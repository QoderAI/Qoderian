import type { SessionMetadata } from '@/core/types';
import {
  resolveLegacySessionEdition,
  selectMetadataForEdition,
} from '@/qoder/history/session-edition-filter';

function meta(overrides: Partial<SessionMetadata>): SessionMetadata {
  return {
    id: 'conv-1',
    title: 'Test',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('selectMetadataForEdition', () => {
  it('keeps only sessions stamped with the active edition', () => {
    const metadata = [
      meta({ id: 'global-session', edition: 'global' }),
      meta({ id: 'cn-session', edition: 'cn' }),
    ];

    const visible = selectMetadataForEdition(metadata, 'global', () => true);

    expect(visible.map(m => m.id)).toEqual(['global-session']);
  });

  it('shows cn-stamped sessions only under the cn edition', () => {
    const metadata = [
      meta({ id: 'global-session', edition: 'global' }),
      meta({ id: 'cn-session', edition: 'cn' }),
    ];

    const visible = selectMetadataForEdition(metadata, 'cn', () => true);

    expect(visible.map(m => m.id)).toEqual(['cn-session']);
  });

  it('keeps legacy metadata whose history is not found under the other edition', () => {
    const metadata = [meta({ id: 'legacy', sessionId: 'session-abc' })];
    const existsInOther = jest.fn(() => false);

    const visible = selectMetadataForEdition(metadata, 'cn', existsInOther);

    expect(visible.map(m => m.id)).toEqual(['legacy']);
    expect(existsInOther).toHaveBeenCalledWith('session-abc');
  });

  it('hides legacy metadata whose history file lives under the other edition', () => {
    const metadata = [meta({ id: 'legacy', sessionId: 'session-abc' })];

    const visible = selectMetadataForEdition(metadata, 'cn', () => true);

    expect(visible).toEqual([]);
  });

  it('falls back to the metadata id when sessionId was never recorded', () => {
    const metadata = [meta({ id: 'legacy' })];
    const existsInOther = jest.fn(() => false);

    const visible = selectMetadataForEdition(metadata, 'global', existsInOther);

    expect(visible.map(m => m.id)).toEqual(['legacy']);
    expect(existsInOther).toHaveBeenCalledWith('legacy');
  });

  it('keeps legacy metadata whose session id was cleared', () => {
    const metadata = [meta({ id: 'legacy', sessionId: null })];

    const visible = selectMetadataForEdition(metadata, 'cn', () => false);

    expect(visible.map(m => m.id)).toEqual(['legacy']);
  });
});

describe('resolveLegacySessionEdition', () => {
  it('keeps the existing stamp untouched', () => {
    const target = meta({ id: 'stamped', edition: 'cn' });

    const resolved = resolveLegacySessionEdition(target, 'global', () => 'active');

    expect(resolved).toBe('cn');
  });

  it('attributes legacy metadata to the active edition when its file is there', () => {
    const target = meta({ id: 'legacy', sessionId: 'session-abc' });

    const resolved = resolveLegacySessionEdition(target, 'global', () => 'active');

    expect(resolved).toBe('global');
  });

  it('attributes legacy metadata to the other edition when its file is there', () => {
    const target = meta({ id: 'legacy', sessionId: 'session-abc' });

    expect(resolveLegacySessionEdition(target, 'global', () => 'other')).toBe('cn');
    expect(resolveLegacySessionEdition(target, 'cn', () => 'other')).toBe('global');
  });

  it('leaves metadata unstamped when files are missing everywhere', () => {
    const target = meta({ id: 'legacy', sessionId: 'session-abc' });

    const resolved = resolveLegacySessionEdition(target, 'global', () => 'unknown');

    expect(resolved).toBeUndefined();
  });

  it('leaves metadata without a usable session id unstamped', () => {
    expect(resolveLegacySessionEdition(meta({ id: 'legacy', sessionId: null }), 'global', () => 'active'))
      .toBeUndefined();
  });
});
