import * as sdkModule from '@qoder-ai/qoder-agent-sdk';

import type QoderianPlugin from '@/main';
import {
  countFeedbackChars,
  FEEDBACK_CONTENT_LIMIT,
  submitUserFeedback,
} from '@/qoder/services/submit-user-feedback';

const sdkMock = sdkModule as unknown as {
  resetMockMessages: () => void;
  setMockFeedbackResult: (result: {
    success: boolean;
    message: string;
    requestId?: string;
  }) => void;
  getLastFeedbackCall: () => { params: any; options: any } | undefined;
};

jest.mock('@/core/fs/path', () => ({
  getVaultPath: jest.fn().mockReturnValue('/test/vault'),
}));

jest.mock('@/core/env/environment', () => ({
  getEnhancedPath: jest.fn().mockReturnValue('/usr/bin:/mock/bin'),
}));

function createMockPlugin(cliPath: string | null = '/mock/qoder'): QoderianPlugin {
  return {
    app: {},
    settings: {},
    getResolvedQoderCliPath: jest.fn().mockReturnValue(cliPath),
  } as unknown as QoderianPlugin;
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    content: 'The rewind button loses my draft.',
    includeWorkspaceDiagnostics: true,
    ...overrides,
  } as Parameters<typeof submitUserFeedback>[1];
}

describe('submitUserFeedback', () => {
  beforeEach(() => {
    sdkMock.resetMockMessages();
  });

  it('reports cliUnavailable without spawning the CLI', async () => {
    const outcome = await submitUserFeedback(createMockPlugin(null), draft());

    expect(outcome).toEqual({ ok: false, reason: 'cliUnavailable' });
    expect(sdkMock.getLastFeedbackCall()).toBeUndefined();
  });

  it('maps the draft onto the qodercli feedback arguments', async () => {
    const outcome = await submitUserFeedback(createMockPlugin(), draft({
      email: '  dev@example.com ',
      sessionId: 'session-abc',
      callerVersion: '1.0.7',
    }));

    expect(outcome.ok).toBe(true);
    expect(sdkMock.getLastFeedbackCall()?.params).toEqual({
      content: 'The rewind button loses my draft.',
      workdir: '/test/vault',
      sessionId: 'session-abc',
      email: 'dev@example.com',
      callerVersion: '1.0.7',
    });
  });

  it('omits workdir when diagnostics are declined', async () => {
    await submitUserFeedback(
      createMockPlugin(),
      draft({ includeWorkspaceDiagnostics: false }),
    );

    expect(sdkMock.getLastFeedbackCall()?.params.workdir).toBeUndefined();
  });

  it('spawns with the resolved CLI, enhanced PATH and the Qoderian ide type', async () => {
    await submitUserFeedback(createMockPlugin(), draft());

    const options = sdkMock.getLastFeedbackCall()?.options;
    expect(options.cliPath).toBe('/mock/qoder');
    expect(options.env.PATH).toBe('/usr/bin:/mock/bin');
    expect(options.integrationMode).toBe('Qoderian');
    expect(options.timeout).toBe(30_000);
    // `qodercli feedback` rejects `--storage-dir`, so it must never be forwarded.
    expect(options.storageDir).toBeUndefined();
  });

  it('rejects empty and over-limit content before spawning', async () => {
    expect(await submitUserFeedback(createMockPlugin(), draft({ content: '   ' })))
      .toEqual({ ok: false, reason: 'emptyContent' });
    expect(await submitUserFeedback(createMockPlugin(), draft({
      content: 'a'.repeat(FEEDBACK_CONTENT_LIMIT + 1),
    }))).toEqual({ ok: false, reason: 'contentTooLong' });
    expect(sdkMock.getLastFeedbackCall()).toBeUndefined();
  });

  it('counts emoji as single characters against the CLI limit', () => {
    expect(countFeedbackChars('😀'.repeat(FEEDBACK_CONTENT_LIMIT)))
      .toBe(FEEDBACK_CONTENT_LIMIT);
  });

  it('surfaces the CLI message when the submission is rejected', async () => {
    sdkMock.setMockFeedbackResult({ success: false, message: 'not logged in' });

    const outcome = await submitUserFeedback(createMockPlugin(), draft());

    expect(outcome).toEqual({ ok: false, reason: 'rejected', detail: 'not logged in' });
  });

  it('passes the request id through on success', async () => {
    sdkMock.setMockFeedbackResult({ success: true, message: 'ok', requestId: 'req-1' });

    const outcome = await submitUserFeedback(createMockPlugin(), draft());

    expect(outcome).toEqual({ ok: true, message: 'ok', requestId: 'req-1' });
  });
});
