import type { ComposerReference } from './composer-reference';
import { LiveComposer } from './live-composer';

export interface ComposerBridgeOptions {
  onOpenReference?: (reference: ComposerReference) => void;
}

type NativePropertyDescriptors = {
  value: PropertyDescriptor;
  selectionStart: PropertyDescriptor;
  selectionEnd: PropertyDescriptor;
  placeholder: PropertyDescriptor;
};

function getNativePropertyDescriptors(): NativePropertyDescriptors {
  const descriptors = {
    value: Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value'),
    selectionStart: Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'selectionStart'),
    selectionEnd: Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'selectionEnd'),
    placeholder: Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'placeholder'),
  };
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor) {
      throw new Error(`HTMLTextAreaElement.prototype.${key} descriptor is unavailable`);
    }
  }
  return descriptors as NativePropertyDescriptors;
}

/**
 * Keeps a hidden textarea and a {@link LiveComposer} in lockstep.
 *
 * The textarea remains the wiring target for every existing input consumer
 * (mention dropdown, keyboard shortcuts, draft persistence, programmatic
 * writes). The bridge intercepts property writes and events so those
 * consumers keep working unchanged while the user edits in CodeMirror:
 *
 * - Programmatic writes to `value`/`selectionStart`/`selectionEnd`/
 *   `placeholder` and `focus()` calls are mirrored into the composer.
 * - Composer edits are written back to the textarea and announced with a
 *   synthetic `input` event.
 * - Composer `keydown`/`paste` are forwarded to the textarea so listeners
 *   (send shortcuts, image paste) still observe them.
 */
export class ComposerBridge {
  private readonly sourceEl: HTMLTextAreaElement;
  private readonly hostEl: HTMLElement;
  readonly composer: LiveComposer;

  private syncing = false;
  private destroyed = false;
  private readonly descriptors: NativePropertyDescriptors;
  private readonly originalFocus: HTMLTextAreaElement['focus'];
  private readonly originalSetSelectionRange: HTMLTextAreaElement['setSelectionRange'];

  private readonly handleComposerPaste = (event: ClipboardEvent): void => {
    const EventConstructor = this.sourceEl.ownerDocument.defaultView?.Event ?? Event;
    const forwardedEvent = new EventConstructor('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(forwardedEvent, 'clipboardData', { value: event.clipboardData });
    this.sourceEl.dispatchEvent(forwardedEvent);
    if (forwardedEvent.defaultPrevented) event.preventDefault();
  };

  private readonly handleComposerKeydown = (event: KeyboardEvent): boolean => {
    this.syncSelectionToSource(this.composer.selectionStart, this.composer.selectionEnd);
    const KeyboardEventConstructor = this.sourceEl.ownerDocument.defaultView?.KeyboardEvent ?? KeyboardEvent;
    const forwardedEvent = new KeyboardEventConstructor('keydown', {
      key: event.key,
      code: event.code,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      repeat: event.repeat,
      isComposing: event.isComposing,
      bubbles: true,
      cancelable: true,
    });
    this.sourceEl.dispatchEvent(forwardedEvent);
    if (forwardedEvent.defaultPrevented) {
      event.preventDefault();
      this.syncFromSource();
      return true;
    }
    return false;
  };

  constructor(sourceEl: HTMLTextAreaElement, options: ComposerBridgeOptions = {}) {
    this.sourceEl = sourceEl;
    this.descriptors = getNativePropertyDescriptors();
    this.originalFocus = sourceEl.focus.bind(sourceEl);
    this.originalSetSelectionRange = sourceEl.setSelectionRange.bind(sourceEl);

    const parentEl = sourceEl.parentElement;
    this.hostEl = sourceEl.createDiv({ cls: 'qoderian-live-composer-host' });
    parentEl?.insertBefore(this.hostEl, sourceEl);
    sourceEl.addClass('qoderian-composer-source');

    this.composer = new LiveComposer(this.hostEl, {
      initialValue: sourceEl.value,
      placeholder: sourceEl.placeholder,
      onKeydown: this.handleComposerKeydown,
      onOpenReference: options.onOpenReference,
      onDocChanged: (value) => this.syncToSource(value),
      onSelectionChange: (from, to) => this.syncSelectionToSource(from, to),
    });

    sourceEl.addEventListener('input', this.handleSourceInput);
    this.composer.dom.addEventListener('paste', this.handleComposerPaste);

    this.installSourceInterceptors();
  }

  setReferences(references: readonly ComposerReference[]): void {
    this.composer.setReferences(references);
  }

  /** Pulls value, selection, and placeholder from the textarea into the composer. */
  syncFromSource(): void {
    if (this.destroyed) return;
    this.composer.value = this.sourceEl.value;
    this.composer.setSelectionRange(this.sourceEl.selectionStart, this.sourceEl.selectionEnd);
    this.composer.setPlaceholder(this.sourceEl.placeholder);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.sourceEl.removeEventListener('input', this.handleSourceInput);
    this.composer.dom.removeEventListener('paste', this.handleComposerPaste);

    this.uninstallSourceInterceptors();
    this.sourceEl.removeClass('qoderian-composer-source');
    this.composer.destroy();
    this.hostEl.remove();
  }

  private readonly handleSourceInput = (): void => {
    if (this.syncing || this.destroyed) return;
    this.syncFromSource();
  };

  private installSourceInterceptors(): void {
    const sourceEl = this.sourceEl;
    // Bind the native accessors to the element up front: they must always run
    // with the textarea as `this`, and the bound references carry precise
    // types instead of the descriptors' `any` signatures.
    const nativeValueGet = this.descriptors.value.get!.bind(sourceEl) as () => string;
    const nativeValueSet = this.descriptors.value.set!.bind(sourceEl) as (value: string) => void;
    const nativeSelectionStartGet = this.descriptors.selectionStart.get!.bind(sourceEl) as () => number;
    const nativeSelectionStartSet = this.descriptors.selectionStart.set!.bind(sourceEl) as (position: number | null) => void;
    const nativeSelectionEndGet = this.descriptors.selectionEnd.get!.bind(sourceEl) as () => number;
    const nativeSelectionEndSet = this.descriptors.selectionEnd.set!.bind(sourceEl) as (position: number | null) => void;
    const nativePlaceholderGet = this.descriptors.placeholder.get!.bind(sourceEl) as () => string;
    const nativePlaceholderSet = this.descriptors.placeholder.set!.bind(sourceEl) as (value: string) => void;

    Object.defineProperty(sourceEl, 'value', {
      configurable: true,
      get: () => nativeValueGet(),
      set: (value: string) => {
        nativeValueSet(value);
        this.syncComposerFromSource();
      },
    });
    Object.defineProperty(sourceEl, 'selectionStart', {
      configurable: true,
      get: () => nativeSelectionStartGet(),
      set: (position: number | null) => {
        nativeSelectionStartSet(position);
        this.syncComposerSelectionFromSource();
      },
    });
    Object.defineProperty(sourceEl, 'selectionEnd', {
      configurable: true,
      get: () => nativeSelectionEndGet(),
      set: (position: number | null) => {
        nativeSelectionEndSet(position);
        this.syncComposerSelectionFromSource();
      },
    });
    Object.defineProperty(sourceEl, 'placeholder', {
      configurable: true,
      get: () => nativePlaceholderGet(),
      set: (value: string) => {
        nativePlaceholderSet(value);
        if (!this.destroyed) this.composer.setPlaceholder(value);
      },
    });

    sourceEl.focus = (): void => {
      this.syncFromSource();
      this.composer.focus();
    };
    sourceEl.setSelectionRange = (start: number, end: number): void => {
      this.originalSetSelectionRange(start, end);
      this.syncComposerSelectionFromSource();
    };
  }

  private uninstallSourceInterceptors(): void {
    const sourceEl = this.sourceEl;
    for (const key of ['value', 'selectionStart', 'selectionEnd', 'placeholder'] as const) {
      const descriptor = this.descriptors[key];
      Object.defineProperty(sourceEl, key, descriptor);
    }
    sourceEl.focus = this.originalFocus;
    sourceEl.setSelectionRange = this.originalSetSelectionRange;
  }

  /** Mirrors a programmatic textarea value write into the composer. */
  private syncComposerFromSource(): void {
    if (this.destroyed) return;
    this.composer.value = this.sourceEl.value;
  }

  private syncComposerSelectionFromSource(): void {
    if (this.destroyed) return;
    this.composer.setSelectionRange(this.sourceEl.selectionStart, this.sourceEl.selectionEnd);
  }

  /** Writes a composer edit back into the textarea and announces it. */
  private syncToSource(value: string): void {
    if (this.destroyed) return;
    this.syncing = true;
    try {
      this.descriptors.value.set!.call(this.sourceEl, value);
      this.syncSelectionToSource(this.composer.selectionStart, this.composer.selectionEnd);
      const EventConstructor = this.sourceEl.ownerDocument.defaultView?.Event ?? Event;
      this.sourceEl.dispatchEvent(new EventConstructor('input', { bubbles: true }));
    } finally {
      this.syncing = false;
    }
  }

  /** Pushes the composer selection to the textarea using the native method. */
  private syncSelectionToSource(from: number, to: number): void {
    if (this.destroyed) return;
    this.originalSetSelectionRange(from, to);
  }
}
