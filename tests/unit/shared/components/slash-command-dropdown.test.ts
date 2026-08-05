import { createMockEl } from '@test/helpers/mock-element';

import {
  SlashCommandDropdown,
  type SlashCommandDropdownCallbacks,
  type SlashCommandDropdownConfig,
  type SlashCommandDropdownEntry,
} from '@/shared/components/slash-command-dropdown';

function createMockInput(): any {
  return {
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    focus: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
}

function createMockCallbacks(overrides: Partial<SlashCommandDropdownCallbacks> = {}): SlashCommandDropdownCallbacks {
  return {
    onSelect: jest.fn(),
    onHide: jest.fn(),
    ...overrides,
  };
}

function getRenderedItems(containerEl: any): { name: string; description: string }[] {
  const dropdownEl = containerEl.children.find(
    (c: any) => c.hasClass('qoderian-slash-dropdown')
  );
  if (!dropdownEl) return [];
  const items = dropdownEl.querySelectorAll('.qoderian-slash-item');
  return items.map((item: any) => {
    const nameSpan = item.children.find((c: any) => c.hasClass('qoderian-slash-name'));
    const descDiv = item.children.find((c: any) => c.hasClass('qoderian-slash-desc'));
    return {
      name: nameSpan?.textContent?.replace(/^\//, '') ?? '',
      description: descDiv?.textContent ?? '',
    };
  });
}

function getRenderedCommandNames(containerEl: any): string[] {
  return getRenderedItems(containerEl).map(i => i.name);
}

const QODER_CONFIG: SlashCommandDropdownConfig = {
  triggerChars: ['/'],
};

function makeEntry(name: string, description = ''): SlashCommandDropdownEntry {
  return {
    id: `cmd-${name}`,kind: 'command', name,
    description, content: '', source: 'sdk', displayPrefix: '/', insertPrefix: '/',
  };
}

const BUILTIN_ENTRIES: SlashCommandDropdownEntry[] = [
  {
    id: 'builtin:clear', name: 'clear', description: 'Start a new conversation',
    content: '', displayPrefix: '/', insertPrefix: '/',
  },
  {
    id: 'builtin:add-dir', name: 'add-dir', description: 'Add external context directory',
    content: '', argumentHint: 'path/to/directory', displayPrefix: '/', insertPrefix: '/',
  },
];

const QODER_ENTRIES: SlashCommandDropdownEntry[] = [
  makeEntry('commit', 'Create a git commit'),
  makeEntry('pr', 'Create a pull request'),
  makeEntry('review', 'Review code'),
  makeEntry('my-custom', 'Custom command'),
  makeEntry('compact', 'Compact context'),
];

describe('SlashCommandDropdown', () => {
  let containerEl: any;
  let inputEl: any;
  let callbacks: SlashCommandDropdownCallbacks;
  let dropdown: SlashCommandDropdown;

  beforeEach(() => {
    containerEl = createMockEl();
    inputEl = createMockInput();
    callbacks = createMockCallbacks();
    dropdown = new SlashCommandDropdown(containerEl, inputEl, callbacks, {
      staticEntries: BUILTIN_ENTRIES,
    });
  });

  afterEach(() => {
    dropdown.destroy();
  });

  describe('constructor', () => {
    it('creates dropdown with container and input elements', () => {
      expect(dropdown).toBeInstanceOf(SlashCommandDropdown);
    });

    it('adds input event listener', () => {
      expect(inputEl.addEventListener).toHaveBeenCalledWith('input', expect.any(Function));
    });

  });

  describe('setEnabled', () => {
    it('should not show dropdown when disabled', async () => {
      dropdown.setEnabled(false);

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(dropdown.isVisible()).toBe(false);
      expect(getRenderedCommandNames(containerEl)).toEqual([]);
    });

    it('should hide dropdown when disabling while visible', async () => {
      inputEl.value = '/';
      inputEl.selectionStart = 1;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(dropdown.isVisible()).toBe(true);

      dropdown.setEnabled(false);

      expect(dropdown.isVisible()).toBe(false);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate commands by name (built-in takes priority)', async () => {
      const entriesWithDuplicate: SlashCommandDropdownEntry[] = [
        makeEntry('clear', 'Runtime clear command'),
        makeEntry('commit', 'Create commit'),
      ];
      const getEntries = jest.fn().mockResolvedValue(entriesWithDuplicate);

      const dropdownWithEntries = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { staticEntries: BUILTIN_ENTRIES, catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/cle';
      inputEl.selectionStart = 4;
      dropdownWithEntries.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      const items = getRenderedItems(containerEl);
      const clearItems = items.filter(i => i.name === 'clear');
      expect(clearItems).toHaveLength(1);
      expect(clearItems[0].description).toBe('Start a new conversation');

      dropdownWithEntries.destroy();
    });
  });

  describe('runtime entry caching', () => {
    it('should cache entries after first successful fetch', async () => {
      const getEntries = jest.fn().mockResolvedValue(QODER_ENTRIES);

      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { staticEntries: BUILTIN_ENTRIES, catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      inputEl.value = '/c';
      inputEl.selectionStart = 2;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(getEntries).toHaveBeenCalledTimes(1);
      d.destroy();
    });

    it('should cache empty results and not refetch', async () => {
      const getEntries = jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(QODER_ENTRIES);

      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { staticEntries: BUILTIN_ENTRIES, catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      inputEl.value = '/c';
      inputEl.selectionStart = 2;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(getEntries).toHaveBeenCalledTimes(1);
      d.destroy();
    });

    it('should retry fetch when previous call threw error', async () => {
      const getEntries = jest.fn()
        .mockRejectedValueOnce(new Error('Not ready'))
        .mockResolvedValueOnce(QODER_ENTRIES);

      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      inputEl.value = '/c';
      inputEl.selectionStart = 2;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(getEntries).toHaveBeenCalledTimes(2);
      d.destroy();
    });
  });

  describe('race condition handling', () => {
    it('should share an in-flight fetch and render results for the latest input', async () => {
      let resolveFirst: (value: SlashCommandDropdownEntry[]) => void;
      const firstPromise = new Promise<SlashCommandDropdownEntry[]>(resolve => { resolveFirst = resolve; });

      const getEntries = jest.fn().mockReturnValue(firstPromise);

      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      d.handleInputChange();

      inputEl.value = '/n';
      inputEl.selectionStart = 2;
      d.handleInputChange();
      expect(getEntries).toHaveBeenCalledTimes(1);

      resolveFirst!([makeEntry('new-command', 'New'), ...QODER_ENTRIES]);
      await new Promise(resolve => setTimeout(resolve, 10));

      const names = getRenderedCommandNames(containerEl);
      expect(names).toContain('new-command');
      expect(names).not.toContain('commit');
      expect(getEntries).toHaveBeenCalledTimes(1);

      d.destroy();
    });

    it('should ignore a pending result after cache invalidation', async () => {
      let resolveStale: (value: SlashCommandDropdownEntry[]) => void = () => {};
      const getEntries = jest.fn()
        .mockReturnValueOnce(new Promise<SlashCommandDropdownEntry[]>((resolve) => {
          resolveStale = resolve;
        }))
        .mockResolvedValueOnce([makeEntry('fresh-command', 'Fresh')]);
      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      d.handleInputChange();
      d.resetCatalogCache();
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      resolveStale(QODER_ENTRIES);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(getEntries).toHaveBeenCalledTimes(2);
      expect(getRenderedCommandNames(containerEl)).toContain('fresh-command');
      expect(getRenderedCommandNames(containerEl)).not.toContain('commit');
      d.destroy();
    });

    it('should not render after being destroyed during a fetch', async () => {
      let resolveEntries: (value: SlashCommandDropdownEntry[]) => void = () => {};
      const getEntries = jest.fn().mockReturnValue(
        new Promise<SlashCommandDropdownEntry[]>((resolve) => { resolveEntries = resolve; })
      );
      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      d.handleInputChange();
      d.destroy();
      resolveEntries(QODER_ENTRIES);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect((d as unknown as { dropdownEl: HTMLElement | null }).dropdownEl).toBeNull();
    });
  });

  describe('resetCatalogCache', () => {
    it('should clear cached entries and allow refetch', async () => {
      const getEntries = jest.fn().mockResolvedValue(QODER_ENTRIES);

      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(getEntries).toHaveBeenCalledTimes(1);

      d.resetCatalogCache();

      inputEl.value = '/c';
      inputEl.selectionStart = 2;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(getEntries).toHaveBeenCalledTimes(2);

      d.destroy();
    });
  });

  describe('immediate rendering', () => {
    it('should render built-in commands before a slow fetch resolves', async () => {
      let resolveEntries: (entries: SlashCommandDropdownEntry[]) => void = () => {};
      const getEntries = jest.fn().mockReturnValue(
        new Promise<SlashCommandDropdownEntry[]>((resolve) => { resolveEntries = resolve; })
      );

      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { staticEntries: BUILTIN_ENTRIES, catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 0));

      // Dropdown is visible with built-ins even though the fetch is pending.
      expect(d.isVisible()).toBe(true);
      const names = getRenderedCommandNames(containerEl);
      expect(names).toContain('clear');
      expect(names).not.toContain('commit');

      resolveEntries(QODER_ENTRIES);
      await new Promise(resolve => setTimeout(resolve, 10));

      // SDK entries appear after the background fetch completes.
      const refreshedNames = getRenderedCommandNames(containerEl);
      expect(refreshedNames).toContain('commit');
      expect(refreshedNames).toContain('clear');

      d.destroy();
    });
  });

  describe('catalog subscription', () => {
    it('should refetch and rerender a visible dropdown on catalog change', async () => {
      let listener: (() => void) | null = null;
      const subscribe = jest.fn((l: () => void) => {
        listener = l;
        return () => { listener = null; };
      });
      const getEntries = jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(QODER_ENTRIES);

      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { catalogConfig: QODER_CONFIG, getEntries, subscribeCatalogChanges: subscribe }
      );

      expect(subscribe).toHaveBeenCalledTimes(1);

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(getEntries).toHaveBeenCalledTimes(1);
      expect(getRenderedCommandNames(containerEl)).not.toContain('commit');

      listener!();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(getEntries).toHaveBeenCalledTimes(2);
      expect(getRenderedCommandNames(containerEl)).toContain('commit');

      d.destroy();
      expect(listener).toBeNull();
    });

    it('should not refetch on catalog change while hidden', async () => {
      let listener: (() => void) | null = null;
      const subscribe = jest.fn((l: () => void) => {
        listener = l;
        return () => {};
      });
      const getEntries = jest.fn().mockResolvedValue(QODER_ENTRIES);

      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { catalogConfig: QODER_CONFIG, getEntries, subscribeCatalogChanges: subscribe }
      );

      listener!();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(getEntries).not.toHaveBeenCalled();
      d.destroy();
    });

    it('should unsubscribe the previous catalog when replacement has no subscription', () => {
      const unsubscribe = jest.fn();
      const subscribe = jest.fn(() => unsubscribe);
      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        {
          catalogConfig: QODER_CONFIG,
          getEntries: jest.fn().mockResolvedValue([]),
          subscribeCatalogChanges: subscribe,
        }
      );

      d.setCatalog(QODER_CONFIG, jest.fn().mockResolvedValue([]));

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      d.destroy();
    });
  });

  describe('handleInputChange', () => {
    it('should hide dropdown when no valid trigger is found', () => {
      inputEl.value = 'text without trigger';
      inputEl.selectionStart = 20;
      dropdown.handleInputChange();

      expect(callbacks.onHide).toHaveBeenCalled();
    });

    it('should hide dropdown when whitespace follows command', () => {
      inputEl.value = '/clear ';
      inputEl.selectionStart = 7;
      dropdown.handleInputChange();

      expect(callbacks.onHide).toHaveBeenCalled();
    });

    it('should show dropdown when / is at position 0', async () => {
      inputEl.value = '/';
      inputEl.selectionStart = 1;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(containerEl.children.length).toBeGreaterThan(0);
    });
  });

  describe('handleKeydown', () => {
    it('should return false when dropdown is not visible', () => {
      const event = { key: 'ArrowDown', preventDefault: jest.fn() } as any;
      const handled = dropdown.handleKeydown(event);

      expect(handled).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('should not intercept IME candidate navigation', async () => {
      inputEl.value = '/';
      inputEl.selectionStart = 1;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 0));
      const event = {
        key: 'ArrowDown', isComposing: true, preventDefault: jest.fn(),
      } as any;

      expect(dropdown.handleKeydown(event)).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('isVisible', () => {
    it('should return false initially', () => {
      expect(dropdown.isVisible()).toBe(false);
    });
  });

  describe('hide', () => {
    it('should call onHide callback', () => {
      dropdown.hide();
      expect(callbacks.onHide).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should remove input event listener', () => {
      dropdown.destroy();
      expect(inputEl.removeEventListener).toHaveBeenCalledWith('input', expect.any(Function));
    });
  });

  describe('search filtering', () => {
    it('should filter commands by name', async () => {
      const getEntries = jest.fn().mockResolvedValue(QODER_ENTRIES);

      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/com';
      inputEl.selectionStart = 4;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      const commandNames = getRenderedCommandNames(containerEl);
      expect(commandNames).toContain('commit');
      expect(commandNames).not.toContain('pr');

      d.destroy();
    });

    it('should filter commands by description', async () => {
      const getEntries = jest.fn().mockResolvedValue(QODER_ENTRIES);

      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/pull';
      inputEl.selectionStart = 5;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(getRenderedCommandNames(containerEl)).toContain('pr');

      d.destroy();
    });

    it('should rank an exact command name above prefix and description matches', async () => {
      const entries = [
        makeEntry('profile', 'Inspect runtime profiling status'),
        makeEntry('status', 'Show account and session status'),
        makeEntry('statusline', 'Set up a custom status line'),
      ];
      const getEntries = jest.fn().mockResolvedValue(entries);
      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/status';
      inputEl.selectionStart = 7;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(getRenderedCommandNames(containerEl)).toEqual([
        'status',
        'statusline',
        'profile',
      ]);

      const event = { key: 'Enter', preventDefault: jest.fn() } as any;
      expect(d.handleKeydown(event)).toBe(true);
      expect(inputEl.value).toBe('/status ');

      d.destroy();
    });

    it('should rank prefix, name substring, and description matches by relevance', async () => {
      const entries = [
        makeEntry('profile', 'Inspect the runtime configuration'),
        makeEntry('my-runtime', 'Inspect a named environment'),
        makeEntry('runtime-profile', 'Profile the current process'),
      ];
      const getEntries = jest.fn().mockResolvedValue(entries);
      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/runtime';
      inputEl.selectionStart = 8;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(getRenderedCommandNames(containerEl)).toEqual([
        'runtime-profile',
        'my-runtime',
        'profile',
      ]);

      d.destroy();
    });

    it('should rank exact command names case-insensitively', async () => {
      const entries = [
        makeEntry('profile', 'Inspect runtime status'),
        makeEntry('status', 'Show account and session status'),
      ];
      const getEntries = jest.fn().mockResolvedValue(entries);
      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/STATUS';
      inputEl.selectionStart = 7;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(getRenderedCommandNames(containerEl)).toEqual(['status', 'profile']);

      d.destroy();
    });

    it('should hide dropdown when search has no matches', async () => {
      inputEl.value = '/xyz123nonexistent';
      inputEl.selectionStart = 18;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(callbacks.onHide).toHaveBeenCalled();
    });

    it('should sort results alphabetically', async () => {
      const getEntries = jest.fn().mockResolvedValue(QODER_ENTRIES);

      const d = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        { catalogConfig: QODER_CONFIG, getEntries }
      );

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      d.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      const names = getRenderedCommandNames(containerEl);
      const sortedNames = [...names].sort();
      expect(names).toEqual(sortedNames);

      d.destroy();
    });
  });
});
