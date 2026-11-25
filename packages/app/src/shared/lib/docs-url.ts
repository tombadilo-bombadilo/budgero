/** budgero.app docs page; English is unprefixed, the other locales are not. */
export function docsUrl(slug: string, locale: string): string {
  const prefix = ['de', 'fr', 'es', 'nl'].includes(locale) ? `/${locale}` : '';
  return `https://budgero.app${prefix}/docs/${slug}`;
}
