import { requestUrl } from 'obsidian';

import {
  fetchAvailableQoderianUpdate,
  isNewerQoderianVersion,
} from '@/features/update/plugin-update-checker';

const mockRequestUrl = requestUrl as jest.Mock;

describe('plugin update checker', () => {
  beforeEach(() => {
    mockRequestUrl.mockReset();
  });

  it.each([
    ['1.0.7', '1.0.8', true],
    ['1.0.7', '1.1.0', true],
    ['1.9.9', '2.0.0', true],
    ['1.0.7', '1.0.7', false],
    ['1.0.8', '1.0.7', false],
    ['invalid', '1.0.8', false],
  ])('compares %s with %s', (current, latest, expected) => {
    expect(isNewerQoderianVersion(current, latest)).toBe(expected);
  });

  it('returns the newer stable GitHub release', async () => {
    mockRequestUrl.mockResolvedValue({
      json: {
        tag_name: 'v1.1.0',
        html_url: 'https://github.com/QoderAI/Qoderian/releases/tag/v1.1.0',
      },
    });

    await expect(fetchAvailableQoderianUpdate('1.0.7')).resolves.toEqual({
      version: '1.1.0',
      url: 'https://github.com/QoderAI/Qoderian/releases/tag/v1.1.0',
    });
  });

  it('fails silently when offline', async () => {
    mockRequestUrl.mockRejectedValue(new Error('offline'));

    await expect(fetchAvailableQoderianUpdate('1.0.7')).resolves.toBeNull();
  });
});
