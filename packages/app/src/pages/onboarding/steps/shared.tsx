/* eslint-disable react-refresh/only-export-components */
// Shared bits for the onboarding step components: the common prop shape,
// hand-rolled "paper" primitives (hero image, title, input row, selection
// tile, field label, ghost button), the repeated palette hex tokens, and
// the money/date formatting helpers a few steps need.
//
// Styling is intentionally inline (paper/editorial) — distinct from the
// post-onboarding shadcn dashboard.
import React from 'react';
import { CURRENCIES, type OnboardingFormState, type OnboardingStepDef } from '../onboarding-data';

// Repeated palette tokens. Centralized because the same handful of hex
// values are re-typed dozens of times across the step files — not because
// the design system needs named colors beyond onboarding.
export const PAPER = '#fffdf8';
export const PAPER_HIGHLIGHT = '#fbf7eb';
export const INK = '#141414';
export const INK_MUTED = '#393939';

export function getCurrencySym(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.sym ?? '$';
}

// Inclusive month count between today and an ISO date, clamped at >= 1 so
// monthly math never divides by zero when the user picks today / yesterday.
export function monthsBetweenNow(iso: string): number {
  const target = new Date(iso);
  const now = new Date();
  if (Number.isNaN(target.getTime())) return 1;
  const months =
    (target.getFullYear() - now.getFullYear()) * 12 +
    (target.getMonth() - now.getMonth()) +
    (target.getDate() >= now.getDate() ? 0 : -1);
  return Math.max(1, months);
}

export function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function formatMoney(sym: string, amount: number): string {
  return `${sym}${Math.round(amount).toLocaleString()}`;
}

export interface StepProps {
  cur: OnboardingStepDef;
  state: OnboardingFormState;
  set: (patch: Partial<OnboardingFormState>) => void;
}

// Shared full-bleed hero image used at the top of most onboarding steps.
export const StepHeroImage: React.FC<{ src: string; alt: string }> = ({ src, alt }) => (
  <div
    style={{
      margin: '-20px -24px 20px',
      display: 'flex',
      justifyContent: 'center',
      background: PAPER,
    }}
  >
    <img
      src={src}
      alt={alt}
      style={{
        width: '100%',
        maxWidth: 520,
        height: 'auto',
        display: 'block',
        mixBlendMode: 'multiply',
      }}
    />
  </div>
);

export const Title: React.FC<{ h: string; sub?: string }> = ({ h, sub }) => (
  <div style={{ marginBottom: 28 }}>
    <h1
      className="bo-title"
      style={{
        margin: 0,
        fontSize: 34,
        fontWeight: 700,
        letterSpacing: -0.5,
        lineHeight: 1.15,
        color: INK,
      }}
    >
      {h}
    </h1>
    {sub && (
      <p
        className="bo-title-sub"
        style={{
          margin: '10px 0 0',
          fontSize: 14,
          color: INK_MUTED,
          lineHeight: 1.55,
          maxWidth: 520,
        }}
      >
        {sub}
      </p>
    )}
  </div>
);

export const InputRow: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  prefix?: string;
  big?: boolean;
  type?: string;
}> = ({ value, onChange, placeholder, prefix, big, type }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      border: '1px dashed rgba(57,57,57,0.55)',
      background: PAPER,
      padding: big ? '14px 18px' : '10px 14px',
      fontFamily: 'IBM Plex Mono, monospace',
    }}
  >
    {prefix && (
      <span style={{ color: INK_MUTED, marginRight: 8, fontSize: big ? 20 : 14 }}>{prefix}</span>
    )}
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      style={{
        flex: 1,
        background: 'transparent',
        border: 'none',
        outline: 'none',
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: big ? 22 : 14,
        color: INK,
      }}
    />
  </div>
);

// Small uppercase label above a field/section — repeated verbatim across
// PasswordStep and GoalStep (marginBottom varies: 6 for fields, 8 for the
// "how do you want to save?" section header).
export const FieldLabel: React.FC<{ children: React.ReactNode; marginBottom?: number }> = ({
  children,
  marginBottom = 6,
}) => (
  <div style={{ fontSize: 11, color: INK_MUTED, marginBottom, letterSpacing: 0.5 }}>{children}</div>
);

/**
 * Shared "selection tile" button — the active/inactive border+background
 * swap repeated across StartModeStep, CurrencyStep, GoalStep (template
 * picker + mode toggle), WhereHeardStep, and ThemeStep. Everything besides
 * that swap (icon, copy, internal layout) is supplied via `style` +
 * children since each site's internals differ.
 *
 * `borderAlpha` genuinely varies by call site (0.4–0.45) — pass it
 * explicitly rather than normalizing every site to one value.
 * `activeBg` defaults to the paper highlight; ThemeStep intentionally keeps
 * the same background whether active or not (its preview swatch already
 * shows selection), so it passes `activeBg={PAPER}`.
 */
export const OnboardingOptionTile: React.FC<{
  active: boolean;
  onClick: () => void;
  borderAlpha?: number;
  activeBg?: string;
  type?: 'button';
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({
  active,
  onClick,
  borderAlpha = 0.4,
  activeBg = PAPER_HIGHLIGHT,
  type,
  style,
  children,
}) => (
  <button
    type={type}
    onClick={onClick}
    style={{
      textAlign: 'left',
      border: active ? `1.5px solid ${INK}` : `1px dashed rgba(57,57,57,${borderAlpha})`,
      background: active ? activeBg : PAPER,
      cursor: 'pointer',
      fontFamily: 'inherit',
      ...style,
    }}
  >
    {children}
  </button>
);

// Full-width dashed "ghost" action button — repeated verbatim (modulo the
// disabled state) between ShareStep's "+ INVITE SOMEONE" and AccountsStep's
// "+ ADD ANOTHER ACCOUNT".
export const OnboardingGhostButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ onClick, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      marginTop: 12,
      padding: '10px 14px',
      border: `1px dashed ${INK}`,
      background: 'transparent',
      fontFamily: 'inherit',
      fontSize: 12,
      cursor: disabled ? 'not-allowed' : 'pointer',
      width: '100%',
      letterSpacing: 0.5,
      opacity: disabled ? 0.4 : 1,
    }}
  >
    {children}
  </button>
);
