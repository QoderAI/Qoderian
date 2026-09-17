import type { SDKControlGetContextUsageResponse } from '@qoder-ai/qoder-agent-sdk';

import { mapContextUsageBreakdown } from '@/qoder/runtime/qoder-context-usage';
import { QoderTurnTracker } from '@/qoder/runtime/qoder-turn-tracker';

function createPayload(
  overrides: Partial<SDKControlGetContextUsageResponse> = {},
): SDKControlGetContextUsageResponse {
  return {
    model: 'qoder-sonnet-4-5',
    contextWindow: { usedPercentage: 37.4 },
    categories: [
      { type: 'system_prompt', percentage: 0.4 },
      { type: 'system_tools', percentage: 1 },
      { type: 'skills', percentage: 0.2 },
      { type: 'messages', percentage: 35.8 },
      { type: 'other', percentage: 0 },
      { type: 'free_space', percentage: 62.6 },
    ],
    autoCompact: { enabled: true, thresholdPercentage: 95 },
    skills: { count: 7, percentageOfContext: 0.2, items: [] },
    duplicateFileReads: [],
    session: {
      messageCount: 12,
      promptCount: 6,
      toolCalls: { total: 30, succeeded: 29, failed: 1 },
      linesChanged: { added: 120, removed: 4 },
    },
    ...overrides,
  } as SDKControlGetContextUsageResponse;
}

describe('mapContextUsageBreakdown', () => {
  it('keeps category and skill data from the CLI payload', () => {
    const breakdown = mapContextUsageBreakdown(createPayload());

    expect(breakdown.usedPercentage).toBe(37.4);
    expect(breakdown.categories).toEqual([
      { type: 'system_prompt', percentage: 0.4 },
      { type: 'system_tools', percentage: 1 },
      { type: 'skills', percentage: 0.2 },
      { type: 'messages', percentage: 35.8 },
      { type: 'other', percentage: 0 },
      { type: 'free_space', percentage: 62.6 },
    ]);
    expect(breakdown.skills).toEqual({ count: 7, percentageOfContext: 0.2 });
  });

  it('drops unknown categories and normalizes missing numbers', () => {
    const payload = createPayload({
      contextWindow: { usedPercentage: Number.NaN },
      categories: [
        { type: 'tool_output_summary' as never, percentage: 5 },
        { type: 'messages', percentage: Number.POSITIVE_INFINITY },
      ],
      skills: { count: 2.7, percentageOfContext: -1, items: [] },
    });

    const breakdown = mapContextUsageBreakdown(payload);

    expect(breakdown.usedPercentage).toBe(0);
    expect(breakdown.categories).toEqual([{ type: 'messages', percentage: 0 }]);
    expect(breakdown.skills).toEqual({ count: 2, percentageOfContext: 0 });
  });

  it('survives a payload without categories', () => {
    const payload = createPayload();
    delete (payload as { categories?: unknown }).categories;

    expect(mapContextUsageBreakdown(payload).categories).toEqual([]);
  });
});

describe('QoderTurnTracker context breakdown cache', () => {
  const request = (query: unknown) => ({
    query: query as never,
    isCurrentQuery: () => true,
    configuredModel: 'sonnet',
    sessionId: null,
  });

  it('caches the breakdown reported by the CLI until the session changes', async () => {
    const tracker = new QoderTurnTracker();
    const query = { getContextUsage: jest.fn().mockResolvedValue(createPayload()) };

    const chunk = await tracker.fetchContextUsage(request(query));

    expect(chunk).not.toBeNull();
    expect(tracker.getContextBreakdown()?.usedPercentage).toBe(37.4);

    tracker.clearContextBreakdown();
    expect(tracker.getContextBreakdown()).toBeNull();
  });

  it('keeps the last breakdown when a later read fails', async () => {
    const tracker = new QoderTurnTracker();
    const working = { getContextUsage: jest.fn().mockResolvedValue(createPayload()) };
    const failing = { getContextUsage: jest.fn().mockRejectedValue(new Error('gone')) };

    await tracker.fetchContextUsage(request(working));
    await tracker.fetchContextUsage(request(failing));

    expect(tracker.getContextBreakdown()?.usedPercentage).toBe(37.4);
  });
});
