import { buildGeneratedTextLanguageRule } from './generated-text-language';

const MAX_TITLE_INPUT_LENGTH = 500;
const MAX_TITLE_LENGTH = 50;

export function getTitleGenerationSystemPrompt(): string {
  return `You are a specialist in summarizing user intent.

**Task**: Generate a **concise, descriptive title** (max 50 chars) summarizing the user's task/request.

**Rules**:
1.  **Format**: Sentence case. No periods/quotes.
2.  **Structure**: Start with a **strong verb** appropriate to the output language.
3.  **Forbidden**: "Conversation with...", "Help me...", "Question about...", "I need...".
4.  **Tech Context**: When code is present, include the primary language or framework, preserving product names and code identifiers exactly.

${buildGeneratedTextLanguageRule()}

**Output**: Return ONLY the raw title text.`;
}

export function buildTitleGenerationPrompt(userMessage: string): string {
  const truncated = userMessage.length > MAX_TITLE_INPUT_LENGTH
    ? `${userMessage.slice(0, MAX_TITLE_INPUT_LENGTH)}...`
    : userMessage;
  return `User's request:\n"""\n${truncated}\n"""\n\nGenerate a title for this conversation:`;
}

export function parseTitleGenerationResponse(responseText: string): string | null {
  const trimmed = responseText.trim();
  if (!trimmed) {
    return null;
  }

  let title = trimmed;
  if (
    (title.startsWith('"') && title.endsWith('"'))
    || (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1);
  }

  title = title.replace(/[.!?:;,]+$/, '');

  if (title.length > MAX_TITLE_LENGTH) {
    title = `${title.slice(0, MAX_TITLE_LENGTH - 3)}...`;
  }

  return title || null;
}
