import { t } from '../../../i18n/i18n';
import type QoderianPlugin from '../../../main';
import { cleanupThinkingBlock } from '../rendering/thinking-block-renderer';
import type { TabData } from './types';

export function activateTab(tab: TabData): void {
  tab.dom.contentEl.removeClass('qoderian-hidden');
  tab.controllers.selectionController?.start();
  tab.controllers.browserSelectionController?.start();
  tab.controllers.canvasSelectionController?.start();
  tab.ui.navigationSidebar?.updateVisibility();
}

export function deactivateTab(tab: TabData): void {
  tab.dom.contentEl.addClass('qoderian-hidden');
  tab.controllers.selectionController?.stop();
  tab.controllers.browserSelectionController?.stop();
  tab.controllers.canvasSelectionController?.stop();
}

/** Releases controller, UI, runtime, and DOM resources in dependency order. */
export async function destroyTab(tab: TabData): Promise<void> {
  tab.lifecycleState = 'closing';

  tab.controllers.selectionController?.stop();
  tab.controllers.selectionController?.clear();
  tab.controllers.browserSelectionController?.stop();
  tab.controllers.browserSelectionController?.clear();
  tab.controllers.canvasSelectionController?.stop();
  tab.controllers.canvasSelectionController?.clear();
  tab.controllers.navigationController?.dispose();
  tab.controllers.contextRowOverflow?.destroy();
  tab.controllers.contextRowOverflow = null;

  cleanupThinkingBlock(tab.state.currentThinkingState);
  tab.state.currentThinkingState = null;
  tab.controllers.inputController?.dismissPendingApproval();
  tab.controllers.inputController?.destroyResumeDropdown();

  tab.ui.fileContextManager?.destroy();
  tab.ui.modelSelector?.destroy();
  tab.ui.modelSelector = null;
  tab.ui.slashCommandDropdown?.destroy();
  tab.ui.slashCommandDropdown = null;
  tab.ui.instructionModeManager?.destroy();
  tab.ui.instructionModeManager = null;
  tab.ui.bangBashModeManager?.destroy();
  tab.ui.bangBashModeManager = null;
  tab.ui.statusPanel?.destroy();
  tab.ui.statusPanel = null;
  tab.ui.navigationSidebar?.destroy();
  tab.ui.navigationSidebar = null;

  tab.services.instructionRefineService?.cancel();
  tab.services.instructionRefineService?.resetConversation();
  tab.services.instructionRefineService = null;
  tab.services.titleGenerationService?.cancel();
  tab.services.titleGenerationService = null;
  tab.services.subagentManager.orphanAllActive();
  tab.services.subagentManager.clear();

  for (const cleanup of tab.dom.eventCleanups) cleanup();
  tab.dom.eventCleanups.length = 0;

  await tab.service?.cleanup();
  tab.service = null;
  tab.dom.contentEl.remove();
}

export function getTabTitle(tab: TabData, plugin: QoderianPlugin): string {
  if (tab.conversationId) {
    const conversation = plugin.getConversationSync(tab.conversationId);
    if (conversation?.title) return conversation.title;
  }
  return t('nav.newChat');
}
