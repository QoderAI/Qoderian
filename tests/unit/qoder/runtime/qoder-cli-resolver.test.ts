import * as fs from 'fs';

import { getHostnameKey } from '@/core/env/environment';
import { findQoderCLIPath } from '@/qoder/runtime/find-qoder-cli-path';
import { QoderCliResolver, resolveQoderCliPath } from '@/qoder/runtime/qoder-cli-resolver';

jest.mock('fs');
jest.mock('@/core/env/environment', () => {
  const actual = jest.requireActual('@/core/env/environment');
  return {
    ...actual,
    getHostnameKey: jest.fn(() => 'test-host'),
  };
});
jest.mock('@/qoder/runtime/find-qoder-cli-path', () => {
  const actual = jest.requireActual('@/qoder/runtime/find-qoder-cli-path');
  return {
    ...actual,
    findQoderCLIPath: jest.fn(),
  };
});

const mockedExists = fs.existsSync as jest.Mock;
const mockedStat = fs.statSync as jest.Mock;
const mockedFind = findQoderCLIPath as jest.Mock;
const mockedDeviceKey = getHostnameKey as jest.Mock;

describe('QoderCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDeviceKey.mockReturnValue('test-host');
  });

  describe('hostname-based resolution', () => {
    it('should use hostname path when available', () => {
      mockedExists.mockImplementation((p: string) => p === '/hostname/qoder');
      mockedStat.mockReturnValue({ isFile: () => true });

      const resolver = new QoderCliResolver();
      const resolved = resolver.resolve(
        { 'test-host': '/hostname/qoder' },
        '/legacy/qoder'
      );

      expect(resolved).toBe('/hostname/qoder');
    });

    it('should fall back to legacy path when hostname not found', () => {
      mockedExists.mockImplementation((p: string) => p === '/legacy/qoder');
      mockedStat.mockReturnValue({ isFile: () => true });

      const resolver = new QoderCliResolver();
      const resolved = resolver.resolve(
        { 'other-host': '/other/qoder' },
        '/legacy/qoder'
      );

      expect(resolved).toBe('/legacy/qoder');
    });

    it('should fall back to legacy path when hostname paths empty', () => {
      mockedExists.mockImplementation((p: string) => p === '/legacy/qoder');
      mockedStat.mockReturnValue({ isFile: () => true });

      const resolver = new QoderCliResolver();
      const resolved = resolver.resolve(
        {},
        '/legacy/qoder'
      );

      expect(resolved).toBe('/legacy/qoder');
    });

    it('should auto-detect when no paths configured', () => {
      mockedExists.mockReturnValue(false);
      mockedFind.mockReturnValue('/auto/qoder');

      const resolver = new QoderCliResolver();
      const resolved = resolver.resolve({}, '');

      expect(resolved).toBe('/auto/qoder');
      expect(mockedFind).toHaveBeenCalled();
    });
  });

  describe('caching', () => {
    it('should cache resolved path and return same result', () => {
      mockedExists.mockImplementation((p: string) => p === '/hostname/qoder');
      mockedStat.mockReturnValue({ isFile: () => true });

      const resolver = new QoderCliResolver();
      const first = resolver.resolve(
        { 'test-host': '/hostname/qoder' },
        ''
      );
      const second = resolver.resolve(
        { 'test-host': '/hostname/qoder' },
        ''
      );

      expect(first).toBe('/hostname/qoder');
      expect(second).toBe('/hostname/qoder');
      // existsSync should be called only once due to caching
      expect(mockedExists).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache when hostname path changes', () => {
      mockedExists.mockReturnValue(true);
      mockedStat.mockReturnValue({ isFile: () => true });

      const resolver = new QoderCliResolver();
      const first = resolver.resolve(
        { 'test-host': '/hostname/qoder1' },
        ''
      );
      const second = resolver.resolve(
        { 'test-host': '/hostname/qoder2' },
        ''
      );

      expect(first).toBe('/hostname/qoder1');
      expect(second).toBe('/hostname/qoder2');
    });

    it('should clear cache on reset()', () => {
      mockedExists.mockReturnValue(true);
      mockedStat.mockReturnValue({ isFile: () => true });

      const resolver = new QoderCliResolver();
      resolver.resolve(
        { 'test-host': '/hostname/qoder' },
        ''
      );

      resolver.reset();

      resolver.resolve(
        { 'test-host': '/hostname/qoder' },
        ''
      );

      // Should be called twice because cache was cleared
      expect(mockedExists).toHaveBeenCalledTimes(2);
    });
  });

  describe('legacy compatibility', () => {
    it('should use legacy path as fallback when hostname paths are empty', () => {
      mockedExists.mockImplementation((p: string) => p === '/legacy/qoder');
      mockedStat.mockReturnValue({ isFile: () => true });
      mockedFind.mockReturnValue('/auto/qoder');

      const resolver = new QoderCliResolver();
      const resolved = resolver.resolve({}, '/legacy/qoder');

      expect(resolved).toBe('/legacy/qoder');
      expect(mockedFind).not.toHaveBeenCalled();
    });

    it('should use legacy path when hostname paths are undefined', () => {
      mockedExists.mockImplementation((p: string) => p === '/legacy/qoder');
      mockedStat.mockReturnValue({ isFile: () => true });
      mockedFind.mockReturnValue('/auto/qoder');

      const resolver = new QoderCliResolver();
      const resolved = resolver.resolve(undefined, '/legacy/qoder');

      expect(resolved).toBe('/legacy/qoder');
      expect(mockedFind).not.toHaveBeenCalled();
    });
  });
});

describe('resolveQoderCliPath', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return hostname path when valid file exists', () => {
    mockedExists.mockImplementation((p: string) => p === '/hostname/qoder');
    mockedStat.mockReturnValue({ isFile: () => true });

    const result = resolveQoderCliPath('/hostname/qoder', '/legacy/qoder');

    expect(result).toBe('/hostname/qoder');
  });

  it('should skip hostname path if it is a directory', () => {
    mockedExists.mockReturnValue(true);
    mockedStat.mockImplementation((p: string) => ({
      isFile: () => p !== '/hostname/qoder',
    }));

    const result = resolveQoderCliPath('/hostname/qoder', '/legacy/qoder');

    expect(result).toBe('/legacy/qoder');
  });

  it('should handle empty hostname path gracefully', () => {
    mockedExists.mockImplementation((p: string) => p === '/legacy/qoder');
    mockedStat.mockReturnValue({ isFile: () => true });

    const result = resolveQoderCliPath('', '/legacy/qoder');

    expect(result).toBe('/legacy/qoder');
  });

  it('should trim whitespace from paths', () => {
    mockedExists.mockImplementation((p: string) => p === '/hostname/qoder');
    mockedStat.mockReturnValue({ isFile: () => true });

    const result = resolveQoderCliPath('  /hostname/qoder  ', '');

    expect(result).toBe('/hostname/qoder');
  });

  it('should handle null/undefined hostname path', () => {
    mockedExists.mockImplementation((p: string) => p === '/legacy/qoder');
    mockedStat.mockReturnValue({ isFile: () => true });

    const result = resolveQoderCliPath(undefined, '/legacy/qoder');

    expect(result).toBe('/legacy/qoder');
  });

  it('should handle null/undefined legacy path', () => {
    mockedExists.mockReturnValue(false);
    mockedFind.mockReturnValue('/auto/qoder');

    const result = resolveQoderCliPath('', undefined);

    expect(result).toBe('/auto/qoder');
  });

  it('should fall through hostname path when existsSync returns false', () => {
    mockedExists.mockImplementation((p: string) => p === '/legacy/qoder');
    mockedStat.mockReturnValue({ isFile: () => true });

    const result = resolveQoderCliPath('/nonexistent/qoder', '/legacy/qoder');

    expect(result).toBe('/legacy/qoder');
  });

  it('should fall through hostname path when existsSync throws', () => {
    mockedExists.mockImplementation((p: string) => {
      if (p.includes('nonexistent')) throw new Error('Access denied');
      return p === '/legacy/qoder';
    });
    mockedStat.mockReturnValue({ isFile: () => true });

    const result = resolveQoderCliPath('/nonexistent/qoder', '/legacy/qoder');

    expect(result).toBe('/legacy/qoder');
  });

  it('should fall through legacy path when existsSync throws', () => {
    mockedExists.mockImplementation(() => {
      throw new Error('Access denied');
    });
    mockedFind.mockReturnValue('/auto/qoder');

    const result = resolveQoderCliPath('', '/bad/path');

    expect(result).toBe('/auto/qoder');
  });

  it('should skip legacy path if it is a directory', () => {
    mockedExists.mockReturnValue(true);
    mockedStat.mockReturnValue({ isFile: () => false });
    mockedFind.mockReturnValue('/auto/qoder');

    const result = resolveQoderCliPath('', '/legacy/dir');

    expect(result).toBe('/auto/qoder');
  });

});
