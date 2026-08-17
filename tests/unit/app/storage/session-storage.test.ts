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
});
