// Copies shared repository assets into the website's static dir so the
// published site can reference them without committing duplicates.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const siteDir = join(scriptsDir, "..");
const repoRoot = join(scriptsDir, "..", "..");

const targets = [
  ["assets/preview.png", "static/img/preview.png"],
];

for (const [from, to] of targets) {
  const dest = join(siteDir, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(repoRoot, from), dest);
  console.log(`synced ${from} -> docs/${to}`);
}
