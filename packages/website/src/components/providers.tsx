'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { PostHogProvider } from '@/components/PostHogProvider';
import { KlaroProvider } from '@/components/KlaroProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem={false} forcedTheme="light">
      <KlaroProvider>
        <PostHogProvider>{children}</PostHogProvider>
      </KlaroProvider>
    </NextThemesProvider>
  );
}
