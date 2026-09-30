import type { App, ItemView } from 'obsidian';

import type { CanvasSelectionContext } from '../../../core/context/types';
import {
  appendSelectionToken,
  basename,
  buildCanvasSelectionToken,
  removeSelectionToken,
  type SelectionTokenReference,
  type SelectionTokenSink,
  truncateLabel,
} from './selection-token';

const CANVAS_POLL_INTERVAL = 250;
const ORPHAN_TOKEN_PATTERN = /@canvas:\S+/;

type CanvasSelectionNode = { id?: unknown };

type CanvasViewLike = ItemView & {
  canvas?: {
    selection?: Set<CanvasSelectionNode>;
  };
  file?: {
    path?: unknown;
  };
};

export class CanvasSelectionController {
  private app: App;
  private inputEl: HTMLTextAreaElement;
  private tokenSink: SelectionTokenSink;
  private storedSelection: CanvasSelectionContext | null = null;
  private storedToken: string | null = null;
  private syncingToken = false;
  private pollInterval: number | null = null;
  private readonly handleInput = (): void => this.reconcileToken();

  constructor(app: App, inputEl: HTMLTextAreaElement, tokenSink: SelectionTokenSink) {
    this.app = app;
    this.inputEl = inputEl;
    this.tokenSink = tokenSink;
  }

  start(): void {
    if (this.pollInterval) return;
    this.inputEl.addEventListener('input', this.handleInput);
    this.pollInterval = window.setInterval(() => this.poll(), CANVAS_POLL_INTERVAL);
  }

  stop(): void {
    if (this.pollInterval) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.inputEl.removeEventListener('input', this.handleInput);
    this.clear();
  }

  private poll(): void {
    const canvasView = this.getCanvasView();
    if (!canvasView) return;

    const canvas = canvasView.canvas;
    if (!canvas?.selection) return;

    const selection = canvas.selection;
    const canvasPath = canvasView.file?.path;
    if (typeof canvasPath !== 'string' || !canvasPath) return;

    const nodeIds = [...selection]
      .map(node => node.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (nodeIds.length > 0) {
      const sameSelection = this.storedSelection
        && this.storedSelection.canvasPath === canvasPath
        && this.storedSelection.nodeIds.length === nodeIds.length
        && this.storedSelection.nodeIds.every(id => nodeIds.includes(id));

      if (!sameSelection) {
        this.storedSelection = { canvasPath, nodeIds };
        this.applyToken(buildCanvasSelectionToken(canvasPath), canvasPath);
      }
    } else if (this.getActiveElement() !== this.inputEl) {
      if (this.storedSelection) {
        this.storedSelection = null;
        this.applyToken(null);
      }
    }
  }

  private getActiveElement(): Element | null {
    return this.inputEl.ownerDocument?.activeElement ?? null;
  }

  private getCanvasView(): CanvasViewLike | null {
    const activeLeaf = this.app.workspace.getMostRecentLeaf?.();
    const activeView = activeLeaf?.view as CanvasViewLike | undefined;
    if (activeView?.getViewType?.() === 'canvas' && activeView.file) {
      return activeView;
    }

    const leaves = this.app.workspace.getLeavesOfType('canvas');
    if (leaves.length === 0) return null;
    const leaf = leaves.find(l => (l.view as CanvasViewLike).file);
    return leaf ? (leaf.view as CanvasViewLike) : null;
  }

  private buildReference(token: string, canvasPath: string): SelectionTokenReference {
    return {
      token,
      path: canvasPath,
      kind: 'canvas-selection',
      label: truncateLabel(basename(canvasPath)),
      icon: 'network',
    };
  }

  private applyToken(nextToken: string | null, canvasPath?: string): void {
    if (nextToken === this.storedToken) return;

    this.syncingToken = true;
    try {
      const previous = this.storedToken;
      this.storedToken = nextToken;
      if (previous) {
        removeSelectionToken(this.inputEl, previous);
        this.tokenSink.unregister(previous);
      }
      if (nextToken && canvasPath) {
        appendSelectionToken(this.inputEl, nextToken);
        this.tokenSink.register(this.buildReference(nextToken, canvasPath));
      }
    } finally {
      this.syncingToken = false;
    }
  }

  private reconcileToken(): void {
    if (this.syncingToken) return;

    const value = this.inputEl.value;
    if (this.storedToken) {
      if (!value.includes(this.storedToken)) {
        const stale = this.storedToken;
        this.storedToken = null;
        this.storedSelection = null;
        this.tokenSink.unregister(stale);
      }
      return;
    }

    const orphan = value.match(ORPHAN_TOKEN_PATTERN)?.[0];
    if (orphan) {
      this.syncingToken = true;
      try {
        removeSelectionToken(this.inputEl, orphan);
      } finally {
        this.syncingToken = false;
      }
    }
  }

  getContext(): CanvasSelectionContext | null {
    if (!this.storedSelection) return null;
    return {
      canvasPath: this.storedSelection.canvasPath,
      nodeIds: [...this.storedSelection.nodeIds],
    };
  }

  hasSelection(): boolean {
    return this.storedSelection !== null;
  }

  clear(): void {
    this.storedSelection = null;
    this.applyToken(null);
  }
}
