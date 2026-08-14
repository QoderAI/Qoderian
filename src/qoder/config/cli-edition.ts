import * as os from 'os';
import * as path from 'path';

import { QODER_CLI_EDITIONS, type QoderCliEdition } from '../../core/types/settings';

/** User-level config directory name under the home directory, per edition. */
export const QODER_CLI_HOME_DIRS: Record<QoderCliEdition, string> = {
  global: '.qoder',
  cn: '.qoder-cn',
};

/** Executable base name (without platform extension), per edition. */
export const QODER_CLI_BINARY_NAMES: Record<QoderCliEdition, string> = {
  global: 'qodercli',
  cn: 'qoderclicn',
};

/** Coerces an arbitrary stored value into a valid edition, defaulting to the global build. */
export function normalizeQoderCliEdition(value: unknown): QoderCliEdition {
  return typeof value === 'string' && (QODER_CLI_EDITIONS as readonly string[]).includes(value)
    ? value as QoderCliEdition
    : 'global';
}

/** Absolute user-level config root for an edition (e.g. `~/.qoder-cn`). */
export function getQoderCliHomeDir(
  edition: QoderCliEdition,
  homeDir: string = os.homedir(),
): string {
  return path.join(homeDir, QODER_CLI_HOME_DIRS[edition]);
}

export function getQoderCliBinaryBaseName(edition: QoderCliEdition): string {
  return QODER_CLI_BINARY_NAMES[edition];
}

/** Terminal login hint shown when the CLI reports missing credentials. */
export function getQoderCliLoginCommand(edition: QoderCliEdition): string {
  return `${QODER_CLI_BINARY_NAMES[edition]} login`;
}

/*
 * Active-edition registry. The plugin is a singleton per Obsidian instance and
 * updates this value whenever settings load or save, so path helpers that are
 * called as free functions (history files, global plugin discovery) can stay
 * edition-aware without threading settings through every signature.
 */
let activeEdition: QoderCliEdition = 'global';

export function setActiveQoderCliEdition(edition: QoderCliEdition): void {
  activeEdition = normalizeQoderCliEdition(edition);
}

export function getActiveQoderCliEdition(): QoderCliEdition {
  return activeEdition;
}
