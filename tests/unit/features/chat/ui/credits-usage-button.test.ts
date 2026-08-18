import { createMockEl } from '@test/helpers/mock-element';

import type { CreditsUsageSnapshot } from '@/core/types/services';
import { CreditsUsageButton } from '@/features/chat/ui/credits-usage-button';
import { setLocale } from '@/i18n/i18n';
import { setActiveQoderCliEdition } from '@/qoder/config/cli-edition';

const SNAPSHOT: CreditsUsageSnapshot = {
  userType: 'teams',
  totalUsagePercentage: 100,
  expiresAt: 1787414400000,
  upgradeUrl: 'https://qoder.com/pricing?client=qoder',
  isQuotaExceeded: false,
  userQuota: { total: 6000, used: 6000, remaining: 0, percentage: 100 },
  orgResourcePackage: {
    cap: 214000,
    used: 190309,
    remaining: 23691,
    percentage: 89,
    available: true,
  },
};

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface ButtonHarness {
  parentEl: ReturnType<typeof createMockEl>;
  fetchUsage: jest.Mock;
  button: CreditsUsageButton;
}

function createButton(cached: CreditsUsageSnapshot | null = SNAPSHOT): ButtonHarness {
  const parentEl = createMockEl();
  const fetchUsage = jest.fn().mockResolvedValue(SNAPSHOT);
  const button = new CreditsUsageButton(parentEl, {
    getCachedUsage: () => cached,
    fetchUsage,
    subscribeRuntimeStatus: jest.fn().mockReturnValue(() => {}),
  });
  return { parentEl, fetchUsage, button };
}

describe('CreditsUsageButton', () => {
  it('shows a static usage tooltip like the other nav-row buttons', () => {
    const { parentEl } = createButton();

    expect(parentEl.querySelector('.qoderian-credits-btn')?.getAttribute('aria-label'))
      .toBe('Usage');
    expect(parentEl.querySelector('.qoderian-credits-btn')?.getAttribute('title')).toBeNull();
  });

  it('re-applies localized text when the locale changes', () => {
    const { parentEl, button } = createButton();

    setLocale('zh-CN');
    try {
      button.refreshLocale();
      expect(parentEl.querySelector('.qoderian-credits-btn')?.getAttribute('aria-label'))
        .toBe('用量');
    } finally {
      setLocale('en');
    }
  });

  it('renders plan and resource package sections like the IDE usage panel', () => {
    const { parentEl } = createButton();

    const titles = parentEl.querySelectorAll('.qoderian-credits-section-title')
      .map((el: { textContent: string }) => el.textContent);
    expect(titles).toEqual(['Plan Credits', 'Add-on Credits']);

    const teamsBadge = parentEl.querySelector('.qoderian-credits-badge') as ReturnType<typeof createMockEl>;
    expect(teamsBadge.textContent).toBe('Teams');
    expect(teamsBadge.hasClass('qoderian-credits-badge--plain')).toBe(false);
    expect(parentEl.querySelector('.qoderian-credits-trailing')?.textContent)
      .toContain('Renews on');

    const numbers = parentEl.querySelectorAll('.qoderian-credits-numbers');
    expect(numbers).toHaveLength(2);
    const planNums = numbers[0] as ReturnType<typeof createMockEl>;
    expect(planNums.querySelector('.qoderian-credits-used-num')?.textContent).toBe('6000');
    expect(planNums.querySelector('.qoderian-credits-total-num')?.textContent)
      .toContain('/ 6000');
    expect(planNums.querySelector('.qoderian-credits-used-percent')?.textContent)
      .toBe('(100% used)');
    expect(planNums.querySelector('.qoderian-credits-left')?.textContent).toBe('0 left');

    // Fully used plan bar is clamped at 100% and keeps the unified color
    const fills = parentEl.querySelectorAll('.qoderian-credits-bar-fill');
    expect((fills[0] as ReturnType<typeof createMockEl>).style.width).toBe('100%');
    expect((fills[1] as ReturnType<typeof createMockEl>).style.width).toBe('89%');
  });

  it('renders personal accounts like the IDE usage panel', () => {
    const personal: CreditsUsageSnapshot = {
      userType: 'personal_standard',
      totalUsagePercentage: 0,
      expiresAt: 253402214400000,
      userQuota: { total: 0, used: 0, remaining: 0, percentage: 0 },
      addOnQuota: { total: 1000, used: 0, remaining: 1000, percentage: 0 },
    };
    const { parentEl } = createButton(personal);

    // Personal tier shows a plain-text label instead of the green pill.
    const badge = parentEl.querySelector('.qoderian-credits-badge') as ReturnType<typeof createMockEl>;
    expect(badge.textContent).toBe('Trial');
    expect(badge.hasClass('qoderian-credits-badge--plain')).toBe(true);

    // The year-9999 sentinel expiry hides the renewal line.
    expect(parentEl.querySelector('.qoderian-credits-trailing')).toBeNull();

    const titles = parentEl.querySelectorAll('.qoderian-credits-section-title')
      .map((el: { textContent: string }) => el.textContent);
    expect(titles).toEqual(['Plan Credits', 'Personal Resource Pack']);
  });

  it('links to the edition account usage page', () => {
    const { parentEl } = createButton();
    expect(parentEl.querySelector('.qoderian-credits-details-link')?.getAttribute('href'))
      .toBe('https://qoder.com/account/usage');

    setActiveQoderCliEdition('cn');
    try {
      const cn = createButton();
      expect(cn.parentEl.querySelector('.qoderian-credits-details-link')?.getAttribute('href'))
        .toBe('https://qoder.com.cn/account/usage');
    } finally {
      setActiveQoderCliEdition('global');
    }
  });

  it('shows an unavailable state without a snapshot', () => {
    const { parentEl } = createButton(null);

    expect(parentEl.querySelector('.qoderian-credits-btn')?.getAttribute('aria-label'))
      .toBe('Usage');
    expect(parentEl.querySelector('.qoderian-credits-empty')?.textContent)
      .toBe('Usage unavailable');
  });

  it('refreshes from the CLI when the refresh button is clicked', async () => {
    const { parentEl, fetchUsage } = createButton(null);

    parentEl.querySelector('.qoderian-credits-refresh')?.click();
    await flushPromises();

    expect(fetchUsage).toHaveBeenCalledTimes(1);
    expect(parentEl.querySelector('.qoderian-credits-btn')?.getAttribute('aria-label'))
      .toBe('Usage');
    expect(parentEl.querySelector('.qoderian-credits-empty')).toBeNull();
  });

  it('validates the cached snapshot on first open, then respects the TTL', async () => {
    const { parentEl, fetchUsage } = createButton();

    // First open has no self-fetch yet, so it validates against the CLI.
    parentEl.querySelector('.qoderian-credits-btn')?.click();
    await flushPromises();
    expect(fetchUsage).toHaveBeenCalledTimes(1);

    // Close + reopen within the TTL keeps the fresh snapshot.
    parentEl.querySelector('.qoderian-credits-btn')?.click();
    parentEl.querySelector('.qoderian-credits-btn')?.click();
    await flushPromises();
    expect(fetchUsage).toHaveBeenCalledTimes(1);
  });
});
