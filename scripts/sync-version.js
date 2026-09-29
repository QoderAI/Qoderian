#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const packagePath = path.join(rootDir, 'package.json');
const manifestPath = path.join(rootDir, 'manifest.json');
const versionsPath = path.join(rootDir, 'versions.json');
const lockPath = path.join(rootDir, 'package-lock.json');

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifestJson.version = packageJson.version;
const minAppVersion = manifestJson.minAppVersion;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifestJson, null, 2)}\n`);

const lockJson = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
lockJson.version = packageJson.version;
if (lockJson.packages && lockJson.packages['']) {
  lockJson.packages[''].version = packageJson.version;
}
fs.writeFileSync(lockPath, `${JSON.stringify(lockJson, null, 2)}\n`);

const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
versions[packageJson.version] = minAppVersion;
const sortedVersions = Object.fromEntries(
  Object.entries(versions).sort(([left], [right]) =>
    left.localeCompare(right, undefined, { numeric: true }),
  ),
);
fs.writeFileSync(versionsPath, `${JSON.stringify(sortedVersions, null, 2)}\n`);

console.log(`Synced manifest.json, versions.json and package-lock.json to ${packageJson.version}`);
