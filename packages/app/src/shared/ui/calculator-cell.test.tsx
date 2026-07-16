import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as useIsMobileModule from '@shared/hooks/useIsMobile';
import { useUiStore } from '@shared/store/useUiStore';
import { asMilli } from '@shared/lib/currency/milli';
import { CalculatorCell } from './calculator-cell';

vi.mock('@shared/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(),
}));

vi.mock('@shared/lib/haptics', () => ({
  triggerHapticFeedback: vi.fn(),
}));

describe('CalculatorCell Mobile Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.getState().setPrivacyMaskNumbers(false);
  });

  it('should show input text while editing in mobile view even with useFormatterForDisplay', () => {
    vi.spyOn(useIsMobileModule, 'useIsMobile').mockReturnValue(true);

    const onCommit = vi.fn();
    const formatter = (val: number) => `$${val.toFixed(2)}`;

    render(
      <CalculatorCell
        value={asMilli(100_000)} // $100 stored as milliunits
        onCommit={onCommit}
        formatter={formatter}
        useFormatterForDisplay
      />
    );

    // Initial state: should show formatted value (formatter is decimal-in)
    const trigger = screen.getByText('$100.00');
    expect(trigger).toBeInTheDocument();

    fireEvent.click(trigger);

    // Editing opens the mobile sheet and seeds the trigger with the raw value
    // (no localizer in this test, so the seed is value.toString() = "100").
    // Note: Multiple elements may show "100" (trigger + mobile sheet display)

    const elements = screen.getAllByText('100');
    expect(elements.length).toBeGreaterThan(0);
    expect(screen.queryByText('$100.00')).not.toBeInTheDocument();

    // Type via the numpad buttons rendered in the sheet.
    const button7 = screen.getByText('7');
    fireEvent.click(button7);

    // Now mobileText should be "1007" (may appear in multiple places)
    const updatedElements = screen.getAllByText('1007');
    expect(updatedElements.length).toBeGreaterThan(0);
  });

  it('masks non-editing desktop display when privacy mode is enabled', () => {
    vi.spyOn(useIsMobileModule, 'useIsMobile').mockReturnValue(false);
    useUiStore.getState().setPrivacyMaskNumbers(true);

    const onCommit = vi.fn();
    const formatter = (val: number) => `$${val.toFixed(2)}`;

    render(<CalculatorCell value={asMilli(1_234_560)} onCommit={onCommit} formatter={formatter} />);

    expect(screen.getByText('$******')).toBeInTheDocument();
    expect(screen.queryByText('$1234.56')).not.toBeInTheDocument();
  });

  it('reveals value while editing on mobile even when privacy mode is enabled', () => {
    vi.spyOn(useIsMobileModule, 'useIsMobile').mockReturnValue(true);
    useUiStore.getState().setPrivacyMaskNumbers(true);

    const onCommit = vi.fn();
    const formatter = (val: number) => `$${val.toFixed(2)}`;

    render(
      <CalculatorCell
        value={asMilli(100_000)} // $100 stored as milliunits
        onCommit={onCommit}
        formatter={formatter}
        useFormatterForDisplay
      />
    );

    expect(screen.getByText('$*****')).toBeInTheDocument();
    fireEvent.click(screen.getByText('$*****'));
    expect(screen.getAllByText('100').length).toBeGreaterThan(0);
  });
});

describe('CalculatorCell commitUnchanged', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.getState().setPrivacyMaskNumbers(false);
    vi.spyOn(useIsMobileModule, 'useIsMobile').mockReturnValue(false);
  });

  const editAndSave = (text: string) => {
    fireEvent.click(screen.getByRole('button'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
  };

  it('commits an entered value equal to the seeded one when commitUnchanged is set', () => {
    const onCommit = vi.fn();
    render(
      <CalculatorCell
        value={asMilli(0)}
        onCommit={onCommit}
        placeholder="0.00"
        zeroAsEmpty
        commitUnchanged
      />
    );

    editAndSave('0');
    expect(onCommit).toHaveBeenCalledWith(asMilli(0));
  });

  it('still skips no-op commits by default', () => {
    const onCommit = vi.fn();
    render(
      <CalculatorCell value={asMilli(0)} onCommit={onCommit} placeholder="0.00" zeroAsEmpty />
    );

    editAndSave('0');
    expect(onCommit).not.toHaveBeenCalled();
  });
});
