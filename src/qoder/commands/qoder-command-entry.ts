import type { SlashCommandSource } from '../../core/types/settings';

export type QoderCommandKind = 'command' | 'skill';
export type QoderCommandScope = 'builtin' | 'vault' | 'user' | 'system' | 'runtime';

export interface QoderCommandEntry {
  id: string;
  kind: QoderCommandKind;
  name: string;
  description?: string;
  content: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  context?: 'fork';
  agent?: string;
  hooks?: Record<string, unknown>;
  scope: QoderCommandScope;
  source: SlashCommandSource;
  isEditable: boolean;
  isDeletable: boolean;
  displayPrefix: string;
  insertPrefix: string;
  /**
   * Opaque Qoder persistence token used to preserve storage location across
   * edits, renames, and deletes in settings UIs.
   */
  persistenceKey?: string;
}
