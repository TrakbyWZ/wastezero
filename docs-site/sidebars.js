/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    'help',
    {
      type: 'category',
      label: 'For Developers',
      collapsed: false,
      items: [
        'architecture',
        'local-development',
        'app-structure-and-database',
        'admin-platforms',
      ],
    },
  ],
};

module.exports = sidebars;
