/** In-app help navigation (sidebar for `/protected/docs`). */

export const DEFAULT_DOC_SLUG = "help";

export type DocNavSection = {
  label: string;
  items: readonly { slug: string; label: string }[];
};

export const DOC_NAV: readonly DocNavSection[] = [
  {
    label: "Quick Start Guide",
    items: [
      { slug: "help", label: "Overview" },
      { slug: "quick-start-login", label: "1) Login and App Navigation" },
      { slug: "quick-start-customers", label: "2) Create or Verify Customers" },
      { slug: "quick-start-sequences", label: "3) Create Customer Sequences" },
      { slug: "quick-start-batches", label: "4) Create Batches and Export CSV" },
      { slug: "quick-start-data-logs", label: "5) Review Data Logs and Validate" },
      { slug: "quick-start-sign-out", label: "6) Sign Out and Other Options" },
    ],
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
  {
    label: "Windows Upload Service",
    items: [{ slug: "windows-upload-service", label: "Setup and Operations (.NET)" }],
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
