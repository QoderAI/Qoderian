#!/usr/bin/env node
/**
 * Generates synthetic Qoderian session data for load-performance measurement.
 *
 * Writes fixture metadata into `<vault>/.qoderian/sessions/` and (for the
 * legacy sessions that should resolve to a history file) a one-line JSONL
 * under the edition's SDK projects directory. Every generated name carries
 * the `fixture-` prefix, so re-running the script first removes only files
 * created by previous runs — real sessions in the vault are never touched.
 *
 * Usage:
 *   node scripts/generate-session-fixture.mjs --vault /path/to/vault \
 *     [--total 300] [--legacy 100] [--missing 50] [--edition global]
 *
 *   --total    total sessions to generate (default 300)
 *   --legacy   sessions without an `edition` stamp (default total/3)
 *   --missing  legacy sessions with no history file anywhere (default legacy/2)
 *   --edition  edition used for stamps and history placement: global|cn
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FIXTURE_PREFIX = 'fixture-';
const HOME_DIRS = { global: '.qoder', cn: '.qoder-cn' };

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { vault: null, total: 300, legacy: null, missing: null, edition: 'global' };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--vault': args.vault = argv[++i]; break;
      case '--total': args.total = Number(argv[++i]); break;
      case '--legacy': args.legacy = Number(argv[++i]); break;
      case '--missing': args.missing = Number(argv[++i]); break;
      case '--edition': args.edition = argv[++i]; break;
      default: fail(`Unknown argument: ${argv[i]}`);
    }
  }
  if (!args.vault) fail('--vault <path> is required');
  if (!HOME_DIRS[args.edition]) fail('--edition must be global or cn');
  if (!Number.isInteger(args.total) || args.total < 0) fail('--total must be a non-negative integer');
  args.legacy ??= Math.floor(args.total / 3);
  args.missing ??= Math.floor(args.legacy / 2);
  if (args.legacy < 0 || args.legacy > args.total) fail('--legacy must be within [0, total]');
  if (args.missing < 0 || args.missing > args.legacy) fail('--missing must be within [0, legacy]');
  return args;
}

// Mirrors encodeVaultPathForSDK in src/qoder/history/sdk-session-paths.ts.
function encodeVaultPath(vaultPath) {
  return path.resolve(vaultPath).replace(/[^a-zA-Z0-9]/g, '-');
}

function sessionsDir(vault) {
  return path.join(vault, '.qoderian', 'sessions');
}

function projectsDir(edition, vault) {
  return path.join(os.homedir(), HOME_DIRS[edition], 'projects', encodeVaultPath(vault));
}

function removeFixtures(dir, suffix) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith(FIXTURE_PREFIX) && entry.endsWith(suffix)) {
      fs.rmSync(path.join(dir, entry));
      removed += 1;
    }
  }
  return removed;
}

function makeMetadata(id, stamp, edition, index) {
  const timestamp = Date.now() - index * 60_000;
  const metadata = {
    id,
    title: `Fixture session ${index}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastResponseAt: timestamp,
    sessionId: id,
  };
  if (stamp) {
    metadata.edition = edition;
  }
  return metadata;
}

function makeHistoryLine(id) {
  const message = {
    type: 'user',
    uuid: `${id}-line-1`,
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: 'fixture session' },
  };
  return `${JSON.stringify(message)}\n`;
}

const args = parseArgs(process.argv.slice(2));
const vault = path.resolve(args.vault);
if (!fs.existsSync(vault)) fail(`Vault path does not exist: ${vault}`);

const metaDir = sessionsDir(vault);
const otherEdition = args.edition === 'global' ? 'cn' : 'global';

let removed = removeFixtures(metaDir, '.meta.json');
removed += removeFixtures(projectsDir(args.edition, vault), '.jsonl');
removed += removeFixtures(projectsDir(otherEdition, vault), '.jsonl');

fs.mkdirSync(metaDir, { recursive: true });
fs.mkdirSync(projectsDir(args.edition, vault), { recursive: true });

const randomSuffix = () => Math.random().toString(16).slice(2, 10);
let stampedCount = 0;
let legacyWithFileCount = 0;
let missingCount = 0;

for (let index = 0; index < args.total; index += 1) {
  const id = `${FIXTURE_PREFIX}${index}-${randomSuffix()}`;
  const isLegacy = index >= args.total - args.legacy;
  const isMissing = isLegacy && index >= args.total - args.missing;

  fs.writeFileSync(
    path.join(metaDir, `${id}.meta.json`),
    JSON.stringify(makeMetadata(id, !isLegacy, args.edition, index), null, 2),
  );

  if (isLegacy && !isMissing) {
    fs.writeFileSync(path.join(projectsDir(args.edition, vault), `${id}.jsonl`), makeHistoryLine(id));
    legacyWithFileCount += 1;
  } else if (isMissing) {
    missingCount += 1;
  } else {
    stampedCount += 1;
  }
}

console.log(`Vault: ${vault}`);
console.log(`Removed ${removed} fixture file(s) from previous runs.`);
console.log(`Generated ${args.total} session(s): ${stampedCount} stamped (${args.edition}), `
  + `${legacyWithFileCount} legacy with history, ${missingCount} legacy missing.`);
