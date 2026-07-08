// Hand-drawn onboarding illustrations ported from the design handoff.
// Paper theme: dashed/hatched strokes, warm parchment fills.

import React from 'react';

const INK = '#1a1a1a';
const INK_SOFT = '#393939';
const PAPER = '#fffdf8';
const PAPER_WARM = '#f5efdf';
const ACCENT_TEAL = '#14b8a6';
const ACCENT_GREEN = '#2f7d31';
const ACCENT_ORANGE = '#f97316';

export function CategoriesIllustration({ height = 240 }: { height?: number }) {
  const group = (x: number, title: string, items: string[], c: string) => (
    <g transform={`translate(${x} 20)`}>
      <rect
        x="0"
        y="0"
        width="120"
        height="200"
        fill={PAPER}
        stroke={INK}
        strokeWidth="1.5"
        rx="3"
        strokeDasharray="3 2"
      />
      <rect x="0" y="0" width="120" height="26" fill={c} stroke={INK} strokeWidth="1.2" />
      <text
        x="60"
        y="18"
        textAnchor="middle"
        fontFamily="IBM Plex Mono, monospace"
        fontSize="10"
        fontWeight="700"
        fill={PAPER}
        letterSpacing="1"
      >
        {title}
      </text>
      {items.map((item, i) => (
        <g key={i} transform={`translate(8 ${40 + i * 28})`}>
          <rect
            x="0"
            y="0"
            width="104"
            height="22"
            fill={PAPER_WARM}
            stroke={INK_SOFT}
            strokeWidth="0.8"
            rx="2"
          />
          <circle cx="12" cy="11" r="4" fill={c} stroke={INK} strokeWidth="0.8" />
          <text x="22" y="14" fontFamily="IBM Plex Mono, monospace" fontSize="8" fill={INK}>
            {item}
          </text>
        </g>
      ))}
    </g>
  );
  return (
    <svg viewBox="0 0 440 240" style={{ width: '100%', height, display: 'block' }}>
      {group(20, 'NEEDS', ['Rent', 'Groceries', 'Utilities', 'Transport'], ACCENT_TEAL)}
      {group(160, 'WANTS', ['Dining out', 'Subscriptions', 'Hobbies'], ACCENT_ORANGE)}
      {group(300, 'SAVINGS', ['Emergency', 'Vacation', 'Retirement'], ACCENT_GREEN)}
    </svg>
  );
}
