import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useUiStore } from '@shared/store/useUiStore';
import { TEXT_SIZE_SCALE, TEXT_SIZE_STORAGE_KEY } from './text-size';

const appRoot = resolve(__dirname, '../../../..');

afterEach(() => useUiStore.getState().setTextSize('default'));

it('applies the text size to the root element and remembers it on this device', () => {
  useUiStore.getState().setTextSize('larger');
  expect(document.documentElement.getAttribute('data-text-size')).toBe('larger');
  expect(localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBe('larger');

  useUiStore.getState().setTextSize('default');
  expect(document.documentElement.hasAttribute('data-text-size')).toBe(false);
  expect(localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBeNull();
});

it('keeps the stylesheet scale in step with the row-height scale', () => {
  const css = readFileSync(resolve(appRoot, 'src/index.css'), 'utf8');
  for (const [size, scale] of Object.entries(TEXT_SIZE_SCALE)) {
    if (size === 'default') continue;
    const rule = new RegExp(`data-text-size='${size}'\\]\\s*\\{\\s*font-size:\\s*([\\d.]+)%`);
    expect(Number(css.match(rule)?.[1]) / 100).toBe(scale);
  }
});

it('applies the stored size before the app loads (index.html)', () => {
  const html = readFileSync(resolve(appRoot, 'index.html'), 'utf8');
  const script = html.match(/<script>\s*\/\/ Text size[\s\S]*?<\/script>/)?.[0];
  expect(script).toBeDefined();
  localStorage.setItem(TEXT_SIZE_STORAGE_KEY, 'large');
  document.documentElement.removeAttribute('data-text-size');
  new Function(script!.replace(/<\/?script>/g, ''))();
  expect(document.documentElement.getAttribute('data-text-size')).toBe('large');
});
