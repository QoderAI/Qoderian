
import { Notice } from 'obsidian';

import { DEFAULT_QODERIAN_SETTINGS as DEFAULT_SETTINGS } from '@/app/settings/settings-storage';
import { VIEW_TYPE_QODERIAN } from '@/core/types';
import * as sdkSession from '@/qoder/history/qoder-history-store';
import { TOOL_SUBAGENT } from '@/qoder/tools/tool-names';
import { QODERIAN_ICON_ID } from '@/shared/icons';

// Mock fs for QoderChatRuntime
jest.mock('fs');

// Now import the plugin after mocking
import QoderianPlugin from '@/main';

describe('QoderianPlugin', () => {
  let plugin: QoderianPlugin;
  let mockApp: any;
  let mockManifest: any;

  function getRegisteredCommand(commandId: string) {
    const call = (plugin.addCommand as jest.Mock).mock.calls.find(
      ([config]) => config.id === commandId,
    );

    if (!call) {
      throw new Error(`Command ${commandId} was not registered`);
    }

    return call[0];
  }

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    mockApp = {
      vault: {
        adapter: {
          basePath: '/test/vault',
          exists: jest.fn().mockResolvedValue(false),
          read: jest.fn().mockResolvedValue(''),
          write: jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
          mkdir: jest.fn().mockResolvedValue(undefined),
          list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
          stat: jest.fn().mockResolvedValue(null),
          rename: jest.fn().mockResolvedValue(undefined),
        },
      },
      workspace: {
        getLeavesOfType: jest.fn().mockReturnValue([]),
        getRightLeaf: jest.fn().mockReturnValue({
          setViewState: jest.fn().mockResolvedValue(undefined),
        }),
        getLeftLeaf: jest.fn().mockReturnValue({
          setViewState: jest.fn().mockResolvedValue(undefined),
        }),
        getLeaf: jest.fn().mockReturnValue({
          setViewState: jest.fn().mockResolvedValue(undefined),
        }),
        setActiveLeaf: jest.fn(),
        revealLeaf: jest.fn(),
      },
    };

    mockManifest = {
      id: 'qoderian',
      name: 'Qoderian',
      version: '0.1.0',
    };

    // Create plugin instance with mocked app
    plugin = new QoderianPlugin(mockApp, mockManifest);
    (plugin.loadData as jest.Mock).mockResolvedValue({});
  });

  describe('onload', () => {
    it('should initialize settings with defaults', async () => {
      await plugin.onload();

      expect(plugin.settings).toBeDefined();
      expect(plugin.settings.permissionMode).toBe(DEFAULT_SETTINGS.permissionMode);
    });

    // Note: With multi-tab, agentService is per-tab via TabManager, not on plugin

    it('should register the view', async () => {
      await plugin.onload();

      expect((plugin.registerView as jest.Mock)).toHaveBeenCalledWith(
        VIEW_TYPE_QODERIAN,
        expect.any(Function)
      );
    });

    it('should add ribbon icon', async () => {
      await plugin.onload();

      expect((plugin.addRibbonIcon as jest.Mock)).toHaveBeenCalledWith(
        QODERIAN_ICON_ID,
        'Open Qoderian',
        expect.any(Function)
      );
    });

    it('should add command to open view', async () => {
      await plugin.onload();

      expect((plugin.addCommand as jest.Mock)).toHaveBeenCalledWith({
        id: 'open-view',
        name: 'Open chat view',
        callback: expect.any(Function),
      });
    });

  });

  describe('onunload', () => {
    // Note: With multi-tab, cleanup is handled per-tab via QoderianView.onClose()
    it('should complete without error', async () => {
      await plugin.onload();

      expect(() => plugin.onunload()).not.toThrow();
    });
  });

  describe('activateView', () => {
    it('should reveal existing leaf if view already exists', async () => {
      const mockLeaf = { id: 'existing-leaf' };
      mockApp.workspace.getLeavesOfType.mockReturnValue([mockLeaf]);

      await plugin.onload();
      await plugin.activateView();

      expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(mockLeaf);
    });

    it('should create new leaf in right sidebar by default if view does not exist', async () => {
      const mockRightLeaf = {
        setViewState: jest.fn().mockResolvedValue(undefined),
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getRightLeaf.mockReturnValue(mockRightLeaf);

      await plugin.onload();
      await plugin.activateView();

      expect(mockApp.workspace.getRightLeaf).toHaveBeenCalledWith(false);
      expect(mockRightLeaf.setViewState).toHaveBeenCalledWith({
        type: VIEW_TYPE_QODERIAN,
        active: true,
      });
    });

    it('uses ensureSideLeaf for the first sidebar open when available', async () => {
      const mockRightLeaf = { id: 'right-leaf' };
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.ensureSideLeaf = jest.fn().mockResolvedValue(mockRightLeaf);

      await plugin.onload();
      await plugin.activateView();

      expect(mockApp.workspace.ensureSideLeaf).toHaveBeenCalledWith(
        VIEW_TYPE_QODERIAN,
        'right',
        {
          active: true,
          split: false,
          reveal: false,
        },
      );
      expect(mockApp.workspace.getRightLeaf).not.toHaveBeenCalled();
      expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(mockRightLeaf);
    });

    it('should create new leaf in left sidebar when chatViewPlacement is left-sidebar', async () => {
      const mockLeftLeaf = {
        setViewState: jest.fn().mockResolvedValue(undefined),
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getLeftLeaf.mockReturnValue(mockLeftLeaf);

      await plugin.onload();
      plugin.settings.chatViewPlacement = 'left-sidebar';
      await plugin.activateView();

      expect(mockApp.workspace.getLeftLeaf).toHaveBeenCalledWith(false);
      expect(mockApp.workspace.getRightLeaf).not.toHaveBeenCalled();
      expect(mockApp.workspace.getLeaf).not.toHaveBeenCalled();
      expect(mockLeftLeaf.setViewState).toHaveBeenCalledWith({
        type: VIEW_TYPE_QODERIAN,
        active: true,
      });
    });

    it('should handle null right leaf gracefully', async () => {
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getRightLeaf.mockReturnValue(null);

      await plugin.onload();

      // Should not throw
      await expect(plugin.activateView()).resolves.not.toThrow();
    });

    it('should create new leaf in main editor area when chatViewPlacement is main-tab', async () => {
      const mockMainLeaf = {
        setViewState: jest.fn().mockResolvedValue(undefined),
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getLeaf.mockReturnValue(mockMainLeaf);

      await plugin.onload();
      plugin.settings.chatViewPlacement = 'main-tab';
      await plugin.activateView();

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith('tab');
      expect(mockApp.workspace.getRightLeaf).not.toHaveBeenCalled();
      expect(mockApp.workspace.getLeftLeaf).not.toHaveBeenCalled();
      expect(mockMainLeaf.setViewState).toHaveBeenCalledWith({
        type: VIEW_TYPE_QODERIAN,
        active: true,
      });
    });

    it('should handle null main leaf gracefully when chatViewPlacement is main-tab', async () => {
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getLeaf.mockReturnValue(null);

      await plugin.onload();
      plugin.settings.chatViewPlacement = 'main-tab';

      await expect(plugin.activateView()).resolves.not.toThrow();
    });

    it('should detach duplicate leaves and keep the revealed one', async () => {
      const keepLeaf = {
        id: 'leaf-1',
        detach: jest.fn().mockResolvedValue(undefined),
      };
      const staleLeaf = {
        id: 'leaf-2',
        detach: jest.fn().mockResolvedValue(undefined),
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([keepLeaf, staleLeaf]);

      await plugin.onload();
      await plugin.activateView();

      expect(staleLeaf.detach).toHaveBeenCalled();
      expect(keepLeaf.detach).not.toHaveBeenCalled();
      expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(keepLeaf);
    });
  });

  describe('requestPersistTabState', () => {
    it('should request persistence from all open views', async () => {
      await plugin.onload();

      const persistTabState = jest.fn();
      jest.spyOn(plugin, 'getAllViews')
        .mockReturnValue([{ persistTabState } as any]);

      plugin.requestPersistTabState();

      expect(persistTabState).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateChatViewPlacement', () => {
    it('saves the placement without opening a view when Qoderian is closed', async () => {
      await plugin.onload();

      await plugin.updateChatViewPlacement('left-sidebar');

      expect(plugin.settings.chatViewPlacement).toBe('left-sidebar');
      expect(mockApp.workspace.getLeftLeaf).not.toHaveBeenCalled();
      expect(mockApp.workspace.revealLeaf).not.toHaveBeenCalled();
    });

    it('persists tabs and moves the open view immediately', async () => {
      const persistedState = {
        openTabs: [{ tabId: 'tab-1', conversationId: 'conversation-1' }],
        activeTabId: 'tab-1',
      };
      const tabManager = {
        getAllTabs: jest.fn().mockReturnValue([{ state: { isStreaming: false } }]),
        getPersistedState: jest.fn().mockReturnValue(persistedState),
      };
      const currentLeaf = {
        detach: jest.fn(),
        view: { getTabManager: jest.fn().mockReturnValue(tabManager) },
      };
      const targetLeaf = {
        detach: jest.fn(),
        setViewState: jest.fn().mockResolvedValue(undefined),
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([currentLeaf]);
      mockApp.workspace.getLeftLeaf.mockReturnValue(targetLeaf);

      await plugin.onload();
      const persistSpy = jest.spyOn(plugin, 'persistTabManagerState');

      await plugin.updateChatViewPlacement('left-sidebar');

      expect(persistSpy).toHaveBeenCalledWith(persistedState);
      expect(mockApp.workspace.getLeftLeaf).toHaveBeenCalledWith(false);
      expect(targetLeaf.setViewState).toHaveBeenCalledWith({
        type: VIEW_TYPE_QODERIAN,
        active: true,
      });
      expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(targetLeaf);
      expect(currentLeaf.detach).toHaveBeenCalledTimes(1);
      expect(plugin.settings.chatViewPlacement).toBe('left-sidebar');
    });

    it.each([
      ['left-sidebar', 'left'],
      ['right-sidebar', 'right'],
    ] as const)(
      'adds the moved view to the existing %s tab group without splitting it',
      async (placement, side) => {
        const currentLeaf = {
          detach: jest.fn(),
          view: {
            getTabManager: jest.fn().mockReturnValue({
              getAllTabs: jest.fn().mockReturnValue([{ state: { isStreaming: false } }]),
              getPersistedState: jest.fn().mockReturnValue({
                openTabs: [],
                activeTabId: null,
              }),
            }),
          },
        };
        const targetLeaf = {
          detach: jest.fn(),
          setViewState: jest.fn().mockResolvedValue(undefined),
        };
        mockApp.workspace.getLeavesOfType.mockReturnValue([currentLeaf]);
        mockApp.workspace.ensureSideLeaf = jest.fn().mockResolvedValue(currentLeaf);
        const getSideLeaf = side === 'left'
          ? mockApp.workspace.getLeftLeaf
          : mockApp.workspace.getRightLeaf;
        getSideLeaf.mockReturnValue(targetLeaf);

        await plugin.onload();
        plugin.settings.chatViewPlacement = 'main-tab';
        await plugin.updateChatViewPlacement(placement);

        expect(mockApp.workspace.ensureSideLeaf).not.toHaveBeenCalled();
        expect(getSideLeaf).toHaveBeenCalledWith(false);
        expect(targetLeaf.setViewState).toHaveBeenCalledWith({
          type: VIEW_TYPE_QODERIAN,
          active: true,
        });
        expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(targetLeaf);
        expect(currentLeaf.detach).toHaveBeenCalledTimes(1);
      },
    );

    it('keeps the current view and rolls back the setting when the target cannot open', async () => {
      const currentLeaf = {
        detach: jest.fn(),
        view: {
          getTabManager: jest.fn().mockReturnValue({
            getAllTabs: jest.fn().mockReturnValue([{ state: { isStreaming: false } }]),
            getPersistedState: jest.fn().mockReturnValue({
              openTabs: [],
              activeTabId: null,
            }),
          }),
        },
      };
      const targetLeaf = {
        setViewState: jest.fn().mockRejectedValue(new Error('failed to open')),
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([currentLeaf]);
      mockApp.workspace.getLeftLeaf.mockReturnValue(targetLeaf);

      await plugin.onload();

      await expect(plugin.updateChatViewPlacement('left-sidebar'))
        .rejects.toThrow('failed to open');

      expect(mockApp.workspace.getLeftLeaf).toHaveBeenCalledWith(false);
      expect(currentLeaf.detach).not.toHaveBeenCalled();
      expect(plugin.settings.chatViewPlacement).toBe('right-sidebar');
    });

    it('refuses to move while a tab is streaming', async () => {
      const currentLeaf = {
        detach: jest.fn(),
        view: {
          getTabManager: jest.fn().mockReturnValue({
            getAllTabs: jest.fn().mockReturnValue([{ state: { isStreaming: true } }]),
          }),
        },
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([currentLeaf]);

      await plugin.onload();

      await expect(plugin.updateChatViewPlacement('left-sidebar'))
        .rejects.toThrow('Wait for the current response to finish');

      expect(currentLeaf.detach).not.toHaveBeenCalled();
      expect(mockApp.workspace.getLeftLeaf).not.toHaveBeenCalled();
      expect(plugin.settings.chatViewPlacement).toBe('right-sidebar');
    });
  });

  describe('loadSettings', () => {
    it('should merge saved data with defaults', async () => {
      // Mock qoderian-settings.json exists with custom values (Qoderian-specific settings)
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.qoderian/qoderian-settings.json';
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.qoderian/qoderian-settings.json') {
          return JSON.stringify({
            userName: 'TestUser',
          });
        }
        return '';
      });

      await plugin.loadSettings();

      expect(plugin.settings.userName).toBe('TestUser');
    });

    it('should use defaults when no saved data', async () => {
      // No settings file exists
      mockApp.vault.adapter.exists.mockResolvedValue(false);
      (plugin.loadData as jest.Mock).mockResolvedValue(null);

      await plugin.loadSettings();

      expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    });

    it('should use defaults when loadData returns empty object', async () => {
      // No settings file exists
      mockApp.vault.adapter.exists.mockResolvedValue(false);
      (plugin.loadData as jest.Mock).mockResolvedValue({});

      await plugin.loadSettings();

      expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    });

  });

  describe('saveSettings', () => {
    it('should save settings to file', async () => {
      await plugin.onload();

      await plugin.saveSettings();

      // Qoderian-specific settings should be written to .qoderian/qoderian-settings.json
      expect(mockApp.vault.adapter.write).toHaveBeenCalledWith(
        '.qoderian/qoderian-settings.json',
        expect.any(String)
      );

      // The written content should include state fields
      const writeCall = (mockApp.vault.adapter.write as jest.Mock).mock.calls.find(
        ([path]) => path === '.qoderian/qoderian-settings.json'
      );
      expect(writeCall).toBeDefined();
      const content = JSON.parse(writeCall[1]);
      expect(content).not.toHaveProperty('activeConversationId');
      expect(content).not.toHaveProperty('qoder.environmentHash');
      expect(content).toHaveProperty('qoder.lastModel');
      expect(content).not.toHaveProperty('enableBlocklist');
      expect(content).not.toHaveProperty('blockedCommands');
      // Permissions are now in .qoder/settings.json (CC format), not qoderian-settings.json
      expect(content).not.toHaveProperty('permissions');
    });
  });

  describe('ribbon icon callback', () => {
    it('reveals existing view when ribbon icon is clicked', async () => {
      await plugin.onload();
      const mockLeaf = { id: 'existing' };
      mockApp.workspace.getLeavesOfType.mockReturnValue([mockLeaf]);

      const ribbonCallback = (plugin.addRibbonIcon as jest.Mock).mock.calls[0][2];
      await ribbonCallback();

      expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(mockLeaf);
    });
  });

  describe('command callback', () => {
    it('reveals existing view when command is executed', async () => {
      await plugin.onload();
      const mockLeaf = { id: 'existing' };
      mockApp.workspace.getLeavesOfType.mockReturnValue([mockLeaf]);

      const commandConfig = (plugin.addCommand as jest.Mock).mock.calls[0][0];
      await commandConfig.callback();

      expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(mockLeaf);
    });
  });

  describe('new-tab command', () => {
    it('opens the view without creating a duplicate tab when no tab layout is persisted', async () => {
      await plugin.onload();

      const createNewTab = jest.fn().mockResolvedValue(undefined);
      const mockView = {
        createNewTab,
      };

      let viewOpened = false;
      jest.spyOn(plugin, 'activateView').mockImplementation(async () => {
        viewOpened = true;
      });
      jest.spyOn(plugin, 'getView').mockImplementation(() => (
        viewOpened ? mockView as any : null
      ));

      const command = getRegisteredCommand('new-tab');

      expect(command.checkCallback(true)).toBe(true);
      expect(command.checkCallback(false)).toBe(true);

      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(plugin.activateView).toHaveBeenCalledTimes(1);
      expect(createNewTab).not.toHaveBeenCalled();
    });

    it('creates a new tab after reopening a persisted tab layout', async () => {
      (plugin.loadData as jest.Mock).mockResolvedValue({
        tabManagerState: {
          openTabs: [
            { tabId: 'tab-1', conversationId: null },
          ],
          activeTabId: 'tab-1',
        },
      });

      await plugin.onload();

      const createNewTab = jest.fn().mockResolvedValue(undefined);
      const mockView = {
        createNewTab,
      };

      let viewOpened = false;
      jest.spyOn(plugin, 'activateView').mockImplementation(async () => {
        viewOpened = true;
      });
      jest.spyOn(plugin, 'getView').mockImplementation(() => (
        viewOpened ? mockView as any : null
      ));

      const command = getRegisteredCommand('new-tab');

      expect(command.checkCallback(true)).toBe(true);
      expect(command.checkCallback(false)).toBe(true);

      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(plugin.activateView).toHaveBeenCalledTimes(1);
      expect(createNewTab).toHaveBeenCalledTimes(1);
    });

    it('stays unavailable when the open view is already at the tab limit', async () => {
      await plugin.onload();

      const mockView = {
        getTabManager: jest.fn().mockReturnValue({
          canCreateTab: jest.fn().mockReturnValue(false),
        }),
      };

      jest.spyOn(plugin, 'getView').mockReturnValue(mockView as any);

      const command = getRegisteredCommand('new-tab');

      expect(command.checkCallback(true)).toBe(false);
    });

    it('keeps tab commands unavailable while a Qoderian leaf view is not initialized', async () => {
      await plugin.onload();

      mockApp.workspace.getLeavesOfType.mockReturnValue([{ view: {} }]);

      for (const commandId of ['new-tab', 'new-session', 'close-current-tab']) {
        const command = getRegisteredCommand(commandId);

        expect(() => command.checkCallback(true)).not.toThrow();
        expect(command.checkCallback(true)).toBe(false);
      }
    });

    it('stays unavailable when reopening the persisted layout would already hit the tab limit', async () => {
      (plugin.loadData as jest.Mock).mockResolvedValue({
        tabManagerState: {
          openTabs: [
            { tabId: 'tab-1', conversationId: null },
            { tabId: 'tab-2', conversationId: null },
            { tabId: 'tab-3', conversationId: null },
          ],
          activeTabId: 'tab-3',
        },
      });

      await plugin.onload();

      jest.spyOn(plugin, 'getView').mockReturnValue(null);

      const command = getRegisteredCommand('new-tab');

      expect(command.checkCallback(true)).toBe(false);
    });
  });

  describe('createConversation', () => {
    it('should create a new conversation with unique ID', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      expect(conv.id).toMatch(/^conv-\d+-[a-z0-9]+$/);
      expect(conv.messages).toEqual([]);
      expect(conv.sessionId).toBeNull();
    });

    it('should allow retrieving created conversation by ID', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      const fetched = await plugin.getConversationById(conv.id);

      expect(fetched?.id).toBe(conv.id);
    });

    it('should generate default title with timestamp', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      // Title should contain month and time
      expect(conv.title).toBeTruthy();
      expect(conv.title.length).toBeGreaterThan(0);
    });

    // Note: Session management is now per-tab via TabManager
  });

  describe('switchConversation', () => {
    it('should switch to existing conversation', async () => {
      await plugin.onload();

      const conv1 = await plugin.createConversation();
      await plugin.createConversation(); // Create second conversation to switch from

      const result = await plugin.switchConversation(conv1.id);

      expect(result?.id).toBe(conv1.id);
    });

    // Note: Session ID restoration is now handled per-tab via TabManager

    it('should return null for non-existent conversation', async () => {
      await plugin.onload();

      const result = await plugin.switchConversation('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('deleteConversation', () => {
    it('should delete conversation by ID', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      const convId = conv.id;

      // Create another so we have at least one left
      await plugin.createConversation();

      await plugin.deleteConversation(convId);

      const list = plugin.getConversationList();
      expect(list.find(c => c.id === convId)).toBeUndefined();
    });

    it('should allow deleting last conversation without recreating', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.deleteConversation(conv.id);

      const list = plugin.getConversationList();
      expect(list.find(c => c.id === conv.id)).toBeUndefined();
    });

    it('should abort and keep conversation when SDK session deletion fails', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      jest.spyOn(plugin.qoderServices.historyService, 'deleteConversationSession')
        .mockRejectedValue(new Error('session store unavailable'));
      const deleteMetadata = jest.spyOn(plugin.storage.sessions, 'deleteMetadata');

      await plugin.deleteConversation(conv.id);

      expect(deleteMetadata).not.toHaveBeenCalled();
      expect(plugin.getConversationSync(conv.id)).not.toBeNull();
      expect(plugin.getConversationList().find(c => c.id === conv.id)).toBeDefined();
      expect(Notice).toHaveBeenCalled();
    });

    it('should abort and keep conversation when metadata deletion fails', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      jest.spyOn(plugin.storage.sessions, 'deleteMetadata')
        .mockRejectedValue(new Error('disk error'));

      await plugin.deleteConversation(conv.id);

      expect(plugin.getConversationSync(conv.id)).not.toBeNull();
      expect(Notice).toHaveBeenCalled();
    });

    it('should stop and reset bound tabs before deleting persisted state', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      const cancelStreaming = jest.fn();
      const cleanup = jest.fn().mockResolvedValue(undefined);
      const createNew = jest.fn().mockResolvedValue(undefined);
      const view = {
        getTabManager: () => ({
          getAllTabs: () => [{
            conversationId: conv.id,
            service: { cleanup },
            controllers: {
              inputController: { cancelStreaming },
              conversationController: { createNew },
            },
          }],
        }),
      };
      jest.spyOn(plugin, 'getAllViews').mockReturnValue([view as any]);

      const order: string[] = [];
      jest.spyOn(plugin.qoderServices.historyService, 'deleteConversationSession')
        .mockImplementation(async () => {
          expect(cancelStreaming).toHaveBeenCalledTimes(1);
          expect(cleanup).toHaveBeenCalledTimes(1);
          expect(createNew).toHaveBeenCalledTimes(1);
          order.push('session-deleted');
        });
      createNew.mockImplementation(async () => {
        order.push('tab-reset');
      });

      await plugin.deleteConversation(conv.id);

      expect(order).toEqual(['tab-reset', 'session-deleted']);
      expect(plugin.getConversationSync(conv.id)).toBeNull();
    });

    it('should abort deletion when a bound tab cannot be reset', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      const view = {
        getTabManager: () => ({
          getAllTabs: () => [{
            conversationId: conv.id,
            controllers: {
              inputController: { cancelStreaming: jest.fn() },
              conversationController: {
                createNew: jest.fn().mockRejectedValue(new Error('reset failed')),
              },
            },
          }],
        }),
      };
      jest.spyOn(plugin, 'getAllViews').mockReturnValue([view as any]);
      const deleteSession = jest.spyOn(
        plugin.qoderServices.historyService,
        'deleteConversationSession',
      );

      await expect(plugin.deleteConversation(conv.id)).resolves.toBeUndefined();
      expect(deleteSession).not.toHaveBeenCalled();
      expect(plugin.getConversationSync(conv.id)).not.toBeNull();
      expect(Notice).toHaveBeenCalled();
    });
  });

  describe('renameConversation', () => {
    it('should rename conversation', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      await plugin.renameConversation(conv.id, 'New Title');

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.title).toBe('New Title');
    });

    it('should use default title if empty string provided', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      await plugin.renameConversation(conv.id, '   ');

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.title).toBeTruthy();
    });
  });

  describe('updateConversation', () => {
    it('should update conversation messages', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello', timestamp: Date.now() },
      ];

      await plugin.updateConversation(conv.id, { messages });

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.messages).toEqual(messages);
    });

    it('should update conversation sessionId', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      await plugin.updateConversation(conv.id, { sessionId: 'new-session-id' });

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.sessionId).toBe('new-session-id');
    });

    it('should update updatedAt timestamp', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      const originalUpdatedAt = conv.updatedAt;

      // Small delay to ensure timestamp differs
      await new Promise(resolve => setTimeout(resolve, 10));

      await plugin.updateConversation(conv.id, { title: 'Changed' });

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  describe('getConversationList', () => {
    it('should return conversation metadata', async () => {
      await plugin.onload();

      await plugin.createConversation();

      const list = plugin.getConversationList();

      expect(list.length).toBeGreaterThan(0);
      expect(list[0]).toHaveProperty('id');
      expect(list[0]).toHaveProperty('title');
      expect(list[0]).toHaveProperty('messageCount');
      expect(list[0]).toHaveProperty('preview');
    });

    it('should return preview from first user message', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello Qoder', timestamp: Date.now() },
        ],
      });

      const list = plugin.getConversationList();
      const meta = list.find(c => c.id === conv.id);

      expect(meta?.preview).toContain('Hello Qoder');
    });
  });

  describe('loadSettings with conversations', () => {
    it('should load saved conversations from metadata files', async () => {
      const timestamp = Date.now();
      const sessionMeta = JSON.stringify({
        id: 'conv-saved-1',
        title: 'Saved Chat',
        createdAt: timestamp,
        updatedAt: timestamp,
        sessionId: 'saved-session',
      });

      // Mock files exist
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        // Session files
        if (path === '.qoderian/sessions' || path === '.qoderian/sessions/conv-saved-1.meta.json') {
          return true;
        }
        // qoderian-settings.json exists
        if (path === '.qoderian/qoderian-settings.json') {
          return true;
        }
        return false;
      });
      mockApp.vault.adapter.list.mockImplementation(async (path: string) => {
        if (path === '.qoderian/sessions') {
          return { files: ['.qoderian/sessions/conv-saved-1.meta.json'], folders: [] };
        }
        return { files: [], folders: [] };
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.qoderian/sessions/conv-saved-1.meta.json') {
          return sessionMeta;
        }
        if (path === '.qoderian/qoderian-settings.json') {
          return JSON.stringify({});
        }
        return '';
      });

      // data.json is minimal (no state - already migrated)
      (plugin.loadData as jest.Mock).mockResolvedValue({});

      await plugin.loadSettings();

      const loaded = await plugin.getConversationById('conv-saved-1');
      expect(loaded?.id).toBe('conv-saved-1');
      expect(loaded?.title).toBe('Saved Chat');
    });

    it('should ignore legacy activeConversationId when no sessions exist', async () => {
      // No sessions exist
      mockApp.vault.adapter.exists.mockResolvedValue(false);
      mockApp.vault.adapter.list.mockResolvedValue({ files: [], folders: [] });

      (plugin.loadData as jest.Mock).mockResolvedValue({
        activeConversationId: 'non-existent',
        migrationVersion: 2,
      });

      await plugin.loadSettings();

      expect(plugin.getConversationList()).toHaveLength(0);
    });
  });

  describe('Multi-session message loading', () => {
    it('should load messages from previousSessionIds when present', async () => {
      const timestamp = Date.now();

      // Setup conversation with previousSessionIds
      const sessionMeta = JSON.stringify({
        type: 'meta',
        id: 'conv-multi-session',
        title: 'Multi Session Chat',
        createdAt: timestamp,
        updatedAt: timestamp,
        sessionId: 'session-B',
        qoderState: {
          previousSessionIds: ['session-A'],
        },
      });

      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.qoderian/qoderian-settings.json' ||
          path === '.qoderian/sessions' ||
          path === '.qoderian/sessions/conv-multi-session.meta.json';
      });
      mockApp.vault.adapter.list.mockImplementation(async (path: string) => {
        if (path === '.qoderian/sessions') {
          return { files: ['.qoderian/sessions/conv-multi-session.meta.json'], folders: [] };
        }
        return { files: [], folders: [] };
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.qoderian/sessions/conv-multi-session.meta.json') {
          return sessionMeta;
        }
        if (path === '.qoderian/qoderian-settings.json') {
          return JSON.stringify({});
        }
        return '';
      });

      (plugin.loadData as jest.Mock).mockResolvedValue({});

      await plugin.loadSettings();

      const loaded = await plugin.getConversationById('conv-multi-session');
      expect((loaded?.qoderState as any)?.previousSessionIds).toEqual(['session-A']);
      expect(loaded?.sessionId).toBe('session-B');
    });

    it('should preserve previousSessionIds through conversation updates', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        sessionId: 'session-B',
        qoderState: {
          previousSessionIds: ['session-A'],
        },
      });

      const updated = await plugin.getConversationById(conv.id);
      expect((updated?.qoderState as any)?.previousSessionIds).toEqual(['session-A']);
      expect(updated?.sessionId).toBe('session-B');

      // Further update should preserve previousSessionIds
      await plugin.updateConversation(conv.id, {
        title: 'Updated Title',
      });

      const afterTitleUpdate = await plugin.getConversationById(conv.id);
      expect((afterTitleUpdate?.qoderState as any)?.previousSessionIds).toEqual(['session-A']);
    });

    it('should handle empty previousSessionIds array', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        sessionId: 'session-A',
        qoderState: {
          previousSessionIds: [],
        },
      });

      const updated = await plugin.getConversationById(conv.id);
      expect((updated?.qoderState as any)?.previousSessionIds).toEqual([]);
    });
  });

  describe('loadSdkMessagesForConversation - fork branch', () => {
    it('should load from forkSource.sessionId and truncate at forkSource.resumeAt for pending fork', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        qoderState: {
          forkSource: { sessionId: 'source-session-abc', resumeAt: 'asst-uuid-cutoff' },
        },
        sessionId: null,
      });

      const existsSpy = jest.spyOn(sdkSession, 'sdkSessionExists').mockReturnValue(true);
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [
          { id: 'sdk-msg-1', role: 'user', content: 'Hello', timestamp: 1000 },
          { id: 'sdk-msg-2', role: 'assistant', content: 'Hi', timestamp: 1001 },
        ],
        skippedLines: 0,
      });

      // Trigger loadSdkMessagesForConversation via public API
      const loaded = await plugin.getConversationById(conv.id);

      // Should check existence of source session, not the conversation's own session
      expect(existsSpy).toHaveBeenCalledWith(
        expect.any(String),
        'source-session-abc'
      );

      // Should load from forkSource.sessionId with forkSource.resumeAt as truncation point
      expect(loadSpy).toHaveBeenCalledWith(
        expect.any(String),
        'source-session-abc',
        'asst-uuid-cutoff'
      );

      // Messages should be loaded
      expect(loaded?.messages).toBeDefined();

      existsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('should NOT use fork path when conversation has its own sessionId', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        sessionId: 'own-session-id',
        qoderState: {
          forkSource: { sessionId: 'source-session', resumeAt: 'asst-uuid' },
        },
      });

      const existsSpy = jest.spyOn(sdkSession, 'sdkSessionExists').mockReturnValue(true);
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        skippedLines: 0,
      });

      await plugin.getConversationById(conv.id);

      // Should load from own session, not forkSource session
      expect(existsSpy).toHaveBeenCalledWith(
        expect.any(String),
        'own-session-id'
      );

      existsSpy.mockRestore();
      loadSpy.mockRestore();
    });
  });

  describe('loadSdkMessagesForConversation - subagent recovery', () => {
    it('restores subagent data when Task tool exists but subagent content block is missing', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        sessionId: 'session-subagent-recovery',
        qoderState: {
          subagentData: {
            'task-1': {
              id: 'task-1',
              description: 'Recovered subagent',
              status: 'completed',
              result: 'Recovered result',
              toolCalls: [
                {
                  id: 'sub-tool-1',
                  name: 'Read',
                  input: { file_path: 'README.md' },
                  status: 'completed',
                  result: 'content',
                } as any,
              ],
              isExpanded: false,
            } as any,
          },
        },
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-1',
                name: 'Task',
                input: { description: 'Do sub task' },
                status: 'completed',
                result: 'Task completed',
              } as any,
            ],
            // Simulate partial persisted blocks that lost the task tool block.
            contentBlocks: [{ type: 'text', content: 'Done' }] as any,
          } as any,
        ],
      });

      const existsSpy = jest.spyOn(sdkSession, 'sdkSessionExists').mockReturnValue(true);
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      expect(loadSpy).toHaveBeenCalledWith(
        expect.any(String),
        'session-subagent-recovery',
        undefined
      );
      expect(loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-1')).toEqual(
        expect.objectContaining({
          subagent: expect.objectContaining({
            id: 'task-1',
            description: 'Recovered subagent',
            result: 'Recovered result',
          }),
        })
      );
      expect(loaded?.messages[0].contentBlocks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'subagent', subagentId: 'task-1' }),
        ])
      );

      existsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('prefers richer SDK task result over stale cached subagent result', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        sessionId: 'session-subagent-merge',
        qoderState: {
          subagentData: {
            'task-merge-1': {
              id: 'task-merge-1',
              description: 'Recovered subagent',
              mode: 'async',
              asyncStatus: 'completed',
              status: 'completed',
              result: 'Short stale result',
              toolCalls: [],
              isExpanded: false,
            } as any,
          },
        },
        messages: [
          {
            id: 'assistant-merge',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-merge-1',
                name: 'Task',
                input: { description: 'Do sub task', run_in_background: true },
                status: 'completed',
                result: 'Full SDK result from queue-operation',
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-merge-1', mode: 'async' }] as any,
          } as any,
        ],
      });

      const existsSpy = jest.spyOn(sdkSession, 'sdkSessionExists').mockReturnValue(true);
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-merge-1');

      expect(loadSpy).toHaveBeenCalledWith(
        expect.any(String),
        'session-subagent-merge',
        undefined
      );
      expect(taskTool?.result).toBe('Full SDK result from queue-operation');
      expect(taskTool?.subagent?.result).toBe('Full SDK result from queue-operation');

      existsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('keeps the richer cached async result when both SDK and cache are terminal', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        sessionId: 'session-subagent-cache-richer',
        qoderState: {
          subagentData: {
            'task-merge-2': {
              id: 'task-merge-2',
              description: 'Recovered subagent',
              mode: 'async',
              asyncStatus: 'completed',
              status: 'completed',
              result: 'Recovered final result with full details',
              toolCalls: [],
              isExpanded: false,
              agentId: 'agent-cache-richer',
            } as any,
          },
        },
        messages: [],
      });

      const existsSpy = jest.spyOn(sdkSession, 'sdkSessionExists').mockReturnValue(true);
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [
          {
            id: 'assistant-cache-richer',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-merge-2',
                name: 'Task',
                input: { description: 'SDK async subagent', run_in_background: true },
                status: 'completed',
                result: 'Short SDK result',
                subagent: {
                  id: 'task-merge-2',
                  description: 'SDK async subagent',
                  mode: 'async',
                  asyncStatus: 'completed',
                  status: 'completed',
                  result: 'Short SDK result',
                  toolCalls: [],
                  isExpanded: false,
                  agentId: 'agent-cache-richer',
                },
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-merge-2', mode: 'async' }] as any,
          } as any,
        ],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-merge-2');

      expect(taskTool?.status).toBe('completed');
      expect(taskTool?.result).toBe('Recovered final result with full details');
      expect(taskTool?.subagent?.result).toBe('Recovered final result with full details');

      existsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('drops stale asyncStatus from cached sync subagents during recovery', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        sessionId: 'session-sync-subagent-cleanup',
        qoderState: {
          subagentData: {
            'task-sync-1': {
              id: 'task-sync-1',
              description: 'Recovered sync subagent',
              mode: 'sync',
              asyncStatus: 'completed',
              status: 'completed',
              result: 'Recovered sync result',
              toolCalls: [],
              isExpanded: false,
            } as any,
          },
        },
        messages: [
          {
            id: 'assistant-sync',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-sync-1',
                name: 'Task',
                input: { description: 'Do sync task' },
                status: 'completed',
                result: 'Sync result',
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-sync-1', mode: 'sync' }] as any,
          } as any,
        ],
      });

      const existsSpy = jest.spyOn(sdkSession, 'sdkSessionExists').mockReturnValue(true);
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-sync-1');

      expect(taskTool?.subagent?.mode).toBe('sync');
      expect(taskTool?.subagent?.asyncStatus).toBeUndefined();

      existsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('prefers terminal SDK async status over stale cached running state', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        sessionId: 'session-async-sdk-terminal',
        qoderState: {
          subagentData: {
            'task-async-sdk-terminal': {
              id: 'task-async-sdk-terminal',
              description: 'Cached async subagent',
              mode: 'async',
              asyncStatus: 'running',
              status: 'running',
              result: 'Still running',
              toolCalls: [],
              isExpanded: false,
            } as any,
          },
        },
        messages: [],
      });

      const existsSpy = jest.spyOn(sdkSession, 'sdkSessionExists').mockReturnValue(true);
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [
          {
            id: 'assistant-sdk-terminal',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-async-sdk-terminal',
                name: 'Task',
                input: { description: 'SDK async subagent', run_in_background: true },
                status: 'completed',
                result: 'Full SDK final result',
                subagent: {
                  id: 'task-async-sdk-terminal',
                  description: 'SDK async subagent',
                  mode: 'async',
                  asyncStatus: 'completed',
                  status: 'completed',
                  result: 'Full SDK final result',
                  toolCalls: [],
                  isExpanded: false,
                  agentId: 'agent-sdk-terminal',
                },
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-async-sdk-terminal', mode: 'async' }] as any,
          } as any,
        ],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-async-sdk-terminal');

      expect(taskTool?.status).toBe('completed');
      expect(taskTool?.result).toBe('Full SDK final result');
      expect(taskTool?.subagent?.status).toBe('completed');
      expect(taskTool?.subagent?.asyncStatus).toBe('completed');
      expect(taskTool?.subagent?.result).toBe('Full SDK final result');

      existsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('prefers cached terminal async status over SDK launch-only running state', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        sessionId: 'session-async-cache-terminal',
        qoderState: {
          subagentData: {
            'task-async-cache-terminal': {
              id: 'task-async-cache-terminal',
              description: 'Cached async subagent',
              mode: 'async',
              asyncStatus: 'completed',
              status: 'completed',
              result: 'Recovered final result',
              toolCalls: [],
              isExpanded: false,
              agentId: 'agent-cache-terminal',
            } as any,
          },
        },
        messages: [],
      });

      const existsSpy = jest.spyOn(sdkSession, 'sdkSessionExists').mockReturnValue(true);
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [
          {
            id: 'assistant-sdk-running',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-async-cache-terminal',
                name: 'Task',
                input: { description: 'SDK async subagent', run_in_background: true },
                status: 'running',
                result: 'Task launched in background.',
                subagent: {
                  id: 'task-async-cache-terminal',
                  description: 'SDK async subagent',
                  mode: 'async',
                  asyncStatus: 'running',
                  status: 'running',
                  result: 'Task launched in background.',
                  toolCalls: [],
                  isExpanded: false,
                  agentId: 'agent-cache-terminal',
                },
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-async-cache-terminal', mode: 'async' }] as any,
          } as any,
        ],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-async-cache-terminal');

      expect(taskTool?.status).toBe('completed');
      expect(taskTool?.result).toBe('Recovered final result');
      expect(taskTool?.subagent?.status).toBe('completed');
      expect(taskTool?.subagent?.asyncStatus).toBe('completed');
      expect(taskTool?.subagent?.result).toBe('Recovered final result');

      existsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('restores async subagent data and mode when Task tool exists but async block is missing', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        sessionId: 'session-async-subagent-recovery',
        qoderState: {
          subagentData: {
            'task-async-1': {
              id: 'task-async-1',
              description: 'Recovered async subagent',
              mode: 'async',
              asyncStatus: 'completed',
              status: 'completed',
              result: 'Recovered async result',
              toolCalls: [],
              isExpanded: false,
            } as any,
          },
        },
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-async-1',
                name: 'Task',
                input: { description: 'Do background task', run_in_background: true },
                status: 'completed',
                result: 'Task started',
              } as any,
            ],
            contentBlocks: [{ type: 'text', content: 'Started' }] as any,
          } as any,
        ],
      });

      const existsSpy = jest.spyOn(sdkSession, 'sdkSessionExists').mockReturnValue(true);
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      const block = loaded?.messages[0].contentBlocks?.find(
        (b: any) => b.type === 'subagent' && b.subagentId === 'task-async-1'
      ) as any;

      expect(loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-async-1')).toEqual(
        expect.objectContaining({
          id: 'task-async-1',
          subagent: expect.objectContaining({
            id: 'task-async-1',
            mode: 'async',
            asyncStatus: 'completed',
          }),
        })
      );
      expect(block).toEqual(
        expect.objectContaining({ type: 'subagent', subagentId: 'task-async-1', mode: 'async' })
      );

      existsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('hydrates async subagent tool calls from SDK subagent files on reload', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        sessionId: 'session-async-subagent-tools',
        qoderState: {
          subagentData: {
            'task-async-tools': {
              id: 'task-async-tools',
              description: 'Recovered async subagent',
              mode: 'async',
              asyncStatus: 'completed',
              status: 'completed',
              result: 'Recovered async result',
              agentId: 'agent-a123',
              toolCalls: [],
              isExpanded: false,
            } as any,
          },
        },
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-async-tools',
                name: 'Task',
                input: { description: 'Do background task', run_in_background: true },
                status: 'completed',
                result: 'Task started',
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-async-tools', mode: 'async' }] as any,
          } as any,
        ],
      });

      const existsSpy = jest.spyOn(sdkSession, 'sdkSessionExists').mockReturnValue(true);
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        skippedLines: 0,
      });
      const loadSubagentToolsSpy = jest.spyOn(sdkSession, 'loadSubagentToolCalls').mockResolvedValue([
        {
          id: 'sub-tool-1',
          name: 'Bash',
          input: { command: 'ls' },
          status: 'completed',
          result: 'ok',
          isExpanded: false,
        } as any,
      ]);

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-async-tools');

      expect(loadSubagentToolsSpy).toHaveBeenCalledWith(
        expect.any(String),
        'session-async-subagent-tools',
        'agent-a123'
      );
      expect(taskTool?.subagent?.toolCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'sub-tool-1',
            name: 'Bash',
            result: 'ok',
          }),
        ])
      );

      existsSpy.mockRestore();
      loadSpy.mockRestore();
      loadSubagentToolsSpy.mockRestore();
    });

    it('keeps async subagent renderer visible when task block and task tool call are both missing', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        sessionId: 'session-async-subagent-fallback',
        qoderState: {
          subagentData: {
            'task-async-orphan': {
              id: 'task-async-orphan',
              description: 'Recovered async orphan subagent',
              mode: 'async',
              asyncStatus: 'running',
              status: 'running',
              result: 'Running in background',
              toolCalls: [],
              isExpanded: false,
            } as any,
          },
        },
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Background work started',
            timestamp: 1000,
            contentBlocks: [{ type: 'text', content: 'Background work started' }] as any,
          } as any,
        ],
      });

      const existsSpy = jest.spyOn(sdkSession, 'sdkSessionExists').mockReturnValue(true);
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      const assistant = loaded?.messages.find(m => m.id === 'assistant-1');
      const block = assistant?.contentBlocks?.find(
        (b: any) => b.type === 'subagent' && b.subagentId === 'task-async-orphan'
      ) as any;

      expect(assistant?.toolCalls?.find((tc: any) => tc.id === 'task-async-orphan')).toEqual(
        expect.objectContaining({
          id: 'task-async-orphan',
          name: TOOL_SUBAGENT,
          subagent: expect.objectContaining({
            id: 'task-async-orphan',
            mode: 'async',
            asyncStatus: 'running',
          }),
        })
      );
      expect(block).toEqual(
        expect.objectContaining({
          type: 'subagent',
          subagentId: 'task-async-orphan',
          mode: 'async',
        })
      );

      existsSpy.mockRestore();
      loadSpy.mockRestore();
    });
  });

});
