#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));

const packageJson = readJson('package.json');
const rootManifest = readJson('manifest.json');
const versions = readJson('versions.json');
const changelog = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
const errors = [];

const requireCondition = (condition, message) => {
  if (!condition) errors.push(message);
};

const requiredManifestFields = [
  'id',
  'name',
  'version',
  'minAppVersion',
  'description',
  'author',
  'isDesktopOnly',
];

for (const field of requiredManifestFields) {
  requireCondition(
    Object.hasOwn(rootManifest, field),
    `manifest.json is missing required field "${field}"`,
  );
}

requireCondition(
  packageJson.version === rootManifest.version,
  `package.json version (${packageJson.version}) does not match manifest version (${rootManifest.version})`,
);
requireCondition(
  versions[rootManifest.version] === rootManifest.minAppVersion,
  `versions.json must map ${rootManifest.version} to ${rootManifest.minAppVersion}`,
);
requireCondition(
  /^[a-z0-9-]+$/.test(rootManifest.id)
    && !rootManifest.id.includes('obsidian')
    && !rootManifest.id.endsWith('plugin'),
  `manifest id "${rootManifest.id}" is not valid for the Obsidian community plugin directory`,
);
requireCondition(
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rootManifest.version),
  `manifest version "${rootManifest.version}" is not a valid release version`,
);
requireCondition(
  typeof rootManifest.isDesktopOnly === 'boolean',
  'manifest isDesktopOnly must be a boolean',
);

for (const artifact of ['main.js', 'manifest.json', 'styles.css']) {
  requireCondition(
    fs.existsSync(path.join(rootDir, artifact)),
    `release artifact is missing: ${artifact}`,
  );
}

const escapedVersion = rootManifest.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const changelogLines = changelog.split(/\r?\n/);
const changelogHeading = new RegExp(
  `^## \\[${escapedVersion}\\](?: - \\d{4}-\\d{2}-\\d{2})?\\s*$`,
);
const changelogStart = changelogLines.findIndex(line => changelogHeading.test(line));
const changelogEnd = changelogStart < 0
  ? -1
  : changelogLines.findIndex((line, index) => index > changelogStart && line.startsWith('## ['));
const changelogSection = changelogStart < 0
  ? ''
  : changelogLines
    .slice(changelogStart + 1, changelogEnd < 0 ? undefined : changelogEnd)
    .join('\n')
    .trim();
requireCondition(
  Boolean(changelogSection),
  `CHANGELOG.md must contain a non-empty [${rootManifest.version}] release section`,
);

if (process.env.GITHUB_REF_TYPE === 'tag') {
  requireCondition(
    process.env.GITHUB_REF_NAME === rootManifest.version,
    `release tag (${process.env.GITHUB_REF_NAME}) must exactly match manifest version (${rootManifest.version})`,
  );
}

if (errors.length > 0) {
  console.error(`Release validation failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

console.log(`Release ${rootManifest.version} is ready.`);
