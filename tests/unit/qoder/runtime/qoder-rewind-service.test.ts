import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { executeQoderRewind } from '@/qoder/runtime/qoder-rewind-service';

describe('executeQoderRewind path safety', () => {
  const temporaryRoots: string[] = [];

  async function makeTemporaryRoot(prefix: string): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    temporaryRoots.push(root);
    return root;
  }

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root =>
      fs.rm(root, { recursive: true, force: true })
    ));
  });

  function createDeps(
    vaultPath: string,
    rewindFiles: jest.Mock,
    externalContextPaths: string[] = [],
  ) {
    return {
      assistantMessageId: 'assistant-id',
      mode: 'code-and-conversation' as const,
      rewindFiles,
      closePersistentQuery: jest.fn(),
      setPendingResumeAt: jest.fn(),
      resetSession: jest.fn(),
      vaultPath,
      externalContextPaths,
    };
  }

  it('rejects SDK paths outside the vault and approved external contexts', async () => {
    const vaultPath = await makeTemporaryRoot('qoderian-vault-');
    const outsidePath = path.join(await makeTemporaryRoot('qoderian-outside-'), 'note.md');
    const rewindFiles = jest.fn().mockResolvedValue({
      canRewind: true,
      filesChanged: [outsidePath],
    });
    const deps = createDeps(vaultPath, rewindFiles);

    await expect(executeQoderRewind('user-id', deps))
      .rejects.toThrow('outside the vault and approved external contexts');
    expect(rewindFiles).toHaveBeenCalledTimes(1);
    expect(deps.closePersistentQuery).not.toHaveBeenCalled();
  });

  it('restores a vault file when the SDK rewind fails', async () => {
    const vaultPath = await makeTemporaryRoot('qoderian-vault-');
    const notePath = path.join(vaultPath, 'note.md');
    await fs.writeFile(notePath, 'before');
    const rewindFiles = jest.fn()
      .mockResolvedValueOnce({ canRewind: true, filesChanged: ['note.md'] })
      .mockImplementationOnce(async () => {
        await fs.writeFile(notePath, 'changed');
        throw new Error('SDK rewind failed');
      });
    const deps = createDeps(vaultPath, rewindFiles);

    await expect(executeQoderRewind('user-id', deps))
      .rejects.toThrow('files were restored');
    await expect(fs.readFile(notePath, 'utf8')).resolves.toBe('before');
    expect(deps.closePersistentQuery).toHaveBeenCalledWith('rewind failed');
  });

  it('allows files inside an explicitly approved external context', async () => {
    const vaultPath = await makeTemporaryRoot('qoderian-vault-');
    const externalRoot = await makeTemporaryRoot('qoderian-external-');
    const notePath = path.join(externalRoot, 'note.md');
    await fs.writeFile(notePath, 'before');
    const rewindFiles = jest.fn()
      .mockResolvedValueOnce({ canRewind: true, filesChanged: [notePath] })
      .mockImplementationOnce(async () => {
        await fs.writeFile(notePath, 'after');
        return { canRewind: true };
      });
    const deps = createDeps(vaultPath, rewindFiles, [externalRoot]);

    await expect(executeQoderRewind('user-id', deps)).resolves.toMatchObject({
      canRewind: true,
      filesChanged: [notePath],
    });
    await expect(fs.readFile(notePath, 'utf8')).resolves.toBe('after');
  });
});
