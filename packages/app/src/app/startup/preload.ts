let preloadHidden = false;

export function hideStartupPreload(): void {
  if (preloadHidden || typeof window === 'undefined') return;
  const preload = window.document.getElementById('budgero-preload');
  if (!preload) {
    preloadHidden = true;
    return;
  }
  preload.classList.add('is-hidden');
  preloadHidden = true;
  window.setTimeout(() => {
    preload.remove();
  }, 260);
}
