# Exact KB · shrink any photo, signature or PDF to your form's limit

"File size should be between 20 KB and 50 KB." Exact KB gets your file under the limit, as sharp as that limit allows. It's free, and nothing is uploaded.

**Try it:** https://rajmans123-netizen.github.io/exact-kb/

- **Photos:** pick a limit and get a JPG just under it.
- **Signatures and documents:** "Clean up the paper" removes shadows from a phone photo and makes the paper white.
- **PDFs:** shrink a PDF, or pick several files to make one PDF under the limit.
- **Minimums:** if your form also has a minimum size, the file is filled up to meet it. The picture doesn't change.

## How it works
- A photo is re-encoded as a JPG. Exact KB finds the largest size that fits at 72% quality or better, then the highest quality that fits at that size.
- A PDF's pages are drawn with [pdf.js](https://mozilla.github.io/pdf.js/) and rebuilt as JPG pages using the same search. Text in the new PDF can't be selected.
- Limits are counted the strict way, so the file passes whether a form means 1 KB = 1000 bytes or 1024.
- Everything runs in your browser. Photos and PDFs never leave your device.

The exam shortcuts are a convenience, and limits change with each notice. Check your form's own notice before you upload.

Static site, no build step. Built with Claude for [Raj Tries](https://instagram.com/raj_triess) on Instagram.

MIT licensed.
