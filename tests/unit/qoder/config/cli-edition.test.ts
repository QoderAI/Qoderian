import * as os from 'os';
import * as path from 'path';

import {
  getActiveQoderCliEdition,
  getQoderCliBinaryBaseName,
  getQoderCliHomeDir,
  getQoderCliLoginCommand,
  normalizeQoderCliEdition,
  setActiveQoderCliEdition,
} from '@/qoder/config/cli-edition';
import { getQoderSettings } from '@/qoder/config/settings';
import { getSDKProjectsPath } from '@/qoder/history/sdk-session-paths';

describe('cli-edition', () => {
  afterEach(() => {
    setActiveQoderCliEdition('global');
  });

  describe('normalizeQoderCliEdition', () => {
    it('keeps valid editions', () => {
      expect(normalizeQoderCliEdition('global')).toBe('global');
      expect(normalizeQoderCliEdition('cn')).toBe('cn');
    });

    it('falls back to the global build for unknown values', () => {
      expect(normalizeQoderCliEdition(undefined)).toBe('global');
      expect(normalizeQoderCliEdition('')).toBe('global');
      expect(normalizeQoderCliEdition('qoderclicn')).toBe('global');
      expect(normalizeQoderCliEdition(42)).toBe('global');
    });
  });

  describe('edition-specific names and paths', () => {
    it('maps binary names per edition', () => {
      expect(getQoderCliBinaryBaseName('global')).toBe('qodercli');
      expect(getQoderCliBinaryBaseName('cn')).toBe('qoderclicn');
    });

    it('maps config roots per edition', () => {
      expect(getQoderCliHomeDir('global', '/home/test')).toBe(path.join('/home/test', '.qoder'));
      expect(getQoderCliHomeDir('cn', '/home/test')).toBe(path.join('/home/test', '.qoder-cn'));
    });

    it('builds the login command from the binary name', () => {
      expect(getQoderCliLoginCommand('global')).toBe('qodercli login');
      expect(getQoderCliLoginCommand('cn')).toBe('qoderclicn login');
    });
  });

  describe('active edition registry', () => {
    it('defaults to the global build', () => {
      expect(getActiveQoderCliEdition()).toBe('global');
    });

    it('normalizes updates', () => {
      setActiveQoderCliEdition('cn');
      expect(getActiveQoderCliEdition()).toBe('cn');

      setActiveQoderCliEdition('bogus' as never);
      expect(getActiveQoderCliEdition()).toBe('global');
    });
  });

  describe('getQoderSettings edition handling', () => {
    it('defaults to the global build when absent', () => {
      expect(getQoderSettings({}).edition).toBe('global');
    });

    it('round-trips a stored cn edition', () => {
      const settings = { qoder: { edition: 'cn' } };
      expect(getQoderSettings(settings).edition).toBe('cn');
    });

    it('coerces invalid stored values back to global', () => {
      const settings = { qoder: { edition: 'enterprise' } };
      expect(getQoderSettings(settings).edition).toBe('global');
    });
  });

  describe('edition-aware SDK session paths', () => {
    it('points at ~/.qoder/projects for the global build', () => {
      setActiveQoderCliEdition('global');
      expect(getSDKProjectsPath()).toBe(path.join(os.homedir(), '.qoder', 'projects'));
    });

    it('points at ~/.qoder-cn/projects for the China build', () => {
      setActiveQoderCliEdition('cn');
      expect(getSDKProjectsPath()).toBe(path.join(os.homedir(), '.qoder-cn', 'projects'));
    });
  });
});
