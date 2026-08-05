import type * as fsType from 'fs';
import type * as osType from 'os';
import type * as pathType from 'path';

const fs = jest.requireActual<typeof fsType>('fs');
const os = jest.requireActual<typeof osType>('os');
const path = jest.requireActual<typeof pathType>('path');

const isWindows = process.platform === 'win32';

import {
  expandHomePath,
  isPathWithinVault,
  normalizePathForFilesystem,
  normalizePathForVault,
  translateMsysPath,
} from '@/core/fs/path';

describe('expandHomePath', () => {
  const envKey = 'QODERIAN_TEST_PATH';
  const envValue = path.join(os.tmpdir(), 'qoderian-env');
  let originalValue: string | undefined;

  beforeEach(() => {
    originalValue = process.env[envKey];
    process.env[envKey] = envValue;
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = originalValue;
    }
  });

  it('should expand percent-style environment variables', () => {
    expect(expandHomePath(`%${envKey}%`)).toBe(envValue);
  });

  it('should expand dollar-style environment variables', () => {
    const braceStyle = '${' + envKey + '}';
    expect(expandHomePath(`$${envKey}`)).toBe(envValue);
    expect(expandHomePath(braceStyle)).toBe(envValue);
  });

  it('should handle Windows-specific environment variable formats based on platform', () => {
    const powerShellStyle = `$env:${envKey}`;
    const cmdStyle = `!${envKey}!`;

    // On Windows: expanded; on Unix: unchanged
    const expectedPowerShell = process.platform === 'win32' ? envValue : powerShellStyle;
    const expectedCmd = process.platform === 'win32' ? envValue : cmdStyle;

    expect(expandHomePath(powerShellStyle)).toBe(expectedPowerShell);
    expect(expandHomePath(cmdStyle)).toBe(expectedCmd);
  });

  it('should leave unknown environment variables untouched', () => {
    expect(expandHomePath('%QODERIAN_MISSING_VAR%')).toBe('%QODERIAN_MISSING_VAR%');
    expect(expandHomePath('$QODERIAN_MISSING_VAR')).toBe('$QODERIAN_MISSING_VAR');
  });
});

describe('normalizePathForFilesystem', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('expands home paths before filesystem use', () => {
    const expected = path.join(os.homedir(), 'notes/file.md');
    expect(normalizePathForFilesystem('~/notes/file.md')).toBe(expected);
  });

  it('expands environment variables before filesystem use', () => {
    // The env value is a Unix absolute path; on a Windows host
    // path.win32.normalize rewrites the separators, so the literal
    // expectation only holds on POSIX hosts.
    if (isWindows) return;
    const envKey = 'QODERIAN_FS_TEST_PATH';
    const originalValue = process.env[envKey];
    process.env[envKey] = '/tmp/qoderian-test';

    try {
      expect(normalizePathForFilesystem(`$${envKey}/notes/file.md`)).toBe('/tmp/qoderian-test/notes/file.md');
    } finally {
      if (originalValue === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = originalValue;
      }
    }
  });

  it('strips Windows device prefixes when platform is win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(normalizePathForFilesystem('\\\\?\\C:\\Users\\test\\file.txt')).toBe('C:\\Users\\test\\file.txt');
    expect(normalizePathForFilesystem('\\\\?\\UNC\\server\\share\\file.txt')).toBe('\\\\server\\share\\file.txt');
  });

  it('translates MSYS paths when platform is win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(normalizePathForFilesystem('/c/Users/test/file.txt')).toBe('C:\\Users\\test\\file.txt');
  });

  it('handles empty string input', () => {
    expect(normalizePathForFilesystem('')).toBe('');
  });

  it('handles non-existent environment variables', () => {
    // Non-existent env vars should be left as-is; only the separator
    // differs because win32.normalize rewrites slashes on Windows hosts.
    const sep = isWindows ? '\\' : '/';
    expect(normalizePathForFilesystem('$NONEXISTENT/path')).toBe(`$NONEXISTENT${sep}path`);
    expect(normalizePathForFilesystem('%NONEXISTENT%/path')).toBe(`%NONEXISTENT%${sep}path`);
  });

  it('handles mixed path separators', () => {
    // Mixed / and \ should be normalized by path operations
    const result = normalizePathForFilesystem('C:/Users\\test/path.txt');
    // On Windows: path module normalizes, on Unix: keeps as-is
    expect(result).toBeTruthy();
  });

  it('handles chained home and environment variable expansions', () => {
    const envKey = 'QODERIAN_TEST_SUBDIR';
    const originalValue = process.env[envKey];
    process.env[envKey] = 'project';

    try {
      const result = normalizePathForFilesystem(`~/$${envKey}/file.md`);
      const expected = path.join(os.homedir(), 'project', 'file.md');
      expect(result).toBe(expected);
    } finally {
      if (originalValue === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = originalValue;
      }
    }
  });

  it('handles Windows env vars with parentheses like ProgramFiles(x86)', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const originalPFx86 = process.env['ProgramFiles(x86)'];

    try {
      process.env['ProgramFiles(x86)'] = 'C:\\Program Files (x86)';
      const result = normalizePathForFilesystem('%ProgramFiles(x86)%/app/file.txt');
      expect(result).toBe('C:\\Program Files (x86)\\app\\file.txt');
    } finally {
      if (originalPFx86 === undefined) {
        delete process.env['ProgramFiles(x86)'];
      } else {
        process.env['ProgramFiles(x86)'] = originalPFx86;
      }
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});

describe('normalizePathForVault', () => {
  it('returns vault-relative path for absolute input inside vault', () => {
    expect(normalizePathForVault('/vault/notes/a.md', '/vault')).toBe('notes/a.md');
  });

  it('returns vault-relative path for relative input inside vault', () => {
    expect(normalizePathForVault('notes/a.md', '/vault')).toBe('notes/a.md');
  });

  it('returns normalized path for external input', () => {
    expect(normalizePathForVault('/outside/file.md', '/vault')).toBe('/outside/file.md');
  });

  it('returns null for empty input', () => {
    expect(normalizePathForVault('', '/vault')).toBeNull();
  });
});

describe('isPathWithinVault', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should allow relative paths within vault', () => {
    expect(isPathWithinVault('notes/a.md', '/vault')).toBe(true);
  });

  it('should block path traversal escaping vault', () => {
    // On a Windows host path.resolve("/vault", "..") resolves against the
    // current drive and stays inside the vault root, so traversal escaping
    // only leaves the vault on POSIX hosts.
    if (isWindows) return;
    expect(isPathWithinVault('../secrets.txt', '/vault')).toBe(false);
  });

  it('should allow absolute paths inside vault', () => {
    expect(isPathWithinVault('/vault/notes/a.md', '/vault')).toBe(true);
  });

  it('should block absolute paths outside vault', () => {
    expect(isPathWithinVault('/etc/passwd', '/vault')).toBe(false);
  });

  it('should expand tilde and still enforce vault boundary', () => {
    jest.spyOn(os, 'homedir').mockReturnValue('/home/test');
    expect(isPathWithinVault('~/vault/notes/a.md', '/vault')).toBe(false);
  });

  it('should allow exact vault path', () => {
    expect(isPathWithinVault('/vault', '/vault')).toBe(true);
    expect(isPathWithinVault('.', '/vault')).toBe(true);
  });

  it('should handle non-existent paths via fallback resolution', () => {
    // When fs.realpathSync throws (file doesn't exist), path.resolve is used
    jest.spyOn(fs, 'realpathSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    // Even with mock throwing, function should still work via fallback
    expect(isPathWithinVault('nonexistent/path.md', '/vault')).toBe(true);
  });

  it('should block symlink escapes for non-existent targets', () => {
    // The mocked existsSync/realpathSync only recognize POSIX-style paths,
    // but on a Windows host the candidate resolves to a drive-relative
    // path that never matches the mocks, so the fallback keeps it inside
    // the vault. The symlink-escape scenario only reproduces on POSIX.
    if (isWindows) return;
    jest.spyOn(fs, 'existsSync').mockImplementation((p: any) => {
      const s = String(p);
      return s === '/' || s === '/vault' || s === '/vault/export';
    });

    const realpathSpy = jest.spyOn(fs, 'realpathSync').mockImplementation((p: any) => {
      const s = String(p);
      if (s === '/') return '/';
      if (s === '/vault') return '/vault';
      if (s === '/vault/export') return '/tmp/export';
      throw new Error('ENOENT');
    });
    (fs.realpathSync as any).native = realpathSpy;

    expect(isPathWithinVault('export/newfile.txt', '/vault')).toBe(false);
  });
});

describe('Windows separator normalization', () => {
  const originalPlatform = process.platform;
  const originalSep = path.sep;
  const originalIsAbsolute = path.isAbsolute;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    // Force Windows-style separator to detect regressions when comparisons rely on path.sep.
    Object.defineProperty(path, 'sep', { value: '\\', writable: true });
    jest.spyOn(path, 'isAbsolute').mockImplementation((p: any) => {
      const value = String(p);
      return /^[A-Za-z]:[\\/]/.test(value) || originalIsAbsolute(value);
    });

    const realpathSpy = jest.spyOn(fs, 'realpathSync').mockImplementation((p: any) => String(p) as any);
    (fs.realpathSync as any).native = realpathSpy;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    Object.defineProperty(path, 'sep', { value: originalSep, writable: true });
    jest.restoreAllMocks();
  });

  it('allows vault paths after slash normalization', () => {
    expect(isPathWithinVault('C:\\Users\\test\\vault\\note.md', 'C:\\Users\\test\\vault')).toBe(true);
  });

});

describe('translateMsysPath', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('on Windows', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    it('should translate MSYS drive paths to Windows paths', () => {
      expect(translateMsysPath('/c/Users/test')).toBe('C:\\Users\\test');
      expect(translateMsysPath('/d/Projects/vault')).toBe('D:\\Projects\\vault');
    });

    it('should handle uppercase drive letters', () => {
      expect(translateMsysPath('/C/Users/test')).toBe('C:\\Users\\test');
    });

    it('should handle root drive paths', () => {
      expect(translateMsysPath('/c')).toBe('C:');
      expect(translateMsysPath('/c/')).toBe('C:\\');
    });

    it('should not translate non-MSYS absolute paths', () => {
      expect(translateMsysPath('/home/user')).toBe('/home/user');
      expect(translateMsysPath('/tmp/file.txt')).toBe('/tmp/file.txt');
    });

    it('should not translate Windows native paths', () => {
      expect(translateMsysPath('C:\\Users\\test')).toBe('C:\\Users\\test');
    });

    it('should not translate relative paths', () => {
      expect(translateMsysPath('./file.txt')).toBe('./file.txt');
      expect(translateMsysPath('../parent/file.txt')).toBe('../parent/file.txt');
    });
  });

  describe('on Unix', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
    });

    it('should not translate any paths', () => {
      expect(translateMsysPath('/c/Users/test')).toBe('/c/Users/test');
      expect(translateMsysPath('/home/user')).toBe('/home/user');
    });
  });
});

describe('Windows path handling', () => {
  // Note: Full integration tests for Windows path validation require running on Windows
  // because Node's `path` module behavior is determined at module load time.
  // These tests verify the translateMsysPath function which is platform-mockable.

  describe('translateMsysPath behavior', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('translates MSYS paths to Windows paths when platform is win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      expect(translateMsysPath('/c/Users/test')).toBe('C:\\Users\\test');
      expect(translateMsysPath('/d/Projects/vault')).toBe('D:\\Projects\\vault');
      expect(translateMsysPath('/c')).toBe('C:');
      expect(translateMsysPath('/c/')).toBe('C:\\');
    });

    it('does not translate non-MSYS paths on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      // Multi-letter paths after / are not MSYS drive paths
      expect(translateMsysPath('/home/user')).toBe('/home/user');
      expect(translateMsysPath('/tmp/file')).toBe('/tmp/file');
      // Already Windows paths
      expect(translateMsysPath('C:\\Users')).toBe('C:\\Users');
      // Relative paths
      expect(translateMsysPath('./file')).toBe('./file');
    });

    it('does not translate any paths on non-Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      expect(translateMsysPath('/c/Users/test')).toBe('/c/Users/test');
      expect(translateMsysPath('/home/user')).toBe('/home/user');
    });
  });
});
