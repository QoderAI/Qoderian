import type { RewindFilesResult } from '@qoder-ai/qoder-agent-sdk';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { isPathWithinDirectory } from '../../core/fs/path';
import type { ChatRewindMode, ChatRewindResult } from '../../core/runtime/types';

interface BackupEntryFile {
  originalPath: string;
  existedBefore: true;
  kind: 'file' | 'dir';
  backupPath: string;
}

interface BackupEntrySymlink {
  originalPath: string;
  existedBefore: true;
  kind: 'symlink';
  symlinkTarget: string;
}

interface BackupEntryMissing {
  originalPath: string;
  existedBefore: false;
}

type BackupEntry = BackupEntryFile | BackupEntrySymlink | BackupEntryMissing;

export interface QoderRewindBackup {
  restore: () => Promise<void>;
  cleanup: () => Promise<void>;
}

export interface ExecuteQoderRewindDeps {
  assistantMessageId: string | undefined;
  mode: ChatRewindMode;
  rewindFiles: (userMessageId: string, dryRun?: boolean) => Promise<RewindFilesResult>;
  closePersistentQuery: (reason: string) => Promise<void>;
  setPendingResumeAt: (assistantMessageId: string) => void;
  resetSession: () => void;
  vaultPath: string | null;
  externalContextPaths?: string[];
}

function resolveRewindFilePath(
  filePath: string,
  vaultPath: string | null,
  externalContextPaths: string[],
): string {
  if (!vaultPath || !filePath.trim()) {
    throw new Error('Cannot safely rewind files without a valid vault path.');
  }

  const resolvedPath = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(vaultPath, filePath);
  const allowedRoots = [vaultPath, ...externalContextPaths];
  if (!allowedRoots.some(root => isPathWithinDirectory(resolvedPath, root, root))) {
    throw new Error(`Refusing to rewind a path outside the vault and approved external contexts: ${filePath}`);
  }

  return resolvedPath;
}

async function copyDir(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  const dirents = await fs.readdir(from, { withFileTypes: true });
  for (const dirent of dirents) {
    const srcPath = path.join(from, dirent.name);
    const destPath = path.join(to, dirent.name);

    if (dirent.isDirectory()) {
      await copyDir(srcPath, destPath);
      continue;
    }

    if (dirent.isSymbolicLink()) {
      const target = await fs.readlink(srcPath);
      await fs.symlink(target, destPath);
      continue;
    }

    if (dirent.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

export async function createQoderRewindBackup(
  filesChanged: string[] | undefined,
  vaultPath: string | null,
  externalContextPaths: string[] = [],
): Promise<QoderRewindBackup | null> {
  if (!filesChanged || filesChanged.length === 0) {
    return null;
  }

  const originalPaths = filesChanged.map(filePath => resolveRewindFilePath(
    filePath,
    vaultPath,
    externalContextPaths,
  ));
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qoderian-rewind-'));
  const entries: BackupEntry[] = [];
  const backupPathForIndex = (index: number) => path.join(backupRoot, String(index));

  for (let i = 0; i < originalPaths.length; i++) {
    const originalPath = originalPaths[i];

    try {
      const stats = await fs.lstat(originalPath);

      if (stats.isSymbolicLink()) {
        const target = await fs.readlink(originalPath);
        entries.push({ originalPath, existedBefore: true, kind: 'symlink', symlinkTarget: target });
        continue;
      }

      const backupPath = backupPathForIndex(i);
      if (stats.isDirectory()) {
        await copyDir(originalPath, backupPath);
        entries.push({ originalPath, existedBefore: true, kind: 'dir', backupPath });
        continue;
      }

      if (stats.isFile()) {
        await fs.copyFile(originalPath, backupPath);
        entries.push({ originalPath, existedBefore: true, kind: 'file', backupPath });
        continue;
      }

      entries.push({ originalPath, existedBefore: false });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        entries.push({ originalPath, existedBefore: false });
        continue;
      }

      await fs.rm(backupRoot, { recursive: true, force: true });
      throw error;
    }
  }

  const restore = async () => {
    const errors: unknown[] = [];

    for (const entry of entries) {
      try {
        if (!entry.existedBefore) {
          await fs.rm(entry.originalPath, { recursive: true, force: true });
          continue;
        }

        await fs.rm(entry.originalPath, { recursive: true, force: true });
        await fs.mkdir(path.dirname(entry.originalPath), { recursive: true });

        if (entry.kind === 'symlink') {
          await fs.symlink(entry.symlinkTarget, entry.originalPath);
          continue;
        }

        if (entry.kind === 'dir') {
          await copyDir(entry.backupPath, entry.originalPath);
          continue;
        }

        await fs.copyFile(entry.backupPath, entry.originalPath);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Failed to restore ${errors.length} file(s) after rewind failure.`);
    }
  };

  const cleanup = async () => {
    await fs.rm(backupRoot, { recursive: true, force: true });
  };

  return { restore, cleanup };
}

export async function executeQoderRewind(
  userMessageId: string,
  deps: ExecuteQoderRewindDeps,
): Promise<ChatRewindResult> {
  if (deps.mode === 'conversation') {
    if (deps.assistantMessageId) {
      deps.setPendingResumeAt(deps.assistantMessageId);
      await deps.closePersistentQuery('conversation rewind');
    } else {
      deps.resetSession();
    }
    return { canRewind: true, filesChanged: [] };
  }

  const preview = await deps.rewindFiles(userMessageId, true);
  if (!preview.canRewind) {
    return preview;
  }

  const backup = await createQoderRewindBackup(
    preview.filesChanged,
    deps.vaultPath,
    deps.externalContextPaths,
  );

  try {
    const result = await deps.rewindFiles(userMessageId);
    if (!result.canRewind) {
      await backup?.restore();
      await deps.closePersistentQuery('rewind failed');
      return result;
    }

    if (deps.assistantMessageId) {
      deps.setPendingResumeAt(deps.assistantMessageId);
      await deps.closePersistentQuery('rewind');
    } else {
      deps.resetSession();
    }
    return {
      ...result,
      filesChanged: preview.filesChanged,
      insertions: preview.insertions,
      deletions: preview.deletions,
    };
  } catch (error) {
    try {
      await backup?.restore();
    } catch (rollbackError) {
      await deps.closePersistentQuery('rewind failed');
      throw new Error(
        `Rewind failed and files could not be fully restored: ${rollbackError instanceof Error ? rollbackError.message : 'Unknown error'}`,
        { cause: rollbackError },
      );
    }

    await deps.closePersistentQuery('rewind failed');
    throw new Error(
      `Rewind failed but files were restored: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error },
    );
  } finally {
    await backup?.cleanup();
  }
}
