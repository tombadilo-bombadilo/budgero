import { DEMO_ACCOUNT_METADATA_KEY } from '@shared/lib/demo-space';
import { formatOptions } from '@shared/lib/number-format';
import { guessDemoLocale, isDemoAccount } from './demo-workspace';

describe('guessDemoLocale', () => {
  it.each([
    ['en-US', 'USD', '$1,096.56'],
    ['en', 'USD', '$1,096.56'],
    ['en-GB', 'GBP', '$1,096.56'],
    ['en-IE', 'EUR', '$1,096.56'],
    ['en-CA', 'CAD', '1,096.56 USD'],
    ['en-AU', 'AUD', '$1,096.56'],
    ['de', 'EUR', '1.096,56 $'],
    ['de-AT', 'EUR', '1.096,56 $'],
    ['de-CH', 'CHF', '1.096,56 $'],
    ['fr-FR', 'EUR', '1 096,56 $US'],
    ['fr-CA', 'CAD', '1 096,56 $US'],
    ['fr-BE', 'EUR', '1 096,56 $US'],
    ['es-ES', 'EUR', '1.096,56 $'],
    ['es-MX', 'USD', '1.096,56 $'],
    ['es-419', 'USD', '1.096,56 $'],
    ['es-US', 'USD', '1.096,56 $'],
    ['pt-PT', 'EUR', '1.096,56 $'],
    ['pt-BR', 'USD', '1.096,56 $'],
    ['nl-NL', 'EUR', '1.096,56 $'],
    ['ca-ES', 'EUR', '1.096,56 $'],
    ['ja-JP', 'USD', '$1,096.56'],
    ['not a tag', 'USD', '$1,096.56'],
  ])('%s → %s, %s', (tag, currency, numberFormat) => {
    expect(guessDemoLocale(tag)).toEqual({ currency, numberFormat });
  });

  it('only picks number formats the app knows', () => {
    const known = new Set(formatOptions.map((option) => option.key));
    for (const tag of ['en-US', 'de-DE', 'fr-FR', 'en-CA', 'sv-SE', 'it-IT']) {
      expect(known.has(guessDemoLocale(tag).numberFormat), tag).toBe(true);
    }
  });
});

it('recognises the demo marker in account metadata, stored or parsed', () => {
  expect(isDemoAccount({ Metadata: JSON.stringify({ [DEMO_ACCOUNT_METADATA_KEY]: true }) })).toBe(
    true
  );
  expect(isDemoAccount({ Metadata: { [DEMO_ACCOUNT_METADATA_KEY]: true } })).toBe(true);
  expect(isDemoAccount({ Metadata: '{}' })).toBe(false);
  expect(isDemoAccount({ Metadata: 'not json' })).toBe(false);
  expect(isDemoAccount({})).toBe(false);
});
