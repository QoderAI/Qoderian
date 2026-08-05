import { readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const roots = ['src', 'tests', 'scripts'];
const sourceExtension = /\.(?:[cm]?js|tsx?)$/;
const kebabSegment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const invalidFiles = [];

async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(path);
      continue;
    }
    if (!sourceExtension.test(entry.name)) continue;

    const segments = entry.name.replace(sourceExtension, '').split('.');
    if (segments.some((segment) => !kebabSegment.test(segment))) {
      invalidFiles.push(relative(process.cwd(), path));
    }
  }
}

await Promise.all(roots.map((root) => visit(resolve(root))));

if (invalidFiles.length > 0) {
  console.error('Source file names must use kebab-case:');
  for (const file of invalidFiles.sort()) console.error(`- ${file}`);
  process.exitCode = 1;
}
