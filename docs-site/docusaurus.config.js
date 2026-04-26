// Served from the main Next.js app at /docs/ (see scripts/copy-docs-to-public.cjs).
// Set NEXT_PUBLIC_SITE_URL in production if canonical URLs should use your real domain.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  "http://localhost:3000";
/** App root on the same origin (not under /docs/). Baked at docs build time from env — see `docs-site/docs/local-development.md`. */
const appOriginHref = new URL("/", siteUrl).href;

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'WasteZero',
  tagline: 'Help & Documentation',
  url: siteUrl,
  // Must match where static files are mounted in public/docs (trailing slash).
  baseUrl: "/docs/",
  organizationName: 'wastezero',
  projectName: 'wastezero-docs',
  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',
  markdown: {
    mermaid: true,
  },
  themes: ['@docusaurus/theme-mermaid'],
  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],
  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: 'Back to TrakByWz App',
        // Docusaurus requires `src`; we hide the 1×1 image in `custom.css` so only the title shows.
        logo: {
          alt: 'Back to TrakByWz App',
          src: 'img/navbar-logo.svg',
          href: appOriginHref,
          // Default for absolute `href` is a new tab; this keeps navigation in the same tab.
          target: '_self',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docs',
            position: 'left',
            label: 'Docs',
          },
        ],
      },
      footer: {
        style: 'light',
        copyright: `WasteZero © ${new Date().getFullYear()}`,
      },
    }),
};

module.exports = config;
