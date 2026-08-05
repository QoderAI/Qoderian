/** Extracts Qoder MCP server mentions from user-facing text. */
export function extractMcpMentions(text: string, validNames: Set<string>): Set<string> {
  const mentions = new Set<string>();
  const regex = /@([a-zA-Z0-9._-]+)(?!\/)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    if (validNames.has(name)) {
      mentions.add(name);
    }
  }

  return mentions;
}

/** Converts an MCP mention to the CLI prompt syntax. */
export function transformMcpMentions(text: string, validNames: Set<string>): string {
  if (validNames.size === 0) return text;

  const sortedNames = Array.from(validNames).sort((a, b) => b.length - a.length);
  const escapedNames = sortedNames.map(escapeRegExp).join('|');
  const pattern = new RegExp(
    `@(${escapedNames})(?! MCP)(?!/)(?![a-zA-Z0-9_-])(?!\\.[a-zA-Z0-9_-])`,
    'g'
  );

  return text.replace(pattern, '@$1 MCP');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
