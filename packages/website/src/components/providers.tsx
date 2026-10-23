'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { PostHogProvider } from '@/components/PostHogProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      forcedTheme="light"
    >
      <PostHogProvider>{children}</PostHogProvider>
    </NextThemesProvider>
  );
}
