import type { AgentInfo, ModelInfo, Options, SDKUserMessage, SlashCommand as SDKSlashCommand } from '@qoder-ai/qoder-agent-sdk';
import { qodercliAuth, query as agentQuery } from '@qoder-ai/qoder-agent-sdk';

import { getEnhancedPath, getMissingNodeError } from '../../core/env/environment';
import { getVaultPath } from '../../core/fs/path';
import type { SlashCommand } from '../../core/types';
import type { QoderRuntimeStatus } from '../../core/types/services';
import {
  getQoderSettings,
  type QoderDiscoveredAgent,
  type QoderDiscoveredModel,
  resolveQoderSettingSources,
} from '../config/settings';
import type { QoderHostContext } from '../qoder-host-context';
import { createCustomSpawnFunction } from '../runtime/custom-spawn';

function mapSdkCommands(sdkCommands: SDKSlashCommand[]): SlashCommand[] {
  return sdkCommands.map((cmd) => ({
    id: `sdk:${cmd.name}`,
    name: cmd.name,
    description: cmd.description,
    argumentHint: cmd.argumentHint,
    content: '',
    source: 'sdk' as const,
  }));
}

/** Groups mirror the Qoder IDE selector tabs. */
function resolveSdkModelGroup(model: ModelInfo): string {
  const source = model.source as string | undefined;
  if (model.serverScene === 'byok_enterprise' || source === 'organization') return 'Enterprise';
  if (source === 'user') return 'Custom';
  if (model.isNew) return 'New models';
  return 'Qoder';
}

function normalizeBadge(badge: unknown): Record<string, string> | undefined {
  if (!badge || typeof badge !== 'object' || Array.isArray(badge)) return undefined;

  const result: Record<string, string> = {};
  for (const [locale, text] of Object.entries(badge)) {
    if (typeof text === 'string' && text.trim()) {
      result[locale] = text.trim();
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/** Server keeps promotion fields snake_case; flatten what the selector shows. */
function mapSdkPromotion(model: ModelInfo): QoderDiscoveredModel['promotion'] {
  const promotion = model.promotion;
  if (!promotion) return undefined;

  const badge = normalizeBadge(promotion.badge);
  const window = promotion.window_start && promotion.window_end
    ? `${promotion.window_start}-${promotion.window_end}${promotion.timezone ? ` ${promotion.timezone}` : ''}`
    : undefined;

  const mapped: NonNullable<QoderDiscoveredModel['promotion']> = {
    active: promotion.active === true,
    ...(badge ? { badge } : {}),
    ...(typeof promotion.discount_factor === 'number' ? { discountFactor: promotion.discount_factor } : {}),
    ...(window ? { window } : {}),
  };

  return mapped;
}

function mapSdkAgents(sdkAgents: AgentInfo[]): QoderDiscoveredAgent[] {
  return sdkAgents.flatMap((agent) => {
    const name = agent.name?.trim();
    if (!name) return [];
    const description = agent.description?.trim();
    const model = agent.model?.trim();
    return [{
      name,
      ...(description ? { description } : {}),
      ...(model ? { model } : {}),
    }];
  });
}

function mapSdkModels(models: ModelInfo[]): QoderDiscoveredModel[] {
  return models.flatMap((model) => {
    const value = model.value?.trim();
    if (!value || model.isEnabled === false) return [];
    const group = resolveSdkModelGroup(model);
    const promotion = mapSdkPromotion(model);
    return [{
      value,
      displayName: model.displayName?.trim() || value,
      description: model.description?.trim() || '',
      group,
      ...(typeof model.priceFactor === 'number' ? { priceFactor: model.priceFactor } : {}),
      ...(typeof model.originalPriceFactor === 'number'
        ? { originalPriceFactor: model.originalPriceFactor }
        : {}),
      ...(promotion ? { promotion } : {}),
    }];
  });
}

class ProbeInput implements AsyncIterable<SDKUserMessage> {
  private resolveEnd: (() => void) | null = null;
  private readonly ended = new Promise<void>((resolve) => {
    this.resolveEnd = resolve;
  });

  end(): void {
    this.resolveEnd?.();
    this.resolveEnd = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    const ended = this.ended;
    return {
      async next(): Promise<IteratorResult<SDKUserMessage>> {
        await ended;
        return { done: true, value: undefined };
      },
    };
  }
}

function buildProbeOptions(
  plugin: QoderHostContext,
  vaultPath: string,
  cliPath: string,
  abortController: AbortController,
): Options {
  const enhancedPath = getEnhancedPath(undefined, cliPath);
  const qoderSettings = getQoderSettings(plugin.settings);
  return {
    cwd: vaultPath,
    abortController,
    auth: qodercliAuth(),
    pathToQoderCLIExecutable: cliPath,
    env: { ...process.env, PATH: enhancedPath },
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    settingSources: resolveQoderSettingSources(qoderSettings.loadUserSettings),
    persistSession: false,
    spawnQoderCLIProcess: createCustomSpawnFunction(enhancedPath),
  };
}

/** Catalog snapshot discovered from a single SDK initialization. */
export interface QoderRuntimeProbeResult {
  commands: SlashCommand[];
  agents: QoderDiscoveredAgent[];
  models: QoderDiscoveredModel[];
}

export type QoderRuntimeProbeOutcome =
  | QoderRuntimeProbeResult
  | { error: QoderRuntimeStatus };

function getErrorDetails(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function classifyQoderProbeError(error: unknown, timedOut = false): QoderRuntimeStatus {
  const details = getErrorDetails(error).trim() || 'Unknown Qoder CLI initialization error';

  if (timedOut || /abort(?:ed|error)|timed?\s*out/i.test(details)) {
    return {
      kind: 'offline',
      message: 'Qoder CLI did not respond. Check your network connection, then retry.',
      details,
    };
  }
  if (/not logged in|login required|please (?:log|sign) in|please run \/?login|sign[- ]?in required|unauthori[sz]ed|authentication required|invalid (?:api key|credential|token)|expired.*(?:credential|token)|credentials? (?:not found|missing)|\b401\b/i.test(details)) {
    return {
      kind: 'authRequired',
      message: 'Qoder CLI is not signed in. Run `qodercli login` in a terminal, then retry.',
      details,
    };
  }
  if (/protocol version|incompatible|unsupported (?:cli|sdk|version)|version mismatch/i.test(details)) {
    return {
      kind: 'incompatible',
      message: 'This Qoder CLI version is incompatible. Update qodercli, then retry.',
      details,
    };
  }
  if (/enotfound|econnrefused|econnreset|network|fetch failed|socket hang up|service unavailable|\b50[234]\b/i.test(details)) {
    return {
      kind: 'offline',
      message: 'Could not reach Qoder services. Check your network connection, then retry.',
      details,
    };
  }

  return {
    kind: 'failed',
    message: 'Qoder CLI could not be initialized. Check the CLI path and retry.',
    details,
  };
}

/**
 * Probes the Qoder SDK locally to discover the runtime catalog.
 *
 * Opens a single idle Query, waits for the SDK's initialization control
 * response, reads command/agent metadata from it, refreshes the model
 * catalog (live → init → cache), and closes the Query without sending a
 * turn. Returns null when initialization fails so callers can keep their
 * previous snapshot.
 */
export async function probeRuntimeCatalog(
  plugin: QoderHostContext,
  options?: { timeoutMs?: number },
): Promise<QoderRuntimeProbeOutcome> {
  const vaultPath = getVaultPath(plugin.app);
  const cliPath = plugin.getResolvedQoderCliPath();
  if (!cliPath) {
    return {
      error: {
        kind: 'cliMissing',
        message: 'Qoder CLI was not found. Install qodercli or configure its path in Qoderian settings.',
      },
    };
  }
  if (!vaultPath) {
    return {
      error: {
        kind: 'failed',
        message: 'Could not determine the current Obsidian vault path.',
      },
    };
  }

  const enhancedPath = getEnhancedPath(undefined, cliPath);
  const missingNodeError = getMissingNodeError(cliPath, enhancedPath);
  if (missingNodeError) {
    return {
      error: {
        kind: 'nodeMissing',
        message: `${missingNodeError} Install Node.js or use the native qodercli executable, then retry.`,
        details: missingNodeError,
      },
    };
  }

  const abortController = new AbortController();
  const input = new ProbeInput();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, options?.timeoutMs ?? 20_000);
  const conversation = agentQuery({
    prompt: input,
    options: buildProbeOptions(plugin, vaultPath, cliPath, abortController),
  });
  try {
    const initialization = await conversation.initializationResult();
    const commands = mapSdkCommands(initialization.commands ?? []);
    const agents = mapSdkAgents(initialization.agents ?? []);

    let models: QoderDiscoveredModel[] = [];
    try {
      const liveModels: ModelInfo[] = await conversation.getAvailableModels({ fetchStrategy: 'live' });
      if (liveModels.length > 0) {
        models = mapSdkModels(liveModels);
      }
    } catch {
      // Initialization still carries the catalog when a live refresh is unavailable.
    }
    if (models.length === 0 && initialization.models?.length > 0) {
      models = mapSdkModels(initialization.models);
    }
    if (models.length === 0) {
      try {
        const cachedModels: ModelInfo[] = await conversation.getAvailableModels({ fetchStrategy: 'cache' });
        models = mapSdkModels(cachedModels);
      } catch {
        // Keep the SDK-backed selector empty rather than fabricating another catalog.
      }
    }

    return { commands, agents, models };
  } catch (error) {
    return { error: classifyQoderProbeError(error, timedOut) };
  } finally {
    window.clearTimeout(timeout);
    input.end();
    await conversation.close().catch(() => {});
  }
}
