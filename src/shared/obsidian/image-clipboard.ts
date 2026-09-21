/**
 * Qoderian - Vault Image Clipboard
 *
 * Copies a vault image into the OS clipboard as a bitmap so it can be pasted
 * into other applications. Mirrors Obsidian's own "Copy image" in Live Preview:
 * desktop PNG/JPEG go through Electron's nativeImage, everything else falls
 * back to the async Clipboard API.
 */

import type { App, TFile } from 'obsidian';

interface ElectronClipboardApi {
  clipboard?: {
    writeImage?: (image: unknown) => void;
  };
  nativeImage?: {
    createFromBuffer?: (buffer: Buffer) => { isEmpty?: () => boolean };
  };
}

const NATIVE_CLIPBOARD_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);

function getElectronClipboard(): ElectronClipboardApi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron is exposed only at runtime in Obsidian's renderer.
    return require('electron') as ElectronClipboardApi;
  } catch {
    return null;
  }
}

function writeImageWithNativeImage(data: ArrayBuffer): boolean {
  const electron = getElectronClipboard();
  const clipboard = electron?.clipboard;
  const createFromBuffer = electron?.nativeImage?.createFromBuffer;
  const writeImage = clipboard?.writeImage;
  if (!clipboard || typeof createFromBuffer !== 'function' || typeof writeImage !== 'function') {
    return false;
  }

  const image = createFromBuffer(Buffer.from(data));
  if (!image || image.isEmpty?.()) {
    return false;
  }

  writeImage.call(clipboard, image);
  return true;
}

async function writeImageWithClipboardItem(data: ArrayBuffer): Promise<boolean> {
  try {
    const blob = new Blob([data], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/** Copies a vault image to the OS clipboard. Resolves false when the write failed. */
export async function copyVaultImageToClipboard(app: App, file: TFile): Promise<boolean> {
  const data = await app.vault.readBinary(file);

  if (NATIVE_CLIPBOARD_EXTENSIONS.has(file.extension.toLowerCase()) && writeImageWithNativeImage(data)) {
    return true;
  }

  return writeImageWithClipboardItem(data);
}
