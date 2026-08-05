type TestWindow = typeof globalThis & {
  cancelAnimationFrame?: (handle: number) => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
};

const testWindow = globalThis as TestWindow;

if (!testWindow.requestAnimationFrame) {
  testWindow.requestAnimationFrame = (callback: FrameRequestCallback): number => (
    Number(setTimeout(() => callback(Date.now()), 0))
  );
}

if (!testWindow.cancelAnimationFrame) {
  testWindow.cancelAnimationFrame = (handle: number): void => {
    clearTimeout(handle);
  };
}

if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: testWindow,
    writable: true,
  });
}

// Minimal ports of Obsidian's enhance.js DOM helpers (createEl, createDiv,
// createSpan, createSvg, createFragment). Production code relies on these
// globals; jsdom suites exercise them against a real document, and the
// document is resolved lazily so suites that install a mock document later
// still work.
interface TestDomElementInfo {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  value?: string;
  type?: string;
  placeholder?: string;
  href?: string;
  parent?: Node;
  prepend?: boolean;
}

type TestGlobals = Record<string, unknown> & {
  document?: Document;
};

// Obsidian's ambient declarations already type these globals, so the polyfill
// writes through an untyped view of globalThis.
const testGlobals = globalThis as unknown as TestGlobals;

function resolveTestDocument(): Document {
  const doc = testGlobals.document;
  if (!doc) {
    throw new Error('createEl helpers require a document in this test environment');
  }
  return doc;
}

function applyElementInfo(
  el: Element,
  info: TestDomElementInfo,
  callback?: (el: Element) => void,
): void {
  if (info.cls) {
    const classes = Array.isArray(info.cls) ? info.cls : info.cls.split(/\s+/).filter(Boolean);
    el.classList.add(...classes);
  }
  if (info.text) el.textContent = info.text;
  if (info.attr) {
    for (const [name, value] of Object.entries(info.attr)) {
      if (value === null) continue;
      el.setAttribute(name, String(value));
    }
  }
  if (info.title !== undefined) (el as HTMLElement).title = info.title;
  if (info.value !== undefined && el instanceof HTMLInputElement) el.value = info.value;
  if (info.type && el instanceof HTMLInputElement) el.type = info.type;
  if (info.placeholder && el instanceof HTMLInputElement) el.placeholder = info.placeholder;
  if (info.href && el instanceof HTMLAnchorElement) el.href = info.href;
  callback?.(el);
  if (info.parent) {
    if (info.prepend) {
      info.parent.insertBefore(el, info.parent.firstChild);
    } else {
      info.parent.appendChild(el);
    }
  }
}

if (!testGlobals.createEl) {
  testGlobals.createEl = (
    tag: string,
    o?: TestDomElementInfo | string,
    callback?: (el: Element) => void,
  ): Element => {
    const el = resolveTestDocument().createElement(tag);
    applyElementInfo(el, typeof o === 'string' ? { cls: o } : o ?? {}, callback);
    return el;
  };
}

if (!testGlobals.createDiv) {
  testGlobals.createDiv = (o?: TestDomElementInfo | string, callback?: (el: Element) => void) =>
    (testGlobals.createEl as (...args: unknown[]) => Element)('div', o, callback);
}

if (!testGlobals.createSpan) {
  testGlobals.createSpan = (o?: TestDomElementInfo | string, callback?: (el: Element) => void) =>
    (testGlobals.createEl as (...args: unknown[]) => Element)('span', o, callback);
}

if (!testGlobals.createSvg) {
  testGlobals.createSvg = (
    tag: string,
    o?: TestDomElementInfo | string,
    callback?: (el: Element) => void,
  ): Element => {
    const el = resolveTestDocument().createElementNS('http://www.w3.org/2000/svg', tag);
    applyElementInfo(el, typeof o === 'string' ? { cls: o } : o ?? {}, callback);
    return el;
  };
}

if (!testGlobals.createFragment) {
  testGlobals.createFragment = (callback?: (fragment: DocumentFragment) => void): DocumentFragment => {
    const fragment = resolveTestDocument().createDocumentFragment();
    callback?.(fragment);
    return fragment;
  };
}
