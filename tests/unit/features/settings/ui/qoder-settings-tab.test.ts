import * as fs from 'fs';

import {
  renderQoderCliPathSetting,
  renderQoderSettingsTab,
} from '@/features/settings/ui/qoder-settings-tab';
import { DEFAULT_QODER_SETTINGS } from '@/qoder/config/settings';

const mockSaveSettings = jest.fn().mockResolvedValue(undefined);

jest.mock('fs');

jest.mock('obsidian', () => {
  class MockSetting {
    public name = '';
    public desc = '';
    public heading = false;
    public textComponents: MockTextComponent[] = [];
    public textAreaComponents: MockTextAreaComponent[] = [];
    public dropdownComponents: MockDropdownComponent[] = [];
    public toggleComponents: MockToggleComponent[] = [];

    constructor(_container: unknown) {
      createdSettings.push(this);
    }

    setName(name: string) {
      this.name = name;
      return this;
    }

    setDesc(desc: string) {
      this.desc = desc;
      return this;
    }

    setHeading() {
      this.heading = true;
      return this;
    }

    addText(callback: (text: MockTextComponent) => void) {
      const component = createTextComponent();
      this.textComponents.push(component);
      callback(component);
      return this;
    }

    addTextArea(callback: (text: MockTextAreaComponent) => void) {
      const component = createTextAreaComponent();
      this.textAreaComponents.push(component);
      callback(component);
      return this;
    }

    addDropdown(callback: (dropdown: MockDropdownComponent) => void) {
      const component = createDropdownComponent();
      this.dropdownComponents.push(component);
      callback(component);
      return this;
    }

    addToggle(callback: (toggle: MockToggleComponent) => void) {
      const component = createToggleComponent();
      this.toggleComponents.push(component);
      callback(component);
      return this;
    }

  }

  return {
    Setting: MockSetting,
  };
});

jest.mock('@/features/settings/ui/mcp-settings-manager', () => ({
  McpSettingsManager: jest.fn(),
}));

jest.mock('@/features/settings/ui/agent-settings', () => ({
  AgentSettings: jest.fn(),
}));

jest.mock('@/features/settings/ui/plugin-settings-manager', () => ({
  PluginSettingsManager: jest.fn(),
}));

jest.mock('@/features/settings/ui/command-skill-settings', () => ({
  CommandSkillSettings: jest.fn(),
}));

jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/core/env/environment', () => {
  const actual = jest.requireActual('@/core/env/environment');
  return {
    ...actual,
    getHostnameKey: () => 'host-a',
  };
});

interface MockInputEl {
  rows: number;
  cols: number;
  value: string;
  style: Record<string, string>;
  dataset: Record<string, string>;
  addClass: jest.Mock;
  toggleClass: jest.Mock;
  addEventListener: jest.Mock;
}

interface MockTextComponent {
  value: string;
  placeholder: string;
  onChangeCallback: ((value: string) => Promise<void> | void) | null;
  setPlaceholder: jest.MockedFunction<(value: string) => MockTextComponent>;
  setValue: jest.MockedFunction<(value: string) => MockTextComponent>;
  onChange: jest.MockedFunction<(callback: (value: string) => Promise<void> | void) => MockTextComponent>;
  inputEl: MockInputEl;
}

type MockTextAreaComponent = MockTextComponent;

interface MockDropdownComponent {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChangeCallback: ((value: string) => Promise<void> | void) | null;
  addOption: jest.MockedFunction<(value: string, label: string) => MockDropdownComponent>;
  setValue: jest.MockedFunction<(value: string) => MockDropdownComponent>;
  onChange: jest.MockedFunction<(callback: (value: string) => Promise<void> | void) => MockDropdownComponent>;
}

interface MockToggleComponent {
  value: boolean;
  onChangeCallback: ((value: boolean) => Promise<void> | void) | null;
  setValue: jest.MockedFunction<(value: boolean) => MockToggleComponent>;
  onChange: jest.MockedFunction<(callback: (value: boolean) => Promise<void> | void) => MockToggleComponent>;
}

const createdSettings: Array<{
  name: string;
  desc: string;
  heading: boolean;
  textComponents: MockTextComponent[];
  textAreaComponents: MockTextAreaComponent[];
  dropdownComponents: MockDropdownComponent[];
  toggleComponents: MockToggleComponent[];
}> = [];

function createInputEl(): MockInputEl & { _listeners: Map<string, Array<() => void>> } {
  const listeners = new Map<string, Array<() => void>>();
  return {
    rows: 0,
    cols: 0,
    value: '',
    style: {},
    dataset: {},
    addClass: jest.fn(),
    toggleClass: jest.fn(),
    addEventListener: jest.fn((event: string, handler: () => void) => {
      const handlers = listeners.get(event) ?? [];
      handlers.push(handler);
      listeners.set(event, handlers);
    }),
    _listeners: listeners,
  };
}

function createTextComponent(): MockTextComponent {
  const component = {} as MockTextComponent;
  component.value = '';
  component.placeholder = '';
  component.onChangeCallback = null;
  component.inputEl = createInputEl();
  component.setPlaceholder = jest.fn((value: string) => {
    component.placeholder = value;
    return component;
  });
  component.setValue = jest.fn((value: string) => {
    component.value = value;
    component.inputEl.value = value;
    return component;
  });
  component.onChange = jest.fn((callback: (value: string) => Promise<void> | void) => {
    component.onChangeCallback = callback;
    return component;
  });

  return component;
}

function createTextAreaComponent(): MockTextAreaComponent {
  return createTextComponent();
}

function createDropdownComponent(): MockDropdownComponent {
  const component = {} as MockDropdownComponent;
  component.value = '';
  component.options = [];
  component.onChangeCallback = null;
  component.addOption = jest.fn((value: string, label: string) => {
    component.options.push({ value, label });
    return component;
  });
  component.setValue = jest.fn((value: string) => {
    component.value = value;
    return component;
  });
  component.onChange = jest.fn((callback: (value: string) => Promise<void> | void) => {
    component.onChangeCallback = callback;
    return component;
  });

  return component;
}

function createToggleComponent(): MockToggleComponent {
  const component = {} as MockToggleComponent;
  component.value = false;
  component.onChangeCallback = null;
  component.setValue = jest.fn((value: boolean) => {
    component.value = value;
    return component;
  });
  component.onChange = jest.fn((callback: (value: boolean) => Promise<void> | void) => {
    component.onChangeCallback = callback;
    return component;
  });

  return component;
}

function createElement(): any {
  const classes = new Set<string>();
  const element: any = {
    value: '',
    style: {},
    dataset: {},
    appendText: jest.fn(),
    createEl: jest.fn(() => createElement()),
    createDiv: jest.fn(() => createElement()),
    createSpan: jest.fn(() => createElement()),
    setText: jest.fn(),
    empty: jest.fn(),
    addClass: jest.fn((cls: string) => {
      cls.split(/\s+/).filter(Boolean).forEach((item) => classes.add(item));
    }),
    removeClass: jest.fn((cls: string) => {
      cls.split(/\s+/).filter(Boolean).forEach((item) => classes.delete(item));
    }),
    toggleClass: jest.fn((cls: string, force: boolean) => {
      if (force) {
        classes.add(cls);
      } else {
        classes.delete(cls);
      }
    }),
    hasClass: jest.fn((cls: string) => classes.has(cls)),
    classList: {
      add: jest.fn((cls: string) => classes.add(cls)),
      remove: jest.fn((cls: string) => classes.delete(cls)),
      toggle: jest.fn((cls: string, force?: boolean) => {
        if (force === undefined) {
          if (classes.has(cls)) {
            classes.delete(cls);
            return false;
          }
          classes.add(cls);
          return true;
        }
        if (force) {
          classes.add(cls);
        } else {
          classes.delete(cls);
        }
        return force;
      }),
      contains: jest.fn((cls: string) => classes.has(cls)),
    },
  };

  return element;
}

function createContainer(): any {
  return {
    createDiv: jest.fn(() => createElement()),
    createEl: jest.fn(() => createElement()),
  };
}

function createPlugin(overrides: Record<string, unknown> = {}): any {
  return {
    settings: {
      model: 'gateway-large',
      titleGenerationModel: 'auto',
      qoder: {
        ...DEFAULT_QODER_SETTINGS,
        lastModel: 'performance',
      },
      ...overrides,
    },
    qoderServices: {
      cliResolver: {
        reset: jest.fn(),
      },
      commandCatalog: {},
      agentCatalog: {
        getAvailableAgents: jest.fn().mockReturnValue([]),
        refresh: jest.fn().mockResolvedValue(undefined),
      },
      agentStorage: {
        loadAll: jest.fn().mockResolvedValue([]),
      },
      modelConfig: {
        getModelOptions: jest.fn().mockReturnValue([]),
      },
      mcpStorage: {},
      pluginManager: {
        loadPlugins: jest.fn().mockResolvedValue(undefined),
      },
    },
    saveSettings: mockSaveSettings,
    normalizeModelVariantSettings: jest.fn(() => false),
    reloadConversationIndex: jest.fn().mockResolvedValue(undefined),
    getView: jest.fn(() => ({
      getTabManager: jest.fn(() => ({
        broadcastToAllTabs: jest.fn().mockResolvedValue(undefined),
        getAllTabs: jest.fn(() => []),
        closeTab: jest.fn().mockResolvedValue(true),
      })),
    })),
    app: {
      vault: {
        adapter: {
          basePath: '/test/vault',
        },
      },
    },
  };
}

function createContext(plugin: any) {
  return {
    plugin,
    renderMcpSettings: jest.fn(),
  };
}

function findSetting(name: string) {
  const setting = createdSettings.find(candidate => candidate.name === name);
  if (!setting) {
    throw new Error(`Setting not found: ${name}`);
  }
  return setting;
}

describe('QoderSettingsTab', () => {
  const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
  const mockedStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;

  beforeEach(() => {
    createdSettings.length = 0;
    jest.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
    mockedStatSync.mockReturnValue({ isFile: () => true } as fs.Stats);
  });

  it('uses the current npm package wrapper path as the CLI placeholder', () => {
    const plugin = createPlugin();

    renderQoderCliPathSetting(createContainer(), { plugin });

    const cliPathSetting = findSetting('settings.cliPath.name');
    const cliPathInput = cliPathSetting.textComponents[0];

    expect(createdSettings.slice(0, 3).map(setting => setting.name)).toEqual([
      'settings.setup',
      'settings.cliEdition.name',
      'settings.cliPath.name',
    ]);

    const editionSetting = findSetting('settings.cliEdition.name');
    const editionDropdown = editionSetting.dropdownComponents[0];
    expect(editionDropdown.options.map(option => option.value)).toEqual(['global', 'cn']);
    expect(editionDropdown.value).toBe('global');

    expect(cliPathInput.placeholder).toContain('qodercli');
  });

  it('force-closes all open tabs when switching editions', async () => {
    const plugin = createPlugin();
    const closeTab = jest.fn().mockResolvedValue(true);
    const getAllTabs = jest.fn(() => [{ id: 'tab-1' }, { id: 'tab-2' }]);
    plugin.getView = jest.fn(() => ({
      getTabManager: jest.fn(() => ({ getAllTabs, closeTab })),
    }));

    renderQoderCliPathSetting(createContainer(), { plugin });

    const editionDropdown = findSetting('settings.cliEdition.name').dropdownComponents[0];
    await editionDropdown.onChangeCallback?.('cn');

    expect(closeTab).toHaveBeenCalledWith('tab-1', true);
    expect(closeTab).toHaveBeenCalledWith('tab-2', true);
    // Tabs close before the new edition activates so saves stamp the outgoing one.
    expect(closeTab.mock.invocationCallOrder[0])
      .toBeLessThan(mockSaveSettings.mock.invocationCallOrder[0]);
    expect(plugin.settings.qoder.edition).toBe('cn');
    expect(plugin.reloadConversationIndex).toHaveBeenCalled();
  });

  it('does not duplicate the toolbar permission selector in settings', () => {
    const plugin = createPlugin();
    const context = createContext(plugin);

    renderQoderSettingsTab(createContainer(), context);

    expect(createdSettings.map(setting => setting.name)).not.toContain(
      'settings.qoderSafeMode.name',
    );
  });

  it('does not render removed model or Chrome settings', () => {
    const plugin = createPlugin();

    renderQoderSettingsTab(createContainer(), createContext(plugin));

    expect(createdSettings.map(setting => setting.name)).not.toEqual(expect.arrayContaining([
      'settings.models',
      'Qoder model catalog',
      'settings.enableChrome.name',
    ]));
  });

});
