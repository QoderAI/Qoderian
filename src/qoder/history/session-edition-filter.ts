import type { SessionMetadata } from '../../core/types';
import type { QoderCliEdition } from '../../core/types/settings';

/** Resume session id mirroring the plugin's load-time fallback (`sessionId ?? id`). */
function resumeSessionId(meta: SessionMetadata): string | null {
  return meta.sessionId !== undefined ? meta.sessionId : meta.id;
}

/** Where a session's history file lives, relative to the active edition. */
export type SessionEditionLocation = 'active' | 'other' | 'unknown';

/**
 * Selects the session metadata visible to an edition. Sessions stamped with
 * an edition only appear under that edition. Legacy metadata (no `edition`
 * field) stays visible unless its history file provably lives under the other
 * edition's config root, so sessions whose files are missing altogether are
 * never silently dropped.
 */
export function selectMetadataForEdition(
  metadata: SessionMetadata[],
  edition: QoderCliEdition,
  sessionExistsInOtherEdition: (sessionId: string) => boolean,
): SessionMetadata[] {
  return metadata.filter((meta) => {
    if (meta.edition !== undefined) {
      return meta.edition === edition;
    }

    const sessionId = resumeSessionId(meta);
    if (!sessionId || meta.sessionId === null) {
      // No history file was ever persisted; keep it under the active edition.
      return true;
    }
    return !sessionExistsInOtherEdition(sessionId);
  });
}

/**
 * One-shot edition attribution for legacy metadata. Returns the owning
 * edition when the history file location proves it, or `undefined` when the
 * metadata is already stamped or its files are missing everywhere (left
 * unstamped so a later pass can re-evaluate once files reappear).
 */
export function resolveLegacySessionEdition(
  meta: SessionMetadata,
  activeEdition: QoderCliEdition,
  locateSession: (sessionId: string) => SessionEditionLocation,
): QoderCliEdition | undefined {
  if (meta.edition !== undefined) {
    return meta.edition;
  }

  const sessionId = resumeSessionId(meta);
  if (!sessionId || meta.sessionId === null) {
    return undefined;
  }

  const location = locateSession(sessionId);
  if (location === 'active') {
    return activeEdition;
  }
  if (location === 'other') {
    return activeEdition === 'cn' ? 'global' : 'cn';
  }
  return undefined;
}
