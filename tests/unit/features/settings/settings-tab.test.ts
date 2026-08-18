import { QoderianSettingTab } from '@/features/settings/settings-tab';

function createTab() {
  const view = {
    refreshLocalizedChrome: jest.fn(),
    refreshTabControls: jest.fn(),
  };
  const plugin = {
    settings: {
      locale: 'zh-CN',
      enableAutoScroll: true,
      excludedTags: [] as string[],
      mediaFolder: '',
    },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    getAllViews: jest.fn(() => [view]),
  };
  const tab = new QoderianSettingTab({} as any, plugin as any);
  return { tab, plugin, view };
}

describe('QoderianSettingTab declarative controls', () => {
  it('persists locale changes to the Qoderian settings store', async () => {
    const { tab, plugin, view } = createTab();

    await tab.setControlValue('locale', 'en');

    expect(plugin.settings.locale).toBe('en');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    // Open views re-apply localized static text immediately.
    expect(view.refreshLocalizedChrome).toHaveBeenCalledTimes(1);
  });

  it('persists plain declarative controls too', async () => {
    const { tab, plugin } = createTab();

    await tab.setControlValue('enableAutoScroll', false);

    expect(plugin.settings.enableAutoScroll).toBe(false);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });
});
