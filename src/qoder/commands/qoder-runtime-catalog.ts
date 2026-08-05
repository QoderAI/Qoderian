import type { AgentDefinition, SlashCommand } from '../../core/types';
import type { QoderRuntimeStatus } from '../../core/types/services';
import {
  getQoderSettings,
  type QoderDiscoveredAgent,
  type QoderDiscoveredModel,
} from '../config/settings';
import type { QoderHostContext } from '../qoder-host-context';
import { probeRuntimeCatalog } from './probe-runtime-commands';

/** Persistence hook for the last successful catalog snapshot. */
export interface QoderRuntimeCatalogPersistence {
  (update: {
    discoveredAgents?: QoderDiscoveredAgent[];
    discoveredModels?: QoderDiscoveredModel[];
  }): void;
}

export function shouldRetryQoderRuntimeStatus(status: QoderRuntimeStatus): boolean {
  return status.kind === 'offline' || status.kind === 'failed';
}

function agentFromDiscovered(agent: QoderDiscoveredAgent): AgentDefinition {
  return {
    id: agent.name,
    name: agent.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    description: agent.description ?? '',
    prompt: '', // Runtime agent — prompt managed by the CLI
    source: 'builtin',
    ...(agent.model ? { model: agent.model } : {}),
  };
}

/**
 * Runtime catalog of commands and agents discovered from the Qoder CLI.
 *
 * A single idle SDK query provides commands, agents and models at
 * initialization. This class caches the latest successful result, keeps the
 * previous snapshot when a refresh fails, and accepts incremental agent
 * names reported by live session init events.
 */
export class QoderRuntimeCatalog {
  private commands: SlashCommand[] = [];
  private agents: AgentDefinition[] = [];
  private refreshPromise: Promise<boolean> | null = null;
  private runtimeStatus: QoderRuntimeStatus = {
    kind: 'checking',
    message: 'Checking Qoder CLI and loading models…',
  };
  private readonly runtimeStatusListeners = new Set<(status: QoderRuntimeStatus) => void>();

  constructor(
    private readonly plugin: QoderHostContext,
    private readonly onPersist?: QoderRuntimeCatalogPersistence,
  ) {
    // Seed from the last persisted snapshot so cold starts are not empty.
    this.agents = getQoderSettings(plugin.settings).discoveredAgents.map(agentFromDiscovered);
  }

  /**
   * Re-probes the CLI. Deduplicates concurrent calls; never rejects.
   * Resolves true when the probe succeeded.
   */
  async refresh(): Promise<boolean> {
    if (!this.refreshPromise) {
      this.setRuntimeStatus({
        kind: 'checking',
        message: 'Checking Qoder CLI and loading models…',
      });
      this.refreshPromise = this.doRefresh()
        .catch((error: unknown) => {
          this.setRuntimeStatus({
            kind: 'failed',
            message: 'Qoder CLI could not be initialized. Check the CLI path and retry.',
            details: error instanceof Error ? error.message : String(error),
          });
          return false;
        }) // Keep the previous snapshot on failure.
        .finally(() => { this.refreshPromise = null; });
    }
    return this.refreshPromise;
  }

  getCommands(): SlashCommand[] {
    return [...this.commands];
  }

  getAvailableAgents(): AgentDefinition[] {
    return [...this.agents];
  }

  getAgentById(id: string): AgentDefinition | undefined {
    return this.agents.find(a => a.id === id);
  }

  /** Used for @-mention filtering in the chat input. */
  searchAgents(query: string): AgentDefinition[] {
    const q = query.toLowerCase();
    return this.agents.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q)
    );
  }

  /**
   * Merges agent names reported by a live session init into the catalog.
   *
   * Session events only carry names, so an empty catalog is seeded with
   * description-less entries while a populated catalog only gains missing
   * names. Persisted snapshots are left untouched until the next successful
   * probe.
   */
  applySessionAgents(names: string[]): void {
    const valid = names.filter((name): name is string =>
      typeof name === 'string' && name.trim().length > 0);
    if (valid.length === 0) return;

    if (this.agents.length === 0) {
      this.agents = valid.map(name => agentFromDiscovered({ name }));
      return;
    }

    for (const name of valid) {
      if (!this.agents.some(a => a.id === name)) {
        this.agents.push(agentFromDiscovered({ name }));
      }
    }
  }

  getRuntimeStatus(): QoderRuntimeStatus {
    return { ...this.runtimeStatus };
  }

  subscribeRuntimeStatus(listener: (status: QoderRuntimeStatus) => void): () => void {
    this.runtimeStatusListeners.add(listener);
    return () => this.runtimeStatusListeners.delete(listener);
  }

  private setRuntimeStatus(status: QoderRuntimeStatus): void {
    this.runtimeStatus = status;
    for (const listener of this.runtimeStatusListeners) {
      listener({ ...status });
    }
  }

  private async doRefresh(): Promise<boolean> {
    const result = await probeRuntimeCatalog(this.plugin);
    if ('error' in result) {
      this.setRuntimeStatus(result.error);
      return false; // Probe failed — keep the last successful snapshot.
    }

    this.commands = result.commands;
    if (result.agents.length > 0) {
      this.agents = result.agents.map(agentFromDiscovered);
    }

    if (this.onPersist && (result.agents.length > 0 || result.models.length > 0)) {
      try {
        this.onPersist({
          ...(result.agents.length > 0 ? { discoveredAgents: result.agents } : {}),
          ...(result.models.length > 0 ? { discoveredModels: result.models } : {}),
        });
      } catch {
        // Persistence is best-effort; the in-memory catalog already updated.
      }
    }

    const hasModels = result.models.length > 0
      || getQoderSettings(this.plugin.settings).discoveredModels.length > 0;
    this.setRuntimeStatus(hasModels
      ? { kind: 'ready', message: 'Qoder CLI is ready.' }
      : {
          kind: 'noModels',
          message: 'No models are available for this Qoder account. Check your account access, then retry.',
        });
    return true;
  }
}
