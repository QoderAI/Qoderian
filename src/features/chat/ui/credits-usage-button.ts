import { setIcon } from 'obsidian';

import type {
  CreditsUsageQuota,
  CreditsUsageSnapshot,
  QoderRuntimeStatus,
} from '../../../core/types/services';
import { getLocale, t } from '../../../i18n/i18n';
import { getQoderAccountUsageUrl } from '../../../qoder/config/cli-edition';
import { setButtonTooltip } from '../../../shared/dom/tooltip';
import { ClickPopover } from './toolbar/click-popover';

/** Usage snapshots older than this are refreshed when the panel opens. */
const USAGE_CACHE_TTL_MS = 60_000;

export interface CreditsUsageButtonCallbacks {
  /** Latest snapshot known to the runtime catalog (from the startup probe). */
  getCachedUsage: () => CreditsUsageSnapshot | null;
  /** Runs a dedicated idle query against the CLI; null when unavailable. */
  fetchUsage: () => Promise<CreditsUsageSnapshot | null>;
  subscribeRuntimeStatus?: (listener: (status: QoderRuntimeStatus) => void) => () => void;
}

function formatCount(value: number | undefined): string {
  return String(value ?? 0);
}

function formatRenewalDate(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleDateString(getLocale(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return new Date(timestamp).toDateString();
  }
}

/** IDE-style tier label: org editions get the green pill, personal tiers plain text. */
function describeUserTier(userType: string | undefined): { text: string; plain: boolean } | null {
  if (userType === 'teams') return { text: 'Teams', plain: false };
  if (userType === 'personal_standard') return { text: t('credits.tierTrial'), plain: true };
  return null;
}

/** The server uses a year-9999 timestamp for plans that never renew. */
function isSentinelExpiry(timestamp: number): boolean {
  return new Date(timestamp).getUTCFullYear() >= 9999;
}

/**
 * Nav-row button showing overall credits usage with a popover panel that
 * mirrors the Qoder IDE usage view: plan quota, add-on quota and the
 * organization resource package, each with a segmented progress bar.
 */
export class CreditsUsageButton {
  private readonly container: HTMLElement;
  private readonly buttonEl: HTMLElement;
  private readonly panelEl: HTMLElement;
  private readonly popover: ClickPopover;
  private readonly unsubscribeRuntimeStatus: (() => void) | null;
  private refreshBtnEl: HTMLElement | null = null;
  private snapshot: CreditsUsageSnapshot | null;
  private fetchedAt = 0;
  private loading = false;

  constructor(parentEl: HTMLElement, private readonly callbacks: CreditsUsageButtonCallbacks) {
    this.container = parentEl.createDiv({ cls: 'qoderian-credits-container' });
    this.buttonEl = this.container.createDiv({ cls: 'qoderian-input-nav-btn qoderian-credits-btn' });
    setIcon(this.buttonEl, 'gauge');

    this.panelEl = this.container.createDiv({ cls: 'qoderian-credits-panel' });
    this.popover = new ClickPopover(
      this.container,
      this.buttonEl,
      this.panelEl,
      'qoderian-credits--open',
    );
    this.buttonEl.addEventListener('click', this.handleButtonClick);

    this.snapshot = callbacks.getCachedUsage();
    this.unsubscribeRuntimeStatus = callbacks.subscribeRuntimeStatus?.((status) => {
      this.snapshot = callbacks.getCachedUsage() ?? this.snapshot;
      this.updateButton();
      this.renderPanel();
      if (status.kind === 'ready' && !this.snapshot) void this.refresh(false);
    }) ?? null;

    this.updateButton();
    this.renderPanel();
  }

  destroy(): void {
    this.unsubscribeRuntimeStatus?.();
    this.buttonEl.removeEventListener('click', this.handleButtonClick);
    this.popover.destroy();
    this.container.remove();
  }

  /** Re-applies locale-dependent text after a language change. */
  refreshLocale(): void {
    this.updateButton();
    this.renderPanel();
  }

  /** Fetches a fresh snapshot; cached snapshots within the TTL are kept. */
  async refresh(force: boolean): Promise<void> {
    if (this.loading) return;
    if (!force && this.snapshot && Date.now() - this.fetchedAt < USAGE_CACHE_TTL_MS) return;

    this.loading = true;
    this.refreshBtnEl?.addClass('qoderian-credits-refresh--spinning');
    try {
      const snapshot = await this.callbacks.fetchUsage();
      if (snapshot) {
        this.snapshot = snapshot;
        this.fetchedAt = Date.now();
      }
    } finally {
      this.loading = false;
      this.updateButton();
      this.renderPanel();
    }
  }

  private readonly handleButtonClick = (): void => {
    // ClickPopover's own handler runs first and flips aria-expanded.
    if (this.buttonEl.getAttribute('aria-expanded') === 'true') {
      void this.refresh(false);
    }
  };

  private updateButton(): void {
    // Same tooltip path as the other nav-row buttons (aria-label + 300ms
    // delay); only the click behavior (popover) differs.
    setButtonTooltip(this.buttonEl, t('credits.trigger'));
  }

  private renderPanel(): void {
    this.panelEl.empty();

    const header = this.panelEl.createDiv({ cls: 'qoderian-credits-header' });
    header.createSpan({ cls: 'qoderian-credits-title', text: t('credits.title') });
    const actions = header.createDiv({ cls: 'qoderian-credits-header-actions' });
    actions.createEl('a', {
      cls: 'qoderian-credits-details-link',
      text: t('credits.viewDetails'),
      attr: { href: getQoderAccountUsageUrl() },
    });
    this.refreshBtnEl = actions.createDiv({ cls: 'qoderian-credits-refresh' });
    setIcon(this.refreshBtnEl, 'refresh-cw');
    this.refreshBtnEl.setAttribute('role', 'button');
    this.refreshBtnEl.setAttribute('tabindex', '0');
    this.refreshBtnEl.setAttribute('aria-label', t('common.refresh'));
    if (this.loading) this.refreshBtnEl.addClass('qoderian-credits-refresh--spinning');
    this.refreshBtnEl.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.refresh(true);
    });

    if (!this.snapshot) {
      this.panelEl.createDiv({ cls: 'qoderian-credits-empty', text: t('credits.unavailable') });
      return;
    }

    if (this.snapshot.userQuota) {
      const tier = describeUserTier(this.snapshot.userType);
      this.renderQuotaSection(this.snapshot.userQuota, {
        title: t('credits.planCredits'),
        ...(tier ? { badge: tier.text, badgePlain: tier.plain } : {}),
        ...(typeof this.snapshot.expiresAt === 'number' && !isSentinelExpiry(this.snapshot.expiresAt)
          ? { trailing: t('credits.renewsOn', { date: formatRenewalDate(this.snapshot.expiresAt) }) }
          : {}),
      });
    }
    if (this.snapshot.addOnQuota && hasQuotaNumbers(this.snapshot.addOnQuota)) {
      this.renderQuotaSection(this.snapshot.addOnQuota, { title: t('credits.addOnCredits') });
    }
    const orgPackage = this.snapshot.orgResourcePackage;
    if (orgPackage?.available && hasQuotaNumbers(orgPackage)) {
      this.renderQuotaSection({
        total: orgPackage.cap,
        used: orgPackage.used,
        remaining: orgPackage.remaining,
        percentage: orgPackage.percentage,
      }, { title: t('credits.resourcePackage') });
    }
  }

  private renderQuotaSection(
    quota: CreditsUsageQuota,
    options: { title: string; badge?: string; badgePlain?: boolean; trailing?: string },
  ): void {
    const section = this.panelEl.createDiv({ cls: 'qoderian-credits-section' });

    const head = section.createDiv({ cls: 'qoderian-credits-section-head' });
    const titleWrap = head.createDiv({ cls: 'qoderian-credits-section-title-wrap' });
    titleWrap.createSpan({ cls: 'qoderian-credits-section-title', text: options.title });
    if (options.badge) {
      const badge = titleWrap.createSpan({ cls: 'qoderian-credits-badge', text: options.badge });
      if (options.badgePlain) badge.addClass('qoderian-credits-badge--plain');
    }
    if (options.trailing) {
      head.createSpan({ cls: 'qoderian-credits-trailing', text: options.trailing });
    }

    const percent = clampPercent(quota);
    const bar = section.createDiv({ cls: 'qoderian-credits-bar' });
    const fill = bar.createDiv({ cls: 'qoderian-credits-bar-fill' });
    fill.style.width = `${percent}%`;

    const numbers = section.createDiv({ cls: 'qoderian-credits-numbers' });
    const usageNums = numbers.createDiv({ cls: 'qoderian-credits-usage-nums' });
    usageNums.createSpan({ cls: 'qoderian-credits-used-num', text: formatCount(quota.used) });
    usageNums.createSpan({
      cls: 'qoderian-credits-total-num',
      text: ` / ${formatCount(quota.total)} `,
    });
    usageNums.createSpan({
      cls: 'qoderian-credits-used-percent',
      text: `(${t('credits.usedPercent', { percent })})`,
    });
    numbers.createSpan({
      cls: 'qoderian-credits-left',
      text: t('credits.left', { count: formatCount(quota.remaining) }),
    });
  }
}

function hasQuotaNumbers(quota: CreditsUsageQuota): boolean {
  return typeof quota.total === 'number' || typeof quota.used === 'number';
}

function clampPercent(quota: CreditsUsageQuota): number {
  const derived = typeof quota.total === 'number' && quota.total > 0
    ? ((quota.used ?? 0) / quota.total) * 100
    : 0;
  const percent = Math.round(quota.percentage ?? derived);
  return Math.min(100, Math.max(0, percent));
}
