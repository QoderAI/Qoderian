/** @jest-environment jsdom */

import { ContextRowOverflowController } from '@/features/chat/controllers/context-row-overflow';

/**
 * Functional coverage for the narrow-sidebar chip collapse. jsdom has no
 * layout, so widths are mocked: every element reports offsetWidth from its
 * data-mock-width attribute (clones keep it), and the row reports a
 * test-controlled clientWidth.
 */

let rowClientWidth = 400;
let resizeCallback: (() => void) | null = null;

class FakeResizeObserver {
  constructor(callback: () => void) {
    // Captured so tests can simulate a sidebar resize.
    resizeCallback = callback;
  }

  observe(): void {}

  disconnect(): void {}

  unobserve(): void {}
}

function installDomMocks(): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;

  if (!proto.hasClass) {
    proto.hasClass = function hasClass(this: HTMLElement, cls: string) {
      return this.classList.contains(cls);
    };
  }
  if (!proto.addClass) {
    proto.addClass = function addClass(this: HTMLElement, cls: string) {
      cls.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
      return this;
    };
  }
  if (!proto.removeClass) {
    proto.removeClass = function removeClass(this: HTMLElement, cls: string) {
      cls.split(/\s+/).filter(Boolean).forEach(c => this.classList.remove(c));
      return this;
    };
  }
  if (!proto.toggleClass) {
    proto.toggleClass = function toggleClass(this: HTMLElement, cls: string, force: boolean) {
      this.classList.toggle(cls, force);
      return this;
    };
  }
  if (!proto.setText) {
    proto.setText = function setText(this: HTMLElement, text: string) {
      this.textContent = text;
    };
  }
  if (!proto.empty) {
    proto.empty = function empty(this: HTMLElement) {
      while (this.firstChild) this.removeChild(this.firstChild);
    };
  }
  if (!proto.createDiv) {
    proto.createDiv = function createDiv(this: HTMLElement, opts?: { cls?: string }) {
      const el = this.ownerDocument.createElement('div');
      if (opts?.cls) el.setAttribute('class', opts.cls);
      this.appendChild(el);
      return el;
    };
  }
  if (!proto.instanceOf) {
    proto.instanceOf = function instanceOf(this: HTMLElement, type: unknown) {
      return this instanceof (type as new () => HTMLElement);
    };
  }

  Object.defineProperty(proto, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.mockWidth !== undefined) return Number(this.dataset.mockWidth);
      // Pills without an explicit mock width derive theirs from the label,
      // so tests exercise the label-dependent measurement path.
      if (this.classList.contains('qoderian-context-overflow-pill')) {
        return 40 + (this.textContent ?? '').length * 6;
      }
      return 0;
    },
  });

  (globalThis as Record<string, unknown>).ResizeObserver = FakeResizeObserver;
}

function createChip(width: number): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'qoderian-file-indicator qoderian-visible-flex';
  chip.dataset.mockWidth = String(width);
  return chip;
}

function createRow(): HTMLElement {
  const wrapper = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'qoderian-context-row has-content';
  row.style.paddingLeft = '10px';
  row.style.paddingRight = '10px';
  row.style.columnGap = '8px';
  wrapper.appendChild(row);

  Object.defineProperty(row, 'clientWidth', {
    configurable: true,
    get: () => rowClientWidth,
  });
  return row;
}

async function settle(): Promise<void> {
  // rAF-scheduled layout plus mutation-observer reschedules.
  await new Promise(resolve => setTimeout(resolve, 40));
}

function readGap(row: HTMLElement): number {
  return parseFloat(getComputedStyle(row).columnGap) || 0;
}

describe('ContextRowOverflowController', () => {
  beforeAll(installDomMocks);

  beforeEach(() => {
    rowClientWidth = 400;
    resizeCallback = null;
    document.body.textContent = '';
  });

  it('keeps every chip visible and hides the pill when the row is wide', async () => {
    const row = createRow();
    const chips = [createChip(100), createChip(100), createChip(100)];
    chips.forEach(chip => row.appendChild(chip));

    const controller = new ContextRowOverflowController(row);
    await settle();

    chips.forEach(chip => expect(chip.hasClass('qoderian-context-overflow-hidden')).toBe(false));
    const pill = row.querySelector('.qoderian-context-overflow-pill') as HTMLElement;
    expect(pill).not.toBeNull();
    expect(pill.hasClass('qoderian-hidden')).toBe(true);

    controller.destroy();
  });

  it('collapses overflowing chips into a "+N more" pill when narrow', async () => {
    const row = createRow();
    const chips = [createChip(100), createChip(100), createChip(100)];
    chips.forEach(chip => row.appendChild(chip));

    const controller = new ContextRowOverflowController(row);
    await settle();

    rowClientWidth = 200; // available 180: one 100px chip + gap + 70px pill fits
    const pill = row.querySelector('.qoderian-context-overflow-pill') as HTMLElement;
    pill.dataset.mockWidth = '70';

    // Simulate the sidebar resize the ResizeObserver would report.
    resizeCallback?.();
    await settle();

    expect(chips[0].hasClass('qoderian-context-overflow-hidden')).toBe(false);
    expect(chips[1].hasClass('qoderian-context-overflow-hidden')).toBe(true);
    expect(chips[2].hasClass('qoderian-context-overflow-hidden')).toBe(true);
    expect(pill.hasClass('qoderian-hidden')).toBe(false);
    expect(pill.textContent).toBe('+2 more');

    controller.destroy();
  });

  it('expands on pill click and collapses again on second click', async () => {
    const row = createRow();
    const chips = [createChip(100), createChip(100), createChip(100)];
    chips.forEach(chip => row.appendChild(chip));

    const controller = new ContextRowOverflowController(row);
    await settle();

    rowClientWidth = 200;
    const pill = row.querySelector('.qoderian-context-overflow-pill') as HTMLElement;
    pill.dataset.mockWidth = '70';
    resizeCallback?.();
    await settle();

    expect(pill.textContent).toBe('+2 more');

    pill.click();
    await settle();

    chips.forEach(chip => expect(chip.hasClass('qoderian-context-overflow-hidden')).toBe(false));
    expect(row.hasClass('qoderian-context-row--expanded')).toBe(true);
    expect(pill.textContent).toBe('Show less');

    pill.click();
    await settle();

    expect(row.hasClass('qoderian-context-row--expanded')).toBe(false);
    expect(chips[1].hasClass('qoderian-context-overflow-hidden')).toBe(true);
    expect(pill.textContent).toBe('+2 more');

    controller.destroy();
  });

  it('updates the pill when chips are removed', async () => {
    const row = createRow();
    const chips = [createChip(100), createChip(100), createChip(100)];
    chips.forEach(chip => row.appendChild(chip));

    const controller = new ContextRowOverflowController(row);
    await settle();

    rowClientWidth = 200;
    const pill = row.querySelector('.qoderian-context-overflow-pill') as HTMLElement;
    pill.dataset.mockWidth = '70';
    resizeCallback?.();
    await settle();
    expect(pill.textContent).toBe('+2 more');

    chips[2].remove();
    await settle();

    expect(pill.textContent).toBe('+1 more');
    expect(chips[0].hasClass('qoderian-context-overflow-hidden')).toBe(false);
    expect(chips[1].hasClass('qoderian-context-overflow-hidden')).toBe(true);

    controller.destroy();
  });

  it('hides the pill again when the row widens', async () => {
    const row = createRow();
    const chips = [createChip(100), createChip(100), createChip(100)];
    chips.forEach(chip => row.appendChild(chip));

    const controller = new ContextRowOverflowController(row);
    await settle();

    rowClientWidth = 200;
    const pill = row.querySelector('.qoderian-context-overflow-pill') as HTMLElement;
    pill.dataset.mockWidth = '70';
    resizeCallback?.();
    await settle();
    expect(pill.hasClass('qoderian-hidden')).toBe(false);

    rowClientWidth = 400;
    resizeCallback?.();
    await settle();

    expect(pill.hasClass('qoderian-hidden')).toBe(true);
    chips.forEach(chip => expect(chip.hasClass('qoderian-context-overflow-hidden')).toBe(false));

    controller.destroy();
  });

  it('reads the row gap from computed style', () => {
    const row = createRow();
    expect(readGap(row)).toBe(8);
  });

  it('throws when the row is not attached to a host', () => {
    const detached = document.createElement('div');
    expect(() => new ContextRowOverflowController(detached)).toThrow();
  });

  it('derives pill width from its label and collapses everything when nothing fits', async () => {
    const row = createRow();
    const chips = [createChip(100), createChip(100)];
    chips.forEach(chip => row.appendChild(chip));

    const controller = new ContextRowOverflowController(row);
    await settle();

    // available 185: one chip (100) + gap (8) + "+1 more" pill (82) = 190 > 185,
    // so even a single chip cannot share the row with the pill.
    rowClientWidth = 205;
    resizeCallback?.();
    await settle();

    expect(chips[0].hasClass('qoderian-context-overflow-hidden')).toBe(true);
    expect(chips[1].hasClass('qoderian-context-overflow-hidden')).toBe(true);
    const pill = row.querySelector('.qoderian-context-overflow-pill') as HTMLElement;
    expect(pill.textContent).toBe('+2 more');

    controller.destroy();
  });

  it('toggles expansion from the keyboard', async () => {
    const row = createRow();
    const chips = [createChip(100), createChip(100), createChip(100)];
    chips.forEach(chip => row.appendChild(chip));

    const controller = new ContextRowOverflowController(row);
    await settle();

    rowClientWidth = 200;
    const pill = row.querySelector('.qoderian-context-overflow-pill') as HTMLElement;
    pill.dataset.mockWidth = '70';
    resizeCallback?.();
    await settle();
    expect(pill.textContent).toBe('+2 more');

    pill.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(row.hasClass('qoderian-context-row--expanded')).toBe(true);
    expect(pill.textContent).toBe('Show less');

    pill.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(row.hasClass('qoderian-context-row--expanded')).toBe(false);
    expect(pill.textContent).toBe('+2 more');

    controller.destroy();
  });

  it('leaves state untouched while the row is not rendered', async () => {
    const row = createRow();
    const chips = [createChip(100), createChip(100), createChip(100)];
    chips.forEach(chip => row.appendChild(chip));

    const controller = new ContextRowOverflowController(row);
    await settle();

    rowClientWidth = 200;
    const pill = row.querySelector('.qoderian-context-overflow-pill') as HTMLElement;
    pill.dataset.mockWidth = '70';
    resizeCallback?.();
    await settle();
    expect(pill.textContent).toBe('+2 more');

    // Simulate display:none (inactive tab): zero width must not re-collapse.
    rowClientWidth = 0;
    resizeCallback?.();
    await settle();

    expect(pill.textContent).toBe('+2 more');
    expect(chips[0].hasClass('qoderian-context-overflow-hidden')).toBe(false);
    expect(chips[1].hasClass('qoderian-context-overflow-hidden')).toBe(true);

    controller.destroy();
  });

  it('auto-collapses an expanded row once everything fits again', async () => {
    const row = createRow();
    const chips = [createChip(100), createChip(100), createChip(100)];
    chips.forEach(chip => row.appendChild(chip));

    const controller = new ContextRowOverflowController(row);
    await settle();

    rowClientWidth = 200;
    const pill = row.querySelector('.qoderian-context-overflow-pill') as HTMLElement;
    pill.dataset.mockWidth = '70';
    resizeCallback?.();
    await settle();

    pill.click();
    await settle();
    expect(row.hasClass('qoderian-context-row--expanded')).toBe(true);

    rowClientWidth = 400;
    resizeCallback?.();
    await settle();

    expect(row.hasClass('qoderian-context-row--expanded')).toBe(false);
    expect(pill.hasClass('qoderian-hidden')).toBe(true);

    controller.destroy();
  });
});
