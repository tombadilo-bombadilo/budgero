import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useMemo } from 'react';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import {
  defaultRoutes,
  readRememberedRoutes,
  sourceAccountsOf,
} from '@features/import/lib/account-routes';
import type { AccountRoute, ImportConfig } from '@features/import/model/types';

interface Account {
  ID: number;
  Name: string;
  Currency: string;
}

interface AccountsInFilePanelProps {
  rows: Record<string, string>[];
  column: string;
  budgetId: number;
  accounts: Account[];
  importConfig: ImportConfig;
  onImportConfigChange: (config: ImportConfig) => void;
}

const NEW = 'new';
const SKIP = 'skip';

/**
 * "Accounts in this file": one row per value of the Account column, each sent
 * to an existing account, a new one, or skipped. Starts from a same-name
 * account, else the account chosen for it last time, else a new account.
 */
export function AccountsInFilePanel({
  rows,
  column,
  budgetId,
  accounts,
  importConfig,
  onImportConfigChange,
}: AccountsInFilePanelProps) {
  const { t } = useLingui();
  const sources = useMemo(() => sourceAccountsOf(rows, column), [rows, column]);
  const routes = importConfig.accountRoutes ?? {};

  useEffect(() => {
    const current = importConfig.accountRoutes ?? {};
    const next = defaultRoutes(sources, accounts, readRememberedRoutes(budgetId), current);
    const same =
      Object.keys(next).length === Object.keys(current).length &&
      Object.entries(next).every(([k, v]) => JSON.stringify(current[k]) === JSON.stringify(v));
    if (!same) onImportConfigChange({ ...importConfig, accountRoutes: next });
  }, [sources, accounts, budgetId, importConfig, onImportConfigChange]);

  const setRoute = (source: string, route: AccountRoute) =>
    onImportConfigChange({ ...importConfig, accountRoutes: { ...routes, [source]: route } });

  if (sources.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border p-4" data-testid="accounts-in-file">
      <div>
        <Label className="text-sm font-medium">
          <Trans>Accounts in this file</Trans>
        </Label>
        <p className="text-xs text-muted-foreground">
          {plural(sources.length, {
            one: `The "${column}" column names one account. Choose where its transactions go.`,
            other: `The "${column}" column names # accounts. Choose where each one’s transactions go.`,
          })}
        </p>
      </div>
      <ul className="space-y-3">
        {sources.map(({ source, rows: count, currency }) => {
          const route = routes[source];
          const value = route?.kind === 'existing' ? String(route.accountId) : (route?.kind ?? NEW);
          return (
            <li
              key={source}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-start"
            >
              <div className="min-w-0 pt-1.5">
                <div className="truncate text-sm font-medium" title={source}>
                  {source}
                </div>
                <div className="text-xs text-muted-foreground">
                  {plural(count, { one: '# transaction', other: '# transactions' })}
                  {currency ? ` · ${currency}` : ''}
                </div>
              </div>
              <div className="min-w-0 space-y-2">
                <Select
                  value={value}
                  onValueChange={(next) =>
                    setRoute(
                      source,
                      next === NEW
                        ? { kind: 'new', name: source }
                        : next === SKIP
                          ? { kind: 'skip' }
                          : { kind: 'existing', accountId: Number(next) }
                    )
                  }
                >
                  <SelectTrigger className="w-full min-w-0" aria-label={t`Account for ${source}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW}>
                      <Trans>Create a new account</Trans>
                    </SelectItem>
                    {accounts.map((account) => (
                      <SelectItem key={account.ID} value={String(account.ID)}>
                        {account.Name} ({account.Currency})
                      </SelectItem>
                    ))}
                    <SelectItem value={SKIP}>
                      <Trans>Don’t import</Trans>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {route?.kind === 'new' && (
                  <Input
                    value={route.name}
                    onChange={(event) =>
                      setRoute(source, { kind: 'new', name: event.target.value })
                    }
                    aria-label={t`New account name for ${source}`}
                    placeholder={t`Account name`}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
