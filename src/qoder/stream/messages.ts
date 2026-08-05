import type { SDKUserMessage } from '@qoder-ai/qoder-agent-sdk';

export type { SDKMessage } from '@qoder-ai/qoder-agent-sdk';

export type BlockedUserMessage = SDKUserMessage & {
  _blocked: true;
  _blockReason: string;
};

export function isBlockedMessage(message: { type: string }): message is BlockedUserMessage {
  return (
    message.type === 'user' &&
    '_blocked' in message &&
    (message as Record<string, unknown>)._blocked === true &&
    '_blockReason' in message
  );
}
