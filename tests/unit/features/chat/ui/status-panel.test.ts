import { createMockEl, type MockElement } from '@test/helpers/mock-element';

import { StatusPanel } from '@/features/chat/ui/status-panel';

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  setIcon: jest.fn((el: MockElement, iconName: string) => {
    el.setAttribute('data-icon', iconName);
  }),
}));

describe('StatusPanel', () => {
  let containerEl: MockElement;
  let panel: StatusPanel;
  let originalDocument: Document;
  let originalNavigator: Navigator;
  let writeTextMock: jest.Mock;

  beforeEach(() => {
    originalDocument = global.document;
    originalNavigator = global.navigator;
    global.document = {
      createElement: (tag: string) => createMockEl(tag),
    } as unknown as Document;
    writeTextMock = jest.fn().mockResolvedValue(undefined);
    global.navigator = { clipboard: { writeText: writeTextMock } } as unknown as Navigator;
    containerEl = createMockEl();
    panel = new StatusPanel();
    panel.mount(containerEl as unknown as HTMLElement);
  });

  afterEach(() => {
    panel.destroy();
    global.document = originalDocument;
    global.navigator = originalNavigator;
  });

  it('mounts an initially hidden command-output section', () => {
    expect(containerEl.querySelector('.qoderian-status-panel')).not.toBeNull();
    expect(containerEl.querySelector('.qoderian-status-panel-bash')?.style.display).toBe('none');
  });

  it('renders and updates command output', () => {
    panel.addBashOutput({
      id: 'bash-1',
      command: 'echo hello',
      status: 'running',
      output: '',
    });

    expect(containerEl.querySelector('.qoderian-tool-result-text')?.textContent).toBe('Running...');

    panel.updateBashOutput('bash-1', {
      status: 'completed',
      output: 'hello',
      exitCode: 0,
    });

    const entry = containerEl.querySelector('.qoderian-status-panel-bash-entry');
    expect(entry?.querySelector('.qoderian-tool-result-text')?.textContent).toBe('hello');
    expect(entry?.querySelector('.qoderian-tool-status')?.hasClass('status-completed')).toBe(true);
  });

  it('collapses and expands command output', () => {
    panel.addBashOutput({
      id: 'bash-1',
      command: 'echo hello',
      status: 'completed',
      output: 'hello',
    });

    const header = containerEl.querySelector('.qoderian-status-panel-bash-header');
    expect(header?.getAttribute('aria-expanded')).toBe('true');

    header?.click();
    expect(containerEl.querySelector('.qoderian-status-panel-bash-content')?.style.display).toBe('none');
    expect(header?.getAttribute('aria-expanded')).toBe('false');

    header?.click();
    expect(containerEl.querySelector('.qoderian-status-panel-bash-content')?.style.display).toBe('block');
  });

  it('supports keyboard toggling for command output', () => {
    panel.addBashOutput({
      id: 'bash-1',
      command: 'echo hello',
      status: 'completed',
      output: 'hello',
    });

    const header = containerEl.querySelector('.qoderian-status-panel-bash-header');
    const event = { type: 'keydown', key: 'Enter', preventDefault: jest.fn() };
    header?.dispatchEvent(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(containerEl.querySelector('.qoderian-status-panel-bash-content')?.style.display).toBe('none');
  });

  it('collapses and expands individual command entries', () => {
    panel.addBashOutput({
      id: 'bash-1',
      command: 'echo hello',
      status: 'completed',
      output: 'hello',
    });

    const entryHeader = containerEl
      .querySelector('.qoderian-status-panel-bash-entry')
      ?.querySelector('.qoderian-tool-header');
    expect(entryHeader?.getAttribute('aria-expanded')).toBe('true');

    entryHeader?.click();

    const collapsedEntry = containerEl.querySelector('.qoderian-status-panel-bash-entry');
    expect(collapsedEntry?.querySelector('.qoderian-tool-content')?.style.display).toBe('none');
    expect(collapsedEntry?.querySelector('.qoderian-tool-header')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('copies the latest command output', async () => {
    panel.addBashOutput({
      id: 'bash-1',
      command: 'echo hello',
      status: 'completed',
      output: 'hello',
    });

    containerEl.querySelector('.qoderian-status-panel-bash-action-copy')?.click();
    await Promise.resolve();

    expect(writeTextMock).toHaveBeenCalledWith('$ echo hello\nhello');
  });

  it('keeps command actions from toggling the section', async () => {
    panel.addBashOutput({
      id: 'bash-1',
      command: 'echo hello',
      status: 'completed',
      output: 'hello',
    });

    const copyButton = containerEl.querySelector('.qoderian-status-panel-bash-action-copy');
    const event = {
      type: 'keydown',
      key: ' ',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };
    copyButton?.dispatchEvent(event);
    await Promise.resolve();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(containerEl.querySelector('.qoderian-status-panel-bash-content')?.style.display).toBe('block');
  });

  it('clears command output', () => {
    panel.addBashOutput({
      id: 'bash-1',
      command: 'echo hello',
      status: 'completed',
      output: 'hello',
    });

    containerEl.querySelector('.qoderian-status-panel-bash-action-clear')?.click();

    expect(containerEl.querySelector('.qoderian-status-panel-bash')?.style.display).toBe('none');
  });

  it('caps retained command outputs', () => {
    for (let index = 0; index < 55; index++) {
      panel.addBashOutput({
        id: `bash-${index}`,
        command: `echo ${index}`,
        status: 'completed',
        output: String(index),
      });
    }

    expect(containerEl.querySelectorAll('.qoderian-status-panel-bash-entry')).toHaveLength(50);
  });

  it('renders failed command output', () => {
    panel.addBashOutput({
      id: 'bash-1',
      command: 'bad-command',
      status: 'running',
      output: '',
    });

    panel.updateBashOutput('bash-1', {
      status: 'error',
      output: 'command not found',
      exitCode: 127,
    });

    const entry = containerEl.querySelector('.qoderian-status-panel-bash-entry');
    expect(entry?.querySelector('.qoderian-tool-result-text')?.textContent).toBe('command not found');
    expect(entry?.querySelector('.qoderian-tool-status')?.hasClass('status-error')).toBe(true);
  });

  it('ignores updates for unknown command IDs', () => {
    panel.addBashOutput({
      id: 'bash-1',
      command: 'echo hello',
      status: 'running',
      output: '',
    });

    panel.updateBashOutput('missing', { status: 'completed', output: 'unexpected' });

    expect(containerEl.querySelector('.qoderian-tool-result-text')?.textContent).toBe('Running...');
  });

  it('handles clipboard failures without rejecting the UI action', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('Clipboard denied'));
    panel.addBashOutput({
      id: 'bash-1',
      command: 'echo hello',
      status: 'completed',
      output: 'hello',
    });

    containerEl.querySelector('.qoderian-status-panel-bash-action-copy')?.click();
    await Promise.resolve();

    expect(writeTextMock).toHaveBeenCalledTimes(1);
  });

  it('preserves command output across remount', () => {
    panel.addBashOutput({
      id: 'bash-1',
      command: 'echo hello',
      status: 'completed',
      output: 'hello',
    });

    panel.remount();

    const entries = containerEl.querySelectorAll('.qoderian-status-panel-bash-entry');
    const remountedEntry = entries.at(-1);
    expect(remountedEntry).toBeDefined();
    expect(remountedEntry?.querySelector('.qoderian-tool-result-text')?.textContent).toBe('hello');
  });

  it('destroys the panel safely', () => {
    expect(() => {
      panel.destroy();
      panel.destroy();
    }).not.toThrow();
  });
});
