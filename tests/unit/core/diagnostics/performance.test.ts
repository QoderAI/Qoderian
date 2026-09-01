import {
  logElapsed,
  measure,
  measureAsync,
} from '@/core/diagnostics/performance';

describe('measureAsync', () => {
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('returns the wrapped result unchanged', async () => {
    const result = await measureAsync('stage.label', async () => 42);
    expect(result).toBe(42);
  });

  it('logs the label with an elapsed-time suffix', async () => {
    await measureAsync('stage.label', async () => undefined);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [line] = infoSpy.mock.calls[0];
    expect(line).toMatch(/^\[qoderian perf\] stage\.label: \d+(\.\d+)?ms$/);
  });

  it('logs timing and rethrows when the wrapped operation fails', async () => {
    const boom = new Error('boom');

    await expect(
      measureAsync('stage.failing', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0][0]).toMatch(/^\[qoderian perf\] stage\.failing: /);
  });
});

describe('measure', () => {
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('returns the wrapped result unchanged', () => {
    const result = measure('stage.sync', () => 42);
    expect(result).toBe(42);
  });

  it('logs the label with an elapsed-time suffix', () => {
    measure('stage.sync', () => undefined);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0][0]).toMatch(/^\[qoderian perf\] stage\.sync: \d+(\.\d+)?ms$/);
  });

  it('logs timing and rethrows when the wrapped operation fails', () => {
    const boom = new Error('boom');

    expect(() =>
      measure('stage.failing', () => {
        throw boom;
      })).toThrow(boom);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0][0]).toMatch(/^\[qoderian perf\] stage\.failing: /);
  });
});

describe('logElapsed', () => {
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('logs the elapsed time since the given origin', () => {
    const startedAt = performance.now();

    logElapsed('turn.firstChunk', startedAt);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0][0]).toMatch(/^\[qoderian perf\] turn\.firstChunk: \d+(\.\d+)?ms$/);
  });
});
