import * as fs from 'fs';

import { getHostnameKey } from '../../core/env/environment';
import { expandHomePath } from '../../core/fs/path';
import type { HostnameCliPaths, QoderCliEdition } from '../../core/types/settings';
import { getQoderSettings } from '../config/settings';
import { findQoderCLIPath } from './find-qoder-cli-path';

export class QoderCliResolver {
  private resolvedPath: string | null = null;
  private lastHostnamePath = '';
  private lastLegacyPath = '';
  private lastEdition: QoderCliEdition = 'global';
  private readonly cachedHostname = getHostnameKey();

  /**
   * Resolves CLI path with priority: device-specific -> legacy -> auto-detect.
   * @param settings Full app settings bag
   */
  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const hostnameKey = this.cachedHostname;
    const qoderSettings = getQoderSettings(settings);

    const hostnamePath = (qoderSettings.cliPathsByHost[hostnameKey] ?? '').trim();
    const normalizedLegacy = qoderSettings.cliPath.trim();

    return this.resolveConfiguredPaths(hostnamePath, normalizedLegacy, qoderSettings.edition);
  }

  resolve(
    hostnamePaths: HostnameCliPaths | undefined,
    legacyPath: string | undefined,
    edition: QoderCliEdition = 'global',
  ): string | null {
    const hostnamePath = (hostnamePaths?.[this.cachedHostname] ?? '').trim();
    const normalizedLegacy = (legacyPath ?? '').trim();
    return this.resolveConfiguredPaths(hostnamePath, normalizedLegacy, edition);
  }

  private resolveConfiguredPaths(
    hostnamePath: string,
    normalizedLegacy: string,
    edition: QoderCliEdition,
  ): string | null {
    if (
      this.resolvedPath &&
      hostnamePath === this.lastHostnamePath &&
      normalizedLegacy === this.lastLegacyPath &&
      edition === this.lastEdition
    ) {
      return this.resolvedPath;
    }

    this.lastHostnamePath = hostnamePath;
    this.lastLegacyPath = normalizedLegacy;
    this.lastEdition = edition;

    this.resolvedPath = resolveQoderCliPath(hostnamePath, normalizedLegacy, edition);
    return this.resolvedPath;
  }

  reset(): void {
    this.resolvedPath = null;
    this.lastHostnamePath = '';
    this.lastLegacyPath = '';
    this.lastEdition = 'global';
  }
}

function resolveConfiguredPath(rawPath: string | undefined): string | null {
  const trimmed = (rawPath ?? '').trim();
  if (!trimmed) return null;
  try {
    const expanded = expandHomePath(trimmed);
    if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) {
      return expanded;
    }
  } catch {
    // Fall through
  }
  return null;
}

export function resolveQoderCliPath(
  hostnamePath: string | undefined,
  legacyPath: string | undefined,
  edition: QoderCliEdition = 'global',
): string | null {
  return (
    resolveConfiguredPath(hostnamePath) ??
    resolveConfiguredPath(legacyPath) ??
    findQoderCLIPath(undefined, edition)
  );
}
