/**
 * Copies docs-site/build → public/docs so the Docusaurus site is served under /docs on the main Next.js app.
 * Run after: pnpm docs:build
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "docs-site", "build");
const dest = path.join(root, "public", "docs");

if (!fs.existsSync(src)) {
  console.error(
    "copy-docs-to-public: missing docs-site/build. Run: pnpm docs:build",
  );
  process.exit(1);
}

if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true });
}
fs.cpSync(src, dest, { recursive: true });
console.log("copy-docs-to-public: copied to public/docs");
