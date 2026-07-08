import * as React from 'react';

export const DEFAULT_BREAKPOINT = 768;

export function useIsMobile(breakpoint = DEFAULT_BREAKPOINT) {
  const [isMobile, setIsMobile] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < breakpoint;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = `(max-width: ${breakpoint - 1}px)`;
    const mql = window.matchMedia(query);
    const update = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };
    const handleChange = () => update();

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleChange);
    } else if (typeof mql.addListener === 'function') {
      mql.addListener(handleChange);
    }

    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    update();

    return () => {
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', handleChange);
      } else if (typeof mql.removeListener === 'function') {
        mql.removeListener(handleChange);
      }
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [breakpoint]);

  return isMobile;
}
