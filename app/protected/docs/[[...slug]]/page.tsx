import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { DocMarkdown } from "@/components/docs/doc-markdown";
import { DocsSidebarNav } from "@/components/docs/docs-sidebar-nav";
import { DEFAULT_DOC_SLUG, getDocLabel, isValidDocSlug } from "@/lib/docs/config";
import { loadDocMarkdown } from "@/lib/docs/load-doc";

type PageProps = {
  params: Promise<{ slug?: string[] }>;
};

function resolveSlug(segments: string[] | undefined): string {
  if (segments == null || segments.length === 0) {
    return DEFAULT_DOC_SLUG;
  }
  if (segments.length > 1) {
    return "";
  }
  return segments[0] ?? DEFAULT_DOC_SLUG;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug: segments } = await params;
  const s = resolveSlug(segments);
  if (!s) {
    return { title: "Help Documentation" };
  }
  const label = getDocLabel(s) ?? s;
  return { title: `${label} — Help Documentation` };
}

export default async function DocsPage({ params }: PageProps) {
  const { slug: segments } = await params;
  const slug = resolveSlug(segments);
  if (slug.length === 0) {
    notFound();
  }
  if (!isValidDocSlug(slug)) {
    notFound();
  }

  const markdown = await loadDocMarkdown(slug);

  return (
    <div className="w-full max-w-6xl mx-auto -mt-2">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <aside className="shrink-0 lg:sticky lg:top-20 lg:w-56">
          <DocsSidebarNav currentSlug={slug} />
        </aside>
        <div className="min-w-0 flex-1 pb-20">
          <DocMarkdown markdown={markdown} />
        </div>
      </div>
    </div>
  );
}
