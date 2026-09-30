import { createMockEl } from '@test/helpers/mock-element';

import { CanvasSelectionController } from '@/features/chat/controllers/canvas-selection-controller';
import { buildCanvasSelectionToken } from '@/features/chat/controllers/selection-token';

function createMockCanvasNode(id: string) {
  return { id };
}

describe('CanvasSelectionController', () => {
  let controller: CanvasSelectionController;
  let app: any;
  let inputEl: any;
  let tokenSink: { register: jest.Mock; unregister: jest.Mock };
  let canvasView: any;
  let originalDocument: any;

  beforeEach(() => {
    jest.useFakeTimers();

    inputEl = createMockEl();
    inputEl.value = '';
    tokenSink = { register: jest.fn(), unregister: jest.fn() };

    const node1 = createMockCanvasNode('abc123');
    const node2 = createMockCanvasNode('def456');

    canvasView = {
      getViewType: () => 'canvas',
      canvas: {
        selection: new Set([node1, node2]),
      },
      file: { path: 'my-canvas.canvas' },
    };

    app = {
      workspace: {
        getActiveViewOfType: jest.fn().mockReturnValue(null),
        getMostRecentLeaf: jest.fn().mockReturnValue({ view: canvasView }),
        getLeavesOfType: jest.fn().mockReturnValue([{ view: canvasView }]),
      },
    };

    controller = new CanvasSelectionController(app, inputEl, tokenSink);

    originalDocument = (global as any).document;
    (global as any).document = { activeElement: null };
  });

  afterEach(() => {
    controller.stop();
    jest.useRealTimers();
    (global as any).document = originalDocument;
  });

  it('captures canvas selection, appends the token, and registers a chip', () => {
    controller.start();
    jest.advanceTimersByTime(250);

    const token = buildCanvasSelectionToken('my-canvas.canvas');
    expect(controller.hasSelection()).toBe(true);
    expect(controller.getContext()).toEqual({
      canvasPath: 'my-canvas.canvas',
      nodeIds: expect.arrayContaining(['abc123', 'def456']),
    });
    expect(inputEl.value).toBe(token);
    expect(tokenSink.register).toHaveBeenCalledWith({
      token,
      path: 'my-canvas.canvas',
      kind: 'canvas-selection',
      label: 'my-canvas.canvas',
      icon: 'network',
    });
  });

  it('clears the token when the selection is dropped', () => {
    controller.start();
    jest.advanceTimersByTime(250);
    expect(controller.hasSelection()).toBe(true);

    canvasView.canvas.selection = new Set();
    (global as any).document.activeElement = null;
    jest.advanceTimersByTime(250);

    expect(controller.hasSelection()).toBe(false);
    expect(inputEl.value).toBe('');
    expect(tokenSink.unregister).toHaveBeenCalledWith(buildCanvasSelectionToken('my-canvas.canvas'));
  });

  it('preserves selection when input is focused (sticky)', () => {
    controller.start();
    jest.advanceTimersByTime(250);
    expect(controller.hasSelection()).toBe(true);

    canvasView.canvas.selection = new Set();
    (global as any).document.activeElement = inputEl;
    jest.advanceTimersByTime(250);

    expect(controller.hasSelection()).toBe(true);
    expect(inputEl.value).toBe(buildCanvasSelectionToken('my-canvas.canvas'));
  });

  it('returns null context when no selection', () => {
    canvasView.canvas.selection = new Set();
    controller.start();
    jest.advanceTimersByTime(250);

    expect(controller.getContext()).toBeNull();
  });

  it('does not re-register when the selection is unchanged', () => {
    controller.start();
    jest.advanceTimersByTime(250);
    tokenSink.register.mockClear();

    jest.advanceTimersByTime(250);

    expect(tokenSink.register).not.toHaveBeenCalled();
  });

  it('prefers active canvas leaf when multiple canvases are open', () => {
    const activeCanvasView = {
      getViewType: () => 'canvas',
      canvas: { selection: new Set([createMockCanvasNode('active-node')]) },
      file: { path: 'active.canvas' },
    };
    const inactiveCanvasView = {
      getViewType: () => 'canvas',
      canvas: { selection: new Set([createMockCanvasNode('inactive-node')]) },
      file: { path: 'inactive.canvas' },
    };

    app.workspace.getLeavesOfType.mockReturnValue([
      { view: inactiveCanvasView },
      { view: activeCanvasView },
    ]);
    app.workspace.getMostRecentLeaf.mockReturnValue({ view: activeCanvasView });

    controller.start();
    jest.advanceTimersByTime(250);

    expect(controller.getContext()).toEqual({
      canvasPath: 'active.canvas',
      nodeIds: ['active-node'],
    });
  });

  it('handles no canvas view gracefully', () => {
    app.workspace.getMostRecentLeaf.mockReturnValue(null);
    app.workspace.getLeavesOfType.mockReturnValue([]);

    controller.start();
    jest.advanceTimersByTime(250);

    expect(controller.hasSelection()).toBe(false);
    expect(controller.getContext()).toBeNull();
  });

  it('clear() removes the token and unregisters', () => {
    controller.start();
    jest.advanceTimersByTime(250);
    expect(controller.hasSelection()).toBe(true);

    controller.clear();

    expect(controller.hasSelection()).toBe(false);
    expect(inputEl.value).toBe('');
    expect(tokenSink.unregister).toHaveBeenCalled();
  });

  it('drops the stored selection when the token is deleted from the input', () => {
    controller.start();
    jest.advanceTimersByTime(250);
    expect(controller.hasSelection()).toBe(true);

    inputEl.value = '';
    inputEl.dispatchEvent('input');

    expect(controller.hasSelection()).toBe(false);
    expect(tokenSink.unregister).toHaveBeenCalledWith(buildCanvasSelectionToken('my-canvas.canvas'));
  });

  it('removes an orphan canvas token when nothing is stored', () => {
    inputEl.value = `hello ${buildCanvasSelectionToken('stale.canvas')}`;
    controller.start();

    inputEl.dispatchEvent('input');

    expect(inputEl.value).toBe('hello');
  });
});
