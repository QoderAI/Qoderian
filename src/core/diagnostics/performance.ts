/**
 * Load-path and turn-path timing diagnostics.
 *
 * Startup work (session metadata reads, edition migration, index building,
 * tab restore, history hydration) and first-turn work (turn preparation,
 * persistent-query spawn, CLI cold-start, first response chunk) grow with the
 * number of stored sessions and external context, and regressions were
 * invisible until the plugin felt slow. Each stage wraps itself in
 * `measureAsync`/`measure` or logs via `logElapsed`; labels are stable phase
 * names without user data, so the lines are safe to share in bug reports.
 */

export async function measureAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    logElapsed(label, startedAt);
  }
}

/** Synchronous counterpart of `measureAsync` for CPU-bound stages. */
export function measure<T>(label: string, fn: () => T): T {
  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    logElapsed(label, startedAt);
  }
}

/** Logs the elapsed time since `startedAt` under a stable perf label. */
export function logElapsed(label: string, startedAt: number): void {
  const elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10;
  console.info(`[qoderian perf] ${label}: ${elapsedMs}ms`);
}
