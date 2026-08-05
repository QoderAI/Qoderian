import type { CanvasSelectionContext } from '../../../core/context/types';
import { escapeXmlAttribute, escapeXmlClosingTag } from './xml-context';

export function formatCanvasContext(context: CanvasSelectionContext): string {
  if (context.nodeIds.length === 0) return '';
  const path = escapeXmlAttribute(context.canvasPath);
  const nodeIds = escapeXmlClosingTag(context.nodeIds.join(', '), 'canvas_selection');
  return `<canvas_selection path="${path}">\n${nodeIds}\n</canvas_selection>`;
}

export function appendCanvasContext(prompt: string, context: CanvasSelectionContext): string {
  const formatted = formatCanvasContext(context);
  return formatted ? `${prompt}\n\n${formatted}` : prompt;
}
