import { Notice, setIcon } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import { filterValidContextPaths, findConflictingPath, isDuplicatePath, validateContextPath, validateDirectoryPath } from '../../../core/context/external-context';
import { expandHomePath, normalizePathForFilesystem } from '../../../core/fs/path';
import type {
  ContextUsageBreakdown,
  ContextUsageCategory,
  ContextUsageCategoryType,
  ManagedMcpServer,
  UsageInfo,
} from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type { TranslationKey } from '../../../i18n/types';
import type { McpServerManager } from '../../../qoder/mcp/mcp-server-manager';
import { appendCheckIcon, appendMcpIcon } from '../../../shared/icons';
import { ClickPopover } from './toolbar/click-popover';
import { placeHoverDropdown } from './toolbar/hover-dropdown-placement';
import {
  ModelSelector,
  PermissionToggle,
  type ToolbarCallbacks,
} from './toolbar/toolbar-selectors';

export {
  ModelSelector,
  PermissionToggle,
  type ToolbarCallbacks,
  type ToolbarSettings,
} from './toolbar/toolbar-selectors';

interface ElectronOpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface ElectronRemoteApi {
  dialog: {
    showOpenDialog(options: { properties: string[]; title: string }): Promise<ElectronOpenDialogResult>;
  };
}

export type AddExternalContextResult =
  | { success: true; normalizedPath: string }
  | { success: false; error: string };

/**
 * Keep an icon-hover dropdown inside the input toolbar: centered on its icon
 * when it fits, clamped otherwise. The chat container clips overflow, so an
 * unclamped dropdown lost its leading characters in narrow sidebars. Runs on
 * every open (and content change) so panel resizes are picked up.
 *
 * The values are published as CSS custom properties consumed by the
 * dropdown stylesheets (`--qoderian-hover-dropdown-left/-min-width/-max-width`).
 */
export function positionHoverDropdown(
  selectorEl: HTMLElement,
  iconEl: HTMLElement,
  dropdownEl: HTMLElement,
): void {
  const toolbarEl = selectorEl.closest<HTMLElement>('.qoderian-input-toolbar');
  // Layout-less DOM shims used in tests return a non-element from closest().
  if (!toolbarEl || typeof toolbarEl.getBoundingClientRect !== 'function') {
    return;
  }

  const toolbarRect = toolbarEl.getBoundingClientRect();
  const selectorRect = selectorEl.getBoundingClientRect();
  const iconRect = iconEl.getBoundingClientRect();

  // Measure the natural width: caps applied by an earlier pass would
  // otherwise masquerade as the content width and keep shrinking the cap.
  dropdownEl.setCssProps({
    '--qoderian-hover-dropdown-min-width': '',
    '--qoderian-hover-dropdown-max-width': '',
  });
  const dropdownWidth = dropdownEl.getBoundingClientRect().width;

  const placement = placeHoverDropdown(
    iconRect.left - toolbarRect.left + iconRect.width / 2,
    dropdownWidth,
    toolbarRect.width,
  );
  if (!placement) {
    return;
  }

  dropdownEl.setCssProps({
    '--qoderian-hover-dropdown-left': `${toolbarRect.left + placement.center - selectorRect.left}px`,
    '--qoderian-hover-dropdown-min-width': placement.maxWidth !== null ? '0' : '',
    '--qoderian-hover-dropdown-max-width': placement.maxWidth !== null ? `${placement.maxWidth}px` : '',
  });
}

export class ExternalContextSelector {
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  /**
   * Current external context paths. May contain:
   * - Persistent paths only (new sessions via clearExternalContexts)
   * - Restored session paths (loaded sessions via setExternalContexts)
   * - Mixed paths during active sessions
   */
  private externalContextPaths: string[] = [];
  /** Paths that persist across all sessions (stored in settings). */
  private persistentPaths: Set<string> = new Set();
  private onChangeCallback: ((paths: string[]) => void) | null = null;
  private onPersistenceChangeCallback: ((paths: string[]) => void) | null = null;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'qoderian-external-context-selector' });
    this.render();
  }

  setOnChange(callback: (paths: string[]) => void): void {
    this.onChangeCallback = callback;
  }

  setOnPersistenceChange(callback: (paths: string[]) => void): void {
    this.onPersistenceChangeCallback = callback;
  }

  getExternalContexts(): string[] {
    return [...this.externalContextPaths];
  }

  getPersistentPaths(): string[] {
    return [...this.persistentPaths];
  }

  setPersistentPaths(paths: string[]): void {
    // Validate paths - remove non-existent entries (directories or files)
    const validPaths = filterValidContextPaths(paths);
    const invalidPaths = paths.filter(p => !validPaths.includes(p));

    this.persistentPaths = new Set(validPaths);
    // Merge persistent paths into external context paths
    this.mergePersistentPaths();
    this.updateDisplay();
    this.renderDropdown();

    // If invalid paths were removed, notify user and save updated list
    if (invalidPaths.length > 0) {
      const pathNames = invalidPaths.map(p => this.shortenPath(p)).join(', ');
      new Notice(`Removed ${invalidPaths.length} invalid external context path(s): ${pathNames}`, 5000);
      this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    }
  }

  togglePersistence(path: string): void {
    if (this.persistentPaths.has(path)) {
      this.persistentPaths.delete(path);
    } else {
      // Validate the path still exists before persisting (file or directory).
      if (!validateContextPath(path).valid) {
        new Notice(`Cannot persist "${this.shortenPath(path)}" - path no longer exists`, 4000);
        return;
      }
      this.persistentPaths.add(path);
    }
    this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    this.renderDropdown();
  }

  private mergePersistentPaths(): void {
    const pathSet = new Set(this.externalContextPaths);
    for (const path of this.persistentPaths) {
      pathSet.add(path);
    }
    this.externalContextPaths = [...pathSet];
  }

  /**
   * Restore exact external context paths from a saved conversation.
   * Does NOT merge with persistent paths - preserves the session's historical state.
   * Use clearExternalContexts() for new sessions to start with current persistent paths.
   */
  setExternalContexts(paths: string[]): void {
    this.externalContextPaths = [...paths];
    this.updateDisplay();
    this.renderDropdown();
  }

  /**
   * Remove a path from external contexts (and persistent paths if applicable).
   * Exposed for testing the remove button behavior.
   */
  removePath(pathStr: string): void {
    this.externalContextPaths = this.externalContextPaths.filter(p => p !== pathStr);
    // Also remove from persistent paths if it was persistent
    if (this.persistentPaths.has(pathStr)) {
      this.persistentPaths.delete(pathStr);
      this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    }
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();
    this.renderDropdown();
  }

  /**
   * Add an external context path programmatically (e.g., from /add-dir command).
   * Validates the path and handles duplicates/conflicts.
   * @param pathInput - Path string (supports ~/ expansion)
   * @returns Result with success status and normalized path, or error message on failure
   */
  addExternalContext(
    pathInput: string,
    options: { allowFile?: boolean } = {},
  ): AddExternalContextResult {
    const trimmed = pathInput?.trim();
    if (!trimmed) {
      return { success: false, error: 'No path provided. Usage: /add-dir /absolute/path' };
    }

    // Strip surrounding quotes if present (e.g., "/path/with spaces")
    let cleanPath = trimmed;
    if ((cleanPath.startsWith('"') && cleanPath.endsWith('"')) ||
        (cleanPath.startsWith("'") && cleanPath.endsWith("'"))) {
      cleanPath = cleanPath.slice(1, -1);
    }

    // Expand home directory and normalize path
    const expandedPath = expandHomePath(cleanPath);
    const normalizedPath = normalizePathForFilesystem(expandedPath);

    if (!path.isAbsolute(normalizedPath)) {
      return { success: false, error: 'Path must be absolute. Usage: /add-dir /absolute/path' };
    }

    // Validate path exists; a single file is only accepted when explicitly allowed
    const validation: { valid: boolean; error?: string } = options.allowFile
      ? validateContextPath(normalizedPath)
      : validateDirectoryPath(normalizedPath);
    if (!validation.valid) {
      return { success: false, error: `${validation.error}: ${pathInput}` };
    }

    // Check for duplicate (normalized comparison for cross-platform support)
    if (isDuplicatePath(normalizedPath, this.externalContextPaths)) {
      return { success: false, error: 'This folder is already added as an external context.' };
    }

    // Check for nested/overlapping paths
    const conflict = findConflictingPath(normalizedPath, this.externalContextPaths);
    if (conflict) {
      return { success: false, error: this.formatConflictMessage(normalizedPath, conflict) };
    }

    // Add the path
    this.externalContextPaths = [...this.externalContextPaths, normalizedPath];
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();
    this.renderDropdown();

    return { success: true, normalizedPath };
  }

  /**
   * Clear session-only external context paths (call on new conversation).
   * Uses persistent paths from settings if provided, otherwise falls back to local cache.
   * Validates paths before using them (silently filters invalid during session init).
   */
  clearExternalContexts(persistentPathsFromSettings?: string[]): void {
    // Use settings value if provided (most up-to-date), otherwise use local cache
    if (persistentPathsFromSettings) {
      // Validate paths - silently filter during session initialization (not user action)
      const validPaths = filterValidContextPaths(persistentPathsFromSettings);
      this.persistentPaths = new Set(validPaths);
    }
    this.externalContextPaths = [...this.persistentPaths];
    this.updateDisplay();
    this.renderDropdown();
  }

  private render() {
    this.container.empty();

    const iconWrapper = this.container.createDiv({ cls: 'qoderian-external-context-icon-wrapper' });

    this.iconEl = iconWrapper.createDiv({ cls: 'qoderian-external-context-icon' });
    setIcon(this.iconEl, 'folder');

    this.badgeEl = iconWrapper.createDiv({ cls: 'qoderian-external-context-badge' });

    this.updateDisplay();

    // Click to open native folder picker
    iconWrapper.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.openFolderPicker();
    });

    this.dropdownEl = this.container.createDiv({ cls: 'qoderian-external-context-dropdown' });

    // CSS reveals the dropdown on hover; reposition before it becomes visible
    // so panel-width changes since the last render are picked up.
    this.container.addEventListener('mouseenter', () => {
      this.positionDropdown();
    });

    this.renderDropdown();
  }

  private positionDropdown(): void {
    if (!this.dropdownEl || !this.iconEl) return;
    positionHoverDropdown(this.container, this.iconEl, this.dropdownEl);
  }

  private async openFolderPicker() {
    try {
      // Access Electron's dialog through remote
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron remote is exposed only at runtime in Obsidian's renderer.
      const { remote } = require('electron') as { remote?: ElectronRemoteApi };
      if (!remote) {
        throw new Error('Electron remote API is unavailable');
      }
      const result = await remote.dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select External Context',
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];

        // Check for duplicate (normalized comparison for cross-platform support)
        if (isDuplicatePath(selectedPath, this.externalContextPaths)) {
          new Notice('This folder is already added as an external context.', 3000);
          return;
        }

        // Check for nested/overlapping paths
        const conflict = findConflictingPath(selectedPath, this.externalContextPaths);
        if (conflict) {
          new Notice(this.formatConflictMessage(selectedPath, conflict), 5000);
          return;
        }

        this.externalContextPaths = [...this.externalContextPaths, selectedPath];
        this.onChangeCallback?.(this.externalContextPaths);
        this.updateDisplay();
        this.renderDropdown();
      }
    } catch {
      new Notice('Unable to open folder picker.', 5000);
    }
  }

  /** Formats a conflict error message for display. */
  private formatConflictMessage(newPath: string, conflict: { path: string; type: 'parent' | 'child' }): string {
    const shortNew = this.shortenPath(newPath);
    const shortExisting = this.shortenPath(conflict.path);
    return conflict.type === 'parent'
      ? `Cannot add "${shortNew}" - it's inside existing path "${shortExisting}"`
      : `Cannot add "${shortNew}" - it contains existing path "${shortExisting}"`;
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;

    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'qoderian-external-context-header' });
    headerEl.setText('External contexts');

    // Path list
    const listEl = this.dropdownEl.createDiv({ cls: 'qoderian-external-context-list' });

    if (this.externalContextPaths.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'qoderian-external-context-empty' });
      emptyEl.setText('Click folder icon to add');
    } else {
      for (const pathStr of this.externalContextPaths) {
        const itemEl = listEl.createDiv({ cls: 'qoderian-external-context-item' });

        const pathTextEl = itemEl.createSpan({ cls: 'qoderian-external-context-text' });
        // Show shortened path for display
        const displayPath = this.shortenPath(pathStr);
        pathTextEl.setText(displayPath);
        pathTextEl.setAttribute('title', pathStr);

        // Lock toggle button
        const isPersistent = this.persistentPaths.has(pathStr);
        const lockBtn = itemEl.createSpan({ cls: 'qoderian-external-context-lock' });
        if (isPersistent) {
          lockBtn.addClass('locked');
        }
        setIcon(lockBtn, isPersistent ? 'lock' : 'unlock');
        lockBtn.setAttribute('title', isPersistent ? 'Persistent (click to make session-only)' : 'Session-only (click to persist)');
        lockBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.togglePersistence(pathStr);
        });

        const removeBtn = itemEl.createSpan({ cls: 'qoderian-external-context-remove' });
        setIcon(removeBtn, 'x');
        removeBtn.setAttribute('title', 'Remove path');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removePath(pathStr);
        });
      }
    }

    // Content changes can change the width, so re-clamp against the toolbar.
    this.positionDropdown();
  }

  /** Shorten path for display (replace home dir with ~) */
  private shortenPath(fullPath: string): string {
    try {
      const homeDir = os.homedir();
      const normalize = (value: string) => value.replace(/\\/g, '/');
      const normalizedFull = normalize(fullPath);
      const normalizedHome = normalize(homeDir);
      const compareFull = process.platform === 'win32'
        ? normalizedFull.toLowerCase()
        : normalizedFull;
      const compareHome = process.platform === 'win32'
        ? normalizedHome.toLowerCase()
        : normalizedHome;
      if (compareFull.startsWith(compareHome)) {
        // Use normalized path length and normalize the result for consistent display
        const remainder = normalizedFull.slice(normalizedHome.length);
        return '~' + remainder;
      }
    } catch {
      // Fall through to return full path
    }
    return fullPath;
  }

  updateDisplay() {
    if (!this.iconEl || !this.badgeEl) return;

    const count = this.externalContextPaths.length;

    if (count > 0) {
      this.iconEl.addClass('active');
      this.iconEl.setAttribute('title', `${count} external context${count > 1 ? 's' : ''} (click to add more)`);

      this.badgeEl.setText(String(count));
      this.badgeEl.addClass('visible');
    } else {
      this.iconEl.removeClass('active');
      this.iconEl.setAttribute('title', 'Add external contexts (click)');
      this.badgeEl.removeClass('visible');
    }
  }
}

export class McpServerSelector {
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private mcpManager: McpServerManager | null = null;
  private enabledServers: Set<string> = new Set();
  private onChangeCallback: ((enabled: Set<string>) => void) | null = null;
  private visible = true;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'qoderian-mcp-selector' });
    this.render();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) {
      this.container.addClass('qoderian-hidden');
    } else {
      this.updateDisplay();
    }
  }

  setMcpManager(manager: McpServerManager | null): void {
    this.mcpManager = manager;
    if (!manager && this.enabledServers.size > 0) {
      this.enabledServers.clear();
      this.onChangeCallback?.(this.enabledServers);
    }
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  setOnChange(callback: (enabled: Set<string>) => void): void {
    this.onChangeCallback = callback;
  }

  getEnabledServers(): Set<string> {
    return new Set(this.enabledServers);
  }

  addMentionedServers(names: Set<string>): void {
    let changed = false;
    for (const name of names) {
      if (!this.enabledServers.has(name)) {
        this.enabledServers.add(name);
        changed = true;
      }
    }
    if (changed) {
      this.updateDisplay();
      this.renderDropdown();
    }
  }

  clearEnabled(): void {
    this.enabledServers.clear();
    this.updateDisplay();
    this.renderDropdown();
  }

  setEnabledServers(names: string[]): void {
    this.enabledServers = new Set(names);
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  private pruneEnabledServers(): void {
    if (!this.mcpManager) return;
    const activeNames = new Set(this.mcpManager.getServers().filter((s) => s.enabled).map((s) => s.name));
    let changed = false;
    for (const name of this.enabledServers) {
      if (!activeNames.has(name)) {
        this.enabledServers.delete(name);
        changed = true;
      }
    }
    if (changed) {
      this.onChangeCallback?.(this.enabledServers);
    }
  }

  private render() {
    this.container.empty();

    const iconWrapper = this.container.createDiv({ cls: 'qoderian-mcp-selector-icon-wrapper' });

    this.iconEl = iconWrapper.createDiv({ cls: 'qoderian-mcp-selector-icon' });
    appendMcpIcon(this.iconEl);

    this.badgeEl = iconWrapper.createDiv({ cls: 'qoderian-mcp-selector-badge' });

    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'qoderian-mcp-selector-dropdown' });
    this.renderDropdown();

    // Re-render dropdown content on hover (CSS handles visibility)
    this.container.addEventListener('mouseenter', () => {
      this.renderDropdown();
    });
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;
    this.pruneEnabledServers();
    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'qoderian-mcp-selector-header' });
    headerEl.setText('Mcp servers');

    // Server list
    const listEl = this.dropdownEl.createDiv({ cls: 'qoderian-mcp-selector-list' });

    const allServers = this.mcpManager?.getServers() || [];
    const servers = allServers.filter(s => s.enabled);

    if (servers.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'qoderian-mcp-selector-empty' });
      emptyEl.setText(allServers.length === 0 ? 'No MCP servers configured' : 'All MCP servers disabled');
    } else {
      for (const server of servers) {
        this.renderServerItem(listEl, server);
      }
    }

    // Content changes can change the width, so re-clamp against the toolbar.
    this.positionDropdown();
  }

  private positionDropdown(): void {
    if (!this.dropdownEl || !this.iconEl) return;
    positionHoverDropdown(this.container, this.iconEl, this.dropdownEl);
  }

  private renderServerItem(listEl: HTMLElement, server: ManagedMcpServer) {
    const itemEl = listEl.createDiv({ cls: 'qoderian-mcp-selector-item' });
    itemEl.dataset.serverName = server.name;

    const isEnabled = this.enabledServers.has(server.name);
    if (isEnabled) {
      itemEl.addClass('enabled');
    }

    // Checkbox
    const checkEl = itemEl.createDiv({ cls: 'qoderian-mcp-selector-check' });
    if (isEnabled) {
      appendCheckIcon(checkEl);
    }

    // Info
    const infoEl = itemEl.createDiv({ cls: 'qoderian-mcp-selector-item-info' });

    const nameEl = infoEl.createSpan({ cls: 'qoderian-mcp-selector-item-name' });
    nameEl.setText(server.name);

    // Badges
    if (server.contextSaving) {
      const csEl = infoEl.createSpan({ cls: 'qoderian-mcp-selector-cs-badge' });
      csEl.setText('@');
      csEl.setAttribute('title', 'Context-saving: can also enable via @' + server.name);
    }

    // Click to toggle (use mousedown for more reliable capture)
    itemEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleServer(server.name, itemEl);
    });
  }

  private toggleServer(name: string, itemEl: HTMLElement) {
    if (this.enabledServers.has(name)) {
      this.enabledServers.delete(name);
    } else {
      this.enabledServers.add(name);
    }

    // Update item visually in-place (immediate feedback)
    const isEnabled = this.enabledServers.has(name);
    const checkEl = itemEl.querySelector<HTMLElement>('.qoderian-mcp-selector-check');

    if (isEnabled) {
      itemEl.addClass('enabled');
      if (checkEl) appendCheckIcon(checkEl);
    } else {
      itemEl.removeClass('enabled');
      if (checkEl) checkEl.empty();
    }

    this.updateDisplay();
    this.onChangeCallback?.(this.enabledServers);
  }

  updateDisplay() {
    this.pruneEnabledServers();
    if (!this.iconEl || !this.badgeEl) return;

    const count = this.enabledServers.size;
    const hasServers = (this.mcpManager?.getServers().length || 0) > 0;

    // Show/hide container based on whether there are servers and visibility
    if (!hasServers || !this.visible) {
      this.container.addClass('qoderian-hidden');
      return;
    }
    this.container.removeClass('qoderian-hidden');

    if (count > 0) {
      this.iconEl.addClass('active');
      this.iconEl.setAttribute('title', `${count} MCP server${count > 1 ? 's' : ''} enabled (click to manage)`);

      // Show badge only when more than 1
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
    } else {
      this.iconEl.removeClass('active');
      this.iconEl.setAttribute('title', 'Mcp servers (click to enable)');
      this.badgeEl.removeClass('visible');
    }
  }
}

export interface ContextUsageMeterCallbacks {
  /** Fresh `/context` read; the runtime answers from its last snapshot while busy. */
  requestContextUsage?: () => Promise<ContextUsageBreakdown | null>;
  /** Compacts the conversation (sends `/compact` through the composer). */
  onCompactContext?: () => void;
}

/** Skills also report how many are loaded; their label is formatted separately. */
const CONTEXT_CATEGORY_LABELS: Record<Exclude<ContextUsageCategoryType, 'skills'>, TranslationKey> = {
  system_prompt: 'contextUsage.categorySystemPrompt',
  system_tools: 'contextUsage.categorySystemTools',
  messages: 'contextUsage.categoryMessages',
  other: 'contextUsage.categoryOther',
  free_space: 'contextUsage.categoryFreeSpace',
  auto_compact: 'contextUsage.categoryAutoCompact',
};

/** Buckets hidden from the panel: they describe headroom, not occupancy. */
const HIDDEN_CATEGORY_TYPES = new Set<ContextUsageCategoryType>(['free_space', 'auto_compact']);

function roundPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export class ContextUsageMeter {
  private container: HTMLElement;
  private triggerEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;
  private popover: ClickPopover | null = null;
  private fillPath: SVGCircleElement | null = null;
  private percentEl: HTMLElement | null = null;
  private circumference: number = 0;
  private breakdown: ContextUsageBreakdown | null = null;
  private refreshToken = 0;

  constructor(
    parentEl: HTMLElement,
    private readonly callbacks: ContextUsageMeterCallbacks = {},
  ) {
    this.container = parentEl.createDiv({ cls: 'qoderian-context-meter' });
    this.render();
    // Initially hidden
    this.container.addClass('qoderian-hidden');
  }

  setVisible(visible: boolean): void {
    this.container.toggleClass('qoderian-hidden', !visible);
  }

  private render() {
    const size = 18;
    const strokeWidth = 2;
    const radius = (size - strokeWidth * 2) / 2;
    const cx = size / 2;
    const cy = size / 2;
    this.circumference = 2 * Math.PI * radius;

    // Gauge and percentage form the popover trigger; the panel is its sibling
    // so clicks inside the panel cannot toggle it closed.
    this.panelEl = this.container.createDiv({ cls: 'qoderian-context-panel' });
    this.triggerEl = this.container.createDiv({ cls: 'qoderian-context-meter-trigger' });

    const gaugeEl = this.triggerEl.createDiv({ cls: 'qoderian-context-meter-gauge' });
    const svg = gaugeEl.createSvg('svg', {
      attr: {
        width: String(size),
        height: String(size),
        viewBox: `0 0 ${size} ${size}`,
      },
    });

    svg.createSvg('circle', {
      cls: 'qoderian-meter-bg',
      attr: {
        cx: String(cx),
        cy: String(cy),
        r: String(radius),
        fill: 'none',
        'stroke-width': String(strokeWidth),
      },
    });

    const fillPath = svg.createSvg('circle', {
      cls: 'qoderian-meter-fill',
      attr: {
        cx: String(cx),
        cy: String(cy),
        r: String(radius),
        fill: 'none',
        'stroke-width': String(strokeWidth),
        'stroke-linecap': 'round',
        'stroke-dasharray': String(this.circumference),
        'stroke-dashoffset': String(this.circumference),
        transform: `rotate(-90 ${cx} ${cy})`,
      },
    });
    this.fillPath = fillPath;

    this.percentEl = this.triggerEl.createSpan({ cls: 'qoderian-context-meter-percent' });

    this.popover = new ClickPopover(
      this.container,
      this.triggerEl,
      this.panelEl,
      'qoderian-context-meter--open',
    );
    this.triggerEl.addEventListener('click', this.handleTriggerClick);
  }

  private readonly handleTriggerClick = (): void => {
    // ClickPopover's own handler runs first and flips aria-expanded.
    if (this.triggerEl?.getAttribute('aria-expanded') !== 'true') return;
    this.renderPanel();
    void this.refresh();
  };

  private async refresh(): Promise<void> {
    const request = this.callbacks.requestContextUsage;
    if (!request) return;

    const token = ++this.refreshToken;
    try {
      const breakdown = await request();
      if (token !== this.refreshToken || !breakdown) return;
      this.breakdown = breakdown;
      this.renderPanel();
    } catch {
      // The panel already shows the last known breakdown.
    }
  }

  private renderPanel(): void {
    const panel = this.panelEl;
    if (!panel) return;
    panel.empty();

    const header = panel.createDiv({ cls: 'qoderian-context-panel-header' });
    header.createSpan({ cls: 'qoderian-context-panel-title', text: t('contextUsage.title') });
    header.createSpan({
      cls: 'qoderian-context-panel-percent',
      text: this.breakdown ? this.formatPercent(this.breakdown.usedPercentage) : '',
    });

    const breakdown = this.breakdown;
    if (!breakdown) {
      panel.createDiv({ cls: 'qoderian-context-panel-empty', text: t('contextUsage.empty') });
      return;
    }

    panel.createDiv({ cls: 'qoderian-context-panel-desc', text: t('contextUsage.description') });

    const bar = panel.createDiv({ cls: 'qoderian-context-panel-bar' });
    const fill = bar.createDiv({ cls: 'qoderian-context-panel-bar-fill' });
    fill.style.width = `${roundPercent(breakdown.usedPercentage)}%`;

    const list = panel.createDiv({ cls: 'qoderian-context-panel-list' });
    for (const category of breakdown.categories) {
      if (HIDDEN_CATEGORY_TYPES.has(category.type)) continue;
      this.renderCategory(list, category);
    }

    const compactBtn = panel.createEl('button', {
      cls: 'qoderian-context-compact-btn',
      attr: { type: 'button' },
    });
    setIcon(compactBtn.createSpan({ cls: 'qoderian-context-compact-icon' }), 'minimize-2');
    compactBtn.createSpan({ text: t('contextUsage.compact') });
    compactBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.callbacks.onCompactContext?.();
      this.popover?.close();
    });

    this.positionPanel();
  }

  private renderCategory(parentEl: HTMLElement, category: ContextUsageCategory): void {
    const row = parentEl.createDiv({ cls: 'qoderian-context-row' });
    const dot = row.createSpan({ cls: 'qoderian-context-dot' });
    // Faint dots keep near-empty buckets visible without competing with the
    // occupied ones.
    dot.style.opacity = String(Math.max(0.25, Math.min(1, category.percentage / 25)));

    const label = category.type === 'skills'
      ? t('contextUsage.categorySkills', { count: this.breakdown?.skills.count ?? 0 })
      : t(CONTEXT_CATEGORY_LABELS[category.type]);
    row.createSpan({ cls: 'qoderian-context-row-label', text: label });
    row.createSpan({
      cls: 'qoderian-context-row-percent',
      text: this.formatPercent(category.percentage),
    });
  }

  private positionPanel(): void {
    if (!this.triggerEl || !this.panelEl) return;
    positionHoverDropdown(this.container, this.triggerEl, this.panelEl);
  }

  /** Sub-1% buckets read as "<1%" instead of rounding down to a bare 0%. */
  private formatPercent(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0%';
    if (value < 1) return '<1%';
    return `${roundPercent(value)}%`;
  }

  update(usage: UsageInfo | null): void {
    if (!usage || usage.contextTokens <= 0) {
      // Keep the meter discoverable on a new Qoder session. The exact window
      // and token count arrive with the first CLI usage event.
      this.container.removeClass('qoderian-hidden');
      this.container.removeClass('warning');
      this.fillPath?.setAttribute('stroke-dashoffset', String(this.circumference));
      this.percentEl?.setText('0%');
      this.container.setAttribute('data-tooltip', 'Context usage will appear after the first response');
      return;
    }
    this.container.removeClass('qoderian-hidden');
    const fillLength = (usage.percentage / 100) * this.circumference;
    if (this.fillPath) {
      this.fillPath.setAttribute('stroke-dashoffset', String(this.circumference - fillLength));
    }

    if (this.percentEl) {
      this.percentEl.setText(`${usage.percentage}%`);
    }

    // Toggle warning class for > 80%
    if (usage.percentage > 80) {
      this.container.addClass('warning');
    } else {
      this.container.removeClass('warning');
    }

    // Set tooltip with detailed usage
    let tooltip = `${this.formatTokens(usage.contextTokens)} / ${this.formatTokens(usage.contextWindow)}`;
    if (usage.percentage > 80) {
      tooltip += ' (Approaching limit, run `/compact` to continue)';
    }
    this.container.setAttribute('data-tooltip', tooltip);
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}k`;
    }
    return String(tokens);
  }
}

export function createInputToolbar(
  parentEl: HTMLElement,
  callbacks: ToolbarCallbacks
): {
  modelSelector: ModelSelector;
  contextUsageMeter: ContextUsageMeter | null;
  externalContextSelector: ExternalContextSelector;
  mcpServerSelector: McpServerSelector;
  permissionToggle: PermissionToggle;
} {
  const modelSelector = new ModelSelector(parentEl, callbacks);
  const contextUsageMeter = new ContextUsageMeter(parentEl, callbacks);
  const externalContextSelector = new ExternalContextSelector(parentEl, callbacks);
  const mcpServerSelector = new McpServerSelector(parentEl);
  const permissionToggle = new PermissionToggle(parentEl, callbacks);

  return {
    modelSelector,
    contextUsageMeter,
    externalContextSelector,
    mcpServerSelector,
    permissionToggle,
  };
}
