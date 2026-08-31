import { mapWithConcurrency } from '@/core/async/map-with-concurrency';

function defer(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('mapWithConcurrency', () => {
  it('returns results in input order regardless of completion order', async () => {
    const items = [30, 5, 20, 10];
    const results = await mapWithConcurrency(items, 4, async (ms, index) => {
      await defer(ms);
      return index;
    });

    expect(results).toEqual([0, 1, 2, 3]);
  });

  it('keeps in-flight work within the limit while actually running in parallel', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const items = Array.from({ length: 24 }, (_, index) => index);
    await mapWithConcurrency(items, 8, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await defer(5);
      inFlight -= 1;
    });

    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(8);
  });

  it('lets finished workers pick up the next item instead of waiting for a slow one', async () => {
    let completed = 0;
    const items = ['slow', 'fast-1', 'fast-2', 'fast-3'];

    const done = mapWithConcurrency(items, 2, async (item) => {
      if (item === 'slow') {
        await defer(120);
      } else {
        await defer(5);
      }
      completed += 1;
      return item;
    });

    await defer(40);
    // The slow task is still running, but the fast tasks must have finished.
    expect(completed).toBe(3);

    const results = await done;
    expect(results).toEqual(['slow', 'fast-1', 'fast-2', 'fast-3']);
  });

  it('returns an empty array for empty input', async () => {
    await expect(mapWithConcurrency([], 8, async () => 1)).resolves.toEqual([]);
  });

  it('clamps the worker count to the number of items', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await mapWithConcurrency([1, 2], 8, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await defer(5);
      inFlight -= 1;
    });

    expect(maxInFlight).toBe(2);
  });

  it('rejects when the mapper throws', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error('boom');
        return item;
      }),
    ).rejects.toThrow('boom');
  });
});
