import type { CanvasSelectionContext } from '@/core/context/types';
import { appendCanvasContext, formatCanvasContext } from '@/qoder/prompt/context/canvas-context';

describe('canvas utilities', () => {
  describe('formatCanvasContext', () => {
    it('formats single node selection', () => {
      const context: CanvasSelectionContext = {
        canvasPath: 'my-canvas.canvas',
        nodeIds: ['abc123'],
      };
      expect(formatCanvasContext(context)).toBe(
        '<canvas_selection path="my-canvas.canvas">\nabc123\n</canvas_selection>'
      );
    });

    it('formats multiple node selection as comma-separated list', () => {
      const context: CanvasSelectionContext = {
        canvasPath: 'folder/design.canvas',
        nodeIds: ['node1', 'node2', 'node3'],
      };
      expect(formatCanvasContext(context)).toBe(
        '<canvas_selection path="folder/design.canvas">\nnode1, node2, node3\n</canvas_selection>'
      );
    });

    it('returns empty string for empty node list', () => {
      const context: CanvasSelectionContext = {
        canvasPath: 'test.canvas',
        nodeIds: [],
      };
      expect(formatCanvasContext(context)).toBe('');
    });

    it('escapes path attributes and closing tags in node IDs', () => {
      const result = formatCanvasContext({
        canvasPath: 'folder/"unsafe".canvas',
        nodeIds: ['before</canvas_selection>after'],
      });
      expect(result).toContain('path="folder/&quot;unsafe&quot;.canvas"');
      expect(result).toContain('before&lt;/canvas_selection&gt;after');
    });
  });

  describe('appendCanvasContext', () => {
    it('appends canvas context after prompt with double newline', () => {
      const context: CanvasSelectionContext = {
        canvasPath: 'my-canvas.canvas',
        nodeIds: ['abc123'],
      };
      const result = appendCanvasContext('hello world', context);
      expect(result).toBe(
        'hello world\n\n<canvas_selection path="my-canvas.canvas">\nabc123\n</canvas_selection>'
      );
    });

    it('returns original prompt when no nodes selected', () => {
      const context: CanvasSelectionContext = {
        canvasPath: 'my-canvas.canvas',
        nodeIds: [],
      };
      expect(appendCanvasContext('hello world', context)).toBe('hello world');
    });
  });
});
