import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportSpaceActivation } from './app-runtime';

const track = vi.fn();
const captureAppError = vi.fn();
vi.mock('@shared/lib/analytics/track', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/lib/analytics/track')>()),
  track: (...args: unknown[]) => track(...args),
}));
vi.mock('@shared/lib/analytics/error-capture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/lib/analytics/error-capture')>()),
  captureAppError: (...args: unknown[]) => captureAppError(...args),
}));

describe('reportSpaceActivation', () => {
  beforeEach(() => {
    track.mockClear();
    captureAppError.mockClear();
  });

  it('counts a clean activation without an error report', () => {
    reportSpaceActivation({ ok: true, path: 'local', durationMs: 1200 });
    expect(track).toHaveBeenCalledWith('space_activation', {
      outcome: 'ok',
      path: 'local',
      error_code: 'none',
      duration_bucket: '<10s',
    });
    expect(captureAppError).not.toHaveBeenCalled();
  });

  it('reports the error behind a fallback path, even when activation succeeded', () => {
    const cause = Object.assign(new Error('x'), { name: 'NotReadableError' });
    reportSpaceActivation({
      ok: true,
      path: 'local_after_download_failure',
      durationMs: 4000,
      fallbackError: cause,
    });
    expect(track).toHaveBeenCalledWith(
      'space_activation',
      expect.objectContaining({
        outcome: 'ok',
        path: 'local_after_download_failure',
        error_code: 'storage_error',
      })
    );
    expect(captureAppError).toHaveBeenCalledWith(cause, {
      source: 'activation',
      handled: true,
      component: 'activation:local_after_download_failure',
    });
  });

  it('reports a failed activation as unhandled', () => {
    const error = new TypeError('Failed to fetch');
    reportSpaceActivation({ ok: false, path: 'fresh', durationMs: 70_000, error });
    expect(track).toHaveBeenCalledWith(
      'space_activation',
      expect.objectContaining({ outcome: 'error', error_code: 'network', duration_bucket: '1-5m' })
    );
    expect(captureAppError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ handled: false })
    );
  });
});
