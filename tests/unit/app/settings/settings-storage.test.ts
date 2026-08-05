import {
  DEFAULT_QODERIAN_SETTINGS,
  QODERIAN_SETTINGS_PATH,
  QoderianSettingsStorage,
} from '@/app/settings/settings-storage';
import type { VaultFileAdapter } from '@/core/storage/vault-file-adapter';

const mockAdapter = {
  exists: jest.fn(),
  read: jest.fn(),
  write: jest.fn(),
  rename: jest.fn(),
} as unknown as jest.Mocked<VaultFileAdapter>;

describe('QoderianSettingsStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses safe defaults for a new installation', async () => {
    mockAdapter.exists.mockResolvedValue(false);

    const storage = new QoderianSettingsStorage(mockAdapter);
    const settings = await storage.load();

    expect(settings.permissionMode).toBe('acceptEdits');
    expect(settings).toEqual(DEFAULT_QODERIAN_SETTINGS);
    // Must be an owned copy: mutating loaded settings must not poison the
    // module-level defaults.
    expect(settings).not.toBe(DEFAULT_QODERIAN_SETTINGS);
    expect(settings.keyboardNavigation).not.toBe(DEFAULT_QODERIAN_SETTINGS.keyboardNavigation);
  });

  it('merges stored values with current defaults', async () => {
    mockAdapter.exists.mockResolvedValue(true);
    mockAdapter.read.mockResolvedValue(JSON.stringify({
      model: 'performance',
      titleGenerationModel: 'ultimate',
      maxTabs: 2,
      customContextLimits: { performance: 400_000 },
      sharedEnvironmentVariables: 'PATH=/legacy/bin',
      envSnippets: [{
        id: 'legacy-snippet',
        name: 'Legacy',
        description: '',
        envVars: 'ANTHROPIC_MODEL=custom-model',
        contextLimits: { 'custom-model': 500_000 },
      }],
      customModelAliases: { 'custom-model': 'Legacy model' },
      hiddenCommands: ['commit'],
      qoder: {
        enableChrome: true,
        environmentVariables: 'ANTHROPIC_MODEL=custom-model',
        environmentHash: 'legacy-hash',
      },
    }));

    const storage = new QoderianSettingsStorage(mockAdapter);
    const settings = await storage.load();

    expect(settings.model).toBe('performance');
    expect(settings.maxTabs).toBe(2);
    expect(settings.permissionMode).toBe('acceptEdits');
    expect(settings).not.toHaveProperty('customContextLimits');
    expect(settings).not.toHaveProperty('sharedEnvironmentVariables');
    expect(settings).not.toHaveProperty('envSnippets');
    expect(settings).not.toHaveProperty('customModelAliases');
    expect(settings).not.toHaveProperty('hiddenCommands');
    expect(settings.titleGenerationModel).toBe('ultimate');
    expect(settings.qoder).not.toHaveProperty('enableChrome');
    expect(settings.qoder).not.toHaveProperty('environmentVariables');
    expect(settings.qoder).not.toHaveProperty('environmentHash');
  });

  it('migrates the legacy normal mode to its configured SDK safe mode', async () => {
    mockAdapter.exists.mockResolvedValue(true);
    mockAdapter.read.mockResolvedValue(JSON.stringify({
      permissionMode: 'normal',
      qoder: { safeMode: 'default' },
    }));

    const storage = new QoderianSettingsStorage(mockAdapter);
    const settings = await storage.load();

    expect(settings.permissionMode).toBe('default');
    expect(settings.qoder).not.toHaveProperty('safeMode');
  });

  it('backs up malformed JSON before loading defaults', async () => {
    mockAdapter.exists.mockResolvedValue(true);
    mockAdapter.read.mockResolvedValue('{broken');
    mockAdapter.rename.mockResolvedValue(undefined);
    const onRecovery = jest.fn();

    const storage = new QoderianSettingsStorage(mockAdapter, onRecovery);
    const settings = await storage.load();

    expect(settings).toEqual(DEFAULT_QODERIAN_SETTINGS);
    expect(settings).not.toBe(DEFAULT_QODERIAN_SETTINGS);
    expect(mockAdapter.rename).toHaveBeenCalledWith(
      QODERIAN_SETTINGS_PATH,
      expect.stringMatching(/^\.qoderian\/qoderian-settings\.json\.corrupt-\d+\.bak$/),
    );
    expect(onRecovery).toHaveBeenCalledWith({
      sourcePath: QODERIAN_SETTINGS_PATH,
      backupPath: expect.stringMatching(/^\.qoderian\/qoderian-settings\.json\.corrupt-\d+\.bak$/),
    });
  });

  it('refuses to overwrite malformed JSON when backup fails', async () => {
    mockAdapter.exists.mockResolvedValue(true);
    mockAdapter.read.mockResolvedValue('{broken');
    mockAdapter.rename.mockRejectedValue(new Error('rename failed'));

    const storage = new QoderianSettingsStorage(mockAdapter);
    await storage.load();

    await expect(storage.save(DEFAULT_QODERIAN_SETTINGS))
      .rejects.toThrow('Refusing to overwrite invalid settings');
    expect(mockAdapter.write).not.toHaveBeenCalled();
  });
});
