import * as sdkModule from '@qoder-ai/qoder-agent-sdk';
import { createMockEl } from '@test/helpers/mock-element';
import { Notice } from 'obsidian';

import { openFeedbackModal } from '@/features/feedback/ui/feedback-modal';
import type { QoderHostContext } from '@/qoder/qoder-host-context';

const sdkMock = sdkModule as unknown as {
  resetMockMessages: () => void;
  setMockFeedbackResult: (result: {
    success: boolean;
    message: string;
    requestId?: string;
  }) => void;
  getLastFeedbackCall: () => { params: any; options: any } | undefined;
};

let lastModalInstance: any;

jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');

  class MockModal {
    app: any;
    modalEl: any = { addClass: jest.fn() };
    contentEl: any;

    constructor(app: any) {
      this.app = app;
      this.contentEl = createMockEl();
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      lastModalInstance = this;
    }

    setTitle = jest.fn();

    open() {
      this.onOpen();
    }

    close() {
      this.onClose();
    }

    onOpen() {
      // Overridden by subclass
    }

    onClose() {
      // Overridden by subclass
    }
  }

  return {
    ...actual,
    Modal: MockModal,
  };
});

const mockApp = {} as any;

interface TestContext {
  plugin: QoderHostContext;
  sessionId: string;
  callerVersion: string;
  onRequestSignIn?: () => void;
}

function createContext(
  overrides: Partial<TestContext> & { cliPath?: string | null } = {},
): TestContext {
  const { cliPath = '/mock/qoder', ...rest } = overrides;
  const plugin = {
    app: { vault: { adapter: { basePath: '/test/vault' } } },
    settings: {},
    getResolvedQoderCliPath: jest.fn().mockReturnValue(cliPath),
  } as unknown as QoderHostContext;
  return { plugin, sessionId: 'abcdef123456', callerVersion: '1.0.7', ...rest };
}

function find(cls: string): any {
  return lastModalInstance.contentEl.querySelector(`.${cls}`);
}

function typeText(text: string): void {
  const textarea = find('qoderian-feedback-textarea');
  textarea.value = text;
  textarea.dispatchEvent('input');
}

function click(cls: string): void {
  find(cls).click();
}

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

const originalClipboard = (navigator as { clipboard?: unknown }).clipboard;

function mockClipboardWriteText(writeText: jest.Mock): jest.Mock {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

beforeEach(() => {
  lastModalInstance = null;
  sdkMock.resetMockMessages();
  (Notice as unknown as jest.Mock).mockClear();
});

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: originalClipboard,
    configurable: true,
  });
});

describe('FeedbackModal', () => {
  it('resolves null when closed without submitting', async () => {
    const result = openFeedbackModal(mockApp, createContext());
    lastModalInstance.close();

    expect(await result).toBeNull();
  });

  it('disables submit until content is typed and shows the session hint', () => {
    openFeedbackModal(mockApp, createContext());

    expect(find('qoderian-feedback-button--primary').disabled).toBe(true);
    expect(find('qoderian-feedback-session').textContent).toContain('abcdef12');

    typeText('Something is broken.');

    expect(find('qoderian-feedback-button--primary').disabled).toBe(false);
    expect(find('qoderian-feedback-counter').textContent).toBe('20 / 2000');
  });

  it('blocks over-limit input instead of truncating it', () => {
    openFeedbackModal(mockApp, createContext());

    typeText('a'.repeat(2001));

    expect(find('qoderian-feedback-counter').textContent).toBe('2001 / 2000');
    expect(find('qoderian-feedback-counter').hasClass('qoderian-feedback-counter--over'))
      .toBe(true);
    expect(find('qoderian-feedback-button--primary').disabled).toBe(true);
  });

  it('submits the draft and reports success through a Notice', async () => {
    const result = openFeedbackModal(mockApp, createContext());
    typeText('Something is broken.');
    click('qoderian-feedback-button--primary');
    await flush();

    expect(await result).toMatchObject({ ok: true });
    expect(sdkMock.getLastFeedbackCall()?.params).toMatchObject({
      content: 'Something is broken.',
      workdir: '/test/vault',
      sessionId: 'abcdef123456',
      callerVersion: '1.0.7',
    });
    expect(Notice).toHaveBeenCalledWith('Feedback submitted. Thank you!');
  });

  it('copies the request id to the clipboard when the CLI returns one', async () => {
    const writeText = mockClipboardWriteText(jest.fn().mockResolvedValue(undefined));
    sdkMock.setMockFeedbackResult({ success: true, message: 'ok', requestId: 'req-42' });

    openFeedbackModal(mockApp, createContext());
    typeText('Something is broken.');
    click('qoderian-feedback-button--primary');
    await flush();

    expect(writeText).toHaveBeenCalledWith('req-42');
    expect(Notice).toHaveBeenCalledWith(
      'Feedback submitted. Request req-42 copied to your clipboard.',
    );
  });

  it('still reports the request id when the clipboard write fails', async () => {
    mockClipboardWriteText(jest.fn().mockRejectedValue(new Error('denied')));
    sdkMock.setMockFeedbackResult({ success: true, message: 'ok', requestId: 'req-42' });

    openFeedbackModal(mockApp, createContext());
    typeText('Something is broken.');
    click('qoderian-feedback-button--primary');
    await flush();

    expect(Notice).toHaveBeenCalledWith('Feedback submitted (request req-42). Thank you!');
  });

  it('keeps the modal and the typed text when the CLI rejects the submission', async () => {
    sdkMock.setMockFeedbackResult({ success: false, message: 'not logged in' });
    const onRequestSignIn = jest.fn();

    const result = openFeedbackModal(mockApp, createContext({ onRequestSignIn }));
    typeText('Something is broken.');
    click('qoderian-feedback-button--primary');
    await flush();

    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);

    expect(find('qoderian-feedback-error').hasClass('qoderian-hidden')).toBe(false);
    expect(find('qoderian-feedback-error-message').textContent).toBe('not logged in');
    expect(find('qoderian-feedback-textarea').value).toBe('Something is broken.');

    click('qoderian-feedback-signin');
    expect(onRequestSignIn).toHaveBeenCalled();
    expect(await result).toBeNull();
  });

  it('does not offer sign-in when the failure is not auth-related', async () => {
    sdkMock.setMockFeedbackResult({
      success: false,
      message: "error: unknown option '--storage-dir'",
    });
    const onRequestSignIn = jest.fn();

    const result = openFeedbackModal(mockApp, createContext({ onRequestSignIn }));
    typeText('Something is broken.');
    click('qoderian-feedback-button--primary');
    await flush();

    expect(find('qoderian-feedback-error-message').textContent)
      .toBe("error: unknown option '--storage-dir'");
    expect(find('qoderian-feedback-signin')).toBeNull();

    lastModalInstance.close();
    expect(await result).toBeNull();
  });

  it('shows a banner and keeps submit disabled when no CLI is resolved', async () => {
    const result = openFeedbackModal(mockApp, createContext({ cliPath: null }));

    expect(find('qoderian-feedback-banner')).not.toBeNull();

    typeText('Something is broken.');
    expect(find('qoderian-feedback-button--primary').disabled).toBe(true);

    lastModalInstance.close();
    expect(await result).toBeNull();
  });

  it('resolves null when the cancel button is used', async () => {
    const result = openFeedbackModal(mockApp, createContext());
    typeText('Something is broken.');
    click('qoderian-feedback-button');

    expect(await result).toBeNull();
    expect(sdkMock.getLastFeedbackCall()).toBeUndefined();
  });
});
