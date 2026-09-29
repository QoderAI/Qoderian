import useDocusaurusContext from "@docusaurus/useDocusaurusContext";

// Full-page redirect, not a router <Redirect>: Docusaurus router targets are
// resolved without the site baseUrl, so a router-level redirect lands outside
// the /Qoderian/ prefix on GitHub Pages. In non-default locales, siteConfig
// .baseUrl already carries the locale prefix (e.g. /Qoderian/zh-Hans/), so no
// manual locale handling is needed.
export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  if (typeof window !== "undefined") {
    const base = siteConfig.baseUrl.replace(/\/$/, "");
    window.location.replace(`${base}/docs/introduction`);
  }
  return null;
}
