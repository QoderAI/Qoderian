// @ts-check
// Docusaurus config for the Qoderian website (GitHub Pages).
// The site lives inside docs/: curated pages under docs/docs/, while the
// repository markdown at the root (README, CHANGELOG, ...) stays canonical.

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Qoderian",
  tagline: "Qoder CLI embedded in your Obsidian vault.",
  url: "https://qoderai.github.io",
  baseUrl: "/qoderian/",
  organizationName: "QoderAI",
  projectName: "qoderian",
  trailingSlash: false,

  onBrokenLinks: "throw",

  i18n: {
    defaultLocale: "en",
    locales: ["en", "zh-Hans"],
    localeConfigs: {
      en: { label: "English" },
      "zh-Hans": { label: "简体中文" },
    },
  },

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: "./sidebars.js",
          editUrl: "https://github.com/QoderAI/qoderian/edit/main/docs/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: "Qoderian",
        items: [
          {
            type: "localeDropdown",
            position: "right",
          },
          {
            href: "https://github.com/QoderAI/qoderian",
            label: "GitHub",
            position: "right",
          },
        ],
      },
      footer: {
        style: "dark",
        copyright: `Copyright © ${new Date().getFullYear()} Qoder. Built with Docusaurus.`,
      },
    }),
};

export default config;
