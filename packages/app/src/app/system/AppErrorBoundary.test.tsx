import { render, screen } from '@testing-library/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

const captureAppError = vi.fn();
vi.mock('@shared/lib/analytics/error-capture', () => ({
  captureAppError: (...args: unknown[]) => captureAppError(...args),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

i18n.load('en', {});
i18n.activate('en');

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new TypeError('Payee "Dr. Jane Smith" blew up');
  return <p>fine</p>;
}

function renderWith(variant: 'page' | 'section' | 'hidden', explode = true, resetKey = '/a') {
  return render(
    <I18nProvider i18n={i18n}>
      <AppErrorBoundary name="route" variant={variant} resetKey={resetKey}>
        <Bomb explode={explode} />
      </AppErrorBoundary>
    </I18nProvider>
  );
}

describe('AppErrorBoundary', () => {
  afterEach(() => captureAppError.mockClear());

  it('reports the error with the boundary name and a render_error code, then shows the fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWith('section');
    expect(captureAppError).toHaveBeenCalledTimes(1);
    const [error, options] = captureAppError.mock.calls[0]!;
    expect(error).toBeInstanceOf(TypeError);
    expect(options).toEqual({
      source: 'react',
      handled: true,
      component: 'route',
      code: 'render_error',
    });
    expect(screen.getByText('This page could not be shown')).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('renders its children again when the reset key changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = renderWith('section');
    expect(screen.queryByText('fine')).toBeNull();
    view.rerender(
      <I18nProvider i18n={i18n}>
        <AppErrorBoundary name="route" variant="section" resetKey="/b">
          <Bomb explode={false} />
        </AppErrorBoundary>
      </I18nProvider>
    );
    expect(screen.getByText('fine')).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('hidden variant renders nothing and still reports', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = renderWith('hidden');
    expect(container.textContent).toBe('');
    expect(captureAppError).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
