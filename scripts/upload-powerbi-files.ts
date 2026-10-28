import { readdir } from "node:fs/promises";
import path from "node:path";

import { ZipArchive } from "archiver";
import { put } from "@vercel/blob";

const POWERBI_DIR = path.join(process.cwd(), "powerbi");
const BLOB_PATHNAME = "powerbi/TrakbyWz_Reports.zip";

/**
 * .pbi/ holds Power BI Desktop's local cache (cache.abf) and per-machine
 * settings (localSettings.json) — large, machine-specific, and not needed to
 * reopen the report, so they're excluded from the distributed archive.
 */
function isExcluded(relativePath: string): boolean {
  return relativePath.split(path.sep).includes(".pbi");
}

async function collectFiles(dir: string, baseDir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);
    if (isExcluded(relativePath)) continue;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, baseDir)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function buildZip(): Promise<Buffer> {
  const files = await collectFiles(POWERBI_DIR, POWERBI_DIR);
  if (files.length === 0) {
    throw new Error(`No files found under ${POWERBI_DIR}`);
  }

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on("data", (chunk: Buffer) => chunks.push(chunk));

  for (const file of files) {
    archive.file(file, { name: path.relative(POWERBI_DIR, file) });
  }

  const finalized = archive.finalize();
  await new Promise<void>((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
  });
  await finalized;

  return Buffer.concat(chunks);
}

async function main() {
  const zipBuffer = await buildZip();
  console.log(`Built ${BLOB_PATHNAME} (${zipBuffer.byteLength} bytes)`);

  const blob = await put(BLOB_PATHNAME, zipBuffer, {
    access: "private",
    allowOverwrite: true,
    contentType: "application/zip",
  });

  console.log(`Uploaded to ${blob.pathname}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
