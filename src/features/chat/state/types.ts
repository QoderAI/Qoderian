import type { EditorView } from '@codemirror/view';

import type { BrowserSelectionContext, CanvasSelectionContext } from '../../../core/context/types';
import type { EditorSelectionContext } from '../../../core/editor/editor-context';
import type { ChatRuntimeQueryOptions, ChatTurnRequest } from '../../../core/runtime/types';
import type {
  ChatMessage,
  ImageAttachment,
  SubagentInfo,
  ToolCallInfo,
  UsageInfo,
} from '../../../core/types';
import type { ThinkingBlockState } from '../rendering/thinking-block-renderer';
import type { WriteEditState } from '../rendering/write-edit-renderer';

/** Queued message waiting to be sent after current streaming completes. */
export interface QueuedMessage {
  /** Stable id used for list rendering and per-item actions. */
  id: string;
  content: string;
  images?: ImageAttachment[];
  editorContext: EditorSelectionContext | null;
  browserContext?: BrowserSelectionContext | null;
  canvasContext: CanvasSelectionContext | null;
  /** Turn snapshot captured at enqueue time. */
  turnRequest?: ChatTurnRequest;
}

/** Pending tool call waiting to be rendered (buffered until input is complete). */
export interface PendingToolCall {
  toolCall: ToolCallInfo;
  parentEl: HTMLElement | null;
}

/** Stored selection state from editor polling. */
export interface StoredSelection {
  notePath: string;
  selectedText: string;
  lineCount: number;
  startLine?: number;
  from?: number;
  to?: number;
  editorView?: EditorView;
  domRanges?: Range[];
}

/** Centralized chat state data. */
export interface ChatStateData {
  // Message state
  messages: ChatMessage[];

  // Streaming control
  isStreaming: boolean;
  cancelRequested: boolean;
  streamGeneration: number;
  /** Guards against concurrent operations during conversation creation. */
  isCreatingConversation: boolean;
  /** Guards against concurrent operations during conversation switching. */
  isSwitchingConversation: boolean;
  /** Local tab state is ahead of persisted conversation metadata. */
  hasPendingConversationSave: boolean;

  // Conversation identity
  currentConversationId: string | null;

  // Queued messages (FIFO; drained one per completed turn)
  queuedMessages: QueuedMessage[];
  /** Queue auto-drain suspended after the user interrupted a turn. */
  queuePaused: boolean;

  // Active streaming DOM state
  currentContentEl: HTMLElement | null;
  currentTextEl: HTMLElement | null;
  currentTextContent: string;
  currentThinkingState: ThinkingBlockState | null;
  thinkingEl: HTMLElement | null;
  queueIndicatorEl: HTMLElement | null;
  /** Debounce timeout for showing thinking indicator after inactivity. */
  thinkingIndicatorTimeout: number | null;

  // Tool tracking maps
  toolCallElements: Map<string, HTMLElement>;
  writeEditStates: Map<string, WriteEditState>;
  /** Pending tool calls buffered until input is complete (for non-streaming-style render). */
  pendingTools: Map<string, PendingToolCall>;

  // Context window usage
  usage: UsageInfo | null;
  // Flag to ignore usage updates (during session reset)
  ignoreUsageUpdates: boolean;

  // Attention state (approval pending, error, etc.)
  needsAttention: boolean;

  // Auto-scroll control during streaming
  autoScrollEnabled: boolean;

  // Response timer state
  responseStartTime: number | null;
  flavorTimerInterval: number | null;

  // Pending plan content for approve-new-session (auto-sends in new session after stream ends)
  pendingNewSessionPlan: string | null;

  // Plan file path captured from writes to Qoder's plan directory.
  planFilePath: string | null;

}

/** Callbacks for ChatState changes. */
export interface ChatStateCallbacks {
  onMessagesChanged?: () => void;
  onStreamingStateChanged?: (isStreaming: boolean) => void;
  onConversationChanged?: (id: string | null) => void;
  onUsageChanged?: (usage: UsageInfo | null) => void;
  onAttentionChanged?: (needsAttention: boolean) => void;
  onAutoScrollChanged?: (enabled: boolean) => void;
}

/** Options for query execution. */
export type QueryOptions = ChatRuntimeQueryOptions;

// Re-export types that are used across the chat feature
export type {
  ChatMessage,
  EditorSelectionContext,
  ImageAttachment,
  SubagentInfo,
  ThinkingBlockState,
  ToolCallInfo,
  UsageInfo,
  WriteEditState,
};
