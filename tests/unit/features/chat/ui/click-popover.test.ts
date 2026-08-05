import { createMockEl } from '@test/helpers/mock-element';

import { ClickPopover } from '@/features/chat/ui/toolbar/click-popover';

describe('ClickPopover', () => {
  it('closes on an outside click and Escape, and detaches listeners on destroy', () => {
    const documentListeners = new Map<string, Set<(event: Event) => void>>();
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const fakeDocument = {
      addEventListener: (event: string, handler: (event: Event) => void) => {
        const handlers = documentListeners.get(event) ?? new Set();
        handlers.add(handler);
        documentListeners.set(event, handlers);
      },
      removeEventListener: (event: string, handler: (event: Event) => void) => {
        documentListeners.get(event)?.delete(handler);
      },
    };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: fakeDocument,
    });

    try {
      const root = createMockEl();
      const trigger = root.createDiv();
      const panel = root.createDiv();
      const popover = new ClickPopover(root, trigger, panel, 'qoderian-test--open');

      trigger.click();
      expect(root.hasClass('qoderian-test--open')).toBe(true);
      expect(documentListeners.get('click')?.size).toBe(1);
      expect(documentListeners.get('keydown')?.size).toBe(1);

      documentListeners.get('click')?.forEach(handler => handler({
        target: createMockEl(),
      } as unknown as Event));
      expect(root.hasClass('qoderian-test--open')).toBe(false);

      trigger.click();
      documentListeners.get('keydown')?.forEach(handler => handler({
        key: 'Escape',
        preventDefault: jest.fn(),
      } as unknown as Event));
      expect(root.hasClass('qoderian-test--open')).toBe(false);

      trigger.click();
      popover.destroy();
      expect(documentListeners.get('click')?.size).toBe(0);
      expect(documentListeners.get('keydown')?.size).toBe(0);
    } finally {
      if (previousDocument) {
        Object.defineProperty(globalThis, 'document', previousDocument);
      } else {
        Reflect.deleteProperty(globalThis, 'document');
      }
    }
  });

  it('keeps only one toolbar popover open', () => {
    const firstRoot = createMockEl();
    const first = new ClickPopover(
      firstRoot,
      firstRoot.createDiv(),
      firstRoot.createDiv(),
      'qoderian-first--open',
    );
    const secondRoot = createMockEl();
    const second = new ClickPopover(
      secondRoot,
      secondRoot.createDiv(),
      secondRoot.createDiv(),
      'qoderian-second--open',
    );

    firstRoot.children[0].click();
    secondRoot.children[0].click();

    expect(firstRoot.hasClass('qoderian-first--open')).toBe(false);
    expect(secondRoot.hasClass('qoderian-second--open')).toBe(true);

    first.destroy();
    second.destroy();
  });
});
