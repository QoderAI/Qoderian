import type { VaultFileAdapter } from '@/core/storage/vault-file-adapter';
import {
  QODER_CLI_SETTINGS_PATH,
  QoderCliSettingsStorage,
} from '@/qoder/storage/qoder-cli-settings-storage';

const mockAdapter = {
  exists: jest.fn(),
  read: jest.fn(),
  write: jest.fn(),
  rename: jest.fn(),
} as unknown as jest.Mocked<VaultFileAdapter>;

describe('QoderCliSettingsStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns defaults when the settings file does not exist', async () => {
    mockAdapter.exists.mockResolvedValue(false);

    const storage = new QoderCliSettingsStorage(mockAdapter);
    await expect(storage.load()).resolves.toMatchObject({
      permissions: { allow: [], deny: [], ask: [] },
    });
  });

  it('preserves Qoder CLI fields it does not manage', async () => {
    mockAdapter.exists.mockResolvedValue(true);
    mockAdapter.read.mockResolvedValue(JSON.stringify({
      model: 'custom-model',
      permissions: { allow: ['Read(*)'] },
      enabledPlugins: { 'plugin-a': true },
    }));

    const storage = new QoderCliSettingsStorage(mockAdapter);
    const loaded = await storage.load();

    expect(loaded.model).toBe('custom-model');
    expect(loaded.permissions).toEqual({ allow: ['Read(*)'] });
    expect(loaded.enabledPlugins).toEqual({ 'plugin-a': true });
  });

  it('backs up malformed JSON and returns safe defaults', async () => {
    mockAdapter.exists.mockResolvedValue(true);
    mockAdapter.read.mockResolvedValue('{broken');
    mockAdapter.rename.mockResolvedValue(undefined);
    const onRecovery = jest.fn();

    const storage = new QoderCliSettingsStorage(mockAdapter, onRecovery);
    const loaded = await storage.load();

    expect(loaded.permissions).toEqual({ allow: [], deny: [], ask: [] });
    expect(mockAdapter.rename).toHaveBeenCalledWith(
      QODER_CLI_SETTINGS_PATH,
      expect.stringMatching(/^\.qoder\/settings\.json\.corrupt-\d+\.bak$/),
    );
    expect(onRecovery).toHaveBeenCalledWith({
      sourcePath: QODER_CLI_SETTINGS_PATH,
      backupPath: expect.stringMatching(/^\.qoder\/settings\.json\.corrupt-\d+\.bak$/),
    });
  });

  it('does not overwrite malformed JSON when backup fails', async () => {
    mockAdapter.exists.mockResolvedValue(true);
    mockAdapter.read.mockResolvedValue('{broken');
    mockAdapter.rename.mockRejectedValue(new Error('rename failed'));

    const storage = new QoderCliSettingsStorage(mockAdapter);
    await storage.load();

    await expect(storage.save({ enabledPlugins: { 'plugin-a': true } }))
      .rejects.toThrow('Refusing to overwrite invalid settings');
    expect(mockAdapter.write).not.toHaveBeenCalled();
  });

  it('updates plugin state without dropping existing settings', async () => {
    mockAdapter.exists.mockResolvedValue(true);
    mockAdapter.read.mockResolvedValue(JSON.stringify({
      model: 'custom-model',
      permissions: { deny: ['Bash(*)'] },
      enabledPlugins: { 'plugin-a': true },
    }));

    const storage = new QoderCliSettingsStorage(mockAdapter);
    await storage.setPluginEnabled('plugin-b', false);

    const written = JSON.parse(mockAdapter.write.mock.calls[0][1]);
    expect(written).toMatchObject({
      model: 'custom-model',
      permissions: { deny: ['Bash(*)'] },
      enabledPlugins: { 'plugin-a': true, 'plugin-b': false },
    });
  });

  it('reports enabled and explicitly disabled plugins', async () => {
    mockAdapter.exists.mockResolvedValue(true);
    mockAdapter.read.mockResolvedValue(JSON.stringify({
      enabledPlugins: { 'plugin-a': true, 'plugin-b': false },
    }));

    const storage = new QoderCliSettingsStorage(mockAdapter);

    await expect(storage.getExplicitlyEnabledPluginIds()).resolves.toEqual(['plugin-a']);
    await expect(storage.isPluginDisabled('plugin-b')).resolves.toBe(true);
    await expect(storage.isPluginDisabled('plugin-c')).resolves.toBe(false);
  });

  it('propagates read failures that are not parse errors', async () => {
    mockAdapter.exists.mockResolvedValue(true);
    mockAdapter.read.mockRejectedValue(new Error('Read failed'));

    const storage = new QoderCliSettingsStorage(mockAdapter);
    await expect(storage.load()).rejects.toThrow('Read failed');
  });
});
