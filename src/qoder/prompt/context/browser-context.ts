import type { BrowserSelectionContext } from '../../../core/context/types';
import { escapeXmlAttribute, escapeXmlClosingTag } from './xml-context';

function buildAttributeList(context: BrowserSelectionContext): string {
  const attrs: string[] = [];
  const source = context.source.trim() || 'unknown';
  attrs.push(`source="${escapeXmlAttribute(source)}"`);

  if (context.title?.trim()) {
    attrs.push(`title="${escapeXmlAttribute(context.title.trim())}"`);
  }

  if (context.url?.trim()) {
    attrs.push(`url="${escapeXmlAttribute(context.url.trim())}"`);
  }

  return attrs.join(' ');
}

export function formatBrowserContext(context: BrowserSelectionContext): string {
  const selectedText = context.selectedText.trim();
  if (!selectedText) return '';
  const attrs = buildAttributeList(context);
  return `<browser_selection ${attrs}>\n${escapeXmlClosingTag(selectedText, 'browser_selection')}\n</browser_selection>`;
}

export function appendBrowserContext(prompt: string, context: BrowserSelectionContext): string {
  const formatted = formatBrowserContext(context);
  return formatted ? `${prompt}\n\n${formatted}` : prompt;
}
