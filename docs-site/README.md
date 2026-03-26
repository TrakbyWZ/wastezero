# WasteZero Docs (Docusaurus)

Documentation site built with [Docusaurus](https://docusaurus.io/). This package is part of the repo’s pnpm workspace, so install and run from the **repo root** for the smoothest experience.

## Setup

1. **Install dependencies** (from repo root; this installs the main app and docs-site):
   ```bash
   pnpm install
   ```

2. **Copy images** (for the Quick Start guide) into this site’s static folder:
   ```bash
   # From repo root (Unix/macOS)
   cp docs/images/*.png docs-site/static/img/
   ```
   On Windows (PowerShell):  
   `Copy-Item docs\images\*.png docs-site\static\img\`

3. **Run the docs** (from repo root):
   ```bash
   pnpm docs:start    # dev server at http://localhost:3000
   ```
   Or build static files:
   ```bash
   pnpm docs:build    # output in docs-site/build/
   ```

**From this directory:** you can also run `pnpm install` and then `pnpm start` or `pnpm build` inside `docs-site/`. The scripts use `pnpm exec docusaurus` so the local Docusaurus CLI is used.

## Structure

- `docs/` — Markdown (help.md = Quick Start, served at site root)
- `static/img/` — Images (e.g. help-login.png, help-menu.png)
- `sidebars.js` — Sidebar order
- `docusaurus.config.js` — Site title, navbar, theme

## Build output

`pnpm docs:build` (from root) or `pnpm build` (from this directory) writes static files to `docs-site/build/`. Deploy that folder to any static host (Vercel, Netlify, GitHub Pages, etc.).
