import { defaultKeymap,history, historyKeymap } from '@codemirror/commands';
import { Compartment, EditorSelection, EditorState, Prec, StateEffect } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { setIcon } from 'obsidian';

import {
  calculateTextareaMaxHeight,
  calculateTextareaMinHeight,
  TEXTAREA_BASE_MIN_HEIGHT,
} from '../textarea-resize';
import {
  type ComposerReference,
  type ComposerReferenceRange,
  findAtomicDeleteRange,
  findReferenceRanges,
  formatReferenceLabel,
} from './composer-reference';

const refreshReferencesEffect = StateEffect.define<void>();

/**
 * CodeMirror widgets must return detached elements from `toDOM()`. Creating
 * through the owning editor keeps pop-out windows on the correct document;
 * detaching immediately leaves the widget ready for CodeMirror to mount.
 */
function createDetachedElement<K extends keyof HTMLElementTagNameMap>(
  view: EditorView,
  tag: K,
): HTMLElementTagNameMap[K] {
  const element = view.dom.createEl(tag);
  element.detach();
  return element;
}

/** Renders one composer reference token as an inline chip. */
class ReferenceWidget extends WidgetType {
  constructor(
    private readonly range: ComposerReferenceRange,
    private readonly selected: boolean,
    private readonly onOpenReference?: (reference: ComposerReference) => void,
  ) {
    super();
  }

  eq(other: ReferenceWidget): boolean {
    return this.range.reference.token === other.range.reference.token
      && this.range.reference.kind === other.range.reference.kind
      && this.range.from === other.range.from
      && this.range.to === other.range.to
      && this.selected === other.selected;
  }

  toDOM(view: EditorView): HTMLElement {
    const { reference, from, to } = this.range;
    const element = createDetachedElement(view, 'span');
    const icon = createDetachedElement(view, 'span');
    const label = createDetachedElement(view, 'span');
    const remove = createDetachedElement(view, 'span');

    element.classList.add('qoderian-composer-reference');
    element.classList.toggle('qoderian-composer-reference--selected', this.selected);
    element.dataset.path = reference.path;
    element.dataset.kind = reference.kind;
    element.title = reference.token;
    icon.classList.add('qoderian-composer-reference-icon');
    setIcon(icon, reference.kind === 'folder' ? 'folder' : 'file-text');
    label.classList.add('qoderian-composer-reference-label');
    label.textContent = formatReferenceLabel(reference.path);
    remove.classList.add('qoderian-composer-reference-remove');
    remove.setAttribute('aria-label', `Remove ${reference.token}`);
    setIcon(remove, 'x');
    element.append(icon, label, remove);
    // Plain click opens the reference, same as message-bubble chips.
    element.addEventListener('click', (event) => {
      event.preventDefault();
      this.onOpenReference?.(reference);
    });
    // The remove button deletes the whole token, like an atomic Backspace.
    remove.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ changes: { from, to } });
      view.focus();
    });
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

interface DecorationPluginOptions {
  getReferences: () => readonly ComposerReference[];
  onOpenReference?: (reference: ComposerReference) => void;
}

function createReferenceDecorationPlugin(options: DecorationPluginOptions) {
  return ViewPlugin.fromClass(class implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      const refreshRequested = update.transactions.some(transaction => (
        transaction.effects.some(effect => effect.is(refreshReferencesEffect))
      ));
      if (update.docChanged || update.selectionSet || update.viewportChanged || refreshRequested) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    private buildDecorations(view: EditorView): DecorationSet {
      const text = view.state.doc.toString();
      const selection = view.state.selection.main;
      const ranges = findReferenceRanges(text, options.getReferences());

      return Decoration.set(ranges.map(range => Decoration.replace({
        widget: new ReferenceWidget(
          range,
          selection.from === range.from && selection.to === range.to,
          options.onOpenReference,
        ),
      }).range(range.from, range.to)), true);
    }
  }, {
    decorations: value => value.decorations,
  });
}

export interface LiveComposerOptions {
  initialValue?: string;
  placeholder?: string;
  /** Intercepted before CodeMirror handles the key; return true to consume. */
  onKeydown?: (event: KeyboardEvent) => boolean | void;
  onOpenReference?: (reference: ComposerReference) => void;
  onDocChanged?: (value: string) => void;
  onSelectionChange?: (from: number, to: number) => void;
}

/**
 * CodeMirror-backed composer surface. The document stays plain text
 * (`@path` tokens included); reference tokens are decorated as inline chips.
 */
export class LiveComposer {
  private readonly view: EditorView;
  private readonly placeholderCompartment = new Compartment();
  private references: readonly ComposerReference[] = [];

  constructor(parentEl: HTMLElement, private readonly options: LiveComposerOptions = {}) {
    const state = EditorState.create({
      doc: options.initialValue ?? '',
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.editorAttributes.of({ class: 'qoderian-live-composer' }),
        this.placeholderCompartment.of(placeholder(options.placeholder ?? '')),
        createReferenceDecorationPlugin({
          getReferences: () => this.references,
          onOpenReference: options.onOpenReference,
        }),
        Prec.highest(EditorView.domEventHandlers({
          keydown: (event) => this.handleKeydown(event),
        })),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.updateHeight();
            this.options.onDocChanged?.(update.state.doc.toString());
          }
          if (update.selectionSet) {
            const selection = update.state.selection.main;
            this.options.onSelectionChange?.(selection.from, selection.to);
          }
        }),
      ],
    });
    this.view = new EditorView({ state, parent: parentEl });
    this.updateHeight();
  }

  get dom(): HTMLElement {
    return this.view.dom;
  }

  get contentDOM(): HTMLElement {
    return this.view.contentDOM;
  }

  get value(): string {
    return this.view.state.doc.toString();
  }

  set value(value: string) {
    if (value === this.value) return;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: value },
    });
  }

  get selectionStart(): number {
    return this.view.state.selection.main.from;
  }

  get selectionEnd(): number {
    return this.view.state.selection.main.to;
  }

  setSelectionRange(start: number, end: number): void {
    this.view.dispatch({
      selection: EditorSelection.range(start, end),
    });
  }

  setReferences(references: readonly ComposerReference[]): void {
    this.references = references;
    this.view.dispatch({ effects: refreshReferencesEffect.of() });
  }

  setPlaceholder(value: string): void {
    this.view.dispatch({
      effects: this.placeholderCompartment.reconfigure(placeholder(value)),
    });
  }

  focus(): void {
    this.view.focus();
  }

  destroy(): void {
    this.view.destroy();
  }

  private handleKeydown(event: KeyboardEvent): boolean {
    if (this.options.onKeydown?.(event) === true || event.defaultPrevented) return true;

    if ((event.key === 'Backspace' || event.key === 'Delete') && this.deleteAtomicReference(event.key)) {
      event.preventDefault();
      return true;
    }

    return false;
  }

  /** Removes a reference chip (and its token) in one keystroke. */
  private deleteAtomicReference(key: 'Backspace' | 'Delete'): boolean {
    const selection = this.view.state.selection.main;
    const target = findAtomicDeleteRange(this.value, this.references, {
      key,
      selectionFrom: selection.from,
      selectionTo: selection.to,
    });
    if (!target) return false;

    this.view.dispatch({
      changes: { from: target.from, to: target.to, insert: '' },
      selection: { anchor: target.from },
      scrollIntoView: true,
    });
    return true;
  }

  /**
   * Mirrors the textarea auto-resize contract: grows with content, capped at
   * a share of the view height. Metrics come from the CodeMirror scroller.
   */
  private updateHeight(): void {
    const viewHeight = this.view.dom.closest('.qoderian-container')?.clientHeight
      ?? this.view.dom.ownerDocument.defaultView?.innerHeight
      ?? 0;
    const maxHeight = calculateTextareaMaxHeight(viewHeight);

    const scroller = this.view.dom.querySelector<HTMLElement>('.cm-scroller');
    const contentHeight = scroller
      ? Math.min(scroller.scrollHeight, maxHeight)
      : TEXTAREA_BASE_MIN_HEIGHT;
    const minHeight = calculateTextareaMinHeight({
      contentHeight,
      flexAllocatedHeight: this.view.dom.offsetHeight,
    });

    this.view.dom.setCssProps({
      '--qoderian-textarea-min-height': `${minHeight}px`,
      '--qoderian-textarea-max-height': `${maxHeight}px`,
    });
  }
}
