import { SessionStorage } from '@/app/storage/session-storage';
import {
  beginRestoreReport,
  finishRestoreReport,
} from '@/core/diagnostics/restore-report';

type FakeAdapter = {
  read: jest.Mock;
  listFiles: jest.Mock;
};

function makeStorage(read: jest.Mock, listFiles?: jest.Mock): SessionStorage {
  const adapter: FakeAdapter = { read, listFiles: listFiles ?? jest.fn(async () => []) };
  return new SessionStorage(adapter as any);
}

describe('SessionStorage restore diagnostics', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    finishRestoreReport();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports a metadata issue when metadata cannot be read', async () => {
    const storage = makeStorage(jest.fn(async () => {
      throw new Error('file missing');
    }));

    beginRestoreReport();
    expect(await storage.loadMetadata('conv-1')).toBeNull();

    const issues = finishRestoreReport();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      stage: 'metadata',
      detail: expect.stringContaining('conv-1'),
    });
  });

  it('reports a metadata issue for corrupt metadata json', async () => {
    const storage = makeStorage(jest.fn(async () => '{oops'));

    beginRestoreReport();
    expect(await storage.loadMetadata('conv-2')).toBeNull();

    const issues = finishRestoreReport();
    expect(issues).toHaveLength(1);
    expect(issues[0].stage).toBe('metadata');
  });

  it('does not report when metadata loads fine', async () => {
    const storage = makeStorage(jest.fn(async () => '{"id":"conv-3"}'));

    beginRestoreReport();
    await storage.loadMetadata('conv-3');

    expect(finishRestoreReport()).toEqual([]);
  });

  it('skips corrupt files in listMetadata but reports each skip', async () => {
    const read = jest.fn(async (filePath: string) => {
      if (filePath.endsWith('good.meta.json')) return '{"id":"good"}';
      throw new Error('corrupt');
    });
    const listFiles = jest.fn(async () => ['good.meta.json', 'bad.meta.json']);
    const storage = makeStorage(read, listFiles);

    beginRestoreReport();
    const metas = await storage.listMetadata();

    expect(metas).toHaveLength(1);
    const issues = finishRestoreReport();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      stage: 'metadata',
      detail: expect.stringContaining('bad.meta.json'),
    });
  });

  it('reads metadata files concurrently with a bounded number in flight', async () => {
    const fileNames = Array.from({ length: 24 }, (_, index) => `s-${index}.meta.json`);
    let inFlight = 0;
    let maxInFlight = 0;
    const read = jest.fn(async (filePath: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return JSON.stringify({ id: filePath });
    });
    const listFiles = jest.fn(async () => fileNames);
    const storage = makeStorage(read, listFiles);

    beginRestoreReport();
    const metas = await storage.listMetadata();

    expect(metas).toHaveLength(24);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(8);
    expect(finishRestoreReport()).toEqual([]);
  });

  it('keeps listing results in file order and does not block on a slow read', async () => {
    let completed = 0;
    const read = jest.fn(async (filePath: string) => {
      if (filePath === 'slow.meta.json') {
        await new Promise((resolve) => setTimeout(resolve, 120));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      completed += 1;
      return JSON.stringify({ id: filePath });
    });
    const listFiles = jest.fn(async () => ['slow.meta.json', 'a.meta.json', 'b.meta.json', 'c.meta.json']);
    const storage = makeStorage(read, listFiles);

    beginRestoreReport();
    const listing = storage.listMetadata();
    await new Promise((resolve) => setTimeout(resolve, 40));
    // The slow read is still in flight; the other three must not wait for it.
    expect(completed).toBe(3);

    const metas = await listing;
    expect(metas.map((meta) => meta.id)).toEqual([
      'slow.meta.json',
      'a.meta.json',
      'b.meta.json',
      'c.meta.json',
    ]);
  });
});
