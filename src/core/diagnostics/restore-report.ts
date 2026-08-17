/**
 * Startup restore diagnostics.
 *
 * The restore pipeline (tab layout read, per-tab rebuild, session metadata,
 * conversation history hydration) used to swallow failures silently, leaving
 * users with missing tabs or empty conversations and no explanation. Each
 * stage reports issues here; the chat view drains the collected issues once
 * restore finishes and surfaces a single aggregated notice.
 */

export type RestoreStage = 'layout' | 'tab' | 'metadata' | 'history';

export interface RestoreIssue {
  stage: RestoreStage;
  detail: string;
}

let activeIssues: RestoreIssue[] | null = null;

/** Opens the collection window (called once on plugin load). */
export function beginRestoreReport(): void {
  activeIssues = [];
}

/**
 * Records a restore issue. Always logged for debugging; only collected into
 * the user-facing report while the window is open.
 */
export function reportRestoreIssue(stage: RestoreStage, detail: string): void {
  console.error(`[qoderian-restore:${stage}] ${detail}`);
  activeIssues?.push({ stage, detail });
}

/**
 * Closes the window (restore finished) and returns the collected issues.
 * Duplicates are dropped: some stages run twice during startup (e.g. the
 * tab layout is read by both loadSettings and the chat view), and counting
 * the same root cause twice would inflate the aggregated notice.
 */
export function finishRestoreReport(): RestoreIssue[] {
  const issues = activeIssues ?? [];
  activeIssues = null;
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.stage}:${issue.detail}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
