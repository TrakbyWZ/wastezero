/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'WasteZero',
  tagline: 'Help & Documentation',
  url: 'https://your-docs-url.com',
  baseUrl: '/',
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
        title: 'WasteZero',
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
