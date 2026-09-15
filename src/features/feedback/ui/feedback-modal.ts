import { type App, Modal, Notice } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { QoderHostContext } from '../../../qoder/qoder-host-context';
import {
  countFeedbackChars,
  FEEDBACK_CONTENT_LIMIT,
  submitUserFeedback,
  type UserFeedbackOutcome,
} from '../../../qoder/services/submit-user-feedback';

export interface FeedbackModalContext {
  plugin: QoderHostContext;
  /** Active chat session, attached so the team can correlate the report. */
  sessionId?: string;
  /** Plugin version reported as `--caller-version`. */
  callerVersion?: string;
  /** Starts the existing device-flow sign-in; shown when a rejection may be auth-related. */
  onRequestSignIn?: () => void;
}

type FeedbackFailure = Extract<UserFeedbackOutcome, { ok: false }>;
type FeedbackSuccess = Extract<UserFeedbackOutcome, { ok: true }>;

export function openFeedbackModal(
  app: App,
  context: FeedbackModalContext,
): Promise<UserFeedbackOutcome | null> {
  return new Promise(resolve => {
    new FeedbackModal(app, context, resolve).open();
  });
}

/**
 * qodercli reports a missing session in prose rather than as a status code, so
 * the sign-in affordance keys off its wording. Anything else — an unsupported
 * flag, a network failure — is shown verbatim without suggesting a re-login.
 */
const AUTH_FAILURE_HINT = /log ?in|logged in|unauthor|unauthenticat|credential/i;

function isAuthFailure(detail: string | undefined): boolean {
  return !!detail && AUTH_FAILURE_HINT.test(detail);
}

function describeFailure(failure: FeedbackFailure): string {
  switch (failure.reason) {
    case 'cliUnavailable':
      return t('feedback.errorCliUnavailable');
    case 'emptyContent':
      return t('feedback.errorEmpty');
    case 'contentTooLong':
      return t('feedback.errorTooLong', { limit: FEEDBACK_CONTENT_LIMIT });
    case 'rejected':
      return failure.detail?.trim() || t('feedback.errorRejected');
  }
}

class FeedbackModal extends Modal {
  private readonly context: FeedbackModalContext;
  private readonly resolveOutcome: (outcome: UserFeedbackOutcome | null) => void;
  private resolved = false;
  private closed = false;
  private submitting = false;
  private includeDiagnostics = true;

  constructor(
    app: App,
    context: FeedbackModalContext,
    resolve: (outcome: UserFeedbackOutcome | null) => void,
  ) {
    super(app);
    this.context = context;
    this.resolveOutcome = resolve;
  }

  onOpen(): void {
    this.setTitle(t('feedback.title'));
    this.modalEl.addClass('qoderian-feedback-modal');

    const cliAvailable = this.context.plugin.getResolvedQoderCliPath() !== null;

    if (!cliAvailable) {
      this.contentEl.createDiv({
        cls: 'qoderian-feedback-banner',
        text: t('feedback.errorCliUnavailable'),
      });
    }

    const textarea = this.contentEl.createEl('textarea', {
      cls: 'qoderian-feedback-textarea',
      attr: { rows: '6', placeholder: t('feedback.placeholder') },
    });

    const counter = this.contentEl.createDiv({ cls: 'qoderian-feedback-counter' });

    const emailField = this.contentEl.createDiv({ cls: 'qoderian-feedback-field' });
    emailField.createEl('label', {
      cls: 'qoderian-feedback-label',
      text: t('feedback.emailLabel'),
    });
    const email = emailField.createEl('input', {
      cls: 'qoderian-feedback-input',
      attr: { type: 'email', placeholder: t('feedback.emailPlaceholder') },
    });
    emailField.createDiv({ cls: 'qoderian-feedback-hint', text: t('feedback.emailHint') });

    const diagnostics = this.contentEl.createDiv({ cls: 'qoderian-feedback-diagnostics' });
    const diagnosticsToggle = diagnostics.createEl('input', {
      cls: 'qoderian-feedback-checkbox',
      attr: { type: 'checkbox' },
    });
    diagnosticsToggle.checked = this.includeDiagnostics;
    const diagnosticsText = diagnostics.createDiv({ cls: 'qoderian-feedback-diagnostics-text' });
    diagnosticsText.createDiv({
      cls: 'qoderian-feedback-label',
      text: t('feedback.diagnosticsLabel'),
    });
    diagnosticsText.createDiv({
      cls: 'qoderian-feedback-hint',
      text: t('feedback.diagnosticsDesc'),
    });

    if (this.context.sessionId) {
      this.contentEl.createDiv({
        cls: 'qoderian-feedback-session',
        text: t('feedback.sessionHint', { sessionId: this.context.sessionId.slice(0, 8) }),
      });
    }

    const error = this.contentEl.createDiv({ cls: 'qoderian-feedback-error qoderian-hidden' });

    const actions = this.contentEl.createDiv({ cls: 'qoderian-feedback-actions' });
    const cancelButton = actions.createEl('button', {
      cls: 'qoderian-feedback-button',
      text: t('common.cancel'),
    });
    const submitButton = actions.createEl('button', {
      cls: 'qoderian-feedback-button qoderian-feedback-button--primary',
      text: t('feedback.submit'),
    });

    const hideError = (): void => {
      error.empty();
      error.addClass('qoderian-hidden');
    };

    const refresh = (): void => {
      const count = countFeedbackChars(textarea.value ?? '');
      counter.setText(`${count} / ${FEEDBACK_CONTENT_LIMIT}`);
      if (count > FEEDBACK_CONTENT_LIMIT) {
        counter.addClass('qoderian-feedback-counter--over');
      } else {
        counter.removeClass('qoderian-feedback-counter--over');
      }

      // Over-limit input is rejected rather than silently truncated, so the
      // user never believes a shortened version was submitted.
      const submittable =
        cliAvailable && !this.submitting && count > 0 && count <= FEEDBACK_CONTENT_LIMIT;
      submitButton.disabled = !submittable;
    };

    const setBusy = (busy: boolean): void => {
      this.submitting = busy;
      submitButton.setText(busy ? t('feedback.submitting') : t('feedback.submit'));
      cancelButton.disabled = busy;
      textarea.disabled = busy;
      email.disabled = busy;
      diagnosticsToggle.disabled = busy;
      refresh();
    };

    const showError = (message: string, signIn: (() => void) | null): void => {
      error.empty();
      error.createDiv({ cls: 'qoderian-feedback-error-message', text: message });
      if (signIn) {
        const signInButton = error.createEl('button', {
          cls: 'qoderian-feedback-signin',
          text: t('feedback.signIn'),
        });
        signInButton.addEventListener('click', () => {
          signIn();
          this.close();
        });
      }
      error.removeClass('qoderian-hidden');
    };

    const submit = async (): Promise<void> => {
      if (this.submitting || !cliAvailable) return;
      hideError();
      setBusy(true);

      const outcome = await submitUserFeedback(this.context.plugin, {
        content: textarea.value ?? '',
        email: email.value ?? '',
        sessionId: this.context.sessionId,
        callerVersion: this.context.callerVersion,
        includeWorkspaceDiagnostics: this.includeDiagnostics,
      });

      if (outcome.ok) {
        this.resolved = true;
        this.resolveOutcome(outcome);
        this.close();
        await this.announceSuccess(outcome);
        return;
      }

      // `submitFeedback` cannot be aborted, so the modal may already be gone by
      // the time it settles. Report through a Notice rather than detached DOM.
      if (this.closed) {
        new Notice(t('feedback.noticeFailed'));
        return;
      }

      setBusy(false);
      const onRequestSignIn = this.context.onRequestSignIn;
      // A blank email plus auth wording is the only case where signing in is the
      // fix: qodercli requires an address when no session exists.
      const offerSignIn =
        onRequestSignIn && !(email.value ?? '').trim() && isAuthFailure(outcome.detail)
          ? onRequestSignIn
          : null;
      showError(describeFailure(outcome), offerSignIn);
    };

    textarea.addEventListener('input', () => {
      hideError();
      refresh();
    });
    email.addEventListener('input', hideError);
    diagnosticsToggle.addEventListener('change', () => {
      this.includeDiagnostics = diagnosticsToggle.checked;
    });
    cancelButton.addEventListener('click', () => this.close());
    submitButton.addEventListener('click', () => {
      void submit();
    });

    refresh();
    textarea.focus();
  }

  /**
   * Copies the server request id so the user can quote it in a follow-up. When
   * no clipboard API is available the id is still spelled out in the notice.
   */
  private async announceSuccess(outcome: FeedbackSuccess): Promise<void> {
    const requestId = outcome.requestId;
    if (!requestId) {
      new Notice(t('feedback.noticeSuccess'));
      return;
    }
    try {
      await navigator.clipboard.writeText(requestId);
      new Notice(t('feedback.noticeSuccessCopied', { requestId }));
    } catch {
      new Notice(t('feedback.noticeSuccessWithId', { requestId }));
    }
  }

  onClose(): void {
    this.closed = true;
    if (!this.resolved) {
      this.resolved = true;
      this.resolveOutcome(null);
    }
    this.contentEl.empty();
  }
}
