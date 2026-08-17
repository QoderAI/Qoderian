import type { Options } from '@qoder-ai/qoder-agent-sdk';
import { qodercliAuth, query as agentQuery } from '@qoder-ai/qoder-agent-sdk';

import { getEnhancedPath, getMissingNodeError } from '../../core/env/environment';
import { getVaultPath } from '../../core/fs/path';
import {
  getQoderSettings,
  resolveQoderSettingSources,
} from '../config/settings';
import { toQoderRuntimeModelId } from '../models/model-selection';
import {
  resolveModelReasoningEffort,
} from '../models/qoder-model-config';
import type { QoderHostContext } from '../qoder-host-context';
import { extractAssistantText } from '../services/extract-assistant-text';
import { createCustomSpawnFunction } from './custom-spawn';

export interface ColdStartQueryConfig {
  plugin: QoderHostContext;
  systemPrompt: string;
  /** Tools available to the model. Omit for SDK default (all tools). */
  tools?: string[];
  hooks?: Options['hooks'];
  /** Override model. Default: the active Qoder setting. */
  model?: string;
  /**
   * Thinking configuration override:
   * - undefined: use the configured Qoder reasoning effort
   * - { disabled: true }: skip all thinking configuration
   */
  thinking?: { disabled: true };
  /** Default: SDK default (true). */
  persistSession?: boolean;
  resumeSessionId?: string;
  abortController?: AbortController;
  /** Pre-fetched settings snapshot. Avoids a redundant read when the caller already has one. */
  settings?: Record<string, unknown>;
  /** Called with accumulated text after each chunk. */
  onTextChunk?: (accumulatedText: string) => void;
}

export interface ColdStartQueryResult {
  text: string;
  sessionId: string | null;
}

export async function runColdStartQuery(
  config: ColdStartQueryConfig,
  prompt: string,
): Promise<ColdStartQueryResult> {
  const vaultPath = getVaultPath(config.plugin.app);
  if (!vaultPath) {
    throw new Error('Could not determine vault path');
  }

  const resolvedQoderPath = config.plugin.getResolvedQoderCliPath();
  if (!resolvedQoderPath) {
    throw new Error('Qoder CLI not found');
  }

  const enhancedPath = getEnhancedPath(undefined, resolvedQoderPath);

  const missingNodeError = getMissingNodeError(resolvedQoderPath, enhancedPath);
  if (missingNodeError) {
    throw new Error(missingNodeError);
  }

  const settings = config.settings
    ?? config.plugin.settings;
  const qoderSettings = getQoderSettings(settings);

  const selectedModel = toQoderRuntimeModelId(config.model ?? (settings.model as string));

  const options: Options = {
    cwd: vaultPath,
    systemPrompt: config.systemPrompt,
    model: selectedModel,
    abortController: config.abortController,
    auth: qodercliAuth(),
    pathToQoderCLIExecutable: resolvedQoderPath,
    env: {
      ...process.env,
      PATH: enhancedPath,
    },
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    settingSources: resolveQoderSettingSources(qoderSettings.loadUserSettings),
    spawnQoderCLIProcess: createCustomSpawnFunction(enhancedPath),
  };

  if (config.tools !== undefined) {
    options.tools = config.tools;
  }

  if (config.hooks) {
    options.hooks = config.hooks;
  }

  if (config.persistSession !== undefined) {
    options.persistSession = config.persistSession;
  }

  if (config.resumeSessionId) {
    options.resume = config.resumeSessionId;
  }

  if (!config.thinking?.disabled) {
    const effortLevel = resolveModelReasoningEffort(selectedModel, settings);
    options.extraArgs = { ...options.extraArgs, 'reasoning-effort': effortLevel };
  }

  const response = agentQuery({ prompt, options });
  let responseText = '';
  let sessionId: string | null = null;
  let completed = false;

  try {
    for await (const message of response) {
      if (config.abortController?.signal.aborted) {
        await response.interrupt();
        throw new Error('Cancelled');
      }

      if (
        message.type === 'system' &&
        message.subtype === 'init' &&
        message.session_id
      ) {
        sessionId = message.session_id;
      }

      if (message.type === 'result') {
        if (message.subtype !== 'success') {
          const details = message.errors.filter(Boolean).join('\n');
          throw new Error(details || `Qoder query failed: ${message.subtype}`);
        }
        completed = true;
      }

      const text = extractAssistantText(message);
      if (text) {
        responseText += text;
        config.onTextChunk?.(responseText);
      }
    }
  } finally {
    await response.close();
  }

  if (!completed) {
    throw new Error('Qoder query ended without a successful result');
  }

  return { text: responseText, sessionId };
}
