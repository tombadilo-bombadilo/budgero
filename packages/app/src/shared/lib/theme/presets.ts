export type AppThemeId = 'default' | 'phosphor' | 'mesa' | 'obsidian' | 'paper';

export type ThemeColorMode = 'dual' | 'light' | 'dark';

export interface AppThemeOption {
  id: AppThemeId;
  name: string;
  description?: string;
  colorMode: ThemeColorMode;
  previewColors: {
    light: string;
    dark: string;
  }[];
}

export const APP_THEMES: AppThemeOption[] = [
  {
    id: 'default',
    name: 'Budgero Classic',
    description: 'Original look and feel tuned for readability.',
    colorMode: 'dual',
    previewColors: [
      { light: 'oklch(1 0 0)', dark: 'oklch(0.141 0.005 285.823)' },
      { light: 'oklch(0.21 0.006 285.885)', dark: 'oklch(0.92 0.004 286.32)' },
      { light: 'oklch(0.646 0.2 145)', dark: 'oklch(0.769 0.2 145)' },
    ],
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    description: 'Retro CRT terminal with phosphor green glow and scanlines.',
    colorMode: 'dark',
    previewColors: [
      { light: 'oklch(0.13 0 0)', dark: 'oklch(0.13 0 0)' },
      { light: 'oklch(0.75 0.20 145)', dark: 'oklch(0.75 0.20 145)' },
      { light: 'oklch(0.72 0.15 80)', dark: 'oklch(0.72 0.15 80)' },
    ],
  },
  {
    id: 'mesa',
    name: 'Mesa',
    description: 'Warm southwestern desert with sand, terracotta, and sage.',
    colorMode: 'light',
    previewColors: [
      { light: 'oklch(0.95 0.02 75)', dark: 'oklch(0.95 0.02 75)' },
      { light: 'oklch(0.62 0.14 40)', dark: 'oklch(0.62 0.14 40)' },
      { light: 'oklch(0.65 0.08 155)', dark: 'oklch(0.65 0.08 155)' },
    ],
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'Luxury editorial dark with charcoal and warm copper accents.',
    colorMode: 'dark',
    previewColors: [
      { light: 'oklch(0.15 0.01 270)', dark: 'oklch(0.15 0.01 270)' },
      { light: 'oklch(0.72 0.11 55)', dark: 'oklch(0.72 0.11 55)' },
      { light: 'oklch(0.90 0.01 75)', dark: 'oklch(0.90 0.01 75)' },
    ],
  },
  {
    id: 'paper',
    name: 'Paper',
    description:
      'Monochrome budgeting workspace with parchment canvas and red/green utility accents.',
    colorMode: 'light',
    previewColors: [
      { light: '#FBF7EB', dark: '#FBF7EB' },
      { light: '#141414', dark: '#141414' },
      { light: '#2F7D31', dark: '#C6392C' },
    ],
  },
];

export const DEFAULT_APP_THEME_ID: AppThemeId = 'default';
export const THEME_STORAGE_KEY = 'budgero:theme-preset';

export function isAppThemeId(value: unknown): value is AppThemeId {
  return (
    value === 'default' ||
    value === 'phosphor' ||
    value === 'mesa' ||
    value === 'obsidian' ||
    value === 'paper'
  );
}

export function normalizeAppThemeId(value: unknown): AppThemeId {
  if (value === 'stocktaper') {
    return 'paper';
  }
  return isAppThemeId(value) ? value : DEFAULT_APP_THEME_ID;
}
