import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useId } from 'react';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import type { AccountRoutePlan, RouteProblem } from '@features/import/lib/account-routes';
import type { AccountRoute, ImportConfig } from '@features/import/model/types';

interface Account {
  ID: number;
  Name: string;
  Currency: string;
  Archived?: boolean;
}

interface AccountsInFilePanelProps {
  /** planAccountRoutes for the mapped Account column. */
  plan: AccountRoutePlan;
  column: string;
  accounts: Account[];
  importConfig: ImportConfig;
  onImportConfigChange: (config: ImportConfig) => void;
}

const NEW = 'new';
const SKIP = 'skip';
/** A column that is not really the account (a counterparty IBAN) can name hundreds. */
const MAX_LISTED = 50;
const MANY_NEW_ACCOUNTS = 10;

/**
 * "Accounts in this file": one row per value of the Account column, each sent
 * to an existing account, a new one, or skipped. Starts from a same-name
 * account, else the account chosen for it last time, else a new account.
 */
export function AccountsInFilePanel({
  plan,
  column,
  accounts,
  importConfig,
  onImportConfigChange,
}: AccountsInFilePanelProps) {
  const { t } = useLingui();
  const { sources, routes, targets, newAccounts, problems } = plan;
  const archivedLabel = (name: string, currency: string) => t`${name} (${currency}, archived)`;

  // Only the user's own picks are stored; the rest stays derived from the plan.
  const setRoute = (source: string, route: AccountRoute) =>
    onImportConfigChange({
      ...importConfig,
      accountRoutes: { ...importConfig.accountRoutes, [source]: route },
    });

  if (sources.length === 0) return null;

  // Every account that needs a choice is listed; the cap only hides ones that don't.
  let fine = 0;
  const listed = sources.filter(({ source }) => problems.has(source) || fine++ < MAX_LISTED);
  const unlisted = sources.length - listed.length;

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
      {newAccounts.length > MANY_NEW_ACCOUNTS && (
        <p className="text-xs text-destructive" role="alert" data-testid="many-new-accounts">
          {plural(newAccounts.length, {
            one: `This import creates # new account. If the "${column}" column is not the account the transactions are in, set Account to None in Column Mapping.`,
            other: `This import creates # new accounts. If the "${column}" column is not the account the transactions are in, set Account to None in Column Mapping.`,
          })}
        </p>
      )}
      <ul className="space-y-3">
        {listed.map(({ source, rows: count, currency }) => {
          const route = routes[source];
          const target = targets.get(source);
          const problem = problems.get(source);
          // Unset: nothing obvious to default to (see defaultRoutes); the user picks.
          const value = !route
            ? ''
            : route.kind === 'existing'
              ? String(route.accountId)
              : route.kind;
          const pickId = `pick-${source}`;
          const shared =
            target?.kind === 'new'
              ? newAccounts.find((a) => a.placeholderId === target.placeholderId)
              : undefined;
          const sharedWith = shared && shared.sources[0] !== source ? shared.sources[0] : undefined;
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
                  <SelectTrigger
                    className="w-full min-w-0"
                    aria-label={t`Account for ${source}`}
                    aria-invalid={problem === 'pick' ? true : undefined}
                    aria-describedby={problem === 'pick' ? pickId : undefined}
                  >
                    <SelectValue placeholder={t`Pick an account`} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW}>
                      <Trans>Create a new account</Trans>
                    </SelectItem>
                    {accounts.map((account) => (
                      <SelectItem key={account.ID} value={String(account.ID)}>
                        {account.Archived
                          ? archivedLabel(account.Name, account.Currency)
                          : `${account.Name} (${account.Currency})`}
                      </SelectItem>
                    ))}
                    <SelectItem value={SKIP}>
                      <Trans>Don’t import</Trans>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {problem === 'pick' && (
                  <p id={pickId} className="text-xs text-destructive" role="alert">
                    <Trans>Pick the account these transactions go into.</Trans>
                  </p>
                )}
                {route?.kind === 'new' && target?.kind === 'new' && (
                  <NewAccountFields
                    source={source}
                    name={route.name}
                    newName={target.name}
                    newCurrency={target.currency}
                    fileCurrency={currency}
                    problem={problem}
                    sharedWith={sharedWith}
                    onNameChange={(name) => setRoute(source, { kind: 'new', name })}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {unlisted > 0 && (
        <p className="text-xs text-muted-foreground">
          {plural(unlisted, {
            one: '# more account is not listed. It goes to the account with the same name, or to a new one.',
            other:
              '# more accounts are not listed. Each goes to the account with the same name, or to a new one.',
          })}
        </p>
      )}
    </div>
  );
}

interface NewAccountFieldsProps {
  source: string;
  /** What the user typed (may be empty: the source name is used then). */
  name: string;
  /** The name the account is created with. */
  newName: string;
  newCurrency: string;
  fileCurrency?: string;
  problem?: RouteProblem;
  sharedWith?: string;
  onNameChange: (name: string) => void;
}

function NewAccountFields({
  source,
  name,
  newName,
  newCurrency,
  fileCurrency,
  problem,
  sharedWith,
  onNameChange,
}: NewAccountFieldsProps) {
  const { t } = useLingui();
  const hintId = useId();
  return (
    <>
      <Input
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        aria-label={t`New account name for ${source}`}
        aria-invalid={problem ? true : undefined}
        aria-describedby={hintId}
        placeholder={source}
        maxLength={100}
      />
      {problem === 'name-taken' ? (
        <p id={hintId} className="text-xs text-destructive" role="alert">
          <Trans>
            An account with this name already exists. Choose it from the list, or use another name.
          </Trans>
        </p>
      ) : problem === 'currency' ? (
        <p id={hintId} className="text-xs text-destructive" role="alert">
          <Trans>
            “{newName}” is created in {newCurrency}, but these transactions are in {fileCurrency}.
            Use another name.
          </Trans>
        </p>
      ) : (
        <p id={hintId} className="text-xs text-muted-foreground">
          {sharedWith ? (
            <Trans>Goes into the same new account as “{sharedWith}”.</Trans>
          ) : (
            <Trans>New account in {newCurrency}</Trans>
          )}
        </p>
      )}
    </>
  );
}
