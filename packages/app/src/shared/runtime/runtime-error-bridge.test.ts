import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeErrorBridge } from './runtime-error-bridge';

const captureAppError = vi.fn();
const addBreadcrumb = vi.fn();
vi.mock('@shared/lib/analytics/error-capture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/lib/analytics/error-capture')>();
  return {
    ...actual,
    captureAppError: (...args: unknown[]) => captureAppError(...args),
    addBreadcrumb: (...args: unknown[]) => addBreadcrumb(...args),
  };
});
vi.mock('@budgero/runtime', () => ({ logRuntime: vi.fn() }));

const SECRET = 'Payee "Dr. Jane Smith" amount 1234.56';

describe('runtimeErrorBridge', () => {
  beforeEach(() => {
    captureAppError.mockClear();
    addBreadcrumb.mockClear();
  });

  it('ignores debug/info and reports warn/error with component and event slug', () => {
    runtimeErrorBridge('info', 'SyncTransport', 'Received WS message', { type: 'ack' });
    expect(captureAppError).not.toHaveBeenCalled();
    runtimeErrorBridge('warn', 'DatabaseSync', 'Blob upload failed; retry armed', { reason: 'x' });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      'runtime',
      'DatabaseSync:blob_upload_failed_retry_armed'
    );
    const [error, options] = captureAppError.mock.calls[0]!;
    expect((error as Error).name).toBe('RuntimeWarning');
    expect(options).toMatchObject({
      source: 'runtime',
      handled: true,
      synthetic: true,
      component: 'DatabaseSync',
      event: 'blob_upload_failed_retry_armed',
      code: 'snapshot_upload_failed',
    });
  });

  it('derives the code from the logged message text and never forwards the text', () => {
    runtimeErrorBridge(
      'warn',
      'SpaceActivationService',
      'Local DB decrypt failed; attempting reset',
      {
        error: `Decryption failed: invalid password ${SECRET}`,
      }
    );
    const [, options] = captureAppError.mock.calls[0]!;
    expect(options).toMatchObject({
      code: 'decryption_failed',
      event: 'local_db_decrypt_failed_attempting_reset',
    });
    expect(JSON.stringify(options)).not.toContain('Jane');
  });

  it('prefers a real Error object and lets toErrorCode handle it', () => {
    const real = Object.assign(new Error('x'), { name: 'DatabaseError', code: 'locked' });
    runtimeErrorBridge('error', 'RuntimeContextFactory', 'Failed to persist local database', {
      originalError: real,
    });
    const [error, options] = captureAppError.mock.calls[0]!;
    expect(error).toBe(real);
    expect(options).toMatchObject({ synthetic: false });
    expect(options).not.toHaveProperty('code');
  });
});
