import type { ReactNode } from 'react';

export default function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-foreground relative">
      {/* Match docs/changelog overlay framing with outer guides */}
      <div className="pointer-events-none absolute inset-0 border-2 border-border/80" />
      <div className="pointer-events-none absolute inset-y-0 left-[6%] xl:left-[8%] 2xl:left-[10%] w-px bg-border/80 hidden lg:block" />
      <div className="pointer-events-none absolute inset-y-0 right-[6%] xl:right-[8%] 2xl:right-[10%] w-px bg-border/80 hidden lg:block" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
