export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Prevents untrusted context text from closing its surrounding envelope. */
export function escapeXmlClosingTag(text: string, tagName: string): string {
  return text.replace(
    new RegExp(`</${tagName}>`, 'gi'),
    `&lt;/${tagName}&gt;`,
  );
}
