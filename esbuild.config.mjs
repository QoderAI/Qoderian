import { execFileSync } from 'child_process';
import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import path from 'path';
import process from 'process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  promises as fsPromises,
  readFileSync,
  watch,
  writeFileSync,
} from 'fs';
import rendererSafeUnrefHelpers from './scripts/renderer-safe-unref.js';

const {
  findUnsafeTimerUnrefSites,
  patchRendererUnsafeUnrefSites,
} = rendererSafeUnrefHelpers;

// Load .env.local if it exists
if (existsSync('.env.local')) {
  const envContent = readFileSync('.env.local', 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^=]+)=["']?(.+?)["']?$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

const prod = process.argv[2] === 'production';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getNamedImportAliases(contents, exportName, moduleNames) {
  const aliases = new Set([exportName]);
  const importPattern = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  let match;

  while ((match = importPattern.exec(contents)) !== null) {
    const [, specifiers, moduleName] = match;
    if (!moduleNames.includes(moduleName)) continue;

    for (const specifier of specifiers.split(',')) {
      const parts = specifier.trim().split(/\s+as\s+/);
      if (parts[0] === exportName) {
        aliases.add(parts[1] ?? exportName);
      }
    }
  }

  return [...aliases];
}

function patchSdkImportMetaUrl(contents) {
  let patched = contents.replace(
    'createRequire(import.meta.url)',
    'createRequire(__filename)',
  );

  // The Qoder SDK is published as ESM and uses its module URL to locate its
  // bundled CLI. Obsidian loads plugins as CommonJS, where `import.meta` is
  // invalid. Qoderian always passes the resolved qodercli path explicitly, so
  // the plugin file URL is sufficient for the SDK's fallback-only lookups.
  patched = patched.replace(/import\.meta\.url/g, "'file://' + __filename");

  for (const alias of getNamedImportAliases(patched, 'createRequire', ['module', 'node:module'])) {
    patched = patched.replace(
      new RegExp(`\\b${escapeRegExp(alias)}\\(import\\.meta\\.url\\)`, 'g'),
      `${alias}(__filename)`,
    );
  }

  for (const alias of getNamedImportAliases(patched, 'fileURLToPath', ['url', 'node:url'])) {
    patched = patched.replace(
      new RegExp(`\\b${escapeRegExp(alias)}\\(import\\.meta\\.url\\)`, 'g'),
      '__filename',
    );
  }

  return patched;
}

const patchSdkImportMeta = {
  name: 'patch-sdk-import-meta',
  setup(build) {
    build.onLoad(
      {
        filter: /[\\/]node_modules[\\/](?:@qoder-ai[\\/]qoder-agent-sdk[\\/]dist[\\/]index\.js)$/,
      },
      async (args) => {
        const contents = await fsPromises.readFile(args.path, 'utf8');
        const patched = patchSdkImportMetaUrl(contents);

        // The patch is a source-level rewrite of whatever shape the published
        // SDK happens to have. If an SDK update introduces an `import.meta`
        // form the patch does not cover, fail the build instead of shipping a
        // bundle that throws at runtime under Obsidian's CJS loader.
        if (/\bimport\.meta\b/.test(patched)) {
          throw new Error(
            `patch-sdk-import-meta left unpatched import.meta references in ${args.path}. `
            + 'Update patchSdkImportMetaUrl() for the new SDK output.',
          );
        }

        return {
          contents: patched,
          loader: 'js',
        };
      },
    );
  },
};

const patchRendererUnsafeUnref = {
  name: 'patch-renderer-unsafe-unref',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0 || !existsSync('main.js')) return;

      const bundlePath = path.join(process.cwd(), 'main.js');
      const originalContents = await fsPromises.readFile(bundlePath, 'utf8');
      const patchedBundle = patchRendererUnsafeUnrefSites(originalContents);

      if (patchedBundle.contents !== originalContents) {
        await fsPromises.writeFile(bundlePath, patchedBundle.contents, 'utf8');
      }

      const unsafeMatches = findUnsafeTimerUnrefSites(patchedBundle.contents);
      if (unsafeMatches.length > 0) {
        const details = unsafeMatches
          .slice(0, 5)
          .map((match) => `line ${match.line}: ${match.snippet}`)
          .join('\n');

        throw new Error(
          `Renderer-unsafe timer .unref() calls remain in main.js:\n${details}`,
        );
      }
    });
  },
};

// Obsidian plugin folder path (set via OBSIDIAN_VAULT env var or .env.local)
const OBSIDIAN_VAULT = process.env.OBSIDIAN_VAULT;
const OBSIDIAN_CONFIG_PATH = OBSIDIAN_VAULT && existsSync(OBSIDIAN_VAULT)
  ? path.join(OBSIDIAN_VAULT, '.obsidian')
  : null;
const OBSIDIAN_PLUGIN_PATH = OBSIDIAN_CONFIG_PATH
  ? path.join(OBSIDIAN_CONFIG_PATH, 'plugins', 'qoderian')
  : null;

const DEV_RELOADER_ID = 'qoderian-dev-reloader';

function copyArtifactsToObsidian(files) {
  if (!OBSIDIAN_PLUGIN_PATH) return;

  if (!existsSync(OBSIDIAN_PLUGIN_PATH)) {
    mkdirSync(OBSIDIAN_PLUGIN_PATH, { recursive: true });
  }

  for (const file of files) {
    const src = path.join(process.cwd(), file);
    if (existsSync(src)) {
      copyFileSync(src, path.join(OBSIDIAN_PLUGIN_PATH, file));
      console.log(`Copied ${file} to Obsidian plugin folder`);
    }
  }
}

// Plugin to copy built files to Obsidian plugin folder
const copyToObsidian = {
  name: 'copy-to-obsidian',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      copyArtifactsToObsidian(['main.js', 'manifest.json', 'styles.css']);
    });
  }
};

// The dev reloader lives in the vault, not in the shipped plugin: it is the only
// way to make Obsidian pick up a fresh main.js without a manual toggle.
function installDevReloader() {
  if (!OBSIDIAN_CONFIG_PATH) return;

  const source = path.join(process.cwd(), 'scripts', 'dev-reloader');
  const destination = path.join(OBSIDIAN_CONFIG_PATH, 'plugins', DEV_RELOADER_ID);
  mkdirSync(destination, { recursive: true });

  for (const file of ['main.js', 'manifest.json']) {
    copyFileSync(path.join(source, file), path.join(destination, file));
  }

  enableDevReloaderOnNextLaunch();
  console.log(`Installed ${DEV_RELOADER_ID} into the vault`);
}

// Obsidian reads community-plugins.json at launch, so a freshly added entry only
// takes effect on restart. Writing it anyway avoids a manual enable step.
function enableDevReloaderOnNextLaunch() {
  const configFile = path.join(OBSIDIAN_CONFIG_PATH, 'community-plugins.json');

  let enabled = [];
  if (existsSync(configFile)) {
    try {
      const parsed = JSON.parse(readFileSync(configFile, 'utf8'));
      if (!Array.isArray(parsed)) return;
      enabled = parsed;
    } catch {
      console.warn('Could not parse community-plugins.json; enable the dev reloader manually.');
      return;
    }
  }

  if (enabled.includes(DEV_RELOADER_ID)) return;

  enabled.push(DEV_RELOADER_ID);
  writeFileSync(configFile, `${JSON.stringify(enabled, null, 2)}\n`);
  console.log(`Enabled ${DEV_RELOADER_ID} (restart Obsidian once to activate it)`);
}

// esbuild only watches modules reachable from src/main.ts, and CSS is assembled
// by a separate script, so stylesheet edits need their own watcher.
function watchStylesheets() {
  const styleDir = path.join(process.cwd(), 'src', 'style');
  if (!existsSync(styleDir)) return;

  let rebuildTimer = null;
  watch(styleDir, { recursive: true }, (_eventType, filename) => {
    if (!filename || !filename.endsWith('.css')) return;

    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      try {
        execFileSync(process.execPath, ['scripts/build-css.mjs'], { stdio: 'inherit' });
        copyArtifactsToObsidian(['styles.css']);
      } catch {
        // build-css.mjs already reported the failure.
      }
    }, 150);
  });

  console.log('Watching src/style for CSS changes');
}

// Injected into the bundle so distributed copies of main.js carry Qoderian's
// MIT notice and preserve the separate terms governing the bundled Qoder SDK.
const licenseBanner = `/*!
 * Qoderian — Qoder CLI embedded in Obsidian
 * Copyright (c) 2026 Qoder
 *
 * Contains code derived from Claudian (https://github.com/YishenTu/claudian),
 * authored by Yishen Tu. Claudian's upstream MIT copyright notice is retained
 * verbatim:
 * Copyright (c) 2025
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * The bundled @qoder-ai/qoder-agent-sdk package is governed by the Qoder
 * Product Service Terms: https://qoder.com/product-service
 */`;

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  banner: { js: licenseBanner },
  plugins: [
    patchSdkImportMeta,
    patchRendererUnsafeUnref,
    ...(prod ? [] : [copyToObsidian]),
  ],
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtinModules,
    ...builtinModules.map(m => `node:${m}`),
  ],
  format: 'cjs',
  loader: { '.svg': 'text' },
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  installDevReloader();
  watchStylesheets();
  await context.watch();
}
