import { createMockEl } from '@test/helpers/mock-element';
import { MarkdownRenderer, Menu, Notice, TFile } from 'obsidian';

import { MessageRenderer } from '@/features/chat/rendering/message-renderer';

jest.mock('electron', () => ({
  clipboard: { writeImage: jest.fn() },
  nativeImage: { createFromBuffer: jest.fn(() => ({ isEmpty: () => false })) },
}), { virtual: true });

const electronMock = jest.requireMock('electron') as {
  clipboard: { writeImage: jest.Mock };
};

interface MockMenuItem {
  title: string;
  clickHandler: (() => void) | null;
}

// The obsidian mock tracks every Menu instance; the published types don't.
const menuInstances = (Menu as unknown as {
  instances: Array<{ items: MockMenuItem[] }>;
}).instances;

const IMAGE_PATH = 'vibe_images/chart.png';
const EMBED_MARKDOWN = `Here is the render:\n\n![[${IMAGE_PATH}]]`;

const renderMock = MarkdownRenderer.render as unknown as jest.Mock;

function createVaultFile(): TFile {
  return Object.assign(new TFile(), {
    path: IMAGE_PATH,
    name: 'chart.png',
    basename: 'chart',
    extension: 'png',
  });
}

function renderEmbeddedImageSpan(el: any): void {
  const imageEl = el.createSpan({ cls: 'qoderian-embedded-image' });
  imageEl.setAttribute('data-qoderian-image-path', IMAGE_PATH);
}

function createRenderer(file: TFile | null) {
  const messagesEl = createMockEl();
  const container = createMockEl();
  const readBinary = jest.fn().mockResolvedValue(new ArrayBuffer(8));
  const app = {
    vault: {
      getAbstractFileByPath: jest.fn().mockReturnValue(file),
      getResourcePath: jest.fn().mockReturnValue(`app://local/${IMAGE_PATH}`),
      readBinary,
    },
    metadataCache: { getFirstLinkpathDest: jest.fn().mockReturnValue(null) },
  };
  const plugin = { app, settings: { expandFileEditsByDefault: false, mediaFolder: '' } };
  const component = { registerDomEvent: jest.fn() };

  return {
    app,
    container,
    readBinary,
    renderer: new MessageRenderer(plugin as any, component as any, messagesEl),
  };
}

async function flushAsyncAction(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function clickCopyMenuItem(container: ReturnType<typeof createMockEl>): Promise<void> {
  const imageEl = container.querySelector('.qoderian-embedded-image');
  expect(imageEl).not.toBeNull();
  imageEl.dispatchEvent({ type: 'contextmenu', preventDefault: jest.fn() });

  const menu = menuInstances[menuInstances.length - 1];
  await menu.items[0]?.clickHandler?.();
  await flushAsyncAction();
}

describe('MessageRenderer embedded image copy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    menuInstances.length = 0;
    renderMock.mockReset();
    renderMock.mockImplementation(async (_app: unknown, _markdown: string, el: any) => {
      renderEmbeddedImageSpan(el);
    });
  });

  it('opens a copy menu on right-click and writes the image to the clipboard', async () => {
    const file = createVaultFile();
    const { container, readBinary, renderer } = createRenderer(file);

    await renderer.renderContent(container, EMBED_MARKDOWN);
    expect(container.querySelector('.qoderian-embedded-image')).not.toBeNull();

    const preventDefault = jest.fn();
    container.querySelector('.qoderian-embedded-image').dispatchEvent({ type: 'contextmenu', preventDefault });
    expect(preventDefault).toHaveBeenCalled();

    const menu = menuInstances[menuInstances.length - 1];
    expect(menu.items[0]?.title).toBe('Copy image');

    await menu.items[0]?.clickHandler?.();
    await flushAsyncAction();

    expect(readBinary).toHaveBeenCalledWith(file);
    expect(electronMock.clipboard.writeImage).toHaveBeenCalledTimes(1);
    expect(Notice).toHaveBeenCalledWith('Image copied to clipboard');
  });

  it('reports a failure when the image file disappeared before the copy', async () => {
    const file = createVaultFile();
    const { app, container, renderer } = createRenderer(file);

    await renderer.renderContent(container, EMBED_MARKDOWN);
    app.vault.getAbstractFileByPath.mockReturnValue(null);

    await clickCopyMenuItem(container);

    expect(electronMock.clipboard.writeImage).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith('Failed to copy image');
  });
});
