import { createMockEl } from '@test/helpers/mock-element';

import { QoderianSettingsModal } from '@/features/settings/settings-modal';

let lastModalInstance: any;
const mockSettingsTab = {
  containerEl: null as any,
  display: jest.fn(),
  hide: jest.fn(),
};

jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');

  class MockModal {
    app: any;
    modalEl: any = { addClass: jest.fn() };
    titleEl: any = { setText: jest.fn() };
    contentEl: any = createMockEl();

    constructor(app: any) {
      this.app = app;
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      lastModalInstance = this;
    }

    open() {
      this.onOpen();
    }

    close() {
      this.onClose();
    }

    onOpen() {
      // Overridden by subclass
    }

    onClose() {
      // Overridden by subclass
    }
  }

  return { ...actual, Modal: MockModal };
});

jest.mock('@/features/settings/settings-tab', () => ({
  QoderianSettingTab: jest.fn().mockImplementation(() => mockSettingsTab),
}));

describe('QoderianSettingsModal', () => {
  beforeEach(() => {
    mockSettingsTab.containerEl = null;
    mockSettingsTab.display.mockClear();
    mockSettingsTab.hide.mockClear();
  });

  it('renders the settings tab inside the settings window', () => {
    new QoderianSettingsModal({ app: {} } as any).open();

    expect(lastModalInstance.modalEl.addClass).toHaveBeenCalledWith('qoderian-settings-modal');
    expect(lastModalInstance.titleEl.setText).toHaveBeenCalledWith('Qoderian Settings');
    expect(mockSettingsTab.containerEl).toBe(lastModalInstance.contentEl);
    expect(mockSettingsTab.display).toHaveBeenCalledTimes(1);
  });

  it('detaches the settings tab when the window closes', () => {
    const modal = new QoderianSettingsModal({ app: {} } as any);
    modal.open();
    const emptySpy = jest.spyOn(modal.contentEl, 'empty');

    modal.close();

    expect(mockSettingsTab.hide).toHaveBeenCalledTimes(1);
    expect(emptySpy).toHaveBeenCalledTimes(1);
  });
});
