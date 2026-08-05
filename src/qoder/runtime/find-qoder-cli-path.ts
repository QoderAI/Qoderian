import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { parsePathEntries, resolveNvmDefaultBin } from '../../core/fs/path';

const QODERCLI_PACKAGE_SEGMENTS = ['node_modules', '@qoder-ai', 'qodercli'];
const QODERCLI_NODE_ENTRYPOINT = 'cli.js';

function getEnvValue(name: string): string | undefined {
  return process.env[name];
}

function dedupePaths(entries: string[]): string[] {
  const seen = new Set<string>();
  return entries.filter(entry => {
    const key = process.platform === 'win32' ? entry.toLowerCase() : entry;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findFirstExistingPath(entries: string[], candidates: string[]): string | null {
  for (const dir of entries) {
    if (!dir) continue;
    for (const candidate of candidates) {
      const fullPath = path.join(dir, candidate);
      if (isExistingFile(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

function isExistingFile(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      return stat.isFile();
    }
  } catch {
    // Inaccessible path
  }
  return false;
}

function findQoderCliNodeEntrypoint(packageRoot: string): string | null {
  const candidate = path.join(packageRoot, QODERCLI_NODE_ENTRYPOINT);
  return isExistingFile(candidate) ? candidate : null;
}

function resolveQoderCliEntrypointNearPathEntry(entry: string, isWindows: boolean): string | null {
  const directCandidate = findQoderCliNodeEntrypoint(
    path.join(entry, ...QODERCLI_PACKAGE_SEGMENTS)
  );
  if (directCandidate) {
    return directCandidate;
  }

  const baseName = path.basename(entry).toLowerCase();
  if (baseName === 'bin') {
    const prefix = path.dirname(entry);
    const packageParent = isWindows ? prefix : path.join(prefix, 'lib');
    const candidate = findQoderCliNodeEntrypoint(
      path.join(packageParent, ...QODERCLI_PACKAGE_SEGMENTS)
    );
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function resolveQoderCliEntrypointFromPathEntries(entries: string[], isWindows: boolean): string | null {
  for (const entry of entries) {
    const candidate = resolveQoderCliEntrypointNearPathEntry(entry, isWindows);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function resolveQoderFromPathEntries(
  entries: string[],
  isWindows: boolean
): string | null {
  if (entries.length === 0) {
    return null;
  }

  if (!isWindows) {
    const unixCandidate = findFirstExistingPath(entries, ['qodercli']);
    return unixCandidate;
  }

  const exeCandidate = findFirstExistingPath(entries, ['qodercli.exe', 'qodercli']);
  if (exeCandidate) {
    return exeCandidate;
  }

  const packageEntrypoint = resolveQoderCliEntrypointFromPathEntries(entries, isWindows);
  if (packageEntrypoint) {
    return packageEntrypoint;
  }

  return null;
}

function getNpmGlobalPrefix(): string | null {
  if (process.env.npm_config_prefix) {
    return process.env.npm_config_prefix;
  }

  if (process.platform === 'win32') {
    const appDataNpm = process.env.APPDATA
      ? path.join(process.env.APPDATA, 'npm')
      : null;
    if (appDataNpm && fs.existsSync(appDataNpm)) {
      return appDataNpm;
    }
  }

  return null;
}

function addQoderCliEntrypointPath(paths: string[], packageParent: string): void {
  paths.push(path.join(packageParent, ...QODERCLI_PACKAGE_SEGMENTS, QODERCLI_NODE_ENTRYPOINT));
}

function getNpmQoderCliEntrypointPaths(): string[] {
  const homeDir = os.homedir();
  const isWindows = process.platform === 'win32';
  const entrypointPaths: string[] = [];

  if (isWindows) {
    addQoderCliEntrypointPath(entrypointPaths, path.join(homeDir, 'AppData', 'Roaming', 'npm'));

    const npmPrefix = getNpmGlobalPrefix();
    if (npmPrefix) {
      addQoderCliEntrypointPath(entrypointPaths, npmPrefix);
    }

    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    addQoderCliEntrypointPath(entrypointPaths, path.join(programFiles, 'nodejs', 'node_global'));
    addQoderCliEntrypointPath(entrypointPaths, path.join(programFilesX86, 'nodejs', 'node_global'));
    addQoderCliEntrypointPath(entrypointPaths, path.join('D:', 'Program Files', 'nodejs', 'node_global'));
  } else {
    addQoderCliEntrypointPath(entrypointPaths, path.join(homeDir, '.npm-global', 'lib'));
    addQoderCliEntrypointPath(entrypointPaths, '/usr/local/lib');
    addQoderCliEntrypointPath(entrypointPaths, '/usr/lib');

    if (process.env.npm_config_prefix) {
      addQoderCliEntrypointPath(entrypointPaths, path.join(process.env.npm_config_prefix, 'lib'));
    }
  }

  return entrypointPaths;
}

export function findQoderCLIPath(pathValue?: string): string | null {
  const homeDir = os.homedir();
  const isWindows = process.platform === 'win32';

  const customEntries = dedupePaths(parsePathEntries(pathValue));

  if (customEntries.length > 0) {
    const customResolution = resolveQoderFromPathEntries(customEntries, isWindows);
    if (customResolution) {
      return customResolution;
    }
  }

  // On Windows, prefer native .exe, then the official Node-backed package entrypoint. Avoid .cmd fallback
  // because it requires shell: true and breaks SDK stdio streaming.
  if (isWindows) {
    const exePaths: string[] = [
      path.join(homeDir, '.qoder', 'bin', 'qodercli.exe'),
      path.join(homeDir, 'AppData', 'Local', 'Qoder', 'qodercli.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Qoder', 'qodercli.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Qoder', 'qodercli.exe'),
      path.join(homeDir, '.local', 'bin', 'qodercli.exe'),
    ];

    for (const p of exePaths) {
      if (isExistingFile(p)) {
        return p;
      }
    }

    const packageEntrypointPaths = getNpmQoderCliEntrypointPaths();
    for (const p of packageEntrypointPaths) {
      if (isExistingFile(p)) {
        return p;
      }
    }

  }

  const commonPaths: string[] = [
    // Qoder CLI paths
    path.join(homeDir, '.local', 'bin', 'qodercli'),
    path.join(homeDir, '.qoder', 'bin', 'qodercli'),
    path.join(homeDir, '.volta', 'bin', 'qodercli'),
    path.join(homeDir, '.asdf', 'shims', 'qodercli'),
    path.join(homeDir, '.asdf', 'bin', 'qodercli'),
    path.join(homeDir, 'bin', 'qodercli'),
    path.join(homeDir, '.npm-global', 'bin', 'qodercli'),
    '/usr/local/bin/qodercli',
    '/opt/homebrew/bin/qodercli',
  ];

  const npmPrefix = getNpmGlobalPrefix();
  if (npmPrefix) {
    commonPaths.push(path.join(npmPrefix, 'bin', 'qodercli'));
  }

  // NVM: resolve default version bin when NVM_BIN env var is not available (GUI apps)
  const nvmBin = resolveNvmDefaultBin(homeDir);
  if (nvmBin) {
    commonPaths.push(path.join(nvmBin, 'qodercli'));
  }

  for (const p of commonPaths) {
    if (isExistingFile(p)) {
      return p;
    }
  }

  if (!isWindows) {
    const packageEntrypointPaths = getNpmQoderCliEntrypointPaths();
    for (const p of packageEntrypointPaths) {
      if (isExistingFile(p)) {
        return p;
      }
    }
  }

  const envEntries = dedupePaths(parsePathEntries(getEnvValue('PATH')));
  if (envEntries.length > 0) {
    const envResolution = resolveQoderFromPathEntries(envEntries, isWindows);
    if (envResolution) {
      return envResolution;
    }
  }

  return null;
}
