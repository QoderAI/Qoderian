import { Notice } from 'obsidian';

import type { BuiltInCommand } from '../../../core/commands/built-in-commands';
import type QoderianPlugin from '../../../main';
import type { ChatState } from '../state/chat-state';
import type { AddExternalContextResult } from '../ui/input-toolbar';
import { ResumeSessionDropdown } from '../ui/resume-session-dropdown';
import type { ConversationController } from './conversation-controller';

interface InputCommandControllerDeps {
  plugin: QoderianPlugin;
  state: ChatState;
  conversationController: ConversationController;
  getExternalContextSelector: () => {
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;
  getInputContainerEl: () => HTMLElement;
  getInputEl: () => HTMLTextAreaElement;
  openConversation?: (conversationId: string) => Promise<void>;
  onForkAll?: () => Promise<void>;
}

/** Handles local slash commands and the conversation resume picker. */
export class InputCommandController {
  private activeResumeDropdown: ResumeSessionDropdown | null = null;

  constructor(private readonly deps: InputCommandControllerDeps) {}

  async execute(command: BuiltInCommand, args: string): Promise<void> {
    switch (command.action) {
      case 'clear':
        await this.deps.conversationController.createNew();
        break;
      case 'add-dir':
        this.addExternalContext(args);
        break;
      case 'resume':
        this.showResumeDropdown();
        break;
      case 'fork':
        if (!this.deps.onForkAll) {
          new Notice('Fork not available.');
          return;
        }
        await this.deps.onForkAll();
        break;
      default: {
        const unknownAction = typeof (command as { action?: unknown }).action === 'string'
          ? (command as { action: string }).action
          : 'unknown';
        new Notice(`Unknown command: ${unknownAction}`);
      }
    }
  }

  handleResumeKeydown(event: KeyboardEvent): boolean {
    if (!this.activeResumeDropdown?.isVisible()) return false;
    return this.activeResumeDropdown.handleKeydown(event);
  }

  isResumeDropdownVisible(): boolean {
    return this.activeResumeDropdown?.isVisible() ?? false;
  }

  destroyResumeDropdown(): void {
    this.activeResumeDropdown?.destroy();
    this.activeResumeDropdown = null;
  }

  private addExternalContext(path: string): void {
    const selector = this.deps.getExternalContextSelector();
    if (!selector) {
      new Notice('External context selector not available.');
      return;
    }

    const result = selector.addExternalContext(path);
    if (result.success) {
      new Notice(`Added external context: ${result.normalizedPath}`);
    } else {
      new Notice(result.error);
    }
  }

  private showResumeDropdown(): void {
    this.destroyResumeDropdown();

    const conversations = this.deps.plugin.getConversationList();
    if (conversations.length === 0) {
      new Notice('No conversations to resume');
      return;
    }

    const openConversation = this.deps.openConversation
      ?? ((id: string) => this.deps.conversationController.switchTo(id));

    this.activeResumeDropdown = new ResumeSessionDropdown(
      this.deps.getInputContainerEl(),
      this.deps.getInputEl(),
      conversations,
      this.deps.state.currentConversationId,
      {
        onSelect: id => {
          this.destroyResumeDropdown();
          openConversation(id).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Failed to open conversation: ${message}`);
          });
        },
        onDismiss: () => this.destroyResumeDropdown(),
      },
    );
  }
}
