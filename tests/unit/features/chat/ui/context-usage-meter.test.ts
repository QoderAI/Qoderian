import { createMockEl } from '@test/helpers/mock-element';

import type { ContextUsageBreakdown, UsageInfo } from '@/core/types';
import { ContextUsageMeter } from '@/features/chat/ui/input-toolbar';

const BREAKDOWN: ContextUsageBreakdown = {
  usedPercentage: 37.4,
  categories: [
    { type: 'system_prompt', percentage: 0.4 },
    { type: 'system_tools', percentage: 1 },
    { type: 'skills', percentage: 0.2 },
    { type: 'messages', percentage: 35.8 },
    { type: 'other', percentage: 0 },
    { type: 'free_space', percentage: 62.6 },
    { type: 'auto_compact', percentage: 0 },
  ],
  skills: { count: 7, percentageOfContext: 0.2 },
};

const USAGE: UsageInfo = {
  model: 'sonnet',
  inputTokens: 0,
  contextWindow: 200_000,
  contextTokens: 74_000,
  percentage: 37,
};

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface MeterHarness {
  parentEl: ReturnType<typeof createMockEl>;
  meter: ContextUsageMeter;
  requestContextUsage: jest.Mock;
  onCompactContext: jest.Mock;
}

function createMeter(
  requestContextUsage: jest.Mock = jest.fn().mockResolvedValue(BREAKDOWN),
): MeterHarness {
  const parentEl = createMockEl();
  const onCompactContext = jest.fn();
  const meter = new ContextUsageMeter(parentEl, { requestContextUsage, onCompactContext });
  return { parentEl, meter, requestContextUsage, onCompactContext };
}

function getRoot(parentEl: ReturnType<typeof createMockEl>) {
  return parentEl.querySelector('.qoderian-context-meter');
}

async function openPanel(harness: MeterHarness) {
  harness.parentEl.querySelector('.qoderian-context-meter-trigger')?.click();
  await flushPromises();
}

describe('ContextUsageMeter', () => {
  it('draws the gauge as a full ring that fills from the top', () => {
    const { parentEl } = createMeter();

    const fill = parentEl.querySelector('.qoderian-meter-fill');
    expect(fill?.tagName).toBe('CIRCLE');
    const circumference = 2 * Math.PI * ((18 - 2 * 2) / 2);
    expect(Number(fill?.getAttribute('stroke-dasharray'))).toBeCloseTo(circumference);
    expect(Number(fill?.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference);
    expect(fill?.getAttribute('transform')).toBe('rotate(-90 9 9)');
  });

  it('fills the ring and reveals the panel trigger for a reading', () => {
    const { parentEl, meter } = createMeter();
    meter.update(USAGE);

    const circumference = 2 * Math.PI * ((18 - 2 * 2) / 2);
    const fill = parentEl.querySelector('.qoderian-meter-fill');
    expect(Number(fill?.getAttribute('stroke-dashoffset')))
      .toBeCloseTo(circumference * (1 - 0.37));
    expect(parentEl.querySelector('.qoderian-context-meter-percent')?.textContent).toBe('37%');
    expect(getRoot(parentEl)?.hasClass('qoderian-hidden')).toBe(false);
  });

  it('renders the breakdown after the panel opens', async () => {
    const harness = createMeter();

    await openPanel(harness);

    expect(harness.requestContextUsage).toHaveBeenCalledTimes(1);
    expect(getRoot(harness.parentEl)?.hasClass('qoderian-context-meter--open')).toBe(true);
    expect(harness.parentEl.querySelector('.qoderian-context-panel-title')?.textContent)
      .toBe('Context window');
    expect(harness.parentEl.querySelector('.qoderian-context-panel-percent')?.textContent)
      .toBe('37%');

    const barFill = harness.parentEl.querySelector('.qoderian-context-panel-bar-fill');
    expect(barFill?.style.width).toBe('37%');

    const labels = harness.parentEl.querySelectorAll('.qoderian-context-row-label')
      .map((el: { textContent: string }) => el.textContent);
    expect(labels).toEqual([
      'System prompt',
      'System tools',
      'Skills (7)',
      'Messages',
      'Other',
    ]);

    const percents = harness.parentEl.querySelectorAll('.qoderian-context-row-percent')
      .map((el: { textContent: string }) => el.textContent);
    expect(percents).toEqual(['<1%', '1%', '<1%', '36%', '0%']);

    // Near-empty buckets keep a visible dot; occupied ones are fully opaque.
    const dots = harness.parentEl.querySelectorAll('.qoderian-context-dot');
    expect(dots[0]?.style.opacity).toBe('0.25');
    expect(dots[3]?.style.opacity).toBe('1');
  });

  it('shows the empty state until the CLI reports a breakdown', async () => {
    const harness = createMeter(jest.fn().mockResolvedValue(null));

    await openPanel(harness);

    expect(harness.parentEl.querySelector('.qoderian-context-panel-empty')?.textContent)
      .toBe('Context details appear after the first response.');
    expect(harness.parentEl.querySelector('.qoderian-context-row')).toBeNull();
  });

  it('keeps the last breakdown when a refresh returns nothing', async () => {
    const requestContextUsage = jest.fn()
      .mockResolvedValueOnce(BREAKDOWN)
      .mockResolvedValueOnce(null);
    const harness = createMeter(requestContextUsage);

    await openPanel(harness);
    harness.parentEl.querySelector('.qoderian-context-meter-trigger')?.click();
    harness.parentEl.querySelector('.qoderian-context-meter-trigger')?.click();
    await flushPromises();

    // One read per open; the second returns nothing and the panel keeps its data.
    expect(requestContextUsage).toHaveBeenCalledTimes(2);
    expect(harness.parentEl.querySelectorAll('.qoderian-context-row')).toHaveLength(5);
  });

  it('compacts the conversation from the panel button and closes it', async () => {
    const harness = createMeter();
    await openPanel(harness);

    harness.parentEl.querySelector('.qoderian-context-compact-btn')?.click();

    expect(harness.onCompactContext).toHaveBeenCalledTimes(1);
    expect(getRoot(harness.parentEl)?.hasClass('qoderian-context-meter--open')).toBe(false);
  });

  it('does not read the CLI while the panel stays closed', () => {
    const harness = createMeter();

    expect(harness.requestContextUsage).not.toHaveBeenCalled();
    expect(harness.parentEl.querySelector('.qoderian-context-panel-header')).toBeNull();
  });
});
