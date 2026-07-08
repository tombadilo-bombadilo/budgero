import ReactCountryFlag from 'react-country-flag';
import type { ComponentProps } from 'react';

/**
 * Country flag that loads SVGs from our own origin (`public/flags/4x3`) instead
 * of react-country-flag's default jsdelivr CDN — keeps the app CDN-free so it
 * works offline and in the privacy/self-host build.
 */
export function CountryFlag(props: ComponentProps<typeof ReactCountryFlag>) {
  return <ReactCountryFlag cdnUrl="/flags/4x3/" cdnSuffix="svg" {...props} />;
}
