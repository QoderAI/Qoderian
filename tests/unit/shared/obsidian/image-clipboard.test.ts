import type { App, TFile } from 'obsidian';

import { copyVaultImageToClipboard } from '@/shared/obsidian/image-clipboard';

jest.mock('electron', () => ({
  clipboard: { writeImage: jest.fn() },
  nativeImage: { createFromBuffer: jest.fn() },
}), { virtual: true });

const electronMock = jest.requireMock('electron') as {
  clipboard: { writeImage: jest.Mock };
  nativeImage: { createFromBuffer: jest.Mock };
};

class ClipboardItemStub {
  constructor(readonly items: Record<string, Blob>) {}
}

const writeMock = jest.fn<Promise<void>, [unknown[]]>();

function createApp(data: ArrayBuffer): App {
  return {
    vault: { readBinary: jest.fn().mockResolvedValue(data) },
  } as unknown as App;
}

function createFile(path: string): TFile {
  return {
    path,
    extension: path.split('.').pop() ?? '',
  } as unknown as TFile;
}

describe('copyVaultImageToClipboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    electronMock.nativeImage.createFromBuffer.mockReturnValue({ isEmpty: () => false });
    writeMock.mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { write: writeMock } },
      configurable: true,
    });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = ClipboardItemStub;
  });

  it('writes PNG images through Electron nativeImage', async () => {
    const result = await copyVaultImageToClipboard(createApp(new ArrayBuffer(8)), createFile('vibe_images/chart.png'));

    expect(result).toBe(true);
    expect(electronMock.nativeImage.createFromBuffer).toHaveBeenCalledTimes(1);
    expect(electronMock.clipboard.writeImage).toHaveBeenCalledTimes(1);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('routes non-PNG formats to the async clipboard API', async () => {
    const result = await copyVaultImageToClipboard(createApp(new ArrayBuffer(8)), createFile('diagram.webp'));

    expect(result).toBe(true);
    expect(electronMock.nativeImage.createFromBuffer).not.toHaveBeenCalled();
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock.mock.calls[0][0][0]).toBeInstanceOf(ClipboardItemStub);
  });

  it('falls back to the async clipboard API when nativeImage yields an empty image', async () => {
    electronMock.nativeImage.createFromBuffer.mockReturnValue({ isEmpty: () => true });

    const result = await copyVaultImageToClipboard(createApp(new ArrayBuffer(8)), createFile('chart.png'));

    expect(result).toBe(true);
    expect(electronMock.clipboard.writeImage).not.toHaveBeenCalled();
    expect(writeMock).toHaveBeenCalledTimes(1);
  });

  it('resolves false when every clipboard path is unavailable', async () => {
    electronMock.nativeImage.createFromBuffer.mockReturnValue(null);
    writeMock.mockRejectedValue(new Error('clipboard denied'));

    const result = await copyVaultImageToClipboard(createApp(new ArrayBuffer(8)), createFile('chart.png'));

    expect(result).toBe(false);
  });
});
