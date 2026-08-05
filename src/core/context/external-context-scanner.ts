/**
 * Qoderian - External Context Scanner
 *
 * Scans configured external context paths for files to include in @-mention dropdown.
 * Features: recursive scanning, caching, and error handling.
 */

import * as fs from 'fs';
import * as path from 'path';

import { normalizePathForFilesystem } from '../fs/path';

export interface ExternalContextFile {
  path: string;
  name: string;
  relativePath: string;
  contextRoot: string;
  /** In milliseconds */
  mtime: number;
}

interface ScanCache {
  files: ExternalContextFile[];
  timestamp: number;
}

interface ScanBudget {
  remaining: number;
}

const CACHE_TTL_MS = 30000;
const MAX_FILES_PER_PATH = 1000;
const MAX_DEPTH = 10;

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '__pycache__',
  'venv',
  '.venv',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  'Pods',
]);

class ExternalContextScanner {
  private cache = new Map<string, ScanCache>();
  private inFlight = new Map<string, Promise<ExternalContextFile[]>>();
  private invalidationVersion = 0;
  private pathVersions = new Map<string, number>();

  async scanPaths(externalContextPaths: string[]): Promise<ExternalContextFile[]> {
    const now = Date.now();
    const filesByPath = await Promise.all(externalContextPaths.map(async contextPath => {
      const expandedPath = normalizePathForFilesystem(contextPath);

      const cached = this.cache.get(expandedPath);
      if (cached && now - cached.timestamp < CACHE_TTL_MS) {
        return this.withRequestedContextRoot(cached.files, contextPath);
      }

      const existingScan = this.inFlight.get(expandedPath);
      if (existingScan) {
        return this.withRequestedContextRoot(await existingScan, contextPath);
      }

      const invalidationVersion = this.invalidationVersion;
      const pathVersion = this.pathVersions.get(expandedPath) ?? 0;
      const scan = this.scanDirectory(
        expandedPath,
        expandedPath,
        0,
        { remaining: MAX_FILES_PER_PATH },
      ).then(files => {
        if (
          invalidationVersion === this.invalidationVersion
          && pathVersion === (this.pathVersions.get(expandedPath) ?? 0)
        ) {
          this.cache.set(expandedPath, { files, timestamp: Date.now() });
        }
        return files;
      }).finally(() => {
        if (this.inFlight.get(expandedPath) === scan) {
          this.inFlight.delete(expandedPath);
        }
      });

      this.inFlight.set(expandedPath, scan);
      return this.withRequestedContextRoot(await scan, contextPath);
    }));

    return filesByPath.flat();
  }

  private withRequestedContextRoot(
    files: ExternalContextFile[],
    contextRoot: string,
  ): ExternalContextFile[] {
    return files.map(file => ({ ...file, contextRoot }));
  }

  private async scanDirectory(
    dir: string,
    contextRoot: string,
    depth: number,
    budget: ScanBudget,
  ): Promise<ExternalContextFile[]> {
    if (depth > MAX_DEPTH || budget.remaining <= 0) return [];

    const files: ExternalContextFile[] = [];

    try {
      const stat = await fs.promises.stat(dir);
      if (!stat.isDirectory()) return [];

      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (budget.remaining <= 0) break;
        if (entry.name.startsWith('.')) continue;
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        // Symlinks can cause infinite recursion and directory escape
        if (entry.isSymbolicLink()) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const subFiles = await this.scanDirectory(fullPath, contextRoot, depth + 1, budget);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          try {
            const fileStat = await fs.promises.stat(fullPath);
            files.push({
              path: fullPath,
              name: entry.name,
              relativePath: path.relative(contextRoot, fullPath),
              contextRoot,
              mtime: fileStat.mtimeMs,
            });
            budget.remaining--;
          } catch {
            // Inaccessible file
          }
        }
      }
    } catch {
      // Inaccessible directory
    }

    return files;
  }

  invalidateCache(): void {
    this.invalidationVersion++;
    this.cache.clear();
    this.inFlight.clear();
  }

  invalidatePath(contextPath: string): void {
    const expandedPath = normalizePathForFilesystem(contextPath);
    this.pathVersions.set(expandedPath, (this.pathVersions.get(expandedPath) ?? 0) + 1);
    this.cache.delete(expandedPath);
    this.inFlight.delete(expandedPath);
  }
}

export const externalContextScanner = new ExternalContextScanner();
