import { query as agentQuery } from '@qoder-ai/qoder-agent-sdk';

import { getVaultPath } from '../../core/fs/path';
import type { CreditsUsageSnapshot } from '../../core/types/services';
import {
  buildProbeOptions,
  ProbeInput,
} from '../commands/probe-runtime-commands';
import type { QoderHostContext } from '../qoder-host-context';

/**
 * Fetches the account credits usage snapshot via a short-lived idle SDK query.
 *
 * Reuses the runtime probe's spawn options so edition switching, custom CLI
 * paths and safe-mode settings behave exactly like a normal probe. Returns
 * null when the CLI is missing or the lookup fails; callers keep their last
 * snapshot instead of surfacing an error.
 */
export async function fetchCreditsUsage(
  plugin: QoderHostContext,
  options?: { timeoutMs?: number },
): Promise<CreditsUsageSnapshot | null> {
  const vaultPath = getVaultPath(plugin.app);
  const cliPath = plugin.getResolvedQoderCliPath();
  if (!cliPath || !vaultPath) return null;

  const abortController = new AbortController();
  const input = new ProbeInput();
  const timeout = window.setTimeout(() => {
    abortController.abort();
  }, options?.timeoutMs ?? 10_000);
  const conversation = agentQuery({
    prompt: input,
    options: buildProbeOptions(plugin, vaultPath, cliPath, abortController),
  });
  try {
    await conversation.initializationResult();
    const usage = await conversation.getUsageInfo();
    return usage ?? null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
    input.end();
    await conversation.close().catch(() => {});
  }
}
