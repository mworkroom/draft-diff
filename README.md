# DraftDiff

Compare two Word documents side by side while retaining their original font colors, highlights, bold text and paragraph formatting. Removed text is marked with a pale red background; added text gets a pale blue background. Moved passages are treated as deletions and additions.

## Use the app

Open [DraftDiff on GitHub Pages](https://mworkroom.github.io/draft-diff/) or run it locally. Choose the **Before** and **After** `.docx` files, then click **Compare**. Files can also be dropped onto the file selection areas. **Try example** loads synthetic documents.

- **Show changes** toggles comparison marks without removing the original formatting.
- **Previous / Next** jumps between changes.
- **Sync scrolling** links the relative scroll positions of the panels.
- Document zoom starts at **100%**. Narrow panels can scroll horizontally; **Fit width** is also available.

Files and filenames are never uploaded. Documents are processed in browser memory and disappear on refresh. External links and images are disconnected. Only the example button fetches synthetic files from the app's own host. There are no analytics, advertisements or external CDNs.

## Run locally

Use Node.js 24.x LTS, version 24.15 or newer.

```sh
npm ci
npm run build
npm start
```

On Windows, double-click **Open DraftDiff.cmd** after building. The launcher starts a detached, hidden local server and opens `http://127.0.0.1:4173/`. It is independent of a temporary preview session and can be reopened after closing the browser. After restarting the computer, run the launcher again. The server only listens on this computer's loopback interface.

To start the server without opening a browser:

```sh
node scripts/launch.mjs --no-open
```

## Scope and limitations

- Supports unencrypted `.docx` files up to 20 MB each. Save older `.doc` files as `.docx` in Word first.
- Compares body and table text. Headers, footers, footnotes and endnotes are displayed but not compared. Formatting-only changes and automatic list numbering changes are not detected.
- Original text formatting is retained as closely as the renderer allows. Fonts, line wrapping, pagination and special objects can differ from Microsoft Word. Pixel-identical Word layout is not guaranteed.
- Documents with existing tracked changes are rejected to avoid misleading results. Accept or reject those changes in Word and save a separate copy first. Text boxes and embedded objects have limited support. Image comparison and OCR are not included.
- Paragraphs are aligned before word-level comparison. Scroll linking is proportional, rather than semantic alignment.
- Archive size, text length and comparison time are bounded. Document text is not written to the console.

## Development

```sh
npm run dev
npm test
npm run build
npm run preview
```

Built with TypeScript, React and Vite. `docx-preview` renders documents, `diff` compares text, and `jszip` validates DOCX archives and removes external relationships. Comparison runs in a Web Worker. The renderer's original DOM and run styles are retained; comparison marks add backgrounds only.

`public/samples/` contains synthetic documents, generated with `node scripts/generate-samples.mjs`. They contain no student work or personal data. Korean and mixed-language text remain supported; the interface and examples are in English.

## Deployment

`.github/workflows/pages.yml` tests and builds `main`, then deploys the resulting `dist/` to GitHub Pages. The Pages source must be **GitHub Actions**. Vite's relative base URL supports the `/draft-diff/` repository path.

Commit source code, the package lockfile, synthetic examples, development logs and deployment configuration. Do not commit `node_modules/`, `dist/`, `work/`, local environment files or real comparison documents.

## Third-party notices

React / React DOM (MIT), docx-preview (Apache-2.0), diff (BSD-3-Clause), and JSZip (MIT option of its dual license). Runtime dependency notices are generated in `public/THIRD_PARTY_LICENSES.txt` during builds. Synthetic samples are generated with `docx` (MIT).
