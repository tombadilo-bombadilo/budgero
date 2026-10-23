import { useState } from 'react';
import { trackSettingChanged } from '@shared/lib/analytics/track';
import { useLingui } from '@lingui/react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import {
  activateLocale,
  LOCALE_FLAGS,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@shared/i18n';

export function LanguageSwitch({ id }: { id?: string }) {
  const { i18n } = useLingui();
  const [pending, setPending] = useState(false);

  const onChange = (value: string) => {
    setPending(true);
    trackSettingChanged('language', value as SupportedLocale);
    void activateLocale(value as SupportedLocale).finally(() => setPending(false));
  };

  return (
    <Select value={i18n.locale} onValueChange={onChange} disabled={pending}>
      <SelectTrigger id={id} className="w-full sm:w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LOCALES.map((locale) => (
          <SelectItem key={locale} value={locale}>
            <span className="mr-2">{LOCALE_FLAGS[locale]}</span>
            {LOCALE_LABELS[locale]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
