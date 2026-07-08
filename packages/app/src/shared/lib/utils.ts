import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Uppercase the first character of a string, leaving the rest unchanged. */
export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export type { SyncStatus } from '@budgero/runtime';
