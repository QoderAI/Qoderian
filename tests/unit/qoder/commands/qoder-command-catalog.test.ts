import type { VaultFileAdapter } from '@/core/storage/vault-file-adapter';
import type { SlashCommand } from '@/core/types';
import { QoderCommandCatalog } from '@/qoder/commands/qoder-command-catalog';
import { SkillStorage } from '@/qoder/storage/skill-storage';
import { SlashCommandStorage } from '@/qoder/storage/slash-command-storage';

function createMockAdapter(files: Record<string, string> = {}): VaultFileAdapter {
  return {
    exists: jest.fn(async (path: string) => path in files || Object.keys(files).some(k => k.startsWith(path + '/'))),
    read: jest.fn(async (path: string) => {
      if (!(path in files)) throw new Error(`File not found: ${path}`);
      return files[path];
    }),
    write: jest.fn(),
    delete: jest.fn(),
    listFolders: jest.fn(async (folder: string) => {
      const prefix = folder.endsWith('/') ? folder : folder + '/';
      const folders = new Set<string>();
      for (const path of Object.keys(files)) {
        if (path.startsWith(prefix)) {
          const rest = path.slice(prefix.length);
          const firstSlash = rest.indexOf('/');
          if (firstSlash >= 0) {
            folders.add(prefix + rest.slice(0, firstSlash));
          }
        }
      }
      return Array.from(folders);
    }),
    listFiles: jest.fn(),
    listFilesRecursive: jest.fn(async (folder: string) => {
      const prefix = folder.endsWith('/') ? folder : folder + '/';
      return Object.keys(files).filter(k => k.startsWith(prefix));
    }),
    ensureFolder: jest.fn(),
    rename: jest.fn(),
    append: jest.fn(),
    stat: jest.fn(),
    deleteFolder: jest.fn(),
  } as unknown as VaultFileAdapter;
}

describe('QoderCommandCatalog', () => {
  describe('listDropdownEntries', () => {
    it('returns SDK runtime commands as QoderCommandEntry', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new QoderCommandCatalog(commands, skills);

      const sdkCommands: SlashCommand[] = [
        { id: 'sdk:commit', name: 'commit', description: 'Create git commit', content: '', source: 'sdk' },
        { id: 'sdk:review', name: 'review', description: 'Review code', content: '', source: 'sdk' },
      ];
      catalog.setRuntimeCommands(sdkCommands);

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(entries).toHaveLength(2);

      const commitEntry = entries.find(e => e.name === 'commit');
      expect(commitEntry).toBeDefined();
      expect(commitEntry!.scope).toBe('runtime');
      expect(commitEntry!.source).toBe('sdk');
      expect(commitEntry!.isEditable).toBe(false);
      expect(commitEntry!.isDeletable).toBe(false);
      expect(commitEntry!.displayPrefix).toBe('/');
      expect(commitEntry!.insertPrefix).toBe('/');
    });

    it('returns empty when no runtime commands and no probe', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new QoderCommandCatalog(commands, skills);

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(entries).toHaveLength(0);
    });

    it('filters out built-in hidden SDK commands', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new QoderCommandCatalog(commands, skills);

      catalog.setRuntimeCommands([
        { id: 'sdk:commit', name: 'commit', description: 'Commit', content: '', source: 'sdk' },
        { id: 'sdk:init', name: 'init', description: 'Init', content: '', source: 'sdk' },
        { id: 'sdk:debug', name: 'debug', description: 'Debug', content: '', source: 'sdk' },
        { id: 'sdk:cost', name: 'cost', description: 'Cost', content: '', source: 'sdk' },
        { id: 'sdk:review', name: 'review', description: 'Review', content: '', source: 'sdk' },
      ]);

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      const names = entries.map(e => e.name);
      expect(names).toEqual(['commit', 'review']);
      expect(names).not.toContain('init');
      expect(names).not.toContain('debug');
      expect(names).not.toContain('cost');
    });

    it('responds immediately and probes the SDK in the background on cold start', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      let resolveProbe: (v: SlashCommand[]) => void = () => {};
      const probe = jest.fn().mockReturnValue(new Promise<SlashCommand[]>((r) => { resolveProbe = r; }));
      const catalog = new QoderCommandCatalog(commands, skills, probe);

      // First call answers right away with vault data (empty here) instead of
      // blocking on CLI startup.
      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
      expect(entries).toHaveLength(0);
      expect(probe).toHaveBeenCalledTimes(1);

      resolveProbe([
        { id: 'sdk:commit', name: 'commit', description: 'Create git commit', content: '', source: 'sdk' },
      ]);
      await new Promise(resolve => setTimeout(resolve, 0));

      const refreshed = await catalog.listDropdownEntries({ includeBuiltIns: false });
      expect(refreshed).toHaveLength(1);
      expect(refreshed[0].name).toBe('commit');
      expect(refreshed[0].scope).toBe('runtime');
    });

    it('falls back to vault commands and skills when SDK discovery is empty', async () => {
      const adapter = createMockAdapter({
        '.qoder/commands/review.md': `---
description: Review code
---
Review this code`,
        '.qoder/skills/deploy/SKILL.md': `---
description: Deploy app
---
Deploy the app`,
      });
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const probe = jest.fn().mockResolvedValue([]);
      const catalog = new QoderCommandCatalog(commands, skills, probe);

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).toHaveBeenCalledTimes(1);
      expect(entries).toHaveLength(2);
      expect(entries.map(entry => entry.name).sort()).toEqual(['deploy', 'review']);
      expect(entries.every(entry => entry.scope === 'vault')).toBe(true);
    });

    it('does not probe when runtime commands are cached', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const probe = jest.fn().mockResolvedValue([]);
      const catalog = new QoderCommandCatalog(commands, skills, probe);

      catalog.setRuntimeCommands([
        { id: 'sdk:commit', name: 'commit', description: 'Commit', content: '', source: 'sdk' },
      ]);

      await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).not.toHaveBeenCalled();
    });

    it('caches empty probe results and does not relaunch the CLI', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const probe = jest.fn().mockResolvedValue([]);
      const catalog = new QoderCommandCatalog(commands, skills, probe);

      await catalog.listDropdownEntries({ includeBuiltIns: false });
      await new Promise(resolve => setTimeout(resolve, 0));

      await catalog.listDropdownEntries({ includeBuiltIns: false });
      await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).toHaveBeenCalledTimes(1);
    });

    it('re-enables probing after invalidateRuntimeCommands', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const probe = jest.fn().mockResolvedValue([
        { id: 'sdk:commit', name: 'commit', description: 'Commit', content: '', source: 'sdk' },
      ]);
      const catalog = new QoderCommandCatalog(commands, skills, probe);

      await catalog.listDropdownEntries({ includeBuiltIns: false });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(probe).toHaveBeenCalledTimes(1);

      catalog.invalidateRuntimeCommands();
      await catalog.listDropdownEntries({ includeBuiltIns: false });
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(probe).toHaveBeenCalledTimes(2);
    });

    it('notifies subscribers when the background probe completes', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      let resolveProbe: (v: SlashCommand[]) => void = () => {};
      const probe = jest.fn().mockReturnValue(new Promise<SlashCommand[]>((r) => { resolveProbe = r; }));
      const catalog = new QoderCommandCatalog(commands, skills, probe);
      const listener = jest.fn();
      const unsubscribe = catalog.subscribe(listener);

      void catalog.listDropdownEntries({ includeBuiltIns: false });
      expect(listener).not.toHaveBeenCalled();

      resolveProbe([
        { id: 'sdk:commit', name: 'commit', description: 'Commit', content: '', source: 'sdk' },
      ]);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      catalog.invalidateRuntimeCommands();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent probe calls', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const probe = jest.fn().mockResolvedValue([
        { id: 'sdk:commit', name: 'commit', description: 'Commit', content: '', source: 'sdk' },
      ]);
      const catalog = new QoderCommandCatalog(commands, skills, probe);

      const [a, b] = await Promise.all([
        catalog.listDropdownEntries({ includeBuiltIns: false }),
        catalog.listDropdownEntries({ includeBuiltIns: false }),
      ]);

      // Both calls answer immediately without SDK data; one probe runs.
      expect(probe).toHaveBeenCalledTimes(1);
      expect(a).toHaveLength(0);
      expect(b).toHaveLength(0);

      await new Promise(resolve => setTimeout(resolve, 0));
      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
      expect(entries).toHaveLength(1);
      expect(probe).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite runtime commands with stale probe results', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);

      let resolveProbe: (v: SlashCommand[]) => void;
      const probe = jest.fn().mockReturnValue(new Promise<SlashCommand[]>((r) => { resolveProbe = r; }));
      const catalog = new QoderCommandCatalog(commands, skills, probe);

      // Start probe (it will hang)
      const firstEntries = await catalog.listDropdownEntries({ includeBuiltIns: false });
      expect(firstEntries).toHaveLength(0);

      // Runtime provides fresh data while probe is in-flight
      catalog.setRuntimeCommands([
        { id: 'sdk:review', name: 'review', description: 'Review', content: '', source: 'sdk' },
      ]);

      // Probe returns stale data
      resolveProbe!([
        { id: 'sdk:commit', name: 'commit', description: 'Commit', content: '', source: 'sdk' },
      ]);
      await new Promise(resolve => setTimeout(resolve, 0));

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      // Runtime data wins — probe result is discarded
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('review');
    });

    it('does not overwrite an authoritative empty runtime catalog with a stale probe', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      let resolveProbe: (v: SlashCommand[]) => void = () => {};
      const probe = jest.fn().mockReturnValue(
        new Promise<SlashCommand[]>((resolve) => { resolveProbe = resolve; })
      );
      const catalog = new QoderCommandCatalog(commands, skills, probe);

      await catalog.listDropdownEntries({ includeBuiltIns: false });
      catalog.setRuntimeCommands([]);
      resolveProbe([
        { id: 'sdk:stale', name: 'stale', description: 'Stale', content: '', source: 'sdk' },
      ]);
      await new Promise(resolve => setTimeout(resolve, 0));

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
      expect(entries).toHaveLength(0);
      expect(probe).toHaveBeenCalledTimes(1);
    });

    it('starts a fresh probe when invalidated while an older probe is pending', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      let resolveOld: (v: SlashCommand[]) => void = () => {};
      let resolveFresh: (v: SlashCommand[]) => void = () => {};
      const probe = jest.fn()
        .mockReturnValueOnce(new Promise<SlashCommand[]>((resolve) => { resolveOld = resolve; }))
        .mockReturnValueOnce(new Promise<SlashCommand[]>((resolve) => { resolveFresh = resolve; }));
      const catalog = new QoderCommandCatalog(commands, skills, probe);

      await catalog.listDropdownEntries({ includeBuiltIns: false });
      catalog.invalidateRuntimeCommands();
      await catalog.listDropdownEntries({ includeBuiltIns: false });
      expect(probe).toHaveBeenCalledTimes(2);

      resolveOld([
        { id: 'sdk:old', name: 'old', description: 'Old', content: '', source: 'sdk' },
      ]);
      resolveFresh([
        { id: 'sdk:fresh', name: 'fresh', description: 'Fresh', content: '', source: 'sdk' },
      ]);
      await new Promise(resolve => setTimeout(resolve, 0));

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
      expect(entries.map(entry => entry.name)).toEqual(['fresh']);
    });
  });

  describe('listVaultEntries', () => {
    it('returns only vault-owned commands and skills', async () => {
      const adapter = createMockAdapter({
        '.qoder/commands/review.md': `---
description: Review code
---
Review this code`,
        '.qoder/skills/deploy/SKILL.md': `---
description: Deploy
---
Deploy the app`,
      });
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new QoderCommandCatalog(commands, skills);

      // Set SDK commands to verify they're excluded from vault entries
      catalog.setRuntimeCommands([
        { id: 'sdk:commit', name: 'commit', description: 'Commit', content: '', source: 'sdk' },
      ]);

      const entries = await catalog.listVaultEntries();

      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.scope === 'vault')).toBe(true);
      expect(entries.find(e => e.name === 'commit')).toBeUndefined();
    });
  });

  describe('saveVaultEntry', () => {
    it('saves a command entry via command storage', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new QoderCommandCatalog(commands, skills);

      await catalog.saveVaultEntry({
        id: 'cmd-review',
        kind: 'command',
        name: 'review',
        description: 'Review code',
        allowedTools: ['Read', 'Edit'],
        model: 'qoder-sonnet-4-5',
        content: 'Review this code',
        scope: 'vault',
        source: 'user',
        isEditable: true,
        isDeletable: true,
        displayPrefix: '/',
        insertPrefix: '/',
      });

      expect(adapter.write).toHaveBeenCalledWith(
        '.qoder/commands/review.md',
        expect.stringContaining('Review this code'),
      );
      expect(adapter.write).toHaveBeenCalledWith(
        '.qoder/commands/review.md',
        expect.stringContaining('allowed-tools:'),
      );
      expect(adapter.write).toHaveBeenCalledWith(
        '.qoder/commands/review.md',
        expect.stringContaining('model: qoder-sonnet-4-5'),
      );
    });

    it('saves a skill entry via skill storage', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new QoderCommandCatalog(commands, skills);

      await catalog.saveVaultEntry({
        id: 'skill-deploy',
        kind: 'skill',
        name: 'deploy',
        description: 'Deploy app',
        content: 'Deploy the app',
        disableModelInvocation: true,
        userInvocable: false,
        context: 'fork',
        agent: 'deployer',
        hooks: { preToolUse: ['check'] },
        scope: 'vault',
        source: 'user',
        isEditable: true,
        isDeletable: true,
        displayPrefix: '/',
        insertPrefix: '/',
      });

      expect(adapter.ensureFolder).toHaveBeenCalledWith('.qoder/skills/deploy');
      expect(adapter.write).toHaveBeenCalledWith(
        '.qoder/skills/deploy/SKILL.md',
        expect.stringContaining('Deploy the app'),
      );
      expect(adapter.write).toHaveBeenCalledWith(
        '.qoder/skills/deploy/SKILL.md',
        expect.stringContaining('disable-model-invocation: true'),
      );
      expect(adapter.write).toHaveBeenCalledWith(
        '.qoder/skills/deploy/SKILL.md',
        expect.stringContaining('user-invocable: false'),
      );
    });
  });

  describe('deleteVaultEntry', () => {
    it('deletes a command entry', async () => {
      const adapter = createMockAdapter({
        '.qoder/commands/review.md': `---
description: Review
---
Review`,
      });
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new QoderCommandCatalog(commands, skills);

      await catalog.deleteVaultEntry({
        id: 'cmd-review',
        kind: 'command',
        name: 'review',
        description: 'Review',
        content: 'Review',
        scope: 'vault',
        source: 'user',
        isEditable: true,
        isDeletable: true,
        displayPrefix: '/',
        insertPrefix: '/',
      });

      expect(adapter.delete).toHaveBeenCalled();
    });

    it('deletes a skill entry', async () => {
      const adapter = createMockAdapter({
        '.qoder/skills/deploy/SKILL.md': `---
description: Deploy
---
Deploy`,
      });
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new QoderCommandCatalog(commands, skills);

      await catalog.deleteVaultEntry({
        id: 'skill-deploy',
        kind: 'skill',
        name: 'deploy',
        description: 'Deploy',
        content: 'Deploy',
        scope: 'vault',
        source: 'user',
        isEditable: true,
        isDeletable: true,
        displayPrefix: '/',
        insertPrefix: '/',
      });

      expect(adapter.delete).toHaveBeenCalledWith('.qoder/skills/deploy/SKILL.md');
    });
  });

  describe('getDropdownConfig', () => {
    it('returns Qoder-specific config', () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new QoderCommandCatalog(commands, skills);

      const config = catalog.getDropdownConfig();

      expect(config.triggerChars).toEqual(['/']);
    });
  });
});
