import type { SessionMetadata } from '@/core/types';
import {
  PROBE_CONCURRENCY,
  probeLegacySessionLocations,
  SessionEditionProbe,
} from '@/qoder/history/session-edition-probe';

function defer(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeMeta(id: string, overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    id,
    title: id,
    createdAt: 0,
    updatedAt: 0,
    sessionId: id,
    ...overrides,
  };
}

describe('SessionEditionProbe', () => {
  it('dedupes concurrent checks for the same session file into one access', async () => {
    const accessed: string[] = [];
    const probe = new SessionEditionProbe('/vault', async (sessionId, edition) => {
      accessed.push(`${edition}:${sessionId}`);
      await defer(10);
      return true;
    });

    const [first, second] = await Promise.all([
      probe.sessionFileExists('s1', 'global'),
      probe.sessionFileExists('s1', 'global'),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    // The second caller must share the in-flight promise, not trigger a new access.
    expect(accessed).toEqual(['global:s1']);
  });

  it('keeps probing distinct files distinct', async () => {
    const probe = new SessionEditionProbe('/vault', async () => false);

    await probe.sessionFileExists('s1', 'global');
    await probe.sessionFileExists('s1', 'cn');
    await probe.sessionFileExists('s2', 'global');

    // Different edition or session id means a different cache key.
    await expect(probe.sessionFileExists('s1', 'global')).resolves.toBe(false);
  });
});

describe('probeLegacySessionLocations', () => {
  it('stops after the active edition when the file exists there', async () => {
    const accessed: string[] = [];
    const probe = new SessionEditionProbe('/vault', async (sessionId, edition) => {
      accessed.push(`${edition}:${sessionId}`);
      return edition === 'global';
    });

    const locations = await probeLegacySessionLocations([makeMeta('legacy-1')], 'global', probe);

    expect(accessed).toEqual(['global:legacy-1']);
    expect(locations.get('legacy-1')).toBe('active');
  });

  it('probes both editions exactly once for missing files and caches the outcome', async () => {
    const accessed: string[] = [];
    const probe = new SessionEditionProbe('/vault', async (sessionId, edition) => {
      accessed.push(`${edition}:${sessionId}`);
      return false;
    });

    const locations = await probeLegacySessionLocations([makeMeta('gone-1')], 'global', probe);

    expect(locations.get('gone-1')).toBe('unknown');
    // Active edition first, then the other — exactly two accesses.
    expect(accessed).toEqual(['global:gone-1', 'cn:gone-1']);

    // A later stage reusing the same probe must not add any access.
    await probe.sessionFileExists('gone-1', 'global');
    await probe.sessionFileExists('gone-1', 'cn');
    expect(accessed).toEqual(['global:gone-1', 'cn:gone-1']);
  });

  it('maps locations for active, other and missing legacy sessions', async () => {
    const files = new Set(['global:in-active', 'cn:in-other']);
    const probe = new SessionEditionProbe(
      '/vault',
      async (sessionId, edition) => files.has(`${edition}:${sessionId}`),
    );
    const metadata = [
      makeMeta('in-active'),
      makeMeta('in-other'),
      makeMeta('nowhere'),
      makeMeta('stamped', { edition: 'cn' }),
      makeMeta('no-file', { sessionId: null }),
      makeMeta('fallback-to-id', { sessionId: undefined }),
    ];

    const locations = await probeLegacySessionLocations(metadata, 'global', probe);

    expect(locations.get('in-active')).toBe('active');
    expect(locations.get('in-other')).toBe('other');
    expect(locations.get('nowhere')).toBe('unknown');
    // Stamped sessions and sessions without a resolvable session id are not probed.
    expect(locations.has('stamped')).toBe(false);
    expect(locations.has('no-file')).toBe(false);
    expect(locations.get('fallback-to-id')).toBe('unknown');
  });

  it('keeps in-flight accesses within PROBE_CONCURRENCY while running in parallel', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const probe = new SessionEditionProbe('/vault', async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await defer(5);
      inFlight -= 1;
      return false;
    });
    const metadata = Array.from({ length: 24 }, (_, index) => makeMeta(`s-${index}`));

    await probeLegacySessionLocations(metadata, 'global', probe);

    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(PROBE_CONCURRENCY);
  });

  it('resolves the other edition relative to the active one', async () => {
    const accessed: string[] = [];
    const probe = new SessionEditionProbe('/vault', async (sessionId, edition) => {
      accessed.push(`${edition}:${sessionId}`);
      return edition === 'global';
    });

    const locations = await probeLegacySessionLocations([makeMeta('legacy-1')], 'cn', probe);

    expect(accessed).toEqual(['cn:legacy-1', 'global:legacy-1']);
    expect(locations.get('legacy-1')).toBe('other');
  });

  it('returns an empty map when there are no legacy sessions', async () => {
    const probe = new SessionEditionProbe('/vault', async () => true);

    const locations = await probeLegacySessionLocations(
      [makeMeta('stamped', { edition: 'global' })],
      'global',
      probe,
    );

    expect(locations.size).toBe(0);
  });
});
