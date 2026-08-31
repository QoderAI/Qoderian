/**
 * Load-path timing diagnostics.
 *
 * Startup work (session metadata reads, edition migration, index building,
 * tab restore, history hydration) grows with the number of stored sessions,
 * and regressions were invisible until the plugin felt slow. Each stage wraps
 * itself in `measureAsync` and logs its elapsed time; labels are stable phase
 * names without user data, so the lines are safe to share in bug reports.
 */

export async function measureAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    const elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10;
    console.info(`[qoderian perf] ${label}: ${elapsedMs}ms`);
  }
}
