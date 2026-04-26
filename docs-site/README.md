# WasteZero Docs (Docusaurus)

Documentation site built with [Docusaurus](https://docusaurus.io/). It is part of the repo’s pnpm workspace.

## Embedded in the main app (default)

The production app serves these pages at **`/docs` on the same origin** as the Next.js UI (e.g. `https://your-app.vercel.app/docs`).

- A dedicated guide for **developers** — local Supabase, `pnpm dev`, `public/docs`, and how this relates to the Next app — is **`docs/local-development.md`** in this folder (sidebar: *For Developers → Local development*).
- **`docusaurus.config.js`** uses `baseUrl: "/docs/"` and a `url` (and the **app link** in the top-left) derived from `NEXT_PUBLIC_SITE_URL`, `VERCEL_URL`, or `http://localhost:3000` at docs build time so *Back to TrakByWz App* points at the main app, not a path under `/docs/`.
- `pnpm build` at the **repo root** runs `docs:build`, then **`scripts/copy-docs-to-public.cjs`** to copy `docs-site/build` → **`public/docs`**, then `next build`.
- The app navbar includes a **“Help & docs”** link to `/docs/`. Those routes require a **signed-in, allow-listed** user, same as the rest of the app: the request proxy enforces the Supabase session (and the same Docusaurus URL rewrites) before serving the static files.
- For **local** work on the main app, run at least once: `pnpm run docs:build && pnpm run docs:sync` (or a full `pnpm build`) so `public/docs` exists, then `pnpm dev`. To edit docs with hot reload, use `pnpm docs:start` (Docusaurus on **port 3001** at `http://localhost:3001/docs/`) while the app runs on **port 3000**.

Set **`NEXT_PUBLIC_SITE_URL`** in Vercel (e.g. `https://yourdomain.com`) if generated canonical/meta URLs should use your real domain instead of the default `*.vercel.app` host.

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

3. **Run the docs only (Docusaurus dev)** (from repo root):
   ```bash
   pnpm docs:start    # http://localhost:3001/docs/  (port 3001; avoids clashing with Next on 3000)
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

## Deploying on Vercel (optional second project)

If you do **not** use the integrated `/docs` flow above, you can still host the static build on **Vercel** using a **second** project that points at the same GitHub repository as the main app. The Next.js app and the docs are built and deployed **independently** (different builds, different URLs or subdomains — e.g. `app.example.com` vs `docs.example.com`).

1. In [Vercel](https://vercel.com), **Add New…** → **Project** → import this repository (again if the app is already connected).
2. In **Configure Project**:
   - **Root Directory:** set to `docs-site` and click **Edit** to confirm. Vercel will detect `vercel.json` in that folder.
   - **Framework Preset:** *Other* (Docusaurus outputs static files; no need for a Next.js preset on this project).
3. The repo includes [`vercel.json`](./vercel.json) in `docs-site/`, which runs:
   - `install` from the **monorepo root** (`cd .. && pnpm install`) so the pnpm lockfile and workspace are correct
   - `build` in this package (`pnpm run build` → Docusaurus `build/`)
4. **Output** is the `build` folder (already set in `vercel.json`).
5. **Production Branch:** usually `main` (match your main app if you only deploy from `main`).
6. **Environment variables:** the docs static site does **not** need Supabase or app secrets. No env is required for a default build.

**Custom domain:** in this Vercel project, open **Settings** → **Domains** and add e.g. `docs.yourdomain.com` (CNAME/records as Vercel instructs). Keep the app on its own domain in the other project.

**Alternative without Root Directory = `docs-site`:** a single Vercel project with **Root Directory** empty, **Build Command** `pnpm --filter wastezero-docs build`, **Output Directory** `docs-site/build`, **Install Command** `pnpm install` — also valid if you prefer not to use `vercel.json` in `docs-site/`.
