/** In-app help navigation (sidebar for `/protected/docs`). */

export const DEFAULT_DOC_SLUG = "help";

export type DocNavSection = {
  label: string;
  items: readonly { slug: string; label: string }[];
};

export const DOC_NAV: readonly DocNavSection[] = [
  {
    label: "For Users",
    items: [{ slug: "help", label: "Quick Start Guide" }],
  },
  {
    label: "For Developers",
    items: [
      { slug: "architecture", label: "System Overview" },
      { slug: "local-development", label: "Local Development" },
      { slug: "app-structure-and-database", label: "App Structure and Database" },
      { slug: "admin-platforms", label: "Users, GitHub, Supabase, and Vercel" },
    ],
  },
] as const;

export function getAllDocSlugs(): string[] {
  return DOC_NAV.flatMap((section) => section.items.map((i) => i.slug));
}

export function isValidDocSlug(slug: string | undefined): boolean {
  if (slug == null || slug.length === 0) return false;
  return getAllDocSlugs().includes(slug);
}

export function getDocLabel(slug: string): string | undefined {
  for (const section of DOC_NAV) {
    for (const item of section.items) {
      if (item.slug === slug) return item.label;
    }
  }
  return undefined;
}
