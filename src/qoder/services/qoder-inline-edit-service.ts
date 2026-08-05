import type { HookCallbackMatcher } from '@qoder-ai/qoder-agent-sdk';

import type {
  InlineEditRequest,
  InlineEditResult,
} from '../../core/types/services';
import { appendContextFiles } from '../prompt/context/prompt-context';
import {
  buildInlineEditPrompt,
  getInlineEditSystemPrompt,
  parseInlineEditResponse,
} from '../prompt/inline-edit';
import type { QoderHostContext } from '../qoder-host-context';
import { runColdStartQuery } from '../runtime/qoder-cold-start-query';
import {
  isReadOnlyTool,
  READ_ONLY_TOOLS,
} from '../tools/tool-names';

export type { InlineEditRequest };

export function createReadOnlyHook(): HookCallbackMatcher {
  return {
    hooks: [
      async (hookInput) => {
        const input = hookInput as {
          tool_name: string;
          tool_input: Record<string, unknown>;
        };
        const toolName = input.tool_name;

        if (isReadOnlyTool(toolName)) {
          return { continue: true };
        }

        return {
          continue: false,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse' as const,
            permissionDecision: 'deny' as const,
            permissionDecisionReason: `Inline edit mode: tool "${toolName}" is not allowed (read-only)`,
          },
        };
      },
    ],
  };
}

export class QoderInlineEditService {
  private plugin: QoderHostContext;
  private abortController: AbortController | null = null;
  private sessionId: string | null = null;

  constructor(plugin: QoderHostContext) {
    this.plugin = plugin;
  }

  private getScopedSettings(): Record<string, unknown> {
    return this.plugin.settings;
  }

  resetConversation(): void {
    this.sessionId = null;
  }

  async editText(request: InlineEditRequest): Promise<InlineEditResult> {
    this.sessionId = null;
    const prompt = buildInlineEditPrompt(request);
    return this.sendMessage(prompt);
  }

  async continueConversation(message: string, contextFiles?: string[]): Promise<InlineEditResult> {
    if (!this.sessionId) {
      return { success: false, error: 'No active conversation to continue' };
    }
    let prompt = message;
    if (contextFiles && contextFiles.length > 0) {
      prompt = appendContextFiles(message, contextFiles);
    }
    return this.sendMessage(prompt);
  }

  private async sendMessage(prompt: string): Promise<InlineEditResult> {
    const settings = this.getScopedSettings();

    this.abortController = new AbortController();

    const hooks = {
      PreToolUse: [createReadOnlyHook()],
    };

    try {
      const result = await runColdStartQuery({
        plugin: this.plugin,
        systemPrompt: getInlineEditSystemPrompt(),
        tools: [...READ_ONLY_TOOLS],
        hooks,
        resumeSessionId: this.sessionId ?? undefined,
        abortController: this.abortController,
        settings,
      }, prompt);

      this.sessionId = result.sessionId;
      return parseInlineEditResponse(result.text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg };
    } finally {
      this.abortController = null;
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}
