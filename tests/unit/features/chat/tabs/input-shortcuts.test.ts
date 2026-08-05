import { Platform } from 'obsidian';

import {
  sendTabInputMessageFromEnterKey,
  sendTabInputMessageFromExplicitEnterShortcut,
} from '@/features/chat/tabs/input-shortcuts';

function createHarness() {
  const sendMessage = jest.fn().mockResolvedValue(undefined);
  const inputEl = { ownerDocument: { activeElement: null } };
  const tab = {
    controllers: { inputController: { sendMessage } },
    dom: { inputEl },
  } as any;
  const event = (overrides: Partial<KeyboardEvent> = {}) => ({
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    preventDefault: jest.fn(),
    ...overrides,
  } as unknown as KeyboardEvent);
  return { event, inputEl, sendMessage, tab };
}

describe('tab input shortcuts', () => {
  const originalIsMacOS = Platform.isMacOS;

  afterAll(() => {
    Platform.isMacOS = originalIsMacOS;
  });

  it('uses Command+Enter on macOS and Control+Enter elsewhere', () => {
    const mac = createHarness();
    Platform.isMacOS = true;
    expect(sendTabInputMessageFromExplicitEnterShortcut(
      mac.tab,
      mac.event({ metaKey: true }),
    )).toBe(true);

    const other = createHarness();
    Platform.isMacOS = false;
    expect(sendTabInputMessageFromExplicitEnterShortcut(
      other.tab,
      other.event({ ctrlKey: true }),
    )).toBe(true);

    expect(mac.sendMessage).toHaveBeenCalledTimes(1);
    expect(other.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('honors the setting that requires the platform modifier', () => {
    Platform.isMacOS = false;
    const harness = createHarness();

    expect(sendTabInputMessageFromEnterKey(
      harness.tab,
      { requireCommandOrControlEnterToSend: true },
      harness.event(),
    )).toBe(false);
    expect(sendTabInputMessageFromEnterKey(
      harness.tab,
      { requireCommandOrControlEnterToSend: true },
      harness.event({ ctrlKey: true }),
    )).toBe(true);
  });

  it('does not send while composing text or when scoped input is unfocused', () => {
    const harness = createHarness();
    Platform.isMacOS = true;

    expect(sendTabInputMessageFromEnterKey(
      harness.tab,
      { requireCommandOrControlEnterToSend: false },
      harness.event({ isComposing: true }),
    )).toBe(false);
    expect(sendTabInputMessageFromExplicitEnterShortcut(
      harness.tab,
      harness.event({ metaKey: true }),
      { requireInputFocus: true },
    )).toBe(false);
    expect(harness.sendMessage).not.toHaveBeenCalled();
  });
});
