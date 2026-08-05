import { Notice } from 'obsidian';

import type {
  ApprovalCallbackOptions,
  ApprovalDecisionOption,
} from '../../../core/runtime/types';
import type { ApprovalDecision, ExitPlanModeDecision } from '../../../core/types';
import { QODER_PLAN_PATH_PREFIX } from '../../../qoder/config/paths';
import { type InlineAskQuestionConfig, InlineAskUserQuestion } from '../rendering/inline-ask-user-question';
import { InlineExitPlanMode } from '../rendering/inline-exit-plan-mode';
import { InlinePlanApproval, type PlanApprovalDecision } from '../rendering/inline-plan-approval';
import type { MessageRenderer } from '../rendering/message-renderer';
import { setToolIcon } from '../rendering/tool-call-renderer';
import type { ChatState } from '../state/chat-state';
import type { StreamController } from './stream-controller';

const APPROVAL_OPTION_MAP: Record<string, ApprovalDecision> = {
  Deny: 'deny',
  'Allow once': 'allow',
  'Always allow': 'allow-always',
};

const DEFAULT_APPROVAL_DECISION_OPTIONS: ApprovalDecisionOption[] =
  Object.entries(APPROVAL_OPTION_MAP).map(([label, decision]) => ({
    label,
    value: label,
    decision,
  }));

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export interface ApprovalFlowControllerDeps {
  state: ChatState;
  renderer: MessageRenderer;
  streamController: StreamController;
  getInputContainerEl: () => HTMLElement;
}

/** Owns all inline permission, question, and plan-approval UI lifecycles. */
export class ApprovalFlowController {
  private pendingApprovalInline: InlineAskUserQuestion | null = null;
  private pendingAskInline: InlineAskUserQuestion | null = null;
  private pendingExitPlanModeInline: InlineExitPlanMode | null = null;
  private pendingPlanApproval: InlinePlanApproval | null = null;
  private pendingPlanApprovalInvalidated = false;
  private inputContainerHideDepth = 0;

  constructor(private readonly deps: ApprovalFlowControllerDeps) {}

  async requestToolApproval(
    toolName: string,
    description: string,
    approvalOptions?: ApprovalCallbackOptions,
  ): Promise<ApprovalDecision> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) throw new Error('Input container is detached from DOM');

    const headerEl = parentEl.createDiv({ cls: 'qoderian-ask-approval-info' });
    headerEl.remove();
    const toolEl = headerEl.createDiv({ cls: 'qoderian-ask-approval-tool' });
    const iconEl = toolEl.createSpan({ cls: 'qoderian-ask-approval-icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setToolIcon(iconEl, toolName);
    toolEl.createSpan({ text: toolName, cls: 'qoderian-ask-approval-tool-name' });

    if (approvalOptions?.decisionReason) {
      headerEl.createDiv({
        text: approvalOptions.decisionReason,
        cls: 'qoderian-ask-approval-reason',
      });
    }
    if (approvalOptions?.blockedPath) {
      headerEl.createDiv({
        text: approvalOptions.blockedPath,
        cls: 'qoderian-ask-approval-blocked-path',
      });
    }
    if (approvalOptions?.agentID) {
      headerEl.createDiv({
        text: `Agent: ${approvalOptions.agentID}`,
        cls: 'qoderian-ask-approval-agent',
      });
    }
    headerEl.createDiv({ text: description, cls: 'qoderian-ask-approval-desc' });

    const decisionOptions = approvalOptions?.decisionOptions ?? DEFAULT_APPROVAL_DECISION_OPTIONS;
    const optionDecisionMap = new Map<string, ApprovalDecision>();
    const questionOptions = decisionOptions.map((option, index) => {
      const value = option.value || `approval-option-${index}`;
      if (option.decision) optionDecisionMap.set(value, option.decision);
      return {
        label: option.label,
        description: option.description ?? '',
        value,
      };
    });

    const result = await this.showInlineQuestion(
      parentEl,
      inputContainerEl,
      {
        questions: [{
          question: 'Allow this action?',
          options: questionOptions,
          isOther: false,
          isSecret: false,
        }],
      },
      inline => { this.pendingApprovalInline = inline; },
      undefined,
      {
        title: 'Permission required',
        headerEl,
        showCustomInput: false,
        immediateSelect: true,
      },
    );

    if (!result) return 'cancel';
    const selected = Object.values(result)[0];
    const selectedValue = Array.isArray(selected) ? selected[0] : selected;
    if (typeof selectedValue !== 'string') {
      new Notice(`Unexpected approval selection: "${String(selectedValue)}"`);
      return 'cancel';
    }
    return optionDecisionMap.get(selectedValue) ?? {
      type: 'select-option',
      value: selectedValue,
    };
  }

  askUser(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, string | string[]> | null> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) throw new Error('Input container is detached from DOM');
    return this.showInlineQuestion(
      parentEl,
      inputContainerEl,
      input,
      inline => { this.pendingAskInline = inline; },
      signal,
    );
  }

  exitPlanMode(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ExitPlanModeDecision | null> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) throw new Error('Input container is detached from DOM');

    this.deps.streamController.hideThinkingIndicator();
    this.hideInputContainer(inputContainerEl);
    const enrichedInput = this.deps.state.planFilePath
      ? { ...input, planFilePath: this.deps.state.planFilePath }
      : input;

    return new Promise<ExitPlanModeDecision | null>((resolve, reject) => {
      const inline = new InlineExitPlanMode(
        parentEl,
        enrichedInput,
        (decision) => {
          this.pendingExitPlanModeInline = null;
          this.restoreInputContainer(inputContainerEl);
          resolve(decision);
        },
        signal,
        (element, markdown) => this.deps.renderer.renderContent(element, markdown),
        QODER_PLAN_PATH_PREFIX,
      );
      this.pendingExitPlanModeInline = inline;
      try {
        inline.render();
      } catch (error) {
        this.pendingExitPlanModeInline = null;
        this.restoreInputContainer(inputContainerEl);
        reject(toError(error));
      }
    });
  }

  showPlanApproval(): Promise<{ decision: PlanApprovalDecision | null; invalidated: boolean }> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) return Promise.resolve({ decision: null, invalidated: false });

    this.hideInputContainer(inputContainerEl);
    this.pendingPlanApprovalInvalidated = false;
    return new Promise((resolve, reject) => {
      const inline = new InlinePlanApproval(parentEl, (decision) => {
        const invalidated = this.pendingPlanApprovalInvalidated;
        this.pendingPlanApprovalInvalidated = false;
        this.pendingPlanApproval = null;
        this.restoreInputContainer(inputContainerEl);
        resolve({ decision, invalidated });
      });
      this.pendingPlanApproval = inline;
      try {
        inline.render();
      } catch (error) {
        this.pendingPlanApproval = null;
        this.pendingPlanApprovalInvalidated = false;
        this.restoreInputContainer(inputContainerEl);
        reject(toError(error));
      }
    });
  }

  dismissApprovalPrompt(): void {
    this.pendingApprovalInline?.destroy();
    this.pendingApprovalInline = null;
  }

  dismissAll(): void {
    this.dismissApprovalPrompt();
    this.pendingAskInline?.destroy();
    this.pendingAskInline = null;
    this.pendingExitPlanModeInline?.destroy();
    this.pendingExitPlanModeInline = null;
    this.dismissPlanApproval(true);
    this.resetInputContainerVisibility();
  }

  private showInlineQuestion(
    parentEl: HTMLElement,
    inputContainerEl: HTMLElement,
    input: Record<string, unknown>,
    setPending: (inline: InlineAskUserQuestion | null) => void,
    signal?: AbortSignal,
    config?: InlineAskQuestionConfig,
  ): Promise<Record<string, string | string[]> | null> {
    this.deps.streamController.hideThinkingIndicator();
    this.hideInputContainer(inputContainerEl);
    return new Promise((resolve, reject) => {
      const inline = new InlineAskUserQuestion(
        parentEl,
        input,
        (result) => {
          setPending(null);
          this.restoreInputContainer(inputContainerEl);
          resolve(result);
        },
        signal,
        config,
      );
      setPending(inline);
      try {
        inline.render();
      } catch (error) {
        setPending(null);
        this.restoreInputContainer(inputContainerEl);
        reject(toError(error));
      }
    });
  }

  private dismissPlanApproval(invalidated: boolean): void {
    if (!this.pendingPlanApproval) return;
    if (invalidated) this.pendingPlanApprovalInvalidated = true;
    this.pendingPlanApproval.destroy();
    this.pendingPlanApproval = null;
  }

  private hideInputContainer(inputContainerEl: HTMLElement): void {
    this.inputContainerHideDepth++;
    inputContainerEl.addClass('qoderian-hidden');
  }

  private restoreInputContainer(inputContainerEl: HTMLElement): void {
    if (this.inputContainerHideDepth <= 0) return;
    this.inputContainerHideDepth--;
    if (this.inputContainerHideDepth === 0) inputContainerEl.removeClass('qoderian-hidden');
  }

  private resetInputContainerVisibility(): void {
    if (this.inputContainerHideDepth <= 0) return;
    this.inputContainerHideDepth = 0;
    this.deps.getInputContainerEl().removeClass('qoderian-hidden');
  }
}
