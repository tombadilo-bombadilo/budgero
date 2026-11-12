import { afterEach, expect, it } from 'vitest';
import { activateLocale, SUPPORTED_LOCALES } from '@shared/i18n';
import { translateGoalText } from './core-goal-text';

afterEach(() => activateLocale('en', false));

it('translates current core cycle descriptions and refreshes with the locale', async () => {
  await activateLocale('de', false);
  expect(translateGoalText('Cycle: 2026-01 to 2026-12')).toBe('Zyklus: 2026-01 bis 2026-12');
  expect(translateGoalText('Cycle: 2026-01 to 2026-04 (repeats every 4 months)')).toBe(
    'Zyklus: 2026-01 bis 2026-04 (wiederholt sich alle 4 Monate)'
  );
  await activateLocale('fr', false);
  expect(translateGoalText('Cycle: 2026-01 to 2026-12')).toBe('Cycle : de 2026-01 à 2026-12');
  expect(translateGoalText('Unknown extension message')).toBe('Unknown extension message');
});

const templates = [
  'Need {{needed}} more available',
  'Assign {{needed}} to reach your target',
  'Allocated so far: {{totalAssigned}} of {{target}} ({{pct}})',
  'Target: {{target}} available by {{targetDate}}',
  'Start saving {{monthlyTarget}} this month',
  '{{successfulMonths}}/{{monthsTracked}} months',
  'On track — {{needed}} still needed over {{monthsMore}} more months.',
  'Goal exceeded by {{excess}}',
];

it.each(SUPPORTED_LOCALES)(
  'preserves amount, date, percentage, and count markers in %s',
  async (locale) => {
    await activateLocale(locale, false);
    for (const template of templates) {
      const expected = template.match(/\{\{\w+\}\}/g)?.sort();
      const translated = translateGoalText(template);
      expect(translated.match(/\{\{\w+\}\}/g)?.sort()).toEqual(expected);
      expect(translated).not.toContain('{}');
    }
  }
);
