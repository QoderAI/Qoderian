const mockDeleteSDKSessionArtifacts = jest.fn().mockResolvedValue(undefined);

jest.mock('@/qoder/history/qoder-history-store', () => ({
  deleteSDKSessionArtifacts: mockDeleteSDKSessionArtifacts,
  loadSDKSessionMessages: jest.fn(),
  loadSubagentToolCalls: jest.fn(),
  sdkSessionExists: jest.fn(),
}));

import type { Conversation } from '@/core/types';
import { QoderConversationHistoryService } from '@/qoder/history/qoder-conversation-history-service';

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
