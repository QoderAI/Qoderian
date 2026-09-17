import { query as agentQuery } from '@qoder-ai/qoder-agent-sdk';

import { getVaultPath } from '../../core/fs/path';
import type { ContextUsageBreakdown } from '../../core/types';
import { buildProbeOptions, ProbeInput } from '../commands/probe-runtime-commands';
import type { QoderHostContext } from '../qoder-host-context';
import { mapContextUsageBreakdown } from '../runtime/qoder-context-usage';

/** Stored-session reads spawn a CLI; repeated panel opens reuse the answer. */
const PROBE_TTL_MS = 60_000;

const probeCache = new Map<string, { fetchedAt: number; breakdown: ContextUsageBreakdown }>();

/**
 * Reads the `/context` breakdown of a stored session through a short-lived
 * idle query. Used when no live query holds the session — a fresh plugin
 * start or a restored conversation — so the panel can show numbers before the
 * next turn. The probe never sends a prompt and does not persist, so the
 * session transcript stays untouched; resuming may still fail (missing or
 * foreign session), in which case callers keep their previous state.
 */
export async function fetchStoredSessionContextUsage(
  plugin: QoderHostContext,
  sessionId: string,
  options?: { timeoutMs?: number; maxAgeMs?: number },
): Promise<ContextUsageBreakdown | null> {
  const maxAgeMs = options?.maxAgeMs ?? PROBE_TTL_MS;
  const cached = probeCache.get(sessionId);
  if (cached && Date.now() - cached.fetchedAt < maxAgeMs) {
    return cached.breakdown;
  }

  const vaultPath = getVaultPath(plugin.app);
  const cliPath = plugin.getResolvedQoderCliPath();
  if (!cliPath || !vaultPath) return null;

  const abortController = new AbortController();
  const input = new ProbeInput();
  const timeout = window.setTimeout(() => {
    abortController.abort();
  }, options?.timeoutMs ?? 15_000);
  const conversation = agentQuery({
    prompt: input,
    options: {
      ...buildProbeOptions(plugin, vaultPath, cliPath, abortController),
      resume: sessionId,
    },
  });
  try {
    await conversation.initializationResult();
    const breakdown = mapContextUsageBreakdown(await conversation.getContextUsage());
    probeCache.set(sessionId, { fetchedAt: Date.now(), breakdown });
    return breakdown;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
    input.end();
    await conversation.close().catch(() => {});
  }
}
