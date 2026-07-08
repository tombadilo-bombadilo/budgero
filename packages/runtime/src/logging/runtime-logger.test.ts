import { afterEach, describe, expect, it, vi } from 'vitest';
import { logRuntime, logRuntimeError } from './runtime-logger';
import { createStorageMock } from '../__tests__/storage-mock';

describe('runtime logger', () => {
  const localStorageMock = createStorageMock();

  afterEach(() => {
    localStorageMock.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('suppresses debug when debug flag is off', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    logRuntime('debug', 'Test', 'hidden');
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('prints debug when debug flag is on', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    localStorageMock.setItem('budgero_debug', '1');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    logRuntime('debug', 'Test', 'visible');
    expect(debugSpy).toHaveBeenCalledWith('[Runtime][Test] visible');
  });

  it('uses appropriate console methods and context', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    localStorageMock.setItem('budgero_debug', '1');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logRuntime('warn', 'Comp', 'warned', { a: 1 });
    logRuntime('error', 'Comp', 'errored');
    logRuntime('info', 'Comp', 'info');

    expect(warnSpy).toHaveBeenCalledWith('[Runtime][Comp] warned', { a: 1 });
    expect(errSpy).toHaveBeenCalledWith('[Runtime][Comp] errored');
    expect(logSpy).toHaveBeenCalledWith('[Runtime][Comp] info');
  });

  it('suppresses info when debug flag is off', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logRuntime('info', 'Test', 'hidden');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs runtime errors with wrapped context', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('boom');

    logRuntimeError('Comp', 'failed', error, { x: 1 });

    expect(errSpy).toHaveBeenCalledWith('[Runtime][Comp] failed', {
      error: 'boom',
      originalError: error,
      x: 1,
    });
  });
});
