import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";

import { getAllDocSlugs } from "./config";

const MD_LINK =
  /\]\((\.\/)([a-z0-9-]+)\.md(#[^)\s]+)?\)/gi;

/**
 * Map legacy `./page.md` links in Markdown to in-app doc routes.
 */
function rewriteInternalLinks(body: string): string {
  return body.replace(
    MD_LINK,
    (_full, _dot: string, name: string, hash: string | undefined) =>
      `](/protected/docs/${name}${hash ?? ""})`,
  );
}

function stripFrontMatter(raw: string): string {
  if (!raw.startsWith("---\n")) return raw;
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return raw;
  return raw.slice(end + 5).trimStart();
}

export const loadDocMarkdown = cache(
  async (slug: string): Promise<string> => {
    if (!getAllDocSlugs().includes(slug)) {
      throw new Error(`Unknown doc slug: ${slug}`);
    }
    const file = path.join(
      process.cwd(),
      "content",
      "docs",
      `${slug}.md`,
    );
    const raw = await readFile(file, "utf8");
    const body = stripFrontMatter(raw);
    return rewriteInternalLinks(body);
  },
);
