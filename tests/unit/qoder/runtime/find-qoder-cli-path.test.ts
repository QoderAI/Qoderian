import type * as fsType from 'fs';
import type * as osType from 'os';
import type * as pathType from 'path';

const fs = jest.requireActual<typeof fsType>('fs');
const os = jest.requireActual<typeof osType>('os');
const path = jest.requireActual<typeof pathType>('path');

import { findQoderCLIPath } from '@/qoder/runtime/find-qoder-cli-path';

const isWindows = process.platform === 'win32';

describe('findQoderCLIPath', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns null when nothing found', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    const result = findQoderCLIPath('/nonexistent/path');
    expect(result).toBeNull();
  });

  it('resolves from custom path entries', () => {
    const qoderPath = isWindows
      ? 'C:\\custom\\bin\\qodercli.exe'
      : '/custom/bin/qodercli';

    jest.spyOn(fs, 'existsSync').mockImplementation(
      p => String(p) === qoderPath
    );
    jest.spyOn(fs, 'statSync').mockImplementation(
      p => ({ isFile: () => String(p) === qoderPath }) as fsType.Stats
    );

    const result = findQoderCLIPath(isWindows ? 'C:\\custom\\bin' : '/custom/bin');
    expect(result).toBe(qoderPath);
  });

  it('returns string or null', () => {
    const result = findQoderCLIPath();
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('finds qoder from common paths when no custom path provided', () => {
    const commonPath = path.join(os.homedir(), '.local', 'bin', 'qodercli');

    jest.spyOn(fs, 'existsSync').mockImplementation(
      p => String(p) === commonPath
    );
    jest.spyOn(fs, 'statSync').mockImplementation(
      p => ({ isFile: () => String(p) === commonPath }) as fsType.Stats
    );

    const result = findQoderCLIPath();
    expect(result).toBe(commonPath);
  });

  it('falls back to the official npm cli.js path when the binary is not found', () => {
    const cliPath = path.join(
      os.homedir(), '.npm-global', 'lib', 'node_modules',
      '@qoder-ai', 'qodercli', 'cli.js'
    );

    jest.spyOn(fs, 'existsSync').mockImplementation(
      p => String(p) === cliPath
    );
    jest.spyOn(fs, 'statSync').mockImplementation(
      p => ({ isFile: () => String(p) === cliPath }) as fsType.Stats
    );

    const result = findQoderCLIPath();
    expect(result).toBe(cliPath);
  });

  it('falls back to PATH environment when common and npm paths fail', () => {
    const envQoderPath = '/env/specific/bin/qodercli';
    const originalPath = process.env.PATH;
    process.env.PATH = `/env/specific/bin:${originalPath}`;

    jest.spyOn(fs, 'existsSync').mockImplementation(
      p => String(p) === envQoderPath
    );
    jest.spyOn(fs, 'statSync').mockImplementation(
      p => ({ isFile: () => String(p) === envQoderPath }) as fsType.Stats
    );

    try {
      const result = findQoderCLIPath();
      expect(result).toBe(envQoderPath);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('returns null for custom path without qoder binary on non-Windows', () => {
    // On non-Windows, custom path resolution only looks for the qodercli binary.
    const customDir = '/custom/tools';

    jest.spyOn(fs, 'existsSync').mockReturnValue(false);

    const result = findQoderCLIPath(customDir);
    expect(result).toBeNull();
  });

  it('handles inaccessible filesystem paths gracefully', () => {
    jest.spyOn(fs, 'existsSync').mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = findQoderCLIPath('/some/path');
    expect(result).toBeNull();
  });

  it('finds qoder via nvm default version when NVM_BIN is not set (Unix)', () => {
    if (isWindows) return;

    const savedNvmBin = process.env.NVM_BIN;
    const savedNvmDir = process.env.NVM_DIR;
    delete process.env.NVM_BIN;
    delete process.env.NVM_DIR;

    const nvmDir = '/fake/home/.nvm';
    const qoderPath = path.join(nvmDir, 'versions', 'node', 'v22.18.0', 'bin', 'qodercli');
    const binDir = path.join(nvmDir, 'versions', 'node', 'v22.18.0', 'bin');

    jest.spyOn(os, 'homedir').mockReturnValue('/fake/home');
    jest.spyOn(fs, 'existsSync').mockImplementation(p => {
      const s = String(p);
      return s === qoderPath || s === binDir;
    });
    jest.spyOn(fs, 'readFileSync').mockImplementation(((p: string) => {
      if (String(p) === path.join(nvmDir, 'alias', 'default')) return '22';
      throw new Error('not found');
    }) as typeof fs.readFileSync);
    jest.spyOn(fs, 'readdirSync').mockImplementation(((p: string) => {
      if (String(p) === path.join(nvmDir, 'versions', 'node')) return ['v22.18.0'];
      return [];
    }) as typeof fs.readdirSync);
    jest.spyOn(fs, 'statSync').mockImplementation(
      () => ({ isFile: () => true }) as fsType.Stats
    );

    const result = findQoderCLIPath();
    expect(result).toBe(qoderPath);

    if (savedNvmBin !== undefined) process.env.NVM_BIN = savedNvmBin;
    else delete process.env.NVM_BIN;
    if (savedNvmDir !== undefined) process.env.NVM_DIR = savedNvmDir;
    else delete process.env.NVM_DIR;
  });

  it('finds qoder via built-in nvm node alias when NVM_BIN is not set (Unix)', () => {
    if (isWindows) return;

    const savedNvmBin = process.env.NVM_BIN;
    const savedNvmDir = process.env.NVM_DIR;
    delete process.env.NVM_BIN;
    delete process.env.NVM_DIR;

    const nvmDir = '/fake/home/.nvm';
    const qoderPath = path.join(nvmDir, 'versions', 'node', 'v22.18.0', 'bin', 'qodercli');
    const binDir = path.join(nvmDir, 'versions', 'node', 'v22.18.0', 'bin');

    jest.spyOn(os, 'homedir').mockReturnValue('/fake/home');
    jest.spyOn(fs, 'existsSync').mockImplementation(p => {
      const s = String(p);
      return s === qoderPath || s === binDir;
    });
    jest.spyOn(fs, 'readFileSync').mockImplementation(((p: string) => {
      if (String(p) === path.join(nvmDir, 'alias', 'default')) return 'node';
      throw new Error('not found');
    }) as typeof fs.readFileSync);
    jest.spyOn(fs, 'readdirSync').mockImplementation(((p: string) => {
      if (String(p) === path.join(nvmDir, 'versions', 'node')) return ['v20.10.0', 'v22.18.0'];
      return [];
    }) as typeof fs.readdirSync);
    jest.spyOn(fs, 'statSync').mockImplementation(
      () => ({ isFile: () => true }) as fsType.Stats
    );

    const result = findQoderCLIPath();
    expect(result).toBe(qoderPath);

    if (savedNvmBin !== undefined) process.env.NVM_BIN = savedNvmBin;
    else delete process.env.NVM_BIN;
    if (savedNvmDir !== undefined) process.env.NVM_DIR = savedNvmDir;
    else delete process.env.NVM_DIR;
  });
});

describe('findQoderCLIPath (platform resolution)', () => {
  const originalPlatform = process.platform;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.PATH = '';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = originalEnv;
  });

  describe('on Unix/macOS', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
    });

    function mockExistingFile(...paths: string[]) {
      const pathSet = new Set(paths);
      jest.spyOn(fs, 'existsSync').mockImplementation((p: any) => pathSet.has(p));
      jest.spyOn(fs, 'statSync').mockImplementation((p: any) => ({
        isFile: () => pathSet.has(String(p)),
      }) as fsType.Stats);
    }

    it('should return first matching Qoder CLI path', () => {
      jest.spyOn(os, 'homedir').mockReturnValue('/home/test');
      mockExistingFile('/home/test/.local/bin/qodercli');

      expect(findQoderCLIPath()).toBe('/home/test/.local/bin/qodercli');
    });

    it('should return null when Qoder CLI is not found', () => {
      jest.spyOn(os, 'homedir').mockReturnValue('/home/test');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false as any);

      expect(findQoderCLIPath()).toBeNull();
    });

    it('should check the official npm package entrypoint as fallback on Unix', () => {
      jest.spyOn(os, 'homedir').mockReturnValue('/home/test');
      mockExistingFile('/usr/local/lib/node_modules/@qoder-ai/qodercli/cli.js');

      expect(findQoderCLIPath()).toBe('/usr/local/lib/node_modules/@qoder-ai/qodercli/cli.js');
    });

    it('should resolve Qoder CLI from custom PATH', () => {
      mockExistingFile('/custom/bin/qodercli');

      const customPath = '/custom/bin:/usr/bin';
      expect(findQoderCLIPath(customPath)).toBe('/custom/bin/qodercli');
    });

    it('should expand home directory in custom PATH', () => {
      jest.spyOn(os, 'homedir').mockReturnValue('/home/test');
      mockExistingFile('/home/test/bin/qodercli');

      const customPath = '~/bin:/usr/bin';
      expect(findQoderCLIPath(customPath)).toBe('/home/test/bin/qodercli');
    });

    it('should not return a directory path even if it exists', () => {
      jest.spyOn(os, 'homedir').mockReturnValue('/home/test');
      const dirPath = path.join('/home/test', '.local', 'bin', 'qodercli');
      jest.spyOn(fs, 'existsSync').mockImplementation((p: any) => p === dirPath);
      jest.spyOn(fs, 'statSync').mockImplementation(() => ({
        isFile: () => false,
      }) as fsType.Stats);

      expect(findQoderCLIPath()).toBeNull();
    });
  });

  describe('on Windows', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.ProgramFiles = 'C:\\Program Files';
      process.env['ProgramFiles(x86)'] = 'C:\\Program Files (x86)';
      process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    });

    function mockExistingFile(...paths: string[]) {
      const pathSet = new Set(paths);
      jest.spyOn(fs, 'existsSync').mockImplementation((p: any) => pathSet.has(p));
      jest.spyOn(fs, 'statSync').mockImplementation((p: any) => ({
        isFile: () => pathSet.has(String(p)),
      }) as fsType.Stats);
    }

    it('should prefer .exe when both .exe and the npm cli.js exist', () => {
      jest.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\test');
      const exePath = path.join('C:\\Users\\test', '.qoder', 'bin', 'qodercli.exe');
      const cliPath = path.join('C:\\Users\\test', 'AppData', 'Roaming', 'npm', 'node_modules', '@qoder-ai', 'qodercli', 'cli.js');
      mockExistingFile(exePath, cliPath);

      expect(findQoderCLIPath()).toBe(exePath);
    });

    it('should prioritize the official npm cli.js over .cmd files on Windows', () => {
      jest.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\test');
      // Note: path.join uses actual platform separator, so we match against that
      const cliPath = path.join('C:\\Users\\test', 'AppData', 'Roaming', 'npm', 'node_modules', '@qoder-ai', 'qodercli', 'cli.js');
      const cmdPath = path.join('C:\\Users\\test', 'AppData', 'Roaming', 'npm', 'qodercli.cmd');
      mockExistingFile(cmdPath, cliPath);

      expect(findQoderCLIPath()).toBe(cliPath);
    });

    it('should find cli.js in a custom npm global path via npm_config_prefix', () => {
      jest.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\test');
      process.env.npm_config_prefix = 'D:\\nodejs\\node_global';
      const expectedPath = path.join('D:\\nodejs\\node_global', 'node_modules', '@qoder-ai', 'qodercli', 'cli.js');
      mockExistingFile(expectedPath);

      expect(findQoderCLIPath()).toBe(expectedPath);
    });

    it('should fall back to .exe if package entrypoint is not found', () => {
      jest.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\test');
      const expectedPath = path.join('C:\\Users\\test', '.qoder', 'bin', 'qodercli.exe');
      mockExistingFile(expectedPath);

      expect(findQoderCLIPath()).toBe(expectedPath);
    });

    it('should ignore .cmd fallback on Windows', () => {
      jest.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\test');
      const expectedPath = path.join('C:\\Users\\test', 'AppData', 'Roaming', 'npm', 'qodercli.cmd');
      mockExistingFile(expectedPath);

      expect(findQoderCLIPath()).toBeNull();
    });

    it('should return null when no CLI is found on Windows', () => {
      jest.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\test');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false as any);

      expect(findQoderCLIPath()).toBeNull();
    });

    it('should resolve the official npm cli.js from a custom PATH npm prefix', () => {
      const npmBin = 'C:\\Users\\test\\AppData\\Roaming\\npm';
      const cliPath = path.join(npmBin, 'node_modules', '@qoder-ai', 'qodercli', 'cli.js');
      mockExistingFile(cliPath);

      const customPath = `${npmBin};C:\\Windows\\System32`;
      expect(findQoderCLIPath(customPath)).toBe(cliPath);
    });

    it('should not return a directory path even if it exists', () => {
      jest.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\test');
      const dirPath = path.join('C:\\Users\\test', '.qoder', 'bin', 'qodercli');
      // Simulate a directory named 'qoder' (exists but isFile returns false)
      jest.spyOn(fs, 'existsSync').mockImplementation((p: any) => p === dirPath);
      jest.spyOn(fs, 'statSync').mockImplementation(() => ({
        isFile: () => false,
      }) as fsType.Stats);

      expect(findQoderCLIPath()).toBeNull();
    });
  });
});
