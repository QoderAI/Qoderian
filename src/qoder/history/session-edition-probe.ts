import { mapWithConcurrency } from '../../core/async/map-with-concurrency';
import type { SessionMetadata } from '../../core/types';
import type { QoderCliEdition } from '../../core/types/settings';
import { sdkSessionExistsForEditionAsync } from './sdk-session-paths';
import { resumeSessionId, type SessionEditionLocation } from './session-edition-filter';

/** Upper bound on concurrent `fs.access` probes across all workers. */
export const PROBE_CONCURRENCY = 8;

export type EditionFileExists = (
  sessionId: string,
  edition: QoderCliEdition,
) => Promise<boolean>;

/**
 * Edition-file probing scoped to one load transaction. The in-flight promise
 * (not just the resolved value) is cached, so concurrent callers asking for
 * the same file share a single `fs.access`.
 */
export class SessionEditionProbe {
  private checks = new Map<string, Promise<boolean>>();
  private exists: EditionFileExists;

  constructor(vaultPath: string, exists?: EditionFileExists) {
    this.exists = exists
      ?? ((sessionId, edition) => sdkSessionExistsForEditionAsync(vaultPath, sessionId, edition));
  }

  sessionFileExists(sessionId: string, edition: QoderCliEdition): Promise<boolean> {
    const key = `${edition}:${sessionId}`;
    let check = this.checks.get(key);
    if (!check) {
      check = this.exists(sessionId, edition);
      this.checks.set(key, check);
    }
    return check;
  }
}

/**
 * Probes where each legacy session's history file lives. Workers check the
 * active edition first and stop as soon as it exists; the other edition is
 * only probed on a miss, so in-flight accesses stay within
 * `PROBE_CONCURRENCY`. The resulting map feeds both the migration and index
 * stages of the same load, so each file is accessed at most once.
 */
export async function probeLegacySessionLocations(
  metadata: SessionMetadata[],
  activeEdition: QoderCliEdition,
  probe: SessionEditionProbe,
): Promise<Map<string, SessionEditionLocation>> {
  const otherEdition: QoderCliEdition = activeEdition === 'cn' ? 'global' : 'cn';
  const targets = metadata.filter(meta => meta.edition === undefined && !!resumeSessionId(meta));

  const locations = new Map<string, SessionEditionLocation>();
  await mapWithConcurrency(targets, PROBE_CONCURRENCY, async (meta) => {
    const sessionId = resumeSessionId(meta);
    if (!sessionId) {
      return;
    }
    if (await probe.sessionFileExists(sessionId, activeEdition)) {
      locations.set(sessionId, 'active');
      return;
    }
    if (await probe.sessionFileExists(sessionId, otherEdition)) {
      locations.set(sessionId, 'other');
      return;
    }
    locations.set(sessionId, 'unknown');
  });

  return locations;
}
