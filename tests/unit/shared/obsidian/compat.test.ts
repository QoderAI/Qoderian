import type { App, TAbstractFile, Workspace, WorkspaceLeaf } from 'obsidian';

import { openReferenceChip, parseSelectionLineRange, revealWorkspaceLeaf } from '@/shared/obsidian/compat';

const mockShowItemInFolder = jest.fn();

jest.mock('electron', () => ({
  remote: { shell: { showItemInFolder: mockShowItemInFolder } },
}), { virtual: true });

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

    it('reveals an external absolute path in the OS file manager', () => {
      const { app, openFile, revealInFolder } = createMockApp({});
      mockShowItemInFolder.mockClear();

      openReferenceChip(app, 'folder', '/Users/me/Desktop/qoderian-verify');

      expect(mockShowItemInFolder).toHaveBeenCalledWith('/Users/me/Desktop/qoderian-verify');
      expect(openFile).not.toHaveBeenCalled();
      expect(revealInFolder).not.toHaveBeenCalled();
    });
  });
});

describe('selection chip click', () => {
  function createMockAppWithEditor(path: string) {
    const setSelection = jest.fn();
    const scrollIntoView = jest.fn();
    const editor = {
      lineCount: () => 20,
      getLine: () => '0123456789',
      setSelection,
      scrollIntoView,
    };
    const openFile = jest.fn().mockResolvedValue(undefined);
    const app = {
      vault: {
        getAbstractFileByPath: (p: string) => (
          p === path ? { path, basename: 'x.md' } : null
        ),
      },
      workspace: {
        getLeaf: () => ({ openFile, view: { editor } }),
      },
    } as unknown as App;
    return { app, setSelection, scrollIntoView, openFile };
  }

  it('parses line ranges from selection tokens', () => {
    expect(parseSelectionLineRange('@notes/a.md#L6-8')).toEqual({ from: 6, to: 8 });
    expect(parseSelectionLineRange('@notes/a.md#L6')).toEqual({ from: 6, to: 6 });
    expect(parseSelectionLineRange('@notes/a.md')).toBeNull();
    expect(parseSelectionLineRange('@browser:x')).toBeNull();
  });

  it('re-selects the referenced lines when a selection chip is clicked', async () => {
    const { app, setSelection, scrollIntoView } = createMockAppWithEditor('notes/a.md');

    openReferenceChip(app, 'selection', 'notes/a.md', '@notes/a.md#L6-8');
    await Promise.resolve();
    await Promise.resolve();

    expect(setSelection).toHaveBeenCalledWith({ line: 5, ch: 0 }, { line: 7, ch: 10 });
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
