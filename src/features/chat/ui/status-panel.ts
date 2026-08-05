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

    const ownerDocument = this.containerEl.ownerDocument ?? window.document;

    // Create panel element (no border/background - seamless)
    this.panelEl = ownerDocument.createElement('div');
    this.panelEl.className = 'qoderian-status-panel';

    // Bash output container - hidden by default
    this.bashOutputContainerEl = ownerDocument.createElement('div');
    this.bashOutputContainerEl.className = 'qoderian-status-panel-bash qoderian-hidden';

    this.bashHeaderEl = ownerDocument.createElement('div');
    this.bashHeaderEl.className = 'qoderian-tool-header qoderian-status-panel-bash-header';
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

    this.bashContentEl = ownerDocument.createElement('div');
    this.bashContentEl.className = 'qoderian-status-panel-bash-content';

    this.bashOutputContainerEl.appendChild(this.bashHeaderEl);
    this.bashOutputContainerEl.appendChild(this.bashContentEl);
    this.panelEl.appendChild(this.bashOutputContainerEl);

    this.containerEl.appendChild(this.panelEl);
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
      const oldest = this.currentBashOutputs.keys().next().value as string | undefined;
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
    const ownerDocument = this.bashHeaderEl.ownerDocument ?? window.document;

    const headerIconEl = ownerDocument.createElement('span');
    headerIconEl.className = 'qoderian-tool-icon';
    headerIconEl.setAttribute('aria-hidden', 'true');
    setIcon(headerIconEl, 'terminal');
    this.bashHeaderEl.appendChild(headerIconEl);

    const latest = Array.from(this.currentBashOutputs.values()).at(-1);

    const headerLabelEl = ownerDocument.createElement('span');
    headerLabelEl.className = 'qoderian-tool-label';
    if (this.isBashExpanded) {
      headerLabelEl.textContent = t('chat.bangBash.commandPanel');
    } else {
      headerLabelEl.textContent = latest ? this.truncateDescription(latest.command, 60) : t('chat.bangBash.commandPanel');
    }
    this.bashHeaderEl.appendChild(headerLabelEl);

    const previewEl = ownerDocument.createElement('span');
    previewEl.className = 'qoderian-tool-current';
    previewEl.classList.toggle('qoderian-hidden', !this.isBashExpanded);
    this.bashHeaderEl.appendChild(previewEl);

    const summaryStatusEl = ownerDocument.createElement('span');
    summaryStatusEl.className = 'qoderian-tool-status';
    if (!this.isBashExpanded && latest) {
      summaryStatusEl.classList.add(`status-${latest.status}`);
      summaryStatusEl.setAttribute('aria-label', t('chat.bangBash.statusLabel', { status: latest.status }));
      if (latest.status === 'completed') setIcon(summaryStatusEl, 'check');
      if (latest.status === 'error') setIcon(summaryStatusEl, 'x');
    } else {
      summaryStatusEl.classList.add('qoderian-hidden');
    }
    this.bashHeaderEl.appendChild(summaryStatusEl);

    this.bashHeaderEl.setAttribute('aria-expanded', String(this.isBashExpanded));

    const actionsEl = ownerDocument.createElement('span');
    actionsEl.className = 'qoderian-status-panel-bash-actions';
    this.appendActionButton(actionsEl, 'copy', t('chat.bangBash.copyAriaLabel'), 'copy', () => {
      void this.copyLatestBashOutput();
    });
    this.appendActionButton(actionsEl, 'clear', t('chat.bangBash.clearAriaLabel'), 'trash', () => {
      this.clearBashOutputs();
    });
    this.bashHeaderEl.appendChild(actionsEl);

    this.bashContentEl.toggleClass('qoderian-hidden', !this.isBashExpanded);

    if (!this.isBashExpanded) {
      return;
    }

    for (const info of this.currentBashOutputs.values()) {
      this.bashContentEl.appendChild(this.renderBashEntry(info, ownerDocument));
    }

    if (scroll) {
      this.bashContentEl.scrollTop = this.bashContentEl.scrollHeight;
      this.scrollToBottom();
    }
  }

  private renderBashEntry(info: PanelBashOutput, ownerDocument: Document): HTMLElement {
    const entryEl = ownerDocument.createElement('div');
    entryEl.className = 'qoderian-tool-call qoderian-status-panel-bash-entry';

    const entryHeaderEl = ownerDocument.createElement('div');
    entryHeaderEl.className = 'qoderian-tool-header';
    entryHeaderEl.setAttribute('tabindex', '0');
    entryHeaderEl.setAttribute('role', 'button');

    const entryIconEl = ownerDocument.createElement('span');
    entryIconEl.className = 'qoderian-tool-icon';
    entryIconEl.setAttribute('aria-hidden', 'true');
    setIcon(entryIconEl, 'dollar-sign');
    entryHeaderEl.appendChild(entryIconEl);

    const entryLabelEl = ownerDocument.createElement('span');
    entryLabelEl.className = 'qoderian-tool-label';
    entryLabelEl.textContent = t('chat.bangBash.commandLabel', { command: this.truncateDescription(info.command, 60) });
    entryHeaderEl.appendChild(entryLabelEl);

    const entryStatusEl = ownerDocument.createElement('span');
    entryStatusEl.className = 'qoderian-tool-status';
    entryStatusEl.classList.add(`status-${info.status}`);
    entryStatusEl.setAttribute('aria-label', t('chat.bangBash.statusLabel', { status: info.status }));
    if (info.status === 'completed') setIcon(entryStatusEl, 'check');
    if (info.status === 'error') setIcon(entryStatusEl, 'x');
    entryHeaderEl.appendChild(entryStatusEl);

    entryEl.appendChild(entryHeaderEl);

    const contentEl = ownerDocument.createElement('div');
    contentEl.className = 'qoderian-tool-content';
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

    const rowEl = ownerDocument.createElement('div');
    rowEl.className = 'qoderian-tool-result-row';

    const textEl = ownerDocument.createElement('span');
    textEl.className = 'qoderian-tool-result-text';
    if (info.status === 'running' && !info.output) {
      textEl.textContent = t('chat.bangBash.running');
    } else if (info.output) {
      textEl.textContent = info.output;
    }

    rowEl.appendChild(textEl);
    contentEl.appendChild(rowEl);

    entryEl.appendChild(contentEl);
    return entryEl;
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
    const el = (parent.ownerDocument ?? window.document).createElement('span');
    el.className = `qoderian-status-panel-bash-action qoderian-status-panel-bash-action-${name}`;
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
    parent.appendChild(el);
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
