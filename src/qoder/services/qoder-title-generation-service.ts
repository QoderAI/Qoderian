import type {
  TitleGenerationCallback,
  TitleGenerationResult,
} from '../../core/types/services';
import { toQoderRuntimeModelId } from '../models/model-selection';
import { qoderModelConfig } from '../models/qoder-model-config';
import {
  buildTitleGenerationPrompt,
  getTitleGenerationSystemPrompt,
  parseTitleGenerationResponse,
} from '../prompt/title-generation';
import type { QoderHostContext } from '../qoder-host-context';
import { runColdStartQuery } from '../runtime/qoder-cold-start-query';

export type { TitleGenerationResult };

export class QoderTitleGenerationService {
  private plugin: QoderHostContext;
  private activeGenerations: Map<string, AbortController> = new Map();

  constructor(plugin: QoderHostContext) {
    this.plugin = plugin;
  }

  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback
  ): Promise<void> {
    // Cancel any existing generation for this conversation
    const existingController = this.activeGenerations.get(conversationId);
    if (existingController) {
      existingController.abort();
    }

    const abortController = new AbortController();
    this.activeGenerations.set(conversationId, abortController);

    const prompt = buildTitleGenerationPrompt(userMessage);

    try {
      const result = await runColdStartQuery({
        plugin: this.plugin,
        systemPrompt: getTitleGenerationSystemPrompt(),
        tools: [],
        model: this.resolveTitleModel(),
        thinking: { disabled: true },
        persistSession: false,
        abortController,
      }, prompt);

      const title = parseTitleGenerationResponse(result.text);
      if (title) {
        await this.safeCallback(callback, conversationId, { success: true, title });
      } else {
        await this.safeCallback(callback, conversationId, {
          success: false,
          error: 'Failed to parse title from response',
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      await this.safeCallback(callback, conversationId, { success: false, error: msg });
    } finally {
      this.activeGenerations.delete(conversationId);
    }
  }

  cancel(): void {
    for (const controller of this.activeGenerations.values()) {
      controller.abort();
    }
    this.activeGenerations.clear();
  }

  private resolveTitleModel(): string {
    const titleModel = this.plugin.settings.titleGenerationModel || 'auto';
    if (qoderModelConfig.isKnownModel(
      titleModel,
      this.plugin.settings,
    )) {
      return toQoderRuntimeModelId(titleModel);
    }

    return 'auto';
  }

  private async safeCallback(
    callback: TitleGenerationCallback,
    conversationId: string,
    result: TitleGenerationResult
  ): Promise<void> {
    try {
      await callback(conversationId, result);
    } catch {
      // Silently ignore callback errors
    }
  }
}
