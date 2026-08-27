import type { App } from 'obsidian';
import { FileSystemAdapter, normalizePath } from 'obsidian';

import type { TurnFileChange } from './turn-file-changes';

/** Format a changed file without exposing the host's absolute vault path. */
export function turnFileDisplayPath(app: App, file: TurnFileChange): string {
  const movedTo = latestMoveTarget(file);
  return movedTo
    ? `${vaultDisplayPath(app, file.filePath)} → ${vaultDisplayPath(app, movedTo)}`
    : vaultDisplayPath(app, file.filePath);
}

export function turnFileName(file: TurnFileChange): string {
  const movedTo = latestMoveTarget(file);
  return movedTo
    ? `${filePathName(file.filePath)} → ${filePathName(movedTo)}`
    : filePathName(file.filePath);
}

export function filePathName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

function vaultDisplayPath(app: App, filePath: string): string {
  const normalized = normalizePath(filePath);
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) {
    return isAbsolutePath(normalized) ? filePathName(normalized) : normalized;
  }

  const basePath = normalizePath(adapter.getBasePath());
  const relativePath = normalized.startsWith(`${basePath}/`)
    ? normalized.slice(basePath.length + 1)
    : normalized;
  return isAbsolutePath(relativePath) ? filePathName(relativePath) : relativePath;
}

function latestMoveTarget(file: TurnFileChange): string | undefined {
  return [...file.diffs].reverse().find(diff => diff.movedTo)?.movedTo;
}

function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[A-Za-z]:\//.test(filePath);
}
