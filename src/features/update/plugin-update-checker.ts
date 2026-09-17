import { requestUrl } from 'obsidian';

import { openExternalBrowserUrl } from '../../qoder/services/qoder-login-service';

const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/QoderAI/Qoderian/releases/latest';

export interface QoderianUpdate {
  version: string;
  url: string;
}

interface GitHubReleaseResponse {
  html_url?: unknown;
  tag_name?: unknown;
}

function parseVersion(value: string): number[] | null {
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return match.slice(1).map(Number);
}

/** Semver comparison for the three-part release tags used by Qoderian. */
export function isNewerQoderianVersion(currentVersion: string, latestVersion: string): boolean {
  const current = parseVersion(currentVersion);
  const latest = parseVersion(latestVersion);
  if (!current || !latest) return false;

  for (let index = 0; index < latest.length; index += 1) {
    if (latest[index] !== current[index]) return latest[index] > current[index];
  }
  return false;
}

/** Obsidian's own URI for a plugin's entry in the community-plugins list. */
export function qoderianPluginPageUri(pluginId: string): string {
  return `obsidian://show-plugin?id=${encodeURIComponent(pluginId)}`;
}

/**
 * Opens Obsidian's plugin page, where the update button lives. Obsidian
 * handles its own URI scheme, so this stays inside the app.
 */
export function openQoderianUpdatePage(pluginId: string): void {
  openExternalBrowserUrl(qoderianPluginPageUri(pluginId));
}

/**
 * Checks the latest stable GitHub release. Network and malformed-response
 * failures are intentionally silent so update discovery never blocks chat.
 */
export async function fetchAvailableQoderianUpdate(
  currentVersion: string,
): Promise<QoderianUpdate | null> {
  try {
    const response = await requestUrl({
      url: LATEST_RELEASE_API_URL,
      headers: { Accept: 'application/vnd.github+json' },
    });
    const release = response.json as GitHubReleaseResponse;
    if (typeof release.tag_name !== 'string' || typeof release.html_url !== 'string') return null;

    const version = release.tag_name.replace(/^v/i, '');
    if (!isNewerQoderianVersion(currentVersion, version)) return null;
    return { version, url: release.html_url };
  } catch {
    return null;
  }
}
