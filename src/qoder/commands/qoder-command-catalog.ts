import type { SlashCommand } from '../../core/types';
import type { SkillStorage } from '../storage/skill-storage';
import type { SlashCommandStorage } from '../storage/slash-command-storage';
import { isHiddenCommand } from './command-visibility-policy';
import type {
  QoderCommandCatalogContract,
  QoderCommandDropdownConfig,
} from './qoder-command-catalog-contract';
import type { QoderCommandEntry } from './qoder-command-entry';
import { isSkill } from './slash-command';

function slashCommandToEntry(cmd: SlashCommand): QoderCommandEntry {
  const skill = isSkill(cmd);
  return {
    id: cmd.id,
    kind: skill ? 'skill' : 'command',
    name: cmd.name,
    description: cmd.description,
    content: cmd.content,
    argumentHint: cmd.argumentHint,
    allowedTools: cmd.allowedTools,
    model: cmd.model,
    disableModelInvocation: cmd.disableModelInvocation,
    userInvocable: cmd.userInvocable,
    context: cmd.context,
    agent: cmd.agent,
    hooks: cmd.hooks,
    scope: cmd.source === 'sdk' ? 'runtime' : 'vault',
    source: cmd.source ?? 'user',
    isEditable: cmd.source !== 'sdk',
    isDeletable: cmd.source !== 'sdk',
    displayPrefix: '/',
    insertPrefix: '/',
  };
}

function entryToSlashCommand(entry: QoderCommandEntry): SlashCommand {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    content: entry.content,
    argumentHint: entry.argumentHint,
    allowedTools: entry.allowedTools,
    model: entry.model,
    disableModelInvocation: entry.disableModelInvocation,
    userInvocable: entry.userInvocable,
    context: entry.context,
    agent: entry.agent,
    hooks: entry.hooks,
    source: entry.source,
    kind: entry.kind,
  };
}

export type CommandProbe = () => Promise<SlashCommand[]>;

interface ProbeState {
  revision: number;
  promise: Promise<void>;
}

export class QoderCommandCatalog implements QoderCommandCatalogContract {
  private sdkCommands: SlashCommand[] = [];
  private probeState: ProbeState | null = null;
  private revision = 0;
  /** True once a probe attempt finished, so empty results are cached and the
   * CLI is not relaunched on every dropdown open. */
  private probeCompleted = false;
  private listeners = new Set<() => void>();

  constructor(
    private commandStorage: SlashCommandStorage,
    private skillStorage: SkillStorage,
    private probe?: CommandProbe,
  ) {}

  setRuntimeCommands(commands: SlashCommand[]): void {
    this.revision++;
    this.sdkCommands = commands;
    // Runtime data is authoritative — no probe needed, even when empty.
    this.probeCompleted = true;
    this.notifyListeners();
  }

  /** Clears runtime commands and allows the SDK probe to run again. */
  invalidateRuntimeCommands(): void {
    this.revision++;
    this.sdkCommands = [];
    this.probeCompleted = false;
    this.notifyListeners();
  }

  /** Subscribes to entry changes (e.g., background probe completion). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async listDropdownEntries(context: { includeBuiltIns: boolean }): Promise<QoderCommandEntry[]> {
    void context;
    // SDK commands already include vault commands/skills (the SDK scans
    // .qoder/commands/ and .qoder/skills/ internally). No file scan needed.
    // On a cold start, kick off the SDK probe in the background and answer
    // immediately so the dropdown never blocks on CLI startup. Subscribers
    // are notified once the probe finishes.
    if (this.sdkCommands.length === 0 && !this.probeCompleted && this.probe) {
      void this.ensureProbed();
    }
    const runtimeEntries = this.sdkCommands
      .filter(cmd => !isHiddenCommand(cmd.name))
      .map(slashCommandToEntry);
    if (runtimeEntries.length > 0) {
      return runtimeEntries;
    }
    // No separate skill layer: skills arrive through the SDK list above and are
    // governed by the same blacklist. The offline fallback offers the user's own
    // vault commands only.
    return this.listVaultCommandEntries();
  }

  /** Probe the SDK for commands. Deduplicates concurrent calls. */
  private async ensureProbed(): Promise<void> {
    if (!this.probe || this.probeCompleted) return;
    const revision = this.revision;
    if (!this.probeState || this.probeState.revision !== revision) {
      const promise = this.probe().then((commands) => {
        if (revision === this.revision && commands.length > 0) {
          this.sdkCommands = commands;
        }
      }).catch(() => {
        // Probe is best-effort.
      }).finally(() => {
        if (this.probeState?.revision === revision) {
          this.probeState = null;
        }
        // Runtime updates and invalidations supersede an older probe. They
        // must not be marked completed or notified by its stale result.
        if (revision !== this.revision) return;
        this.probeCompleted = true;
        this.notifyListeners();
      });
      this.probeState = { revision, promise };
    }
    await this.probeState.promise;
  }

  private notifyListeners(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  async listVaultEntries(): Promise<QoderCommandEntry[]> {
    const commands = await this.commandStorage.loadAll();
    const skills = await this.skillStorage.loadAll();
    return [...commands, ...skills].map(slashCommandToEntry);
  }

  /** Dropdown offline fallback: the user's own vault commands, without skills. */
  private async listVaultCommandEntries(): Promise<QoderCommandEntry[]> {
    const commands = await this.commandStorage.loadAll();
    return commands.map(slashCommandToEntry);
  }

  async saveVaultEntry(entry: QoderCommandEntry): Promise<void> {
    const cmd = entryToSlashCommand(entry);
    if (entry.kind === 'skill') {
      await this.skillStorage.save(cmd);
    } else {
      await this.commandStorage.save(cmd);
    }
  }

  async deleteVaultEntry(entry: QoderCommandEntry): Promise<void> {
    if (entry.kind === 'skill') {
      await this.skillStorage.delete(entry.id);
    } else {
      await this.commandStorage.delete(entry.id);
    }
  }

  getDropdownConfig(): QoderCommandDropdownConfig {
    return {
      triggerChars: ['/'],
    };
  }

  async refresh(): Promise<void> {
    // Qoder revalidation happens externally via setRuntimeCommands
  }
}
