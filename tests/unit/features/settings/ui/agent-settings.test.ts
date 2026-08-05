import { createMockEl } from '@test/helpers/mock-element';
import { Notice } from 'obsidian';

import type { AgentDefinition } from '@/core/types';
import { AgentSettings } from '@/features/settings/ui/agent-settings';

function createAgent(name: string, filePath?: string): AgentDefinition {
  return {
    id: name,
    name,
    description: `${name} description`,
    prompt: `${name} prompt`,
    source: 'vault',
    filePath,
  };
}

describe('AgentSettings save orchestration', () => {
  let saveMock: jest.Mock;
  let deleteMock: jest.Mock;
  let plugin: any;
  let settings: AgentSettings;

  beforeEach(() => {
    jest.clearAllMocks();
    saveMock = jest.fn().mockResolvedValue(undefined);
    deleteMock = jest.fn().mockResolvedValue(undefined);

    plugin = {
      app: {},
      agentStorage: {
        loadAll: jest.fn().mockResolvedValue([]),
        load: jest.fn(),
        save: saveMock,
        delete: deleteMock,
      },
      agentCatalog: {
        getAvailableAgents: jest.fn().mockReturnValue([]),
        refresh: jest.fn().mockResolvedValue(undefined),
      },
    };

    settings = new AgentSettings(createMockEl('div') as unknown as HTMLElement, {
      app: plugin.app,
      agentCatalog: plugin.agentCatalog,
      agentStorage: plugin.agentStorage,
      modelOptions: [],
    });
  });

  it('renaming saves with filePath undefined, then deletes old file', async () => {
    const existing = createAgent('old-name', '.qoder/agents/custom-old.md');
    const renamed = createAgent('new-name', '.qoder/agents/custom-old.md');

    await (settings as any).saveAgent(renamed, existing);

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith({ ...renamed, filePath: undefined });
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith(existing);

    expect(saveMock.mock.invocationCallOrder[0]).toBeLessThan(deleteMock.mock.invocationCallOrder[0]);
  });

  it('non-rename saves original agent and does not delete', async () => {
    const existing = createAgent('same-name', '.qoder/agents/custom-name.md');
    const updated = createAgent('same-name', '.qoder/agents/custom-name.md');

    await (settings as any).saveAgent(updated, existing);

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith(updated);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('shows notice and aborts when loading existing agent fails', async () => {
    const existing = createAgent('existing-agent', '.qoder/agents/existing-agent.md');
    plugin.agentStorage.load.mockRejectedValue(new Error('permission denied'));

    await (settings as any).openAgentModal(existing);

    expect(Notice).toHaveBeenCalledWith('Failed to load subagent "existing-agent": permission denied');
  });
});
