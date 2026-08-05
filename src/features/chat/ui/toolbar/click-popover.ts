let closeActivePopover: (() => void) | null = null;

/**
 * Small click-driven popover controller shared by toolbar selectors.
 *
 * The controller owns only interaction state. Callers keep ownership of the
 * panel content so model and effort rendering remain independent.
 */
export class ClickPopover {
  private isOpen = false;

  constructor(
    private readonly rootEl: HTMLElement,
    private readonly triggerEl: HTMLElement,
    private readonly panelEl: HTMLElement,
    private readonly openClass: string,
  ) {
    triggerEl.setAttribute('role', 'button');
    triggerEl.setAttribute('tabindex', '0');
    triggerEl.setAttribute('aria-haspopup', 'listbox');
    triggerEl.setAttribute('aria-expanded', 'false');
    panelEl.setAttribute('role', 'listbox');

    triggerEl.addEventListener('click', this.handleTriggerClick);
    triggerEl.addEventListener('keydown', this.handleTriggerKeydown);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (closeActivePopover === this.closeFromRegistry) closeActivePopover = null;
    this.rootEl.removeClass(this.openClass);
    this.triggerEl.setAttribute('aria-expanded', 'false');
    this.detachDocumentListeners();
  }

  destroy(): void {
    this.close();
    this.triggerEl.removeEventListener('click', this.handleTriggerClick);
    this.triggerEl.removeEventListener('keydown', this.handleTriggerKeydown);
  }

  private readonly handleTriggerClick = (event: Event): void => {
    event.stopPropagation();
    this.toggle();
  };

  private readonly handleTriggerKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    this.toggle();
  };

  private readonly handleDocumentClick = (event: Event): void => {
    if (!this.rootEl.contains(event.target as Node)) {
      this.close();
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.close();
  };

  private toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }

    closeActivePopover?.();
    closeActivePopover = this.closeFromRegistry;
    this.isOpen = true;
    this.rootEl.addClass(this.openClass);
    this.triggerEl.setAttribute('aria-expanded', 'true');
    this.attachDocumentListeners();
  }

  private readonly closeFromRegistry = (): void => {
    this.close();
  };

  private attachDocumentListeners(): void {
    const document = this.rootEl.ownerDocument;
    document.addEventListener('click', this.handleDocumentClick);
    document.addEventListener('keydown', this.handleDocumentKeydown);
  }

  private detachDocumentListeners(): void {
    const document = this.rootEl.ownerDocument;
    document.removeEventListener('click', this.handleDocumentClick);
    document.removeEventListener('keydown', this.handleDocumentKeydown);
  }
}
