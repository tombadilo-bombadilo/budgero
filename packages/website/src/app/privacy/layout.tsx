import React from 'react';

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      {/* Animated overlay to smooth gradients (same as landing) */}
      <div className="absolute inset-x-0 top-0 h-[70vh] md:h-[75vh] lg:h-[80vh] opacity-40 dark:opacity-25 pointer-events-none z-0">
        <div className="absolute inset-0 bg-gradient-to-r from-gray-200/30 via-gray-300/25 via-gray-400/30 to-gray-500/25 dark:from-gray-700/25 dark:via-gray-600/20 dark:via-gray-500/25 dark:to-gray-700/20 animate-gradient bg-[length:400%_400%] gradient-ultra-smooth mask-fade-y"></div>
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
