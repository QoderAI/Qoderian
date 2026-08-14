/**
 * Collapses context chips that do not fit the current row width behind a
 * "+N more" pill, so narrow sidebars degrade gracefully instead of
 * clipping chips. Clicking the pill expands the row (wrapped) so hidden
 * chips stay reachable; clicking again collapses it.
 */
export class ContextRowOverflowController {
  private readonly rowEl: HTMLElement;
  private readonly hostEl: HTMLElement;
  private readonly pillEl: HTMLElement;
  private readonly measureEl: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly mutationObserver: MutationObserver;
  private layoutScheduled = false;
  private expanded = false;
  private destroyed = false;

  constructor(rowEl: HTMLElement) {
    this.rowEl = rowEl;
    // Measurement surface lives outside the observed subtree so measuring
    // never re-triggers the mutation observer.
    const host = rowEl.parentElement;
    if (!host) throw new Error('ContextRowOverflowController requires an attached context row');
    this.hostEl = host;

    this.pillEl = rowEl.createDiv({ cls: 'qoderian-context-overflow-pill qoderian-hidden' });
    this.pillEl.setAttribute('role', 'button');
    this.pillEl.setAttribute('tabindex', '0');
    this.pillEl.addEventListener('click', () => this.toggleExpanded());
    this.pillEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggleExpanded();
      }
    });

    this.measureEl = this.hostEl.createDiv({ cls: 'qoderian-context-overflow-measure' });

    this.resizeObserver = new ResizeObserver(() => this.scheduleLayout());
    this.resizeObserver.observe(rowEl);

    this.mutationObserver = new MutationObserver(() => this.scheduleLayout());
    this.mutationObserver.observe(rowEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
      characterData: true,
    });

    this.scheduleLayout();
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.mutationObserver.disconnect();
    this.pillEl.remove();
    this.measureEl.remove();
  }

  private scheduleLayout(): void {
    if (this.layoutScheduled) return;
    this.layoutScheduled = true;
    window.requestAnimationFrame(() => {
      this.layoutScheduled = false;
      if (!this.destroyed) this.layout();
    });
  }

  /** Content items are row children that are currently meant to be visible. */
  private contentItems(): HTMLElement[] {
    return Array.from(this.rowEl.children).filter(
      (el): el is HTMLElement =>
        el.instanceOf(HTMLElement) && el !== this.pillEl && !el.hasClass('qoderian-hidden')
    );
  }

  private layout(): void {
    const items = this.contentItems();

    if (items.length === 0 || !this.rowEl.hasClass('has-content')) {
      this.applyState(items, items.length, false);
      return;
    }

    const rowStyles = getComputedStyle(this.rowEl);
    const available =
      this.rowEl.clientWidth -
      parseFloat(rowStyles.paddingLeft) -
      parseFloat(rowStyles.paddingRight);
    // Row not rendered (e.g. inactive tab): skip, ResizeObserver re-runs once visible.
    if (available <= 0) return;
    const gap = parseFloat(rowStyles.columnGap) || 0;

    const widths = this.measureWidths(items);
    const total = widths.reduce((sum, width) => sum + width, 0) + gap * (items.length - 1);

    if (this.expanded) {
      // Auto-collapse once everything fits on a single line again.
      this.applyState(items, items.length, total > available);
      return;
    }

    if (total <= available) {
      this.applyState(items, items.length, false);
      return;
    }

    // Keep as many leading chips as fit alongside the pill; when even one
    // chip cannot fit, collapse everything behind the pill if the pill fits.
    let visibleCount = 0;
    for (let k = items.length - 1; k >= 1; k--) {
      const pillWidth = this.measurePillWidth(items.length - k);
      const used =
        widths.slice(0, k).reduce((sum, width) => sum + width, 0) +
        gap * (k - 1) +
        gap +
        pillWidth;
      if (used <= available) {
        visibleCount = k;
        break;
      }
    }
    if (visibleCount === 0 && this.measurePillWidth(items.length) > available) {
      // Even the pill does not fit: show one chip rather than nothing.
      visibleCount = 1;
    }

    this.applyState(items, visibleCount, false);
  }

  private toggleExpanded(): void {
    this.expanded = !this.expanded;
    this.layout();
  }

  /** Natural single-line widths, measured on clones so hidden items work too. */
  private measureWidths(items: HTMLElement[]): number[] {
    this.measureEl.empty();
    const clones = items.map((item) => {
      const clone = item.cloneNode(true) as HTMLElement;
      clone.classList.remove('qoderian-context-overflow-hidden');
      this.measureEl.appendChild(clone);
      return clone;
    });
    const widths = clones.map(clone => clone.offsetWidth);
    this.measureEl.empty();
    return widths;
  }

  private measurePillWidth(hiddenCount: number): number {
    this.measureEl.empty();
    const clone = this.pillEl.cloneNode(false) as HTMLElement;
    clone.classList.remove('qoderian-hidden');
    clone.setText(this.pillLabel(hiddenCount));
    this.measureEl.appendChild(clone);
    const width = clone.offsetWidth;
    this.measureEl.empty();
    return width;
  }

  private pillLabel(hiddenCount: number): string {
    return this.expanded ? 'Show less' : `+${hiddenCount} more`;
  }

  private applyState(items: HTMLElement[], visibleCount: number, expanded: boolean): void {
    this.expanded = expanded && items.length > 0;

    items.forEach((el, index) => {
      const shouldHide = !this.expanded && index >= visibleCount;
      if (shouldHide !== el.hasClass('qoderian-context-overflow-hidden')) {
        el.toggleClass('qoderian-context-overflow-hidden', shouldHide);
      }
    });

    this.rowEl.toggleClass('qoderian-context-row--expanded', this.expanded);

    const hiddenCount = items.length - (this.expanded ? items.length : visibleCount);
    const showPill = this.expanded || hiddenCount > 0;

    if (showPill) {
      const label = this.pillLabel(hiddenCount);
      if (this.pillEl.textContent !== label) this.pillEl.setText(label);
      if (this.pillEl.hasClass('qoderian-hidden')) this.pillEl.removeClass('qoderian-hidden');
      // The pill always trails the chips.
      if (this.pillEl.nextElementSibling) this.rowEl.appendChild(this.pillEl);
    } else if (!this.pillEl.hasClass('qoderian-hidden')) {
      this.pillEl.addClass('qoderian-hidden');
    }
  }
}
