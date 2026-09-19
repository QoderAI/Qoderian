import type { ChatMessage } from '../../../core/types';
import { extractUserDisplayContent } from '../../../qoder/prompt/context/prompt-context';
import { autoResizeTextarea } from '../ui/textarea-resize';

export interface PromptHistoryControllerDeps {
  getInputEl: () => HTMLTextAreaElement;
  getMessages: () => ChatMessage[];
  getConversationId: () => string | null;
}

/**
 * ArrowUp in an empty composer walks back through the messages sent in the
 * current session; ArrowDown walks forward again and finally back to the empty
 * draft. Browsing is considered intact only while the composer still shows the
 * entry that was last recalled, so typing, sending, or switching conversations
 * drops out of history mode.
 */
export class PromptHistoryController {
  private entries: string[] = [];
  private position = 0;
  private sourceConversationId: string | null = null;

  constructor(private readonly deps: PromptHistoryControllerDeps) {}

  /** Returns true when the key was consumed as history navigation. */
  handleKeydown(event: KeyboardEvent): boolean {
    if (event.isComposing) return false;
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key === 'ArrowUp') return this.showPreviousEntry(event);
    if (event.key === 'ArrowDown') return this.showNextEntry(event);
    return false;
  }

  private showPreviousEntry(event: KeyboardEvent): boolean {
    if (!this.isBrowsingIntact()) {
      if (this.deps.getInputEl().value.length > 0) return false;
      this.entries = this.collectSentMessages();
      if (this.entries.length === 0) return false;
      this.position = this.entries.length;
      this.sourceConversationId = this.deps.getConversationId();
    }

    if (this.position === 0) return false;

    this.position -= 1;
    this.restoreEntry(this.entries[this.position]);
    event.preventDefault();
    return true;
  }

  private showNextEntry(event: KeyboardEvent): boolean {
    if (!this.isBrowsingIntact()) return false;
    if (this.position >= this.entries.length) return false;

    this.position += 1;
    event.preventDefault();

    if (this.position === this.entries.length) {
      this.clearInput();
      return true;
    }

    this.restoreEntry(this.entries[this.position]);
    return true;
  }

  private isBrowsingIntact(): boolean {
    if (this.entries.length === 0) return false;
    if (this.sourceConversationId !== this.deps.getConversationId()) return false;

    const shown = this.position < this.entries.length ? this.entries[this.position] : '';
    return this.deps.getInputEl().value === shown;
  }

  private collectSentMessages(): string[] {
    const entries: string[] = [];

    for (const message of this.deps.getMessages()) {
      if (message.role !== 'user') continue;
      if (message.isInterrupt || message.isRebuiltContext) continue;

      const text = this.getDisplayText(message).trim();
      if (text.length > 0) entries.push(text);
    }

    return entries;
  }

  private getDisplayText(message: ChatMessage): string {
    return message.displayContent
      ?? extractUserDisplayContent(message.content)
      ?? message.content;
  }

  private restoreEntry(text: string): void {
    const inputEl = this.deps.getInputEl();
    inputEl.value = text;
    autoResizeTextarea(inputEl);
    inputEl.setSelectionRange(text.length, text.length);
  }

  private clearInput(): void {
    const inputEl = this.deps.getInputEl();
    inputEl.value = '';
    autoResizeTextarea(inputEl);
  }
}
