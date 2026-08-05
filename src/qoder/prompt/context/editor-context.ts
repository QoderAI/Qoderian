import type { EditorSelectionContext } from '../../../core/editor/editor-context';
import { escapeXmlAttribute, escapeXmlClosingTag } from './xml-context';

export function formatEditorContext(context: EditorSelectionContext): string {
  if (context.mode === 'selection' && context.selectedText) {
    const lineAttr = context.startLine && context.lineCount
      ? ` lines="${context.startLine}-${context.startLine + context.lineCount - 1}"`
      : '';
    const path = escapeXmlAttribute(context.notePath);
    const selectedText = escapeXmlClosingTag(context.selectedText, 'editor_selection');
    return `<editor_selection path="${path}"${lineAttr}>\n${selectedText}\n</editor_selection>`;
  }

  if (context.mode === 'cursor' && context.cursorContext) {
    const cursor = context.cursorContext;
    let content: string;
    if (cursor.isInbetween) {
      const parts = [];
      if (cursor.beforeCursor) parts.push(cursor.beforeCursor);
      parts.push('| #inbetween');
      if (cursor.afterCursor) parts.push(cursor.afterCursor);
      content = parts.join('\n');
    } else {
      content = `${cursor.beforeCursor}|${cursor.afterCursor} #inline`;
    }
    const path = escapeXmlAttribute(context.notePath);
    return `<editor_cursor path="${path}">\n${escapeXmlClosingTag(content, 'editor_cursor')}\n</editor_cursor>`;
  }

  return '';
}

export function appendEditorContext(prompt: string, context: EditorSelectionContext): string {
  const formatted = formatEditorContext(context);
  return formatted ? `${prompt}\n\n${formatted}` : prompt;
}
