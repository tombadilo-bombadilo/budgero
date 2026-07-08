'use client';

import { useKlaro } from '@/components/KlaroProvider';

/** Footer link that re-opens the Klaro consent modal. */
export function ManageCookiesButton({ className }: { className?: string }) {
  const { show } = useKlaro();
  return (
    <button type="button" onClick={show} className={className}>
      Manage cookies
    </button>
  );
}
