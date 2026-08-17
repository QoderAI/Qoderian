const mockDeleteSDKSessionArtifacts = jest.fn().mockResolvedValue(undefined);

jest.mock('@/qoder/history/qoder-history-store', () => ({
  deleteSDKSessionArtifacts: mockDeleteSDKSessionArtifacts,
  loadSDKSessionMessages: jest.fn(),
  loadSubagentToolCalls: jest.fn(),
  sdkSessionExists: jest.fn(),
}));

import { beginRestoreReport, finishRestoreReport } from '@/core/diagnostics/restore-report';
import type { Conversation } from '@/core/types';
import { QoderConversationHistoryService } from '@/qoder/history/qoder-conversation-history-service';
import { loadSDKSessionMessages, sdkSessionExists } from '@/qoder/history/qoder-history-store';

describe('QoderConversationHistoryService deletion', () => {
  beforeEach(() => {
    mockDeleteSDKSessionArtifacts.mockClear();
  });

  it('deletes current, previous, and fork session artifacts without duplicates', async () => {
    const conversation = {
      id: 'conversation-id',
      title: 'Conversation',
      createdAt: 1,
      updatedAt: 2,
      sessionId: 'current-session',
      messages: [],
      qoderState: {
        previousSessionIds: ['previous-one', 'previous-two', 'previous-one'],
        forkSource: { sessionId: 'fork-source', resumeAt: 'assistant-id' },
      },
    } as Conversation;
    const service = new QoderConversationHistoryService();

    await service.deleteConversationSession(conversation, '/vault');

    expect(mockDeleteSDKSessionArtifacts.mock.calls).toEqual(expect.arrayContaining([
      ['/vault', 'current-session'],
      ['/vault', 'previous-one'],
      ['/vault', 'previous-two'],
      ['/vault', 'fork-source'],
    ]));
    expect(mockDeleteSDKSessionArtifacts).toHaveBeenCalledTimes(4);
  });

  it('does nothing when the vault path is unavailable', async () => {
    const service = new QoderConversationHistoryService();

    await service.deleteConversationSession({
      id: 'conversation-id',
      sessionId: 'session-id',
    } as Conversation, null);

    expect(mockDeleteSDKSessionArtifacts).not.toHaveBeenCalled();
  });
});

describe('QoderConversationHistoryService restore diagnostics', () => {
  const mockLoad = loadSDKSessionMessages as jest.Mock;
  const mockExists = sdkSessionExists as jest.Mock;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    finishRestoreReport();
    mockLoad.mockReset();
    mockExists.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const conversation = {
    id: 'conv-1',
    title: 'Conversation',
    createdAt: 1,
    updatedAt: 2,
    sessionId: 'sess-1',
    messages: [],
  } as Conversation;

  it('reports a history issue when session files fail to load', async () => {
    mockExists.mockReturnValue(true);
    mockLoad.mockResolvedValue({ messages: [], skippedLines: 0, error: 'read failed' });
    const service = new QoderConversationHistoryService();

    beginRestoreReport();
    await service.hydrateConversationHistory(conversation, '/vault');

    const issues = finishRestoreReport();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      stage: 'history',
      detail: expect.stringContaining('conv-1'),
    });
  });

  it('reports a history issue when session files are missing on disk', async () => {
    mockExists.mockReturnValue(false);
    const service = new QoderConversationHistoryService();

    beginRestoreReport();
    await service.hydrateConversationHistory(conversation, '/vault');

    const issues = finishRestoreReport();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      stage: 'history',
      detail: expect.stringContaining('missing'),
    });
  });

  it('does not report when hydration succeeds', async () => {
    mockExists.mockReturnValue(true);
    mockLoad.mockResolvedValue({ messages: [], skippedLines: 0 });
    const service = new QoderConversationHistoryService();

    beginRestoreReport();
    await service.hydrateConversationHistory(conversation, '/vault');

    expect(finishRestoreReport()).toEqual([]);
  });
});
