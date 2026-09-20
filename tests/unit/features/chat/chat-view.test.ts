import { createMockEl } from '@test/helpers/mock-element';
import { Notice, Platform, Scope } from 'obsidian';

import { QoderianView } from '@/features/chat/chat-view';
import { setLocale, t } from '@/i18n/i18n';

const MockScope = Scope as typeof Scope & { instances: Scope[] };
const MockNotice = Notice as unknown as jest.Mock;

function createViewHarness(options: {
  createdTab?: unknown;
  maxTabs?: number;
}): {
  createTab: jest.Mock;
  view: any;
} {
  const createTab = jest.fn().mockResolvedValue(options.createdTab ?? null);
  const view = Object.create(QoderianView.prototype) as any;

  view.plugin = {
    settings: { maxTabs: options.maxTabs ?? 4 },
  };
  view.tabManager = { createTab };

  return { createTab, view };
}

describe('QoderianView tab controls', () => {
  beforeEach(() => {
    MockNotice.mockClear();
    setLocale('en');
  });

  it('notices the limit and points to settings when no tab can be created', async () => {
    const { view } = createViewHarness({ createdTab: null, maxTabs: 4 });

    await view.createNewTab();

    expect(MockNotice).toHaveBeenCalledTimes(1);
    expect(MockNotice.mock.calls[0][0]).toBe(
      t('chat.tabs.maxTabsReached', { count: '4' }),
    );
  });

  it('stays quiet when a new tab is created', async () => {
    const { createTab, view } = createViewHarness({ createdTab: { id: 'tab-2' } });

    await view.createNewTab();

    expect(createTab).toHaveBeenCalledTimes(1);
    expect(MockNotice).not.toHaveBeenCalled();
  });

  it('hides the strip and the new-session button at the limit while the redesign is off', () => {
    const tabBarContainerEl = createMockEl();
    const newTabButtonEl = createMockEl();
    const view = Object.create(QoderianView.prototype) as any;
    view.plugin = { settings: {} };
    view.tabManager = {
      getTabCount: jest.fn().mockReturnValue(1),
      canCreateTab: jest.fn().mockReturnValue(false),
    };
    view.tabBarContainerEl = tabBarContainerEl;
    view.newTabButtonEl = newTabButtonEl;

    view.refreshTabControls();

    expect(tabBarContainerEl.hasClass('qoderian-hidden')).toBe(true);
    expect(newTabButtonEl.hasClass('qoderian-hidden')).toBe(true);
    expect(newTabButtonEl.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps a single session visible and the new-session button enabled while the redesign is on', () => {
    const tabBarContainerEl = createMockEl();
    const newTabButtonEl = createMockEl();
    const view = Object.create(QoderianView.prototype) as any;
    view.plugin = { settings: { enableSessionTabsRedesign: true } };
    view.tabManager = {
      getTabCount: jest.fn().mockReturnValue(1),
      canCreateTab: jest.fn().mockReturnValue(false),
    };
    view.tabBarContainerEl = tabBarContainerEl;
    view.newTabButtonEl = newTabButtonEl;

    view.refreshTabControls();

    expect(tabBarContainerEl.hasClass('qoderian-hidden')).toBe(false);
    expect(newTabButtonEl.hasClass('qoderian-hidden')).toBe(false);
    expect(newTabButtonEl.getAttribute('aria-disabled')).toBeNull();
  });

  it('opens a history conversation in a new tab when the redesign is on', async () => {
    const openConversation = jest.fn().mockResolvedValue(true);
    const view = Object.create(QoderianView.prototype) as any;
    view.plugin = { settings: { enableSessionTabsRedesign: true } };
    view.tabManager = { openConversation };
    view.historyDropdown = createMockEl();
    view.historyDropdown.addClass('visible');

    await view.openHistoryConversation('conv-9');

    expect(openConversation).toHaveBeenCalledWith('conv-9', { preferNewTab: true });
    expect(view.historyDropdown.hasClass('visible')).toBe(false);
  });

  it('opens a history conversation in the active tab while the redesign is off', async () => {
    const openConversation = jest.fn().mockResolvedValue(true);
    const view = Object.create(QoderianView.prototype) as any;
    view.plugin = { settings: {} };
    view.tabManager = { openConversation };
    view.historyDropdown = createMockEl();
    view.historyDropdown.addClass('visible');

    await view.openHistoryConversation('conv-9');

    expect(openConversation).toHaveBeenCalledWith('conv-9', { preferNewTab: false });
    expect(MockNotice).not.toHaveBeenCalled();
    expect(view.historyDropdown.hasClass('visible')).toBe(false);
  });

  it('notices the limit when a history conversation cannot open a new tab', async () => {
    const openConversation = jest.fn().mockResolvedValue(false);
    const view = Object.create(QoderianView.prototype) as any;
    view.plugin = { settings: { maxTabs: 3, enableSessionTabsRedesign: true } };
    view.tabManager = { openConversation };
    view.historyDropdown = createMockEl();
    view.historyDropdown.addClass('visible');

    await view.openHistoryConversation('conv-9');

    expect(MockNotice).toHaveBeenCalledTimes(1);
    expect(MockNotice.mock.calls[0][0]).toBe(
      t('chat.tabs.maxTabsReached', { count: '3' }),
    );
    expect(view.historyDropdown.hasClass('visible')).toBe(false);
  });

  it('keeps tab controls in the view-owned input row', () => {
    const navRowContent = createMockEl();
    const inputNavRowHostEl = createMockEl();
    const view = Object.create(QoderianView.prototype) as any;

    view.containerEl = createMockEl();
    view.navRowContent = navRowContent;
    view.inputNavRowHostEl = inputNavRowHostEl;
    view.tabBar = {
      captureScrollPosition: jest.fn(),
      restoreScrollPosition: jest.fn(),
    };

    view.attachNavRowContentToInputFooter();

    expect(inputNavRowHostEl.children).toContain(navRowContent);
    expect(view.tabBar.captureScrollPosition).toHaveBeenCalledTimes(1);
    expect(view.tabBar.restoreScrollPosition).toHaveBeenCalledTimes(1);
  });

  it('moves only the active tab input into the stable input slot', () => {
    const activeInputSlotEl = createMockEl();
    const tab1 = {
      id: 'tab-1',
      dom: {
        contentEl: createMockEl(),
        inputComposerEl: createMockEl(),
        inputContainerEl: createMockEl(),
      },
    };
    const tab2 = {
      id: 'tab-2',
      dom: {
        contentEl: createMockEl(),
        inputComposerEl: createMockEl(),
        inputContainerEl: createMockEl(),
      },
    };
    const view = Object.create(QoderianView.prototype) as any;

    view.activeInputSlotEl = activeInputSlotEl;
    view.tabManager = {
      getActiveTab: jest.fn()
        .mockReturnValueOnce(tab1)
        .mockReturnValueOnce(tab2),
      getTab: jest.fn((id: string) => id === 'tab-1' ? tab1 : tab2),
    };

    view.updateInputLocation();
    view.updateInputLocation();

    expect(activeInputSlotEl.children).toContain(tab2.dom.inputComposerEl);
    expect(activeInputSlotEl.children).not.toContain(tab1.dom.inputComposerEl);
    expect(tab1.dom.contentEl.children).toContain(tab1.dom.inputComposerEl);
  });

  it('preserves active pending prompt siblings during same-tab input updates', () => {
    const activeInputSlotEl = createMockEl();
    const inputComposerEl = activeInputSlotEl.createDiv();
    const pendingPromptEl = inputComposerEl.createDiv({ cls: 'qoderian-ask-question-inline' });
    const tab = {
      id: 'tab-1',
      dom: {
        contentEl: createMockEl(),
        inputComposerEl,
        inputContainerEl: inputComposerEl.createDiv({ cls: 'qoderian-input-container' }),
      },
    };
    const view = Object.create(QoderianView.prototype) as any;

    Object.defineProperty(inputComposerEl, 'parentElement', {
      configurable: true,
      get: () => activeInputSlotEl,
    });
    view.activeInputTabId = 'tab-1';
    view.activeInputSlotEl = activeInputSlotEl;
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(tab),
      getTab: jest.fn().mockReturnValue(tab),
    };

    view.updateInputLocation();

    expect(activeInputSlotEl.children).toContain(inputComposerEl);
    expect(inputComposerEl.children).toContain(pendingPromptEl);
  });

  it('clears the stable input slot when no tab is active', () => {
    const activeInputSlotEl = createMockEl();
    const staleInputEl = activeInputSlotEl.createDiv();
    const view = Object.create(QoderianView.prototype) as any;

    view.activeInputTabId = 'tab-1';
    view.activeInputSlotEl = activeInputSlotEl;
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(null),
    };

    view.updateInputLocation();

    expect(activeInputSlotEl.children).not.toContain(staleInputEl);
    expect(view.activeInputTabId).toBeNull();
  });

  it('toggles the history dropdown when the history button is clicked', () => {
    const historyDropdown = createMockEl();
    const view = Object.create(QoderianView.prototype) as any;

    view.historyDropdown = historyDropdown;
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue(null),
    };

    view.toggleHistoryDropdown();

    expect(historyDropdown.hasClass('visible')).toBe(true);

    view.toggleHistoryDropdown();

    expect(historyDropdown.hasClass('visible')).toBe(false);
  });
});

describe('QoderianView Escape handling', () => {
  beforeEach(() => {
    MockScope.instances.length = 0;
  });

  function createEscapeHarness(options: {
    isStreaming: boolean;
  }): {
    cancelStreaming: jest.Mock;
    eventRefs: unknown[];
    view: any;
  } {
    const cancelStreaming = jest.fn();
    const eventRefs: unknown[] = [];
    const parentScope = new Scope();
    const view = Object.create(QoderianView.prototype) as any;

    view.app = { scope: parentScope };
    view.containerEl = createMockEl();
    view.historyDropdown = createMockEl();
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.eventRefs = eventRefs;
    view.plugin = {
      app: {
        vault: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
        workspace: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
      },
    };
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        state: { isStreaming: options.isStreaming },
        controllers: {
          inputController: { cancelStreaming },
        },
        ui: {
          fileContextManager: {
            markFileCacheDirty: jest.fn(),
            markFolderCacheDirty: jest.fn(),
            handleFileOpen: jest.fn(),
            handleClickOutside: jest.fn(),
          },
        },
      }),
    };

    return { cancelStreaming, eventRefs, view };
  }

  function createScopedSendHarness(options: {
    inputFocused: boolean;
  }): {
    inputEl: HTMLTextAreaElement;
    sendMessage: jest.Mock;
    view: any;
  } {
    const sendMessage = jest.fn();
    const inputEl = createMockEl('textarea') as unknown as HTMLTextAreaElement;
    Object.defineProperty(inputEl.ownerDocument, 'activeElement', {
      configurable: true,
      get: () => options.inputFocused ? inputEl : null,
    });
    const eventRefs: unknown[] = [];
    const parentScope = new Scope();
    const view = Object.create(QoderianView.prototype) as any;

    view.app = { scope: parentScope };
    view.containerEl = createMockEl();
    view.historyDropdown = createMockEl();
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.eventRefs = eventRefs;
    view.plugin = {
      app: {
        vault: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
        workspace: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
      },
    };
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        state: { isStreaming: false },
        dom: { inputEl },
        controllers: {
          inputController: { sendMessage },
        },
        ui: {
          fileContextManager: {
            markFileCacheDirty: jest.fn(),
            markFolderCacheDirty: jest.fn(),
            handleFileOpen: jest.fn(),
            handleClickOutside: jest.fn(),
          },
        },
      }),
    };

    return { inputEl, sendMessage, view };
  }

  it('registers Escape on the Obsidian view scope instead of document keydown capture', () => {
    const { view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();

    expect(view.scope).toBeInstanceOf(Scope);
    expect(view.scope.parent).toBe(view.app.scope);
    expect(view.scope.register).toHaveBeenCalledWith([], 'Escape', expect.any(Function));
    expect(view.registerDomEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      'keydown',
      expect.any(Function),
      { capture: true }
    );
  });

  it('cancels streaming and consumes scoped Escape', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false } as KeyboardEvent);

    expect(cancelStreaming).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it('consumes scoped Escape without cancelling when not streaming', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: false });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false } as KeyboardEvent);

    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('consumes already handled scoped Escape without cancelling again', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({
      key: 'Escape',
      isComposing: false,
      defaultPrevented: true,
    } as KeyboardEvent);

    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('sends from focused composer through scoped Mod+Enter', () => {
    Platform.isMacOS = true;
    const { sendMessage, view } = createScopedSendHarness({ inputFocused: true });

    view.wireEventHandlers();
    const sendHandler = view.scope.handlers.find(
      (handler: any) => handler.key === 'Enter' && handler.modifiers?.includes('Mod')
    );
    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault: jest.fn(),
    } as unknown as KeyboardEvent;
    const result = sendHandler.func(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it('ignores scoped Mod+Enter when composer is not focused', () => {
    Platform.isMacOS = true;
    const { sendMessage, view } = createScopedSendHarness({ inputFocused: false });

    view.wireEventHandlers();
    const sendHandler = view.scope.handlers.find(
      (handler: any) => handler.key === 'Enter' && handler.modifiers?.includes('Mod')
    );
    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault: jest.fn(),
    } as unknown as KeyboardEvent;
    const result = sendHandler.func(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
