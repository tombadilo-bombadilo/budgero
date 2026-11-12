import { Trans, useLingui } from '@lingui/react/macro';
import { Plus, X } from 'lucide-react';
import React from 'react';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { cn } from '@shared/lib/utils';
import { ACCOUNT_TYPES, type AccountInput } from '../onboarding-data';
import { FIELD_CLASS, SELECT_ITEM_CLASS, Title, getCurrencySym, type StepProps } from './shared';

export const AccountsStep: React.FC<StepProps> = ({ cur, state, set }) => {
  const { t } = useLingui();

  const addAccount = () =>
    set({
      accounts: [...state.accounts, { id: Date.now(), type: 'checking', name: '', balance: '' }],
    });
  const updateAcct = (id: number, patch: Partial<AccountInput>) =>
    set({ accounts: state.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const removeAcct = (id: number) => set({ accounts: state.accounts.filter((a) => a.id !== id) });
  const sym = getCurrencySym(state.currency);
  return (
    <div>
      <Title h={cur.title} sub={cur.subtitle} />
      <div className="grid gap-2">
        {state.accounts.map((a) => {
          const type = ACCOUNT_TYPES.find((t) => t.id === a.type) ?? ACCOUNT_TYPES[0];
          return (
            // Phone: type and ✕ on top, name and balance underneath.
            // Desktop: one row (the inner rows dissolve with md:contents).
            <div
              key={a.id}
              data-keep-in-view
              className="grid scroll-my-3 gap-2 rounded-lg border bg-card p-2 md:flex md:items-center"
            >
              <div className="flex gap-2 md:contents">
                <Select
                  value={a.type}
                  onValueChange={(value) =>
                    updateAcct(a.id, { type: value as AccountInput['type'] })
                  }
                >
                  <SelectTrigger
                    aria-label={t`Account type`}
                    className={cn(FIELD_CLASS, 'h-9 min-w-0 flex-1 md:w-36 md:flex-none')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((tp) => (
                      <SelectItem key={tp.id} value={tp.id} className={SELECT_ITEM_CLASS}>
                        {t(tp.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeAcct(a.id)}
                  aria-label={t`Remove account`}
                  className="size-9 shrink-0 md:order-last"
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="flex gap-2 md:contents">
                <Input
                  value={a.name}
                  onChange={(e) => updateAcct(a.id, { name: e.target.value })}
                  placeholder={t`${t(type.name)} name`}
                  className={cn(FIELD_CLASS, 'h-9 min-w-0 flex-1')}
                />
                <div className="relative w-32 shrink-0 md:w-40">
                  <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground">
                    {sym}
                  </span>
                  <Input
                    value={a.balance}
                    onChange={(e) => updateAcct(a.id, { balance: e.target.value })}
                    placeholder={type.isDebt ? t`Amount owed` : '0.00'}
                    aria-label={t`${t(type.balanceLabel)} for ${a.name.trim() || t(type.name)}`}
                    type="number"
                    inputMode="decimal"
                    min={type.isDebt ? 0 : undefined}
                    className={cn(FIELD_CLASS, 'h-9 text-right tabular-nums')}
                    style={{ paddingLeft: `${Math.max(1.75, 0.9 + sym.length * 0.55)}rem` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {state.accounts.some((a) => a.type === 'credit') && (
        <p className="mt-2 text-xs text-muted-foreground">
          <Trans>
            For credit cards, enter the amount you currently owe — the card will open with that
            balance as debt.
          </Trans>
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={addAccount}
        className="mt-2 w-full border-dashed"
      >
        <Plus className="size-4" />
        <Trans>Add another account</Trans>
      </Button>
    </div>
  );
};
