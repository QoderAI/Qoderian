/**
 * @jest-environment jsdom
 */
import { createMockEl } from '@test/helpers/mock-element';
import { Notice, TFile, TFolder } from 'obsidian';

import { VaultDropController } from '@/features/chat/ui/vault-drop';

function makeFile(path: string): any {
  const file = new (TFile as unknown as new () => Record<string, unknown>)();
  file.path = path;
  file.name = path.split('/').pop() ?? path;
  file.extension = path.split('.').pop() ?? '';
  return file;
}

function makeFolder(path: string): any {
  const folder = new (TFolder as unknown as new () => Record<string, unknown>)();
  folder.path = path;
  return folder;
}

function createDropEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'drop',
    preventDefault: jest.fn(),
    stopImmediatePropagation: jest.fn(),
    clientX: 10,
    clientY: 10,
    ...overrides,
  };
}

function createDragEvent(type: string, overrides: Record<string, unknown> = {}) {
  return {
    type,
    preventDefault: jest.fn(),
    stopImmediatePropagation: jest.fn(),
    clientX: 10,
    clientY: 10,
    ...overrides,
  };
}

function createApp(draggable: unknown): any {
  return { dragManager: { draggable } };
}

function createInputEl(value = ''): any {
  const el = createMockEl('textarea');
  el.value = value;
  el.selectionStart = value.length;
  el.selectionEnd = value.length;
  el.setSelectionRange = jest.fn((start: number, end: number) => {
    el.selectionStart = start;
    el.selectionEnd = end;
  });
  return el;
}

function findOverlay(wrapper: any): any {
  const overlays = (wrapper.children as any[]).filter(
    (child) => child.className && child.className.includes('qoderian-vault-drop-overlay'),
  );
  return overlays[0];
}

describe('VaultDropController', () => {
  let wrapper: any;
  let inputEl: any;

  beforeEach(() => {
    (Notice as unknown as jest.Mock).mockClear();
    wrapper = createMockEl();
    wrapper.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    inputEl = createInputEl();
  });

  describe('drop handling', () => {
    it('inserts a markdown file mention at the caret', () => {
      const app = createApp({ file: makeFile('notes/idea.md') });
      new VaultDropController(app, wrapper, inputEl);

      wrapper.dispatchEvent('drop', createDropEvent());

      expect(inputEl.value).toBe('@notes/idea.md ');
    });

    it('inserts a folder mention with trailing slash', () => {
      const app = createApp({ type: 'files', files: [makeFolder('projects/alpha')] });
      new VaultDropController(app, wrapper, inputEl);

      wrapper.dispatchEvent('drop', createDropEvent());

      expect(inputEl.value).toBe('@projects/alpha/ ');
    });

    it('inserts multiple references separated by spaces', () => {
      const app = createApp({
        type: 'files',
        files: [makeFile('a.md'), makeFolder('dir'), makeFile('b.md')],
      });
      new VaultDropController(app, wrapper, inputEl);

      wrapper.dispatchEvent('drop', createDropEvent());

      expect(inputEl.value).toBe('@a.md @dir/ @b.md ');
    });

    it('skips unsupported files, root folder, and duplicates', () => {
      const app = createApp({
        type: 'files',
        files: [
          makeFile('report.pdf'),
          makeFolder('/'),
          makeFile('a.md'),
          makeFile('a.md'),
        ],
      });
      new VaultDropController(app, wrapper, inputEl);

      wrapper.dispatchEvent('drop', createDropEvent());

      expect(inputEl.value).toBe('@a.md ');
    });

    it('inserts an image mention like a regular file', () => {
      const app = createApp({ type: 'files', files: [makeFile('pics/logo.png')] });
      const onInsertReference = jest.fn();
      new VaultDropController(app, wrapper, inputEl, { onInsertReference });

      const event = createDropEvent();
      wrapper.dispatchEvent('drop', event);

      expect(inputEl.value).toBe('@pics/logo.png ');
      expect(event.preventDefault).toHaveBeenCalled();
      expect(onInsertReference).toHaveBeenCalledWith({
        token: '@pics/logo.png',
        path: 'pics/logo.png',
        kind: 'file',
      });
      expect(Notice).not.toHaveBeenCalled();
    });

    it('combines note and image mentions for mixed drags', () => {
      const app = createApp({
        type: 'files',
        files: [makeFile('a.md'), makeFile('logo.png')],
      });
      new VaultDropController(app, wrapper, inputEl);

      wrapper.dispatchEvent('drop', createDropEvent());

      expect(inputEl.value).toBe('@a.md @logo.png ');
      expect(Notice).not.toHaveBeenCalled();
    });

    it('notifies about ignored unsupported items in mixed drags', () => {
      const app = createApp({
        type: 'files',
        files: [makeFile('a.md'), makeFile('logo.pdf')],
      });
      new VaultDropController(app, wrapper, inputEl);

      wrapper.dispatchEvent('drop', createDropEvent());

      expect(inputEl.value).toBe('@a.md ');
      expect(Notice).toHaveBeenCalledWith(expect.stringContaining('1'));
    });

    it('does not notify when every dragged item is a note or folder', () => {
      const app = createApp({
        type: 'files',
        files: [makeFile('a.md'), makeFolder('dir')],
      });
      new VaultDropController(app, wrapper, inputEl);

      wrapper.dispatchEvent('drop', createDropEvent());

      expect(Notice).not.toHaveBeenCalled();
    });

    it('does not insert a mention that already exists in the input', () => {
      inputEl.value = 'see @notes/idea.md for details';
      const app = createApp({ file: makeFile('notes/idea.md') });
      new VaultDropController(app, wrapper, inputEl);

      const event = createDropEvent();
      wrapper.dispatchEvent('drop', event);

      expect(inputEl.value).toBe('see @notes/idea.md for details');
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('preserves surrounding text and adds spacing when needed', () => {
      inputEl.value = 'review this:';
      inputEl.selectionStart = inputEl.value.length;
      const app = createApp({ file: makeFile('notes/idea.md') });
      new VaultDropController(app, wrapper, inputEl);

      wrapper.dispatchEvent('drop', createDropEvent());

      expect(inputEl.value).toBe('review this: @notes/idea.md ');
    });

    it('ignores drops without a vault drag payload', () => {
      const app = createApp(null);
      new VaultDropController(app, wrapper, inputEl);

      const event = createDropEvent();
      wrapper.dispatchEvent('drop', event);

      expect(inputEl.value).toBe('');
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    });

    it('dispatches an input event after inserting mentions', () => {
      const app = createApp({ file: makeFile('a.md') });
      new VaultDropController(app, wrapper, inputEl);

      const seen: string[] = [];
      inputEl.addEventListener('input', () => seen.push('input'));
      wrapper.dispatchEvent('drop', createDropEvent());

      expect(seen).toEqual(['input']);
    });

    it('reports inserted references so they can be chipified', () => {
      const app = createApp({ type: 'files', files: [makeFile('a b.md'), makeFolder('dir')] });
      const onInsertReference = jest.fn();
      new VaultDropController(app, wrapper, inputEl, { onInsertReference });

      wrapper.dispatchEvent('drop', createDropEvent());

      expect(onInsertReference).toHaveBeenCalledTimes(2);
      expect(onInsertReference).toHaveBeenNthCalledWith(1, {
        token: '@a b.md',
        path: 'a b.md',
        kind: 'file',
      });
      expect(onInsertReference).toHaveBeenNthCalledWith(2, {
        token: '@dir/',
        path: 'dir',
        kind: 'folder',
      });
    });
  });

  describe('overlay visibility', () => {
    it('shows the overlay on vault dragenter and claims the event', () => {
      const app = createApp({ file: makeFile('a.md') });
      new VaultDropController(app, wrapper, inputEl);

      const event = createDragEvent('dragenter');
      wrapper.dispatchEvent('dragenter', event);

      const overlay = findOverlay(wrapper);
      expect(overlay.className).toContain('visible');
      expect(event.stopImmediatePropagation).toHaveBeenCalled();
    });

    it('hides the overlay when the drag leaves the wrapper bounds', () => {
      const app = createApp({ file: makeFile('a.md') });
      new VaultDropController(app, wrapper, inputEl);

      wrapper.dispatchEvent('dragenter', createDragEvent('dragenter'));
      wrapper.dispatchEvent('dragleave', createDragEvent('dragleave', { clientX: 500, clientY: 500 }));

      const overlay = findOverlay(wrapper);
      expect(overlay.className).not.toContain('visible');
    });

    it('does not show the overlay for non-vault drags', () => {
      const app = createApp(null);
      new VaultDropController(app, wrapper, inputEl);

      const event = createDragEvent('dragenter');
      wrapper.dispatchEvent('dragenter', event);

      const overlay = findOverlay(wrapper);
      expect(overlay.className).not.toContain('visible');
      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    });

    it('shows the overlay for image-only vault drags', () => {
      const app = createApp({ type: 'files', files: [makeFile('logo.png')] });
      new VaultDropController(app, wrapper, inputEl);

      const event = createDragEvent('dragenter');
      wrapper.dispatchEvent('dragenter', event);

      const overlay = findOverlay(wrapper);
      expect(overlay.className).toContain('visible');
      expect(event.stopImmediatePropagation).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('removes listeners and the overlay', () => {
      const app = createApp({ file: makeFile('a.md') });
      const controller = new VaultDropController(app, wrapper, inputEl);
      const overlay = findOverlay(wrapper);
      overlay.remove = jest.fn();
      controller.destroy();

      wrapper.dispatchEvent('drop', createDropEvent());

      expect(inputEl.value).toBe('');
      expect(overlay.remove).toHaveBeenCalled();
    });
  });
});
