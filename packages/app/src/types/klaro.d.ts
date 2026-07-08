/**
 * Klaro 0.7 ships JS only with no .d.ts files. We type just enough surface
 * for our usage; the full API is in `klaro-config.ts` as exported interfaces.
 */
declare module 'klaro' {
  import type { KlaroApi } from '@shared/lib/analytics/klaro-config';
  const klaro: KlaroApi;
  export default klaro;
  export const setup: KlaroApi['setup'];
  export const getManager: KlaroApi['getManager'];
  export const show: KlaroApi['show'];
  export const render: KlaroApi['render'];
}

declare module 'klaro/dist/klaro.css';
declare module '@shared/lib/analytics/klaro-theme.css';
