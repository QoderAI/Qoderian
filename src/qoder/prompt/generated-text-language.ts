import { getLocale } from '../../i18n/i18n';

export function buildGeneratedTextLanguageRule(): string {
  return `**Language**: Write the generated text in the same language as the user's request. If the request's language is unclear, use the UI locale (\`${getLocale()}\`). Keep proper nouns, product names, file names, paths, code identifiers, and code snippets unchanged; do not translate or rename them.`;
}
