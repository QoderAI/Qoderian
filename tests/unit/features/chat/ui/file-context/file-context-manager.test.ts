import { createMockEl, type MockElement } from '@test/helpers/mock-element';
import { TFile } from 'obsidian';

import type { ExternalContextFile } from '@/core/context/external-context-scanner';
import type { FileContextCallbacks } from '@/features/chat/ui/file-context/file-context-manager';
import { FileContextManager } from '@/features/chat/ui/file-context/file-context-manager';
import { VaultFolderCache } from '@/shared/mention/vault-folder-cache';

jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');
  return {
    ...actual,
    setIcon: jest.fn(),
  };
});

function createMockTFile(filePath: string): TFile {
  const file = new (TFile as any)(filePath) as TFile;
  (file as any).stat = { mtime: Date.now(), ctime: Date.now(), size: 0 };
  return file;
}

let mockVaultPath = '/vault';
jest.mock('@/core/fs/path', () => {
  const actual = jest.requireActual('@/core/fs/path');
  return {
    ...actual,
    getVaultPath: jest.fn(() => mockVaultPath),
    isPathWithinVault: jest.fn((candidatePath: string, vaultPath: string) => {
      if (!candidatePath) return false;
      if (!candidatePath.startsWith('/')) return true;
      return candidatePath.startsWith(vaultPath);
    }),
  };
});

const mockScanPaths = jest.fn<ExternalContextFile[], [string[]]>(() => []);
jest.mock('@/core/context/external-context-scanner', () => ({
  externalContextScanner: {
    scanPaths: (paths: string[]) => mockScanPaths(paths),
  },
}));


function findByClass(root: MockElement, className: string): MockElement | undefined {
  if (root.hasClass(className)) return root;
  for (const child of root.children) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return undefined;
}

function findAllByClass(root: MockElement, className: string): MockElement[] {
  const results: MockElement[] = [];
  const walk = (node: MockElement) => {
    if (node.hasClass(className)) {
      results.push(node);
    }
    node.children.forEach(walk);
  };
  walk(root);
  return results;
}

function createMockApp(options: {
  files?: string[];
  activeFilePath?: string | null;
  fileCacheByPath?: Map<string, any>;
} = {}) {
  const { files = [], activeFilePath = null, fileCacheByPath = new Map() } = options;
  const fileMap = new Map<string, TFile>();
  files.forEach((filePath) => {
    fileMap.set(filePath, createMockTFile(filePath));
  });

  return {
    vault: {
      on: jest.fn(() => ({ id: 'event-ref' })),
      offref: jest.fn(),
      getAbstractFileByPath: jest.fn((filePath: string) => fileMap.get(filePath) || null),
      getAllLoadedFiles: jest.fn(() => Array.from(fileMap.values())),
      getFiles: jest.fn(() => Array.from(fileMap.values())),
    },
    workspace: {
      getActiveFile: jest.fn(() => {
        if (!activeFilePath) return null;
        return fileMap.get(activeFilePath) || createMockTFile(activeFilePath);
      }),
      getLeaf: jest.fn(() => ({
        openFile: jest.fn().mockResolvedValue(undefined),
      })),
    },
    metadataCache: {
      getFileCache: jest.fn((file: TFile) => fileCacheByPath.get(file.path) || null),
    },
  } as any;
}

function createMockCallbacks(options: {
  externalContexts?: string[];
  excludedTags?: string[];
} = {}): FileContextCallbacks {
  const { externalContexts = [], excludedTags = [] } = options;
  return {
    getExcludedTags: jest.fn(() => excludedTags),
    getExternalContexts: jest.fn(() => externalContexts),
  };
}

/** Picks a file from the @ dropdown, which attaches it to the manager state. */
function attachViaMention(
  manager: FileContextManager,
  inputEl: HTMLTextAreaElement,
  query: string,
): void {
  inputEl.value = `@${query}`;
  inputEl.selectionStart = inputEl.value.length;
  inputEl.selectionEnd = inputEl.value.length;
  manager.handleInputChange();
  jest.advanceTimersByTime(200);
  manager.handleMentionKeydown({ key: 'Enter', preventDefault: jest.fn() } as any);
}

describe('FileContextManager', () => {
  let containerEl: MockElement;
  let inputEl: HTMLTextAreaElement;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockVaultPath = '/vault';
    mockScanPaths.mockReturnValue([]);
    containerEl = createMockEl();
    inputEl = {
      value: '',
      selectionStart: 0,
      selectionEnd: 0,
      focus: jest.fn(),
    } as unknown as HTMLTextAreaElement;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves the current note from the active file', () => {
    const app = createMockApp({
      files: ['notes/alpha.md'],
      activeFilePath: 'notes/alpha.md',
    });
    const manager = new FileContextManager(
      app,
      containerEl as any,
      inputEl,
      createMockCallbacks()
    );

    expect(manager.getCurrentNotePath()).toBe('notes/alpha.md');

    app.workspace.getActiveFile = jest.fn(() => null);
    expect(manager.getCurrentNotePath()).toBeNull();

    manager.destroy();
  });

  it('resolves the current note from the most recent file even when the sidebar is focused', () => {
    const app = createMockApp({
      files: ['notes/alpha.md', 'notes/beta.md'],
      activeFilePath: 'notes/alpha.md',
    });
    const manager = new FileContextManager(
      app,
      containerEl as any,
      inputEl,
      createMockCallbacks()
    );

    expect(manager.getCurrentNotePath()).toBe('notes/alpha.md');

    // Switching notes is picked up without any file-open bookkeeping.
    app.workspace.getActiveFile = jest.fn(() => createMockTFile('notes/beta.md'));
    expect(manager.getCurrentNotePath()).toBe('notes/beta.md');

    manager.destroy();
  });

  it('does not resolve a current note with an excluded tag', () => {
    const fileCacheByPath = new Map<string, any>([
      ['notes/private.md', { frontmatter: { tags: ['private'] } }],
    ]);
    const app = createMockApp({
      files: ['notes/private.md', 'notes/public.md'],
      activeFilePath: 'notes/private.md',
      fileCacheByPath,
    });

    const manager = new FileContextManager(
      app,
      containerEl as any,
      inputEl,
      createMockCallbacks({ excludedTags: ['private'] })
    );

    expect(manager.getCurrentNotePath()).toBeNull();

    app.workspace.getActiveFile = jest.fn(() => createMockTFile('notes/public.md'));
    expect(manager.getCurrentNotePath()).toBe('notes/public.md');

    manager.destroy();
  });

  it('shows vault-relative path in @ dropdown and inserts full path on selection', () => {
    const app = createMockApp({
      files: ['clipping/file.md'],
    });
    const manager = new FileContextManager(
      app,
      containerEl as any,
      inputEl,
      createMockCallbacks()
    );

    inputEl.value = '@file';
    inputEl.selectionStart = 5;
    inputEl.selectionEnd = 5;
    manager.handleInputChange();
    jest.advanceTimersByTime(200);

    const pathEl = findByClass(containerEl, 'qoderian-mention-path');
    expect(pathEl?.textContent).toBe('clipping/file.md');

    manager.handleMentionKeydown({ key: 'Enter', preventDefault: jest.fn() } as any);

    // Now inserts full vault-relative path (WYSIWYG)
    expect(inputEl.value).toBe('@clipping/file.md ');
    const attached = manager.getAttachedFiles();
    expect(attached.has('clipping/file.md')).toBe(true);

    manager.destroy();
  });

  it('wires getCachedVaultFolders through VaultFolderCache.getFolders', () => {
    const folder = { name: 'src', path: 'src' } as any;
    const getFoldersSpy = jest
      .spyOn(VaultFolderCache.prototype, 'getFolders')
      .mockReturnValue([folder]);
    const app = createMockApp();
    const manager = new FileContextManager(
      app,
      containerEl as any,
      inputEl,
      createMockCallbacks()
    );

    inputEl.value = '@src';
    inputEl.selectionStart = 4;
    inputEl.selectionEnd = 4;
    manager.handleInputChange();
    jest.advanceTimersByTime(200);

    expect(getFoldersSpy).toHaveBeenCalled();
    const folderLabel = findByClass(containerEl, 'qoderian-mention-name-folder');
    expect(folderLabel?.textContent).toBe('@src/');

    manager.destroy();
    getFoldersSpy.mockRestore();
  });

  it('filters context files and attaches absolute path', async () => {
    const app = createMockApp();
    const manager = new FileContextManager(
      app,
      containerEl as any,
      inputEl,
      createMockCallbacks({ externalContexts: ['/external'] })
    );

    const contextFiles: ExternalContextFile[] = [
      {
        path: '/external/src/app.md',
        name: 'app.md',
        relativePath: 'src/app.md',
        contextRoot: '/external',
        mtime: 1000,
      },
    ];
    mockScanPaths.mockReturnValue(contextFiles);

    inputEl.value = '@external/app';
    inputEl.selectionStart = 13;
    inputEl.selectionEnd = 13;
    manager.handleInputChange();
    await jest.advanceTimersByTimeAsync(200);

    const nameEls = findAllByClass(containerEl, 'qoderian-mention-name-context');
    expect(nameEls[0]?.textContent).toBe('src/app.md');

    manager.handleMentionKeydown({ key: 'Enter', preventDefault: jest.fn() } as any);

    // Display shows friendly name, but state stores mapping to absolute path
    expect(inputEl.value).toBe('@external/src/app.md ');
    const attached = manager.getAttachedFiles();
    expect(attached.has('/external/src/app.md')).toBe(true);
    // Check transformation works
    const transformed = await manager.transformContextMentions('@external/src/app.md');
    expect(transformed).toBe('/external/src/app.md');

    manager.destroy();
  });

  it('transforms a bare external root mention to its absolute path', async () => {
    const app = createMockApp();
    const manager = new FileContextManager(
      app,
      containerEl as any,
      inputEl,
      createMockCallbacks({ externalContexts: ['/external'] })
    );
    mockScanPaths.mockReturnValue([]);

    const transformed = await manager.transformContextMentions('Explain @external/ then continue.');
    expect(transformed).toBe('Explain /external then continue.');

    manager.destroy();
  });

  it('transforms pasted external context mention to absolute path without dropdown selection', async () => {
    const app = createMockApp();
    const manager = new FileContextManager(
      app,
      containerEl as any,
      inputEl,
      createMockCallbacks({ externalContexts: ['/external'] })
    );

    const contextFiles: ExternalContextFile[] = [
      {
        path: '/external/src/app.md',
        name: 'app.md',
        relativePath: 'src/app.md',
        contextRoot: '/external',
        mtime: 1000,
      },
    ];
    mockScanPaths.mockReturnValue(contextFiles);

    const transformed = await manager.transformContextMentions('Please review @external/src/app.md before merging.');
    expect(transformed).toBe('Please review /external/src/app.md before merging.');

    manager.destroy();
  });

  it('transforms pasted external context mention with spaces in path', async () => {
    const app = createMockApp();
    const manager = new FileContextManager(
      app,
      containerEl as any,
      inputEl,
      createMockCallbacks({ externalContexts: ['/external'] })
    );

    const contextFiles: ExternalContextFile[] = [
      {
        path: '/external/src/my file.md',
        name: 'my file.md',
        relativePath: 'src/my file.md',
        contextRoot: '/external',
        mtime: 1000,
      },
    ];
    mockScanPaths.mockReturnValue(contextFiles);

    const transformed = await manager.transformContextMentions('Please review @external/src/my file.md before merging.');
    expect(transformed).toBe('Please review /external/src/my file.md before merging.');

    manager.destroy();
  });

  it('keeps trailing punctuation when transforming pasted external context mention', async () => {
    const app = createMockApp();
    const manager = new FileContextManager(
      app,
      containerEl as any,
      inputEl,
      createMockCallbacks({ externalContexts: ['/external'] })
    );

    const contextFiles: ExternalContextFile[] = [
      {
        path: '/external/src/app.md',
        name: 'app.md',
        relativePath: 'src/app.md',
        contextRoot: '/external',
        mtime: 1000,
      },
    ];
    mockScanPaths.mockReturnValue(contextFiles);

    const transformed = await manager.transformContextMentions('Check @external/src/app.md, then continue.');
    expect(transformed).toBe('Check /external/src/app.md, then continue.');

    manager.destroy();
  });

  it('resolves pasted mention using disambiguated external context display name', async () => {
    const app = createMockApp();
    const manager = new FileContextManager(
      app,
      containerEl as any,
      inputEl,
      createMockCallbacks({
        externalContexts: ['/work/a/external', '/work/b/external'],
      })
    );

    mockScanPaths.mockImplementation((paths: string[]) => {
      const contextRoot = paths[0];
      if (contextRoot === '/work/a/external') {
        return [
          {
            path: '/work/a/external/src/app.md',
            name: 'app.md',
            relativePath: 'src/app.md',
            contextRoot: '/work/a/external',
            mtime: 1000,
          },
        ];
      }

      if (contextRoot === '/work/b/external') {
        return [
          {
            path: '/work/b/external/src/app.md',
            name: 'app.md',
            relativePath: 'src/app.md',
            contextRoot: '/work/b/external',
            mtime: 1000,
          },
        ];
      }

      return [];
    });

    const transformed = await manager.transformContextMentions('Use @a/external/src/app.md from workspace A');
    expect(transformed).toBe('Use /work/a/external/src/app.md from workspace A');

    manager.destroy();
  });

  describe('conversation boundaries', () => {
    it('clears tracked composer references at conversation boundaries', () => {
      const app = createMockApp();
      const onReferencesChanged = jest.fn();
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, { ...createMockCallbacks(), onReferencesChanged }
      );

      manager.registerComposerReference({ token: '@a.md', path: 'a.md', kind: 'file' });
      expect(onReferencesChanged).toHaveBeenLastCalledWith(
        [expect.objectContaining({ token: '@a.md' })],
      );

      manager.resetForNewConversation();
      expect(onReferencesChanged).toHaveBeenLastCalledWith([]);

      manager.registerComposerReference({ token: '@b.md', path: 'b.md', kind: 'file' });
      manager.resetForLoadedConversation();
      expect(onReferencesChanged).toHaveBeenLastCalledWith([]);
      manager.destroy();
    });
  });

  describe('file rename handling', () => {
    it('rewrites composer reference tokens when the file is renamed', () => {
      const app = createMockApp({ files: ['notes/old.md', 'notes/new.md'] });
      const onReferencesChanged = jest.fn();
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, { ...createMockCallbacks(), onReferencesChanged }
      );

      manager.registerComposerReference({
        token: '@notes/old.md', path: 'notes/old.md', kind: 'file',
      });
      inputEl.value = 'See @notes/old.md for details';

      const renameHandler = (app.vault.on as jest.Mock).mock.calls
        .find((c: any[]) => c[0] === 'rename')?.[1];
      expect(renameHandler).toBeDefined();

      renameHandler(createMockTFile('notes/new.md'), 'notes/old.md');

      expect(inputEl.value).toBe('See @notes/new.md for details');
      expect(onReferencesChanged).toHaveBeenLastCalledWith(
        [expect.objectContaining({ token: '@notes/new.md', path: 'notes/new.md' })],
      );
      manager.destroy();
    });

    it('should update attached files when renamed', () => {
      const app = createMockApp({ files: ['notes/old.md'] });
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );

      attachViaMention(manager, inputEl, 'old');
      expect(manager.getAttachedFiles().has('notes/old.md')).toBe(true);

      const renameHandler = (app.vault.on as jest.Mock).mock.calls
        .find((c: any[]) => c[0] === 'rename')?.[1];

      renameHandler(createMockTFile('notes/new.md'), 'notes/old.md');
      expect(manager.getAttachedFiles().has('notes/new.md')).toBe(true);
      expect(manager.getAttachedFiles().has('notes/old.md')).toBe(false);
      manager.destroy();
    });
  });

  describe('file delete handling', () => {
    it('drops composer references when the file is deleted', () => {
      const app = createMockApp({ files: ['notes/a.md'] });
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );

      manager.registerComposerReference({ token: '@notes/a.md', path: 'notes/a.md', kind: 'file' });
      inputEl.value = 'See @notes/a.md';

      const deleteHandler = (app.vault.on as jest.Mock).mock.calls
        .find((c: any[]) => c[0] === 'delete')?.[1];
      expect(deleteHandler).toBeDefined();

      deleteHandler(createMockTFile('notes/a.md'));
      expect(inputEl.value).toBe('See ');
      manager.destroy();
    });

    it('should remove deleted file from attached files', () => {
      const app = createMockApp({ files: ['notes/a.md'] });
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );

      attachViaMention(manager, inputEl, 'a');
      expect(manager.getAttachedFiles().has('notes/a.md')).toBe(true);

      const deleteHandler = (app.vault.on as jest.Mock).mock.calls
        .find((c: any[]) => c[0] === 'delete')?.[1];

      deleteHandler(createMockTFile('notes/a.md'));
      expect(manager.getAttachedFiles().has('notes/a.md')).toBe(false);
      manager.destroy();
    });
  });

  describe('hasExcludedTag edge cases', () => {
    it('should exclude file with inline tags (not just frontmatter)', () => {
      const fileCacheByPath = new Map<string, any>([
        ['notes/tagged.md', {
          tags: [{ tag: '#system', position: { start: { line: 5, col: 0 }, end: { line: 5, col: 7 } } }],
        }],
      ]);
      const app = createMockApp({
        files: ['notes/tagged.md'],
        activeFilePath: 'notes/tagged.md',
        fileCacheByPath,
      });

      const manager = new FileContextManager(
        app, containerEl as any, inputEl,
        createMockCallbacks({ excludedTags: ['system'] })
      );

      expect(manager.getCurrentNotePath()).toBeNull();
      manager.destroy();
    });

    it('should exclude file with string frontmatter tag (not array)', () => {
      const fileCacheByPath = new Map<string, any>([
        ['notes/single-tag.md', { frontmatter: { tags: 'private' } }],
      ]);
      const app = createMockApp({
        files: ['notes/single-tag.md'],
        activeFilePath: 'notes/single-tag.md',
        fileCacheByPath,
      });

      const manager = new FileContextManager(
        app, containerEl as any, inputEl,
        createMockCallbacks({ excludedTags: ['private'] })
      );

      expect(manager.getCurrentNotePath()).toBeNull();
      manager.destroy();
    });

    it('should handle tags with # prefix in cache', () => {
      const fileCacheByPath = new Map<string, any>([
        ['notes/hash-tag.md', { frontmatter: { tags: ['#draft'] } }],
      ]);
      const app = createMockApp({
        files: ['notes/hash-tag.md'],
        activeFilePath: 'notes/hash-tag.md',
        fileCacheByPath,
      });

      const manager = new FileContextManager(
        app, containerEl as any, inputEl,
        createMockCallbacks({ excludedTags: ['draft'] })
      );

      expect(manager.getCurrentNotePath()).toBeNull();
      manager.destroy();
    });

    it('should match excluded tags without case sensitivity', () => {
      const fileCacheByPath = new Map<string, any>([
        ['notes/system.md', { frontmatter: { tags: ['#system'] } }],
      ]);
      const app = createMockApp({
        files: ['notes/system.md'],
        activeFilePath: 'notes/system.md',
        fileCacheByPath,
      });
      const manager = new FileContextManager(
        app, containerEl as any, inputEl,
        createMockCallbacks({ excludedTags: ['#System'] })
      );

      expect(manager.getCurrentNotePath()).toBeNull();
      manager.destroy();
    });

    it('should exclude nested tags when their parent tag is excluded', () => {
      const fileCacheByPath = new Map<string, any>([
        ['notes/project.md', { frontmatter: { tags: ['private/project'] } }],
      ]);
      const app = createMockApp({
        files: ['notes/project.md'],
        activeFilePath: 'notes/project.md',
        fileCacheByPath,
      });
      const manager = new FileContextManager(
        app, containerEl as any, inputEl,
        createMockCallbacks({ excludedTags: ['private'] })
      );

      expect(manager.getCurrentNotePath()).toBeNull();
      manager.destroy();
    });

    it('should not exclude unrelated tags with the same prefix', () => {
      const fileCacheByPath = new Map<string, any>([
        ['notes/privateer.md', { frontmatter: { tags: ['privateer'] } }],
      ]);
      const app = createMockApp({
        files: ['notes/privateer.md'],
        activeFilePath: 'notes/privateer.md',
        fileCacheByPath,
      });
      const manager = new FileContextManager(
        app, containerEl as any, inputEl,
        createMockCallbacks({ excludedTags: ['private'] })
      );

      expect(manager.getCurrentNotePath()).toBe('notes/privateer.md');
      manager.destroy();
    });
  });

  describe('cache dirty marking', () => {
    it('should not throw when marking file cache dirty', () => {
      const app = createMockApp();
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );
      expect(() => manager.markFileCacheDirty()).not.toThrow();
      manager.destroy();
    });

    it('should not throw when marking folder cache dirty', () => {
      const app = createMockApp();
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );
      expect(() => manager.markFolderCacheDirty()).not.toThrow();
      manager.destroy();
    });
  });

  describe('MCP and agent support', () => {
    it('renders and selects MCP extensions owned by the chat feature', async () => {
      const manager = new FileContextManager(
        createMockApp(), containerEl as any, inputEl, createMockCallbacks()
      );
      const onChange = jest.fn();
      manager.setOnMcpMentionChange(onChange);
      manager.setMcpManager({
        getContextSavingServers: jest.fn(() => [{ name: 'filesystem' }]),
        extractMentions: jest.fn(() => new Set<string>()),
      } as any);

      inputEl.value = '@file';
      inputEl.selectionStart = inputEl.value.length;
      manager.handleInputChange();
      await jest.advanceTimersByTimeAsync(200);
      manager.handleMentionKeydown({
        key: 'Enter', isComposing: false, preventDefault: jest.fn(),
      } as any);

      expect(inputEl.value).toBe('@filesystem ');
      expect(manager.getMentionedMcpServers()).toEqual(new Set(['filesystem']));
      expect(onChange).toHaveBeenCalledWith(new Set(['filesystem']));
      manager.destroy();
    });

    it('renders and selects agent extensions owned by the chat feature', async () => {
      const onAgentMentionSelect = jest.fn();
      const callbacks: FileContextCallbacks = {
        ...createMockCallbacks(),
        onAgentMentionSelect,
      };
      const manager = new FileContextManager(
        createMockApp(), containerEl as any, inputEl, callbacks
      );
      manager.setAgentService({
        searchAgents: jest.fn(() => [{ id: 'Explore', description: 'Explore code' }]),
      });

      inputEl.value = '@Agents/';
      inputEl.selectionStart = inputEl.value.length;
      manager.handleInputChange();
      await jest.advanceTimersByTimeAsync(200);
      manager.handleMentionKeydown({
        key: 'Enter', isComposing: false, preventDefault: jest.fn(),
      } as any);

      expect(inputEl.value).toBe('@Explore (agent) ');
      expect(onAgentMentionSelect).toHaveBeenCalledWith('Explore');
      manager.destroy();
    });

    it('should expose getMentionedMcpServers', () => {
      const app = createMockApp();
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );
      const servers = manager.getMentionedMcpServers();
      expect(servers).toBeInstanceOf(Set);
      expect(servers.size).toBe(0);
      manager.destroy();
    });

    it('should clear MCP mentions', () => {
      const app = createMockApp();
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );
      // Should not throw
      manager.clearMcpMentions();
      expect(manager.getMentionedMcpServers().size).toBe(0);
      manager.destroy();
    });

    it('should set onMcpMentionChange callback without error', () => {
      const app = createMockApp();
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );
      const callback = jest.fn();
      expect(() => manager.setOnMcpMentionChange(callback)).not.toThrow();
      manager.destroy();
    });

    it('should setMcpManager without error', () => {
      const app = createMockApp();
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );
      expect(() => manager.setMcpManager(null)).not.toThrow();
      manager.destroy();
    });

    it('should setAgentService without error', () => {
      const app = createMockApp();
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );
      expect(() => manager.setAgentService(null)).not.toThrow();
      manager.destroy();
    });

    it('should preScanExternalContexts without error', () => {
      const app = createMockApp();
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );
      expect(() => manager.preScanExternalContexts()).not.toThrow();
      manager.destroy();
    });
  });

  describe('mention dropdown delegation', () => {
    it('should report isMentionDropdownVisible as false initially', () => {
      const app = createMockApp();
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );
      expect(manager.isMentionDropdownVisible()).toBe(false);
      manager.destroy();
    });

    it('should hideMentionDropdown without error', () => {
      const app = createMockApp();
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );
      expect(() => manager.hideMentionDropdown()).not.toThrow();
      manager.destroy();
    });

    it('should containsElement return false for unrelated node', () => {
      const app = createMockApp();
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );
      const unrelatedNode = createMockEl() as unknown as Node;
      expect(manager.containsElement(unrelatedNode)).toBe(false);
      manager.destroy();
    });
  });

  describe('destroy', () => {
    it('should clean up event listeners', () => {
      const app = createMockApp();
      const manager = new FileContextManager(
        app, containerEl as any, inputEl, createMockCallbacks()
      );

      manager.destroy();
      expect(app.vault.offref).toHaveBeenCalledTimes(2);
    });
  });
});
