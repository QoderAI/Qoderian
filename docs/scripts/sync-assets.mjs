// Copies shared repository assets into the website's static dir so the
// published site can reference them without committing duplicates.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const siteDir = join(scriptsDir, "..");
const repoRoot = join(scriptsDir, "..", "..");

const targets = [
  ["assets/preview.png", "static/img/preview.png"],
  ["assets/social-card.jpg", "static/img/social-card.jpg"],
];

for (const [from, to] of targets) {
  const dest = join(siteDir, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(repoRoot, from), dest);
  console.log(`synced ${from} -> docs/${to}`);
}

// The favicon reuses the plugin icon, but a favicon has no surrounding text
// color for currentColor to inherit, so the theme switch is made explicit:
// black mark on light browser chrome, white on dark.
const favicon = readFileSync(join(repoRoot, "src/assets/qoder-icon.svg"), "utf8")
  .replace('fill="currentColor"', 'class="qf"')
  .replace('stroke="currentColor"', 'class="qs"')
  .replace(
    /<svg[^>]*>/,
    (tag) =>
      `${tag}<style>.qf{fill:#000}.qs{fill:none;stroke:#000}` +
      "@media (prefers-color-scheme: dark){.qf{fill:#fff}.qs{stroke:#fff}}</style>",
  );
const faviconDest = join(siteDir, "static/img/favicon.svg");
mkdirSync(dirname(faviconDest), { recursive: true });
writeFileSync(faviconDest, favicon);
console.log("built src/assets/qoder-icon.svg -> docs/static/img/favicon.svg");
