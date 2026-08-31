/**
 * Maps items with a capped number of in-flight async operations.
 *
 * Unlike fixed-chunk `Promise.all` batching, a worker that finishes picks up
 * the next item immediately, so one slow task cannot hold up a whole batch.
 * Output order always matches input order. Failures are the mapper's concern:
 * wrap the per-item work in try/catch and return a sentinel if skips are
 * acceptable, since a thrown error rejects the whole call.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  const workerCount = Math.max(0, Math.min(limit, items.length));
  const workers: Promise<void>[] = [];
  for (let worker = 0; worker < workerCount; worker += 1) {
    workers.push(runWorker());
  }
  await Promise.all(workers);
  return results;
}
