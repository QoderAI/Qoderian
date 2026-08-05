/** Context captured from a browser-like view. */
export interface BrowserSelectionContext {
  source: string;
  selectedText: string;
  title?: string;
  url?: string;
}

/** Nodes selected from an Obsidian Canvas. */
export interface CanvasSelectionContext {
  canvasPath: string;
  nodeIds: string[];
}
