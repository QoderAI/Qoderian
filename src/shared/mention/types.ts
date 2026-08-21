import type { TFile } from 'obsidian';

export interface FileMentionItem {
  type: 'file';
  name: string;
  path: string;
  file: TFile;
}

export interface FolderMentionItem {
  type: 'folder';
  name: string;
  path: string;
}

export interface ContextFileMentionItem {
  type: 'context-file';
  name: string;
  absolutePath: string;
  contextRoot: string;
  folderName: string;
}

export interface ContextFolderMentionItem {
  type: 'context-folder';
  name: string;
  contextRoot: string;
  folderName: string;
}

export interface ExtensionMentionItem {
  type: 'extension';
  key: string;
  displayText: string;
  description?: string;
  className?: string;
  nameClassName?: string;
  descriptionClassName?: string;
  replacement?: string;
  submenuSearchText?: string;
  renderIcon: (container: HTMLElement) => void;
  onSelect?: () => void;
}

export interface MentionExtensionResult {
  items: ExtensionMentionItem[];
  exclusive?: boolean;
}

export interface MentionExtensionProvider {
  getItems(searchText: string): MentionExtensionResult;
}

export type MentionItem =
  | FileMentionItem
  | FolderMentionItem
  | ContextFileMentionItem
  | ContextFolderMentionItem
  | ExtensionMentionItem;

/**
 * Kinds a reference chip can represent. Drives the chip icon and the click
 * behavior dispatched by `openReferenceChip`; extend this union (and the
 * action registry) to support new reference targets.
 */
export type ReferenceChipKind = 'file' | 'folder';

/** A reference token inserted into the input by selecting a mention item. */
export interface MentionInsertReference {
  /** Token text inserted into the input, including the leading `@`. */
  token: string;
  /** Path used for chip labels and open actions. */
  path: string;
  kind: ReferenceChipKind;
}
