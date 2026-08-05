/**
 * Qoderian - External Context Utilities
 *
 * Utilities for external context validation, normalization, and conflict detection.
 */

import * as fs from 'fs';

import { normalizePathForComparison as normalizePathForComparisonImpl } from '../fs/path';

export interface PathConflict {
  path: string;
  type: 'parent' | 'child';
}

/**
 * Normalizes a path for comparison.
 * Re-exports the unified implementation from path.ts for consistency.
 * - Handles MSYS paths, home/env expansions
 * - Case-insensitive on Windows
 * - Trailing slash removed
 */
export function normalizePathForComparison(p: string): string {
  return normalizePathForComparisonImpl(p);
}

function normalizePathForDisplay(p: string): string {
  if (!p) return '';
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function findConflictingPath(
  newPath: string,
  existingPaths: string[]
): PathConflict | null {
  const normalizedNew = normalizePathForComparison(newPath);

  for (const existing of existingPaths) {
    const normalizedExisting = normalizePathForComparison(existing);

    if (normalizedNew.startsWith(normalizedExisting + '/')) {
      return { path: existing, type: 'parent' };
    }

    if (normalizedExisting.startsWith(normalizedNew + '/')) {
      return { path: existing, type: 'child' };
    }
  }

  return null;
}

export function getFolderName(p: string): string {
  const normalized = normalizePathForDisplay(p);
  const segments = normalized.split('/');
  return segments[segments.length - 1] || normalized;
}

export interface ExternalContextDisplayEntry {
  contextRoot: string;
  displayName: string;
  displayNameLower: string;
}

function pathSuffix(segments: string[], depth: number): string {
  return segments.slice(Math.max(0, segments.length - depth)).join('/');
}

export function buildExternalContextDisplayEntries(
  externalContexts: string[]
): ExternalContextDisplayEntry[] {
  const contexts = externalContexts.map(contextRoot => {
    const normalized = normalizePathForComparison(contextRoot);
    const normalizedFolderName = getFolderName(normalized);
    const preferredName = getFolderName(contextRoot) || normalizedFolderName;
    return {
      contextRoot,
      normalized,
      preferredName,
      segments: normalized.split('/').filter(Boolean),
    };
  });

  const preferredNameCounts = new Map<string, number>();
  for (const context of contexts) {
    const key = context.preferredName.toLowerCase();
    preferredNameCounts.set(key, (preferredNameCounts.get(key) ?? 0) + 1);
  }

  const usedDisplayNames = new Map<string, number>();
  return contexts.map(context => {
    let displayName = context.preferredName;
    if ((preferredNameCounts.get(displayName.toLowerCase()) ?? 0) > 1) {
      for (let depth = 2; depth <= context.segments.length; depth++) {
        const candidate = pathSuffix(context.segments, depth);
        const candidateLower = candidate.toLowerCase();
        const duplicate = contexts.some(other =>
          other !== context
          && pathSuffix(other.segments, depth).toLowerCase() === candidateLower
        );
        displayName = candidate;
        if (!duplicate) break;
      }
    }

    const displayNameKey = displayName.toLowerCase();
    const occurrence = (usedDisplayNames.get(displayNameKey) ?? 0) + 1;
    usedDisplayNames.set(displayNameKey, occurrence);
    if (occurrence > 1) {
      displayName = `${displayName} (${occurrence})`;
    }

    return {
      contextRoot: context.contextRoot,
      displayName,
      displayNameLower: displayName.toLowerCase(),
    };
  });
}

export interface DirectoryValidationResult {
  valid: boolean;
  error?: string;
}

export function validateDirectoryPath(p: string): DirectoryValidationResult {
  try {
    const stats = fs.statSync(p);
    if (!stats.isDirectory()) {
      return { valid: false, error: 'Path exists but is not a directory' };
    }
    return { valid: true };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return { valid: false, error: 'Path does not exist' };
    }
    if (error.code === 'EACCES') {
      return { valid: false, error: 'Permission denied' };
    }
    return { valid: false, error: `Cannot access path: ${error.message}` };
  }
}

export function isValidDirectoryPath(p: string): boolean {
  return validateDirectoryPath(p).valid;
}

export function filterValidPaths(paths: string[]): string[] {
  return paths.filter(isValidDirectoryPath);
}

export function isDuplicatePath(newPath: string, existingPaths: string[]): boolean {
  const normalizedNew = normalizePathForComparison(newPath);
  return existingPaths.some(existing => normalizePathForComparison(existing) === normalizedNew);
}
