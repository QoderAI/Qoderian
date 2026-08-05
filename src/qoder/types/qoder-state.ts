import type { QoderState } from '../../core/types/chat';

export function getQoderState(
  qoderState: QoderState | undefined,
): QoderState {
  return qoderState ?? {};
}
