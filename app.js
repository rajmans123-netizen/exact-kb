// Exact KB: shrinks a photo, signature or PDF to a form's KB limit, in the browser. Nothing leaves the device.
// A photo is re-encoded as a JPG: the largest size that still fits at decent quality, then the highest quality that fits.
// PDFs and groups of files become one PDF of JPG pages, searched the same way. Limits are counted the strict way, so the
// file passes whether a form means 1 KB = 1000 bytes or 1024; a form's minimum is met by filling with blank data.
const $ = id => document.getElementById(id);
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const MAX_PAGES = 40, MAX_FILES = 40;
const state = { files: [], url: null };

const fmt = b => b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(1)} KB`;
const fail = msg => { throw Object.assign(new Error(msg), { friendly: true }); };
const say = t => { $('status').textContent = t; };

// ---- reading files
function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(Object.assign(new Error(`${file.name} can't be opened here. HEIC photos only open in Safari: save it as a JPG, or use a screenshot of it, and try again.`), { friendly: true })); };
    img.src = url;
  });
}
function toCanvas(src, w, h, cap) {
  const s = Math.min(1, cap / Math.max(w, h)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);   // JPGs have no transparency
  g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height); return c;
}
function loadPdfjs() {
  if (window.pdfjsLib) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = PDFJS + 'pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; res(); };
    s.onerror = () => rej(Object.assign(new Error('The PDF reader needs the internet the first time. Check your connection and try again.'), { friendly: true }));
    document.head.appendChild(s);
  });
}
async function pdfPages(file) {
  await loadPdfjs();
  let doc;
  try { doc = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise; }
  catch (e) { fail(e && e.name === 'PasswordException' ? `${file.name} has a password. Remove the password and try again.` : `${file.name} can't be opened. It may be damaged.`); }
  if (doc.numPages > MAX_PAGES) fail(`${file.name} has ${doc.numPages} pages. Exact KB handles up to ${MAX_PAGES}.`);
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    say(`Reading page ${i} of ${doc.numPages}`);
    const page = await doc.getPage(i), v1 = page.getViewport({ scale: 1 }), s = Math.min(2.2, 1754 / Math.max(v1.width, v1.height));
    const v = page.getViewport({ scale: s }), c = document.createElement('canvas');
    c.width = Math.round(v.width); c.height = Math.round(v.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: v, intent: 'print' }).promise;   // 'print' doesn't wait on screen frames, so a hidden tab keeps going
    out.push({ canvas: c, ptW: v1.width, ptH: v1.height });
  }
  return out;
}

// ---- cleaning a photographed page: divide by the local paper brightness (which removes shadows), then lift the paper to white
function cleanPaper(c) {
  const W = c.width, H = c.height, k = Math.max(8, Math.round(Math.max(W, H) / 24));
  const small = document.createElement('canvas'); small.width = Math.max(1, Math.round(W / k)); small.height = Math.max(1, Math.round(H / k));
  const sg = small.getContext('2d'); sg.imageSmoothingQuality = 'high'; sg.drawImage(c, 0, 0, small.width, small.height);
  // the paper around a thin signature is the bright part: keep the brightest of each pixel's neighbours
  const sd = sg.getImageData(0, 0, small.width, small.height), src = sd.data.slice(), sw = small.width, sh = small.height;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let r = 0, gg = 0, b = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = Math.min(sh - 1, Math.max(0, y + dy)), xx = Math.min(sw - 1, Math.max(0, x + dx)), i = (yy * sw + xx) * 4;
      r = Math.max(r, src[i]); gg = Math.max(gg, src[i + 1]); b = Math.max(b, src[i + 2]);
    }
    const i = (y * sw + x) * 4; sd.data[i] = r; sd.data[i + 1] = gg; sd.data[i + 2] = b;
  }
  sg.putImageData(sd, 0, 0);
  const bgc = document.createElement('canvas'); bgc.width = W; bgc.height = H;
  const bg = bgc.getContext('2d'); bg.imageSmoothingEnabled = true; bg.imageSmoothingQuality = 'high'; bg.drawImage(small, 0, 0, W, H);
  const g = c.getContext('2d'), im = g.getImageData(0, 0, W, H), d = im.data, p = bg.getImageData(0, 0, W, H).data;
  for (let i = 0; i < d.length; i += 4) for (let ch = 0; ch < 3; ch++) {
    const r = d[i + ch] / Math.max(24, p[i + ch]);                          // 1 = paper, lower = ink
    d[i + ch] = r >= 0.86 ? 255 : Math.max(0, Math.round(255 * Math.pow(r / 0.86, 2.2)));
  }
  g.putImageData(im, 0, 0);
}

// ---- encoding
const encode = (c, q) => new Promise(res => c.toBlob(res, 'image/jpeg', q));
function scaled(c, s) {
  if (s === 1) return c;
  const o = document.createElement('canvas'); o.width = Math.max(1, Math.round(c.width * s)); o.height = Math.max(1, Math.round(c.height * s));
  const g = o.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, o.width, o.height); return o;
}
// the largest size at which quality 72% fits; then the highest quality that fits at that size
async function fitImage(base, maxBytes) {
  const long = Math.max(base.width, base.height); let s = 1, c = base;
  for (;;) {
    say(`Trying ${c.width} × ${c.height} px`);
    const mid = await encode(c, 0.72);
    if (mid.size <= maxBytes) {
      const top = await encode(c, 0.95);
      if (top.size <= maxBytes) return { blob: top, q: 0.95, w: c.width, h: c.height };
      let lo = 0.72, hi = 0.95, blob = mid;
      for (let i = 0; i < 7; i++) { const q = (lo + hi) / 2, b = await encode(c, q); if (b.size <= maxBytes) { lo = q; blob = b; } else hi = q; }
      return { blob, q: lo, w: c.width, h: c.height };
    }
    if (long * s * 0.85 < 160) break;
    s *= 0.85; c = scaled(base, s);
  }
  let lo = 0.2, hi = 0.72, blob = await encode(c, lo);                       // the smallest size: give up quality before failing
  if (blob.size > maxBytes) return { smallest: blob.size };
  for (let i = 0; i < 7; i++) { const q = (lo + hi) / 2, b = await encode(c, q); if (b.size <= maxBytes) { lo = q; blob = b; } else hi = q; }
  return { blob, q: lo, w: c.width, h: c.height, soft: true };
}
// fills a JPG up to a form's minimum with a comment segment: the picture doesn't change
async function padJpeg(blob, target) {
  const need = target - blob.size; if (need <= 0) return blob;
  const src = new Uint8Array(await blob.arrayBuffer()), parts = [src.slice(0, 2)]; let left = Math.max(need, 4);
  while (left > 0) {
    let take = Math.min(left, 65537); if (left - take > 0 && left - take < 4) take -= 4;   // every segment needs its 4-byte header
    const seg = new Uint8Array(take).fill(0x20), len = take - 2;
    seg[0] = 0xFF; seg[1] = 0xFE; seg[2] = len >> 8; seg[3] = len & 255; parts.push(seg); left -= take;
  }
  parts.push(src.slice(2)); return new Blob(parts, { type: 'image/jpeg' });
}

// ---- writing a PDF of JPG pages
async function buildPdf(pages, pad) {
  const te = new TextEncoder(), chunks = [], offs = []; let pos = 0;
  const put = x => { const u = typeof x === 'string' ? te.encode(x) : x; chunks.push(u); pos += u.length; };
  const obj = (n, body) => { offs[n] = pos; put(`${n} 0 obj\n${body}\nendobj\n`); };
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  for (let left = pad; left > 0; left -= 1024) { const n = Math.min(left, 1024); put('%' + ' '.repeat(Math.max(0, n - 2)) + '\n'); }
  const n = pages.length, kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>'); obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  for (let i = 0; i < n; i++) {
    const p = pages[i], a = 3 + i * 3, img = new Uint8Array(await p.jpg.arrayBuffer()), W = p.ptW.toFixed(2), H = p.ptH.toFixed(2);
    obj(a, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /I ${a + 1} 0 R >> >> /Contents ${a + 2} 0 R >>`);
    offs[a + 1] = pos; put(`${a + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`); put(img); put('\nendstream\nendobj\n');
    const content = `q ${W} 0 0 ${H} 0 0 cm /I Do Q`; obj(a + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  const total = 3 + n * 3, xref = pos; let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += `${String(offs[i]).padStart(10, '0')} 00000 n \n`;
  put(`${x}trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
async function encodeAll(pages, s, q) {
  const out = [];
  for (const p of pages) { const c = scaled(p.canvas, s), jpg = await encode(c, q); out.push({ ...p, jpg, w: c.width, h: c.height }); }
  return out;
}
const bytesOf = list => list.reduce((t, p) => t + p.jpg.size, 0);
async function fitPdf(pages, maxBytes) {
  const budget = Math.max(1, maxBytes - (240 + 620 * pages.length));
  const ladder = [1, 0.85, 0.72, 0.6, 0.5, 0.42, 0.35, 0.3, 0.25, 0.2]; let last = null;
  for (const s of ladder) {
    say(`Trying pages at ${Math.round(s * 100)}% size`);
    last = s; const mid = await encodeAll(pages, s, 0.6);
    if (bytesOf(mid) <= budget) {
      let lo = 0.6, hi = 0.92, best = mid;
      for (let i = 0; i < 6; i++) { const q = (lo + hi) / 2, t = await encodeAll(pages, s, q); if (bytesOf(t) <= budget) { lo = q; best = t; } else hi = q; }
      return { list: best, q: lo };
    }
  }
  let lo = 0.2, hi = 0.6, best = await encodeAll(pages, last, lo);
  if (bytesOf(best) > budget) return { smallest: bytesOf(best) + 240 + 620 * pages.length };
  for (let i = 0; i < 5; i++) { const q = (lo + hi) / 2, t = await encodeAll(pages, last, q); if (bytesOf(t) <= budget) { lo = q; best = t; } else hi = q; }
  return { list: best, q: lo, soft: true };
}

// ---- the two jobs
const stem = f => (f.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'file').slice(0, 40);
const tag = size => `${(size / 1000).toFixed(size < 1e4 ? 1 : 0)}KB`;

async function doImage(file, maxBytes, minBytes, clean) {
  if (!clean && file.type === 'image/jpeg' && file.size <= maxBytes) {
    const blob = await padJpeg(file, minBytes), img = await loadImage(file);
    return { blob, w: img.naturalWidth, h: img.naturalHeight, kept: blob.size === file.size, padded: blob.size > file.size, kind: 'jpg' };
  }
  say('Reading your photo');
  const img = await loadImage(file), base = toCanvas(img, img.naturalWidth, img.naturalHeight, maxBytes > 1.5e6 ? 4000 : 2400);
  if (clean) { say('Cleaning the paper'); cleanPaper(base); }
  const fit = await fitImage(base, maxBytes);
  if (fit.smallest) fail(`This can't fit at a readable size. The smallest it gets is ${fmt(fit.smallest)}. Raise the limit, or crop the photo tighter and try again.`);
  const blob = await padJpeg(fit.blob, minBytes);
  return { ...fit, blob, padded: blob.size > fit.blob.size, kind: 'jpg' };
}
async function doPdf(files, maxBytes, minBytes, clean) {
  if (files.length === 1 && files[0].type === 'application/pdf' && !clean && files[0].size <= maxBytes && files[0].size >= minBytes)
    return { blob: files[0], kept: true, kind: 'pdf', pages: null };
  const pages = [];
  for (const f of files) {
    if (f.type === 'application/pdf') pages.push(...await pdfPages(f));
    else { const img = await loadImage(f), c = toCanvas(img, img.naturalWidth, img.naturalHeight, 1754); pages.push({ canvas: c, ptW: 595, ptH: 595 * c.height / c.width }); }
    if (pages.length > MAX_PAGES) fail(`That's more than ${MAX_PAGES} pages. Split it and try again.`);
  }
  if (clean) { say('Cleaning the paper'); pages.forEach(p => cleanPaper(p.canvas)); }
  const fit = await fitPdf(pages, maxBytes);
  if (fit.smallest) fail(`${pages.length} page${pages.length > 1 ? 's' : ''} can't fit at a readable size. The smallest it gets is ${fmt(fit.smallest)}. Raise the limit, or use fewer pages.`);
  let blob = await buildPdf(fit.list, 0), padded = false;
  if (blob.size < minBytes) { blob = await buildPdf(fit.list, minBytes - blob.size + 40); padded = true; }
  return { blob, q: fit.q, soft: fit.soft, kind: 'pdf', pages: pages.length, rebuilt: files.some(f => f.type === 'application/pdf'), padded };
}

// ---- the form
function limitKB() {
  const o = parseFloat($('other').value);
  if (o > 0) return o;
  const r = document.querySelector('input[name=limit]:checked'); return r ? parseFloat(r.value) : 0;
}
const limitText = kb => kb >= 1000 ? `${+(kb / 1000).toFixed(2)} MB` : `${kb} KB`;
function refresh() {
  const kb = limitKB(), has = state.files.length > 0;
  $('go').disabled = !has || !(kb > 0);
  $('go').textContent = !has ? 'Choose a file first' : !(kb > 0) ? 'Pick a limit' : `Shrink to ${limitText(kb)}`;
  $('pdfrow').hidden = !(state.files.length === 1 && state.files[0].type !== 'application/pdf');
}
function showPicked() {
  const f = state.files, box = $('pickedbox'); box.textContent = '';
  if (!f.length) { box.innerHTML = '<strong>Choose a photo, signature or PDF</strong><small>Pick several to make one PDF</small>'; return; }
  const total = f.reduce((t, x) => t + x.size, 0), wrap = document.createElement('span'); wrap.className = 'picked';
  if (f[0].type.startsWith('image/')) { const im = document.createElement('img'); im.alt = ''; im.src = URL.createObjectURL(f[0]); im.onload = () => URL.revokeObjectURL(im.src); wrap.append(im); }
  else { const b = document.createElement('span'); b.className = 'blank'; b.textContent = 'PDF'; wrap.append(b); }
  const t = document.createElement('span'), name = document.createElement('strong'), size = document.createElement('span');
  name.textContent = f.length === 1 ? f[0].name : `${f.length} files, one PDF`; size.className = 'bigsize'; size.textContent = fmt(total); size.style.display = 'block';
  t.append(name, size); wrap.append(t); box.append(wrap);
}
function setFiles(list) {
  const files = [...list].filter(f => f.type.startsWith('image/') || f.type === 'application/pdf' || /\.(heic|heif)$/i.test(f.name));
  $('error').hidden = true; $('result').hidden = true; $('form').hidden = false; say('');
  if (list.length && !files.length) { $('error').textContent = 'That file type isn\'t supported. Choose a photo or a PDF.'; $('error').hidden = false; }
  if (files.length > MAX_FILES) { $('error').textContent = `That's ${files.length} files. Choose up to ${MAX_FILES}.`; $('error').hidden = false; state.files = []; }
  else state.files = files;
  showPicked(); refresh();
}
$('file').addEventListener('change', e => setFiles(e.target.files));
const drop = $('drop');
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
drop.addEventListener('drop', e => { e.preventDefault(); setFiles(e.dataTransfer.files); });
document.querySelectorAll('input[name=limit]').forEach(r => r.addEventListener('change', () => { $('other').value = ''; refresh(); }));
$('other').addEventListener('input', () => { if (parseFloat($('other').value) > 0) document.querySelectorAll('input[name=limit]').forEach(r => { r.checked = false; }); refresh(); });
$('chips').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const max = b.dataset.max, r = document.querySelector(`input[name=limit][value="${max}"]`);
  document.querySelectorAll('input[name=limit]').forEach(x => { x.checked = false; });
  if (r) { r.checked = true; $('other').value = ''; } else $('other').value = max;
  $('min').value = b.dataset.min; refresh();
});

function countDown(el, from, to) {
  const skip = matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden;   // a hidden tab gets no animation frames
  el.textContent = fmt(skip ? to : from);
  if (skip) return Promise.resolve();
  return new Promise(res => {
    const t0 = performance.now(), D = 700;
    const step = now => {
      const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * e));
      if (k < 1) requestAnimationFrame(step); else { el.textContent = fmt(to); res(); }
    };
    requestAnimationFrame(step);
  });
}
async function show(r, kb, before, file) {
  const size = r.blob.size, ext = r.kind === 'pdf' ? 'pdf' : 'jpg', name = `${stem(file)}-${tag(size)}.${ext}`;
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = URL.createObjectURL(r.blob);
  const stage = $('stage'); stage.textContent = '';
  if (r.kind === 'jpg') { const im = document.createElement('img'); im.alt = 'The shrunk file'; im.src = state.url; stage.append(im); }
  else { const b = document.createElement('span'); b.className = 'pdfbadge'; b.textContent = r.pages ? `${r.pages}-page PDF` : 'PDF'; stage.append(b); }
  const lines = [];
  if (r.kept) lines.push('This was already under your limit, so the file is unchanged.');
  else if (r.kind === 'jpg') lines.push(`${r.w} × ${r.h} px JPG`);
  if (r.padded) lines.push(`Your form has a minimum, so blank data fills it up to ${fmt(size)}. The ${r.kind === 'pdf' ? 'pages don\'t' : 'picture doesn\'t'} change.`);
  if (r.rebuilt) lines.push('The pages are now images, so text can\'t be selected. Forms accept this.');
  $('detail').textContent = lines.join(' ');
  $('warn').hidden = !r.soft; $('warn').textContent = r.soft ? 'It\'s soft at this limit. Check that it\'s still clear before you upload, or raise the limit.' : '';
  $('save').href = state.url; $('save').download = name; $('save').textContent = 'Download';
  const shareFile = new File([r.blob], name, { type: r.blob.type });
  const canShare = navigator.canShare && navigator.canShare({ files: [shareFile] });
  $('share').hidden = !canShare; $('share').onclick = () => navigator.share({ files: [shareFile] }).catch(() => {});
  $('before').textContent = fmt(before); $('form').hidden = true; $('result').hidden = false; window.scrollTo(0, 0);
  await countDown($('after'), Math.max(before, size), size);
  const st = document.createElement('div'); st.className = 'stampmark';
  st.innerHTML = '<b>FITS</b><span></span><em></em>'; st.querySelector('span').textContent = fmt(size); st.querySelector('em').textContent = `LIMIT ${limitText(kb)}`;
  stage.append(st); say('');
}
async function run() {
  const kb = limitKB(), minKb = parseFloat($('min').value) || 0;
  $('error').hidden = true; $('result').hidden = true;
  if (minKb >= kb) { $('error').textContent = 'The minimum has to be below your limit.'; $('error').hidden = false; return; }
  const maxBytes = Math.round(kb * 1000) - 100, minBytes = minKb ? Math.min(Math.round(minKb * 1024) + 200, maxBytes) : 0;
  const files = state.files, before = files.reduce((t, f) => t + f.size, 0), clean = $('clean').checked;
  const asPdf = files.length > 1 || files[0].type === 'application/pdf' || $('aspdf').checked;
  $('go').disabled = true;
  try {
    const r = asPdf ? await doPdf(files, maxBytes, minBytes, clean) : await doImage(files[0], maxBytes, minBytes, clean);
    window.__exactkb.last = r; await show(r, kb, before, files[0]);
  } catch (e) {
    say(''); $('error').textContent = e.friendly ? e.message : 'Something went wrong while shrinking this file. Try a different file, or restart your browser if your phone is low on memory.';
    $('error').hidden = false; if (!e.friendly) console.error(e);
  } finally { refresh(); }
}
$('go').addEventListener('click', run);
$('back').addEventListener('click', () => { $('result').hidden = true; $('form').hidden = false; window.scrollTo(0, 0); });
$('again').addEventListener('click', () => {
  $('file').value = ''; setFiles([]); $('clean').checked = false; $('aspdf').checked = false;
  window.scrollTo(0, 0);
});
if (/Instagram|FBAN|FBAV/.test(navigator.userAgent)) $('inapp').hidden = false;
window.__exactkb = { setFiles, run, state, last: null };
refresh();
