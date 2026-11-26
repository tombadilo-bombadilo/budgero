import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DialogBackgroundBlurProvider } from '@shared/contexts/DialogBackgroundBlurContext';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';

function renderDialog(blurBackground: boolean) {
  return render(
    <DialogBackgroundBlurProvider enabled={blurBackground}>
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Example dialog</DialogTitle>
            <DialogDescription>Dialog blur test</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </DialogBackgroundBlurProvider>
  );
}

describe('Dialog background blur', () => {
  it('keeps the current blurred overlay when enabled', () => {
    renderDialog(true);
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass(
      'backdrop-blur-[4px]'
    );
  });

  it('keeps the dim overlay but removes blur when disabled', () => {
    renderDialog(false);
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).toHaveClass('bg-black/5');
    expect(overlay).not.toHaveClass('backdrop-blur-[4px]');
  });

  it('constrains grid column width so truncated header content cannot widen the dialog', () => {
    renderDialog(true);
    expect(document.querySelector('[data-slot="dialog-content"]')).toHaveClass('grid-cols-1');
    expect(document.querySelector('[data-slot="dialog-header"]')).toHaveClass('min-w-0');
  });
});
