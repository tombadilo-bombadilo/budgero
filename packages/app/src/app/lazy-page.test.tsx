import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lazyPage } from './lazy-page';

function Page() {
  return <p>page</p>;
}

const reload = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  reload.mockReset();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

class Boundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: false };
  }

  static getDerivedStateFromError() {
    return { error: true };
  }

  render() {
    return this.state.error ? <p>boundary</p> : this.props.children;
  }
}

function renderLazy(Lazy: React.ComponentType) {
  return render(
    <Boundary>
      <React.Suspense fallback={<p>loading</p>}>
        <Lazy />
      </React.Suspense>
    </Boundary>
  );
}

describe('lazyPage', () => {
  it('loads once for preload and render', async () => {
    const load = vi.fn(() => Promise.resolve({ default: Page }));
    const Lazy = lazyPage(load);
    await Lazy.preload();
    renderLazy(Lazy);
    expect(await screen.findByText('page')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed preload quiet and tries again on render', async () => {
    const load = vi
      .fn<() => Promise<{ default: typeof Page }>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ default: Page });
    const Lazy = lazyPage(load);
    await expect(Lazy.preload()).resolves.toBeUndefined();
    renderLazy(Lazy);
    expect(await screen.findByText('page')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once when a chunk fails to render, then shows the error boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi.fn(() => Promise.reject(new Error('chunk 404')));
    renderLazy(lazyPage(load));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    // The reloaded page fails again right away: no second reload.
    renderLazy(lazyPage(load));
    expect(await screen.findByText('boundary')).toBeTruthy();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
