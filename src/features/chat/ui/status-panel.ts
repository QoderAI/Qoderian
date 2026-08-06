import { Notice, setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';

export interface PanelBashOutput {
  id: string;
  command: string;
  status: 'running' | 'completed' | 'error';
  output: string;
  exitCode?: number;
}

const MAX_BASH_OUTPUTS = 50;

/**
 * StatusPanel - persistent bottom panel for command output.
 */
export class StatusPanel {
  private containerEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;

  // Bash output section
  private bashOutputContainerEl: HTMLElement | null = null;
  private bashHeaderEl: HTMLElement | null = null;
  private bashContentEl: HTMLElement | null = null;
  private isBashExpanded = true;
  private currentBashOutputs: Map<string, PanelBashOutput> = new Map();
  private bashEntryExpanded: Map<string, boolean> = new Map();

  // Event handler references for cleanup
  private bashClickHandler: (() => void) | null = null;
  private bashKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

  /**
   * Mount the panel into the messages container.
   * Appends to the end of the messages area.
   */
  mount(containerEl: HTMLElement): void {
    this.containerEl = containerEl;
    this.createPanel();
  }

  /**
   * Remount the panel to restore state after conversation changes.
   * Re-creates the panel structure and re-renders current state.
   */
  remount(): void {
    if (!this.containerEl) {
      return;
    }

    // Remove old event listeners before removing DOM
    if (this.bashHeaderEl) {
      if (this.bashClickHandler) {
        this.bashHeaderEl.removeEventListener('click', this.bashClickHandler);
      }
      if (this.bashKeydownHandler) {
        this.bashHeaderEl.removeEventListener('keydown', this.bashKeydownHandler);
      }
    }
    this.bashClickHandler = null;
    this.bashKeydownHandler = null;

    // Remove old panel from DOM
    if (this.panelEl) {
      this.panelEl.remove();
    }

    // Clear references and recreate
    this.panelEl = null;
    this.bashOutputContainerEl = null;
    this.bashHeaderEl = null;
    this.bashContentEl = null;
    this.createPanel();

    // Re-render current state
    this.renderBashOutputs();
  }

  /**
   * Create the panel structure.
   */
  private createPanel(): void {
    if (!this.containerEl) {
      return;
    }

    // Create panel element (no border/background - seamless)
    this.panelEl = this.containerEl.createDiv({ cls: 'qoderian-status-panel' });

    // Bash output container - hidden by default
    this.bashOutputContainerEl = this.panelEl.createDiv({ cls: 'qoderian-status-panel-bash qoderian-hidden' });

    this.bashHeaderEl = this.bashOutputContainerEl.createDiv({ cls: 'qoderian-tool-header qoderian-status-panel-bash-header' });
    this.bashHeaderEl.setAttribute('tabindex', '0');
    this.bashHeaderEl.setAttribute('role', 'button');

    this.bashClickHandler = () => this.toggleBashSection();
    this.bashKeydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleBashSection();
      }
    };
    this.bashHeaderEl.addEventListener('click', this.bashClickHandler);
    this.bashHeaderEl.addEventListener('keydown', this.bashKeydownHandler);

    this.bashContentEl = this.bashOutputContainerEl.createDiv({ cls: 'qoderian-status-panel-bash-content' });
  }

  /**
   * Scroll messages container to bottom.
   */
  private scrollToBottom(): void {
    if (this.containerEl) {
      this.containerEl.scrollTop = this.containerEl.scrollHeight;
    }
  }

  // ============================================
  // Bash Output Methods
  // ============================================

  private truncateDescription(description: string, maxLength = 50): string {
    if (description.length <= maxLength) return description;
    return description.substring(0, maxLength) + '...';
  }

  addBashOutput(info: PanelBashOutput): void {
    this.currentBashOutputs.set(info.id, info);
    while (this.currentBashOutputs.size > MAX_BASH_OUTPUTS) {
      const oldest = this.currentBashOutputs.keys().next().value;
      if (!oldest) break;
      this.currentBashOutputs.delete(oldest);
      this.bashEntryExpanded.delete(oldest);
    }
    this.renderBashOutputs();
  }

  updateBashOutput(id: string, updates: Partial<Omit<PanelBashOutput, 'id' | 'command'>>): void {
    const existing = this.currentBashOutputs.get(id);
    if (!existing) return;
    this.currentBashOutputs.set(id, { ...existing, ...updates });
    this.renderBashOutputs();
  }

  clearBashOutputs(): void {
    this.currentBashOutputs.clear();
    this.bashEntryExpanded.clear();
    this.renderBashOutputs();
  }

  private renderBashOutputs(options: { scroll?: boolean } = {}): void {
    if (!this.bashOutputContainerEl || !this.bashHeaderEl || !this.bashContentEl) return;
    const scroll = options.scroll ?? true;

    if (this.currentBashOutputs.size === 0) {
      this.bashOutputContainerEl.addClass('qoderian-hidden');
      return;
    }

    this.bashOutputContainerEl.removeClass('qoderian-hidden');
    this.bashHeaderEl.empty();
    this.bashContentEl.empty();

    const headerIconEl = this.bashHeaderEl.createSpan({ cls: 'qoderian-tool-icon' });
    headerIconEl.setAttribute('aria-hidden', 'true');
    setIcon(headerIconEl, 'terminal');

    const latest = Array.from(this.currentBashOutputs.values()).at(-1);

    const headerLabelEl = this.bashHeaderEl.createSpan({ cls: 'qoderian-tool-label' });
    if (this.isBashExpanded) {
      headerLabelEl.textContent = t('chat.bangBash.commandPanel');
    } else {
      headerLabelEl.textContent = latest ? this.truncateDescription(latest.command, 60) : t('chat.bangBash.commandPanel');
    }

    const previewEl = this.bashHeaderEl.createSpan({ cls: 'qoderian-tool-current' });
    previewEl.classList.toggle('qoderian-hidden', !this.isBashExpanded);

    const summaryStatusEl = this.bashHeaderEl.createSpan({ cls: 'qoderian-tool-status' });
    if (!this.isBashExpanded && latest) {
      summaryStatusEl.classList.add(`status-${latest.status}`);
      summaryStatusEl.setAttribute('aria-label', t('chat.bangBash.statusLabel', { status: latest.status }));
      if (latest.status === 'completed') setIcon(summaryStatusEl, 'check');
      if (latest.status === 'error') setIcon(summaryStatusEl, 'x');
    } else {
      summaryStatusEl.classList.add('qoderian-hidden');
    }

    this.bashHeaderEl.setAttribute('aria-expanded', String(this.isBashExpanded));

    const actionsEl = this.bashHeaderEl.createSpan({ cls: 'qoderian-status-panel-bash-actions' });
    this.appendActionButton(actionsEl, 'copy', t('chat.bangBash.copyAriaLabel'), 'copy', () => {
      void this.copyLatestBashOutput();
    });
    this.appendActionButton(actionsEl, 'clear', t('chat.bangBash.clearAriaLabel'), 'trash', () => {
      this.clearBashOutputs();
    });

    this.bashContentEl.toggleClass('qoderian-hidden', !this.isBashExpanded);

    if (!this.isBashExpanded) {
      return;
    }

    for (const info of this.currentBashOutputs.values()) {
      this.renderBashEntry(info, this.bashContentEl);
    }

    if (scroll) {
      this.bashContentEl.scrollTop = this.bashContentEl.scrollHeight;
      this.scrollToBottom();
    }
  }

  private renderBashEntry(info: PanelBashOutput, parent: HTMLElement): void {
    const entryEl = parent.createDiv({ cls: 'qoderian-tool-call qoderian-status-panel-bash-entry' });

    const entryHeaderEl = entryEl.createDiv({ cls: 'qoderian-tool-header' });
    entryHeaderEl.setAttribute('tabindex', '0');
    entryHeaderEl.setAttribute('role', 'button');

    const entryIconEl = entryHeaderEl.createSpan({ cls: 'qoderian-tool-icon' });
    entryIconEl.setAttribute('aria-hidden', 'true');
    setIcon(entryIconEl, 'dollar-sign');

    const entryLabelEl = entryHeaderEl.createSpan({ cls: 'qoderian-tool-label' });
    entryLabelEl.textContent = t('chat.bangBash.commandLabel', { command: this.truncateDescription(info.command, 60) });

    const entryStatusEl = entryHeaderEl.createSpan({ cls: 'qoderian-tool-status' });
    entryStatusEl.classList.add(`status-${info.status}`);
    entryStatusEl.setAttribute('aria-label', t('chat.bangBash.statusLabel', { status: info.status }));
    if (info.status === 'completed') setIcon(entryStatusEl, 'check');
    if (info.status === 'error') setIcon(entryStatusEl, 'x');

    const contentEl = entryEl.createDiv({ cls: 'qoderian-tool-content' });
    const isEntryExpanded = this.bashEntryExpanded.get(info.id) ?? true;
    contentEl.classList.toggle('qoderian-hidden', !isEntryExpanded);
    entryHeaderEl.setAttribute('aria-expanded', String(isEntryExpanded));
    entryHeaderEl.setAttribute('aria-label', isEntryExpanded ? t('chat.bangBash.collapseOutput') : t('chat.bangBash.expandOutput'));
    entryHeaderEl.addEventListener('click', () => {
      this.bashEntryExpanded.set(info.id, !isEntryExpanded);
      this.renderBashOutputs({ scroll: false });
    });
    entryHeaderEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.bashEntryExpanded.set(info.id, !isEntryExpanded);
        this.renderBashOutputs({ scroll: false });
      }
    });

    const rowEl = contentEl.createDiv({ cls: 'qoderian-tool-result-row' });

    const textEl = rowEl.createSpan({ cls: 'qoderian-tool-result-text' });
    if (info.status === 'running' && !info.output) {
      textEl.textContent = t('chat.bangBash.running');
    } else if (info.output) {
      textEl.textContent = info.output;
    }
  }

  private async copyLatestBashOutput(): Promise<void> {
    const latest = Array.from(this.currentBashOutputs.values()).at(-1);
    if (!latest) return;

    const output = latest.output?.trim() || (latest.status === 'running' ? t('chat.bangBash.running') : '');
    const text = output ? `$ ${latest.command}\n${output}` : `$ ${latest.command}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      new Notice(t('chat.bangBash.copyFailed'));
    }
  }

  private appendActionButton(
    parent: HTMLElement,
    name: string,
    ariaLabel: string,
    icon: string,
    action: () => void
  ): void {
    const el = parent.createSpan({ cls: `qoderian-status-panel-bash-action qoderian-status-panel-bash-action-${name}` });
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', ariaLabel);
    setIcon(el, icon);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      action();
    });
    el.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        action();
      }
    });
  }

  private toggleBashSection(): void {
    this.isBashExpanded = !this.isBashExpanded;
    this.renderBashOutputs({ scroll: false });
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Destroy the panel.
   */
  destroy(): void {
    // Remove event listeners before removing elements
    if (this.bashHeaderEl) {
      if (this.bashClickHandler) {
        this.bashHeaderEl.removeEventListener('click', this.bashClickHandler);
      }
      if (this.bashKeydownHandler) {
        this.bashHeaderEl.removeEventListener('keydown', this.bashKeydownHandler);
      }
    }
    this.bashClickHandler = null;
    this.bashKeydownHandler = null;

    // Clear bash output tracking
    this.currentBashOutputs.clear();

    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
    this.bashOutputContainerEl = null;
    this.bashHeaderEl = null;
    this.bashContentEl = null;
    this.containerEl = null;
  }
}
