/** @jest-environment jsdom */

import { BrowserSelectionController } from '@/features/chat/controllers/browser-selection-controller';
import { buildBrowserSelectionToken } from '@/features/chat/controllers/selection-token';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('BrowserSelectionController', () => {
  let controller: BrowserSelectionController;
  let app: any;
  let inputEl: HTMLTextAreaElement;
  let tokenSink: { register: jest.Mock; unregister: jest.Mock };
  let containerEl: HTMLElement;
  let selectionText = 'selected web snippet';
  let getSelectionSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    selectionText = 'selected web snippet';

    inputEl = document.createElement('textarea');
    document.body.appendChild(inputEl);
    tokenSink = { register: jest.fn(), unregister: jest.fn() };
    containerEl = document.createElement('div');
    const selectionAnchor = document.createElement('span');
    containerEl.appendChild(selectionAnchor);

    getSelectionSpy = jest.spyOn(document, 'getSelection').mockImplementation(() => ({
      toString: () => selectionText,
      anchorNode: selectionAnchor,
      focusNode: selectionAnchor,
    } as unknown as Selection));

    const view = {
      getViewType: () => 'surfing-view',
      getDisplayText: () => 'Surfing',
      containerEl,
      currentUrl: 'https://example.com',
    };

    app = {
      workspace: {
        activeLeaf: { view },
        getMostRecentLeaf: jest.fn(() => ({ view })),
      },
    };

    controller = new BrowserSelectionController(app, inputEl, tokenSink);
  });

  afterEach(() => {
    controller.stop();
    inputEl.remove();
    getSelectionSpy.mockRestore();
    jest.useRealTimers();
  });

  it('captures browser selection, appends the token, and registers a chip', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    const token = buildBrowserSelectionToken('Surfing');
    expect(controller.getContext()).toEqual({
      source: 'browser:https://example.com',
      selectedText: 'selected web snippet',
      title: 'Surfing',
      url: 'https://example.com',
    });
    expect(inputEl.value).toBe(token);
    expect(tokenSink.register).toHaveBeenCalledWith({
      token,
      path: 'https://example.com',
      kind: 'browser-selection',
      label: 'Surfing',
      icon: 'globe',
    });
  });

  it('clears selection when text is deselected and input is not focused', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    selectionText = '';
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.hasSelection()).toBe(false);
    expect(inputEl.value).toBe('');
    expect(tokenSink.unregister).toHaveBeenCalledWith(buildBrowserSelectionToken('Surfing'));
  });

  it('keeps selection while input is focused', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    selectionText = '';
    inputEl.focus();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.hasSelection()).toBe(true);
    expect(inputEl.value).toBe(buildBrowserSelectionToken('Surfing'));
  });

  it('clears selection when clear is called', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    controller.clear();

    expect(controller.hasSelection()).toBe(false);
    expect(inputEl.value).toBe('');
  });

  it('drops the stored selection when the token is deleted from the input', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    inputEl.value = '';
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));

    expect(controller.hasSelection()).toBe(false);
    expect(tokenSink.unregister).toHaveBeenCalledWith(buildBrowserSelectionToken('Surfing'));
  });

  it('removes an orphan browser token when nothing is stored', () => {
    inputEl.value = `look ${buildBrowserSelectionToken('Stale')} here`;
    controller.start();

    inputEl.dispatchEvent(new Event('input', { bubbles: true }));

    expect(inputEl.value).toBe('look here');
  });

  it('handles polling errors without unhandled rejection', async () => {
    const extractSpy = jest.spyOn(controller as any, 'extractSelectedText')
      .mockRejectedValueOnce(new Error('poll failed'));

    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(extractSpy).toHaveBeenCalled();
    expect(controller.hasSelection()).toBe(false);
  });
});
