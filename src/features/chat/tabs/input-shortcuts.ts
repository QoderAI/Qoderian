import { Platform } from 'obsidian';

import type { QoderianSettings } from '../../../core/types';
import type { TabData } from './types';

function isEnterWithoutShiftOrComposition(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing;
}

function hasPlatformSendModifier(event: KeyboardEvent): boolean {
  if (Platform.isMacOS) {
    return event.metaKey === true && !event.ctrlKey && !event.altKey;
  }

  return event.ctrlKey === true && !event.metaKey && !event.altKey;
}

function shouldSendFromExplicitShortcut(event: KeyboardEvent): boolean {
  return isEnterWithoutShiftOrComposition(event) && hasPlatformSendModifier(event);
}

function shouldSendFromEnterKey(
  event: KeyboardEvent,
  settings: Pick<QoderianSettings, 'requireCommandOrControlEnterToSend'>,
): boolean {
  if (!isEnterWithoutShiftOrComposition(event)) return false;
  return settings.requireCommandOrControlEnterToSend === true
    ? hasPlatformSendModifier(event)
    : true;
}

function sendTabInputMessage(
  tab: TabData,
  event: KeyboardEvent,
  options?: { requireInputFocus?: boolean },
): boolean {
  if (options?.requireInputFocus
    && tab.dom.inputEl.ownerDocument.activeElement !== tab.dom.inputEl) {
    return false;
  }

  const inputController = tab.controllers.inputController;
  if (!inputController) return false;

  event.preventDefault();
  void inputController.sendMessage();
  return true;
}

export function sendTabInputMessageFromExplicitEnterShortcut(
  tab: TabData,
  event: KeyboardEvent,
  options?: { requireInputFocus?: boolean },
): boolean {
  if (!shouldSendFromExplicitShortcut(event)) return false;
  return sendTabInputMessage(tab, event, options);
}

export function sendTabInputMessageFromEnterKey(
  tab: TabData,
  settings: Pick<QoderianSettings, 'requireCommandOrControlEnterToSend'>,
  event: KeyboardEvent,
): boolean {
  if (!shouldSendFromEnterKey(event, settings)) return false;
  return sendTabInputMessage(tab, event);
}
