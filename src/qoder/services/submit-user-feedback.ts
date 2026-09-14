import { submitFeedback } from '@qoder-ai/qoder-agent-sdk';

import { getEnhancedPath } from '../../core/env/environment';
import { getVaultPath } from '../../core/fs/path';
import type { QoderHostContext } from '../qoder-host-context';

/** Hard limit enforced by `qodercli feedback --content`. */
export const FEEDBACK_CONTENT_LIMIT = 2000;

/**
 * Reported as `--ide-type`. The SDK maps `qoder_work`/`quest` to their own
 * labels and passes any other string through verbatim, so the backend can
 * attribute submissions to this plugin.
 */
const FEEDBACK_IDE_TYPE = 'Qoderian';

/**
 * Shorter than the SDK's 60s default: `submitFeedback` exposes no abort
 * signal, so the modal cannot offer a cancel while this runs.
 */
const FEEDBACK_TIMEOUT_MS = 30_000;

export interface UserFeedbackDraft {
  content: string;
  /** When true, the vault path is passed as `--workdir` so the CLI collects workspace state. */
  includeWorkspaceDiagnostics: boolean;
  email?: string;
  sessionId?: string;
  callerVersion?: string;
}

export type UserFeedbackOutcome =
  | { ok: true; message: string; requestId?: string }
  | {
      ok: false;
      reason: 'cliUnavailable' | 'emptyContent' | 'contentTooLong' | 'rejected';
      detail?: string;
    };

/** Counts Unicode code points so emoji are not charged twice against the CLI limit. */
export function countFeedbackChars(content: string): number {
  return [...content].length;
}

/**
 * Submits user feedback through the SDK's one-shot `qodercli feedback`
 * subprocess.
 *
 * Mirrors `credits-usage.ts`: it reuses the plugin's resolved CLI path and the
 * enhanced PATH so a custom CLI location, a node-requiring CLI and the active
 * edition all behave exactly like a normal runtime spawn. Returns a reason code
 * instead of throwing so callers own the user-facing copy.
 */
export async function submitUserFeedback(
  plugin: QoderHostContext,
  draft: UserFeedbackDraft,
): Promise<UserFeedbackOutcome> {
  const cliPath = plugin.getResolvedQoderCliPath();
  if (!cliPath) {
    return { ok: false, reason: 'cliUnavailable' };
  }

  const content = draft.content.trim();
  if (!content) {
    return { ok: false, reason: 'emptyContent' };
  }
  if (countFeedbackChars(content) > FEEDBACK_CONTENT_LIMIT) {
    return { ok: false, reason: 'contentTooLong' };
  }

  // `getVaultPath` is null without a filesystem adapter (mobile/web), where the
  // CLI cannot collect anything meaningful either.
  const workdir = draft.includeWorkspaceDiagnostics ? getVaultPath(plugin.app) : null;
  const email = draft.email?.trim();

  const result = await submitFeedback(
    {
      content,
      ...(workdir ? { workdir } : {}),
      ...(draft.sessionId ? { sessionId: draft.sessionId } : {}),
      ...(email ? { email } : {}),
      ...(draft.callerVersion ? { callerVersion: draft.callerVersion } : {}),
    },
    {
      cliPath,
      env: { ...process.env, PATH: getEnhancedPath(undefined, cliPath) },
      integrationMode: FEEDBACK_IDE_TYPE,
      timeout: FEEDBACK_TIMEOUT_MS,
    },
  );

  if (result.success) {
    return { ok: true, message: result.message, requestId: result.requestId };
  }
  return { ok: false, reason: 'rejected', detail: result.message };
}
