import { createMockEl } from '@test/helpers/mock-element';

import { CommandSkillSettings } from '@/features/settings/ui/command-skill-settings';
import type { QoderCommandCatalogContract } from '@/qoder/commands/qoder-command-catalog-contract';
import type {
  QoderCommandEntry,
  QoderCommandKind,
} from '@/qoder/commands/qoder-command-entry';

function createEntry(kind: QoderCommandKind, name: string): QoderCommandEntry {
  return {
    id: kind === 'skill' ? `skill-${name}` : `cmd-${name}`,
    kind,
    name,
    description: `${name} description`,
    content: `${name} instructions`,
    scope: 'vault',
    source: 'user',
    isEditable: true,
    isDeletable: true,
    displayPrefix: '/',
    insertPrefix: '/',
  };
}

function createCatalog(entries: QoderCommandEntry[]): jest.Mocked<QoderCommandCatalogContract> {
  return {
    listDropdownEntries: jest.fn().mockResolvedValue(entries),
    listVaultEntries: jest.fn().mockResolvedValue(entries),
    saveVaultEntry: jest.fn().mockResolvedValue(undefined),
    deleteVaultEntry: jest.fn().mockResolvedValue(undefined),
    setRuntimeCommands: jest.fn(),
    invalidateRuntimeCommands: jest.fn(),
    subscribe: jest.fn((_listener: () => void) => () => {}),
    getDropdownConfig: jest.fn().mockReturnValue({ triggerChars: ['/'] }),
    refresh: jest.fn().mockResolvedValue(undefined),
  };
}

describe('CommandSkillSettings', () => {
  it('renders commands and skills as separate project sections', async () => {
    const container = createMockEl('div');
    const catalog = createCatalog([
      createEntry('command', 'review'),
      createEntry('skill', 'code-review'),
    ]);

    new CommandSkillSettings(container as HTMLElement, {} as never, catalog);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelectorAll('.qoderian-command-section')).toHaveLength(2);
    expect(container.querySelectorAll('.qoderian-sp-item')).toHaveLength(2);
    expect(container.querySelectorAll('.qoderian-settings-action-btn')).toHaveLength(6);
  });

  it('saves a renamed command before removing its old file', async () => {
    const existing = createEntry('command', 'old-name');
    const renamed = { ...existing, name: 'new-name' };
    const catalog = createCatalog([renamed]);
    const settings = new CommandSkillSettings(
      createMockEl('div') as HTMLElement,
      {} as never,
      catalog,
    );
    await Promise.resolve();

    await (settings as any).saveEntry(renamed, existing);

    expect(catalog.saveVaultEntry).toHaveBeenCalledWith(renamed);
    expect(catalog.deleteVaultEntry).toHaveBeenCalledWith(existing);
    expect(catalog.saveVaultEntry.mock.invocationCallOrder[0])
      .toBeLessThan(catalog.deleteVaultEntry.mock.invocationCallOrder[0]);
  });

  it('updates a skill in place without deleting its resource directory', async () => {
    const existing = createEntry('skill', 'code-review');
    const updated = { ...existing, content: 'Updated instructions' };
    const catalog = createCatalog([updated]);
    const settings = new CommandSkillSettings(
      createMockEl('div') as HTMLElement,
      {} as never,
      catalog,
    );
    await Promise.resolve();

    await (settings as any).saveEntry(updated, existing);

    expect(catalog.saveVaultEntry).toHaveBeenCalledWith(updated);
    expect(catalog.deleteVaultEntry).not.toHaveBeenCalled();
  });
});
