import type { App, TAbstractFile, Workspace, WorkspaceLeaf } from 'obsidian';

import { openReferenceChip, revealWorkspaceLeaf } from '@/shared/obsidian/compat';

describe('obsidianCompat', () => {
  describe('revealWorkspaceLeaf', () => {
    it('reveals the workspace leaf', async () => {
      const leaf = {} as WorkspaceLeaf;
      const workspace = {
        revealLeaf: jest.fn().mockResolvedValue(undefined),
      } as unknown as Workspace;

      await revealWorkspaceLeaf(workspace, leaf);

      expect((workspace as unknown as { revealLeaf: jest.Mock }).revealLeaf).toHaveBeenCalledWith(leaf);
    });
  });

  describe('openReferenceChip', () => {
    function createMockFile(path: string): TAbstractFile {
      return { path, basename: path.split('/').pop() ?? path } as unknown as TAbstractFile;
    }

    function createMockFolder(path: string): TAbstractFile {
      return { path, name: path.split('/').pop() ?? path, children: [] } as unknown as TAbstractFile;
    }

    function createMockApp(entries: Record<string, TAbstractFile>): {
      app: App;
      openFile: jest.Mock;
      revealInFolder: jest.Mock;
    } {
      const openFile = jest.fn().mockResolvedValue(undefined);
      const revealInFolder = jest.fn();
      const app = {
        vault: {
          getAbstractFileByPath: (path: string) => entries[path] ?? null,
        },
        workspace: {
          getLeaf: () => ({ openFile }),
        },
        internalPlugins: {
          getPluginById: (id: string) => (
            id === 'file-explorer' ? { instance: { revealInFolder } } : undefined
          ),
        },
      } as unknown as App;
      return { app, openFile, revealInFolder };
    }

    it('opens a file in a leaf when the kind is file', async () => {
      const entry = createMockFile('notes/idea.md');
      const { app, openFile, revealInFolder } = createMockApp({ 'notes/idea.md': entry });

      openReferenceChip(app, 'file', 'notes/idea.md');
      await Promise.resolve();

      expect(openFile).toHaveBeenCalledWith(entry);
      expect(revealInFolder).not.toHaveBeenCalled();
    });

    it('reveals a folder in the file explorer when the kind is folder', () => {
      const entry = createMockFolder('projects');
      const { app, openFile, revealInFolder } = createMockApp({ projects: entry });

      openReferenceChip(app, 'folder', 'projects');

      expect(revealInFolder).toHaveBeenCalledWith(entry);
      expect(openFile).not.toHaveBeenCalled();
    });

    it('falls back to the real type when the file kind is stale', () => {
      // The path used to be a file but is a folder now (or vice versa).
      const entry = createMockFolder('renamed/dir');
      const { app, openFile, revealInFolder } = createMockApp({ 'renamed/dir': entry });

      openReferenceChip(app, 'file', 'renamed/dir');

      expect(revealInFolder).toHaveBeenCalledWith(entry);
      expect(openFile).not.toHaveBeenCalled();
    });

    it('falls back to the real type when the folder kind is stale', async () => {
      const entry = createMockFile('renamed/note.md');
      const { app, openFile, revealInFolder } = createMockApp({ 'renamed/note.md': entry });

      openReferenceChip(app, 'folder', 'renamed/note.md');
      await Promise.resolve();

      expect(openFile).toHaveBeenCalledWith(entry);
      expect(revealInFolder).not.toHaveBeenCalled();
    });

    it('does nothing when the path no longer exists', () => {
      const { app, openFile, revealInFolder } = createMockApp({});

      openReferenceChip(app, 'file', 'gone/note.md');

      expect(openFile).not.toHaveBeenCalled();
      expect(revealInFolder).not.toHaveBeenCalled();
    });
  });
});
