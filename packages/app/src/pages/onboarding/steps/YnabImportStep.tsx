import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import type { YNABApiPlanSnapshot, YNABApiPlanSummary } from '@budgero/core/browser';
import { YNABApiClient } from '@budgero/core/browser';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import {
  YnabPatHelpPopover,
  YnabPatHelpSteps,
} from '@features/budget-management/ui/create-budget-form/YnabPatHelpPopover';
import { YnabCreditPaymentMatching } from '@features/budget-management/ui/create-budget-form/YnabCreditPaymentMatching';
import { hasCompleteCreditPaymentMappings } from '@features/budget-management/ui/create-budget-form/ynab-credit-payment-matching';
import { YnabDateOrderChoice } from '@features/budget-management/ui/create-budget-form/YnabDateOrderChoice';
import { track } from '@shared/lib/analytics/track';
import type { YnabHelpTopic } from '@shared/lib/analytics/events';
import { Title, type StepProps } from './shared';
import { classifyYnabApiError, type YnabApiFailureReason } from './ynab-source-errors';

interface YnabStepProps extends StepProps {
  onFileSelected: (file: File) => Promise<void> | void;
  onApiSnapshotSelected: (snapshot: YNABApiPlanSnapshot) => Promise<void> | void;
  isInspecting: boolean;
  /** Leave the YNAB path for the fresh one, keeping what was entered so far. */
  onStartFresh?: () => void;
}

export const YnabImportStep: React.FC<YnabStepProps> = ({
  cur,
  state,
  set,
  onFileSelected,
  onApiSnapshotSelected,
  isInspecting,
  onStartFresh,
}) => {
  const { t } = useLingui();

  const file = state.ynabFile;
  const apiSnapshot = state.ynabApiSnapshot;
  const preview = state.ynabPreview;
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [sourceMode, setSourceMode] = React.useState<'api' | 'zip'>(state.ynabFile ? 'zip' : 'api');
  const [token, setToken] = React.useState('');
  const [plans, setPlans] = React.useState<YNABApiPlanSummary[]>([]);
  const [selectedPlanId, setSelectedPlanId] = React.useState('');
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [connectionError, setConnectionError] = React.useState('');
  const requestRef = React.useRef(0);
  React.useEffect(
    () => () => {
      requestRef.current += 1;
    },
    []
  );
  const hasSource = Boolean(file || apiSnapshot);
  const helpOpened = (topic: YnabHelpTopic) => track('ynab_import_help_opened', { topic });
  const apiFailed = (error: unknown, fallback: string) => {
    const reason = classifyYnabApiError(error);
    track('ynab_import_validation_failed', { method: 'api', reason });
    setConnectionError(apiErrorMessage(reason, error, fallback));
  };

  const apiErrorMessage = (reason: YnabApiFailureReason, error: unknown, fallback: string) => {
    switch (reason) {
      case 'unauthorized':
        return t`YNAB didn’t accept that token. Copy the whole token from YNAB’s Developer Settings and paste it again, or create a new one.`;
      case 'rate_limited':
        return t`YNAB is limiting requests right now. Wait a few minutes, then connect again.`;
      case 'network':
        return t`Couldn’t reach YNAB. Check your connection and try again.`;
      case 'no_plans':
        return t`That token works, but YNAB returned no plans for it. Check that you signed in to the YNAB account that has your budget.`;
      default:
        return error instanceof Error ? error.message : fallback;
    }
  };
  const needsDateOrder = Boolean(file && preview?.dateOrderAmbiguous && !state.ynabDateOrder);

  const needsCreditMatching = Boolean(
    apiSnapshot &&
    !hasCompleteCreditPaymentMappings(
      preview?.creditPaymentMatching,
      state.ynabCreditPaymentMappings
    )
  );

  const clearSource = () => {
    set({
      ynabFile: null,
      ynabApiSnapshot: null,
      ynabPreview: null,
      ynabDateOrder: undefined,
      ynabCreditPaymentMappings: undefined,
      ynabSourceNumberFormat: undefined,
    });
  };

  const loadPlan = async (planId: string, accessToken = token) => {
    if (!planId || !accessToken.trim()) return;
    const request = ++requestRef.current;
    clearSource();
    setIsConnecting(true);
    setConnectionError('');
    try {
      const snapshot = await new YNABApiClient(accessToken).getPlan(planId);
      if (request !== requestRef.current) return;
      setSelectedPlanId(planId);
      await onApiSnapshotSelected(snapshot);
    } catch (error) {
      if (request !== requestRef.current) return;
      apiFailed(error, t`Could not read that plan`);
    } finally {
      if (request === requestRef.current) setIsConnecting(false);
    }
  };

  const connect = async () => {
    if (!token.trim()) return;
    const request = ++requestRef.current;
    clearSource();
    setIsConnecting(true);
    setConnectionError('');
    try {
      const availablePlans = await new YNABApiClient(token).listPlans();
      if (request !== requestRef.current) return;
      if (availablePlans.length === 0) throw new Error('No plans are available for this token');
      setPlans(availablePlans);
      const firstPlanId = availablePlans[0].id;
      const snapshot = await new YNABApiClient(token).getPlan(firstPlanId);
      if (request !== requestRef.current) return;
      setSelectedPlanId(firstPlanId);
      await onApiSnapshotSelected(snapshot);
      track('ynab_import_source_loaded', { method: 'api' });
    } catch (error) {
      if (request !== requestRef.current) return;
      setPlans([]);
      setSelectedPlanId('');
      apiFailed(error, t`Could not connect to YNAB`);
    } finally {
      if (request === requestRef.current) setIsConnecting(false);
    }
  };

  const switchSource = (mode: 'api' | 'zip') => {
    if (mode !== sourceMode) track('ynab_import_method_chosen', { method: mode });
    requestRef.current += 1;
    setIsConnecting(false);
    setSourceMode(mode);
    clearSource();
  };

  return (
    <div>
      <Title h={cur.title} sub={cur.subtitle} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 12 }}>
        <button
          type="button"
          onClick={() => switchSource('api')}
          style={{
            padding: 9,
            border: '1px solid #141414',
            background: sourceMode === 'api' ? '#141414' : 'transparent',
            color: sourceMode === 'api' ? '#fbf7eb' : '#141414',
            fontFamily: 'inherit',
            fontWeight: 700,
          }}
        >
          <Trans>CONNECT DIRECTLY</Trans>
        </button>
        <button
          type="button"
          onClick={() => switchSource('zip')}
          style={{
            padding: 9,
            border: '1px solid #141414',
            background: sourceMode === 'zip' ? '#141414' : 'transparent',
            color: sourceMode === 'zip' ? '#fbf7eb' : '#141414',
            fontFamily: 'inherit',
            fontWeight: 700,
          }}
        >
          <Trans>EXPORT ZIP</Trans>
        </button>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: '#393939', lineHeight: 1.5 }}>
        {sourceMode === 'api' ? (
          <Trans>
            Recommended. You need a personal access token from the YNAB web app; creating one takes
            about a minute.
          </Trans>
        ) : (
          <Trans>Upload the .zip file the YNAB web app gives you when you export your plan.</Trans>
        )}
      </div>

      {sourceMode === 'api' && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700 }}>
              <Trans>YNAB PERSONAL ACCESS TOKEN</Trans>
            </div>
            <YnabPatHelpPopover
              className="text-[#393939] hover:bg-black/10 hover:text-[#141414]"
              onOpenChange={(open) => open && helpOpened('token_popover')}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="onboarding-ynab-token"
              aria-label={t`YNAB personal access token`}
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => {
                requestRef.current += 1;
                setToken(event.target.value);
                setPlans([]);
                setSelectedPlanId('');
                clearSource();
              }}
              placeholder={t`Used for this import only`}
              disabled={isConnecting}
              style={{ flex: 1, minWidth: 0, padding: 9, border: '1px solid #141414' }}
            />
            <button
              type="button"
              disabled={!token.trim() || isConnecting}
              onClick={() => void connect()}
              style={{
                padding: '8px 14px',
                border: '1px solid #141414',
                background: '#141414',
                color: '#fbf7eb',
                fontFamily: 'inherit',
                fontWeight: 700,
              }}
            >
              {isConnecting ? t`CONNECTING…` : t`CONNECT`}
            </button>
          </div>
          <div style={{ fontSize: 10, color: '#393939' }}>
            <Trans>
              Kept in memory for this import and never saved to Budgero or browser storage.
            </Trans>
          </div>
          {connectionError && (
            <div role="alert" style={{ fontSize: 11, color: '#9f2d24', lineHeight: 1.5 }}>
              {connectionError}
            </div>
          )}
          <details
            data-testid="ynab-token-howto"
            onToggle={(event) => event.currentTarget.open && helpOpened('token_steps')}
            style={{
              padding: '8px 10px',
              fontSize: 11,
              color: '#393939',
              lineHeight: 1.6,
              border: '1px dashed rgba(57,57,57,0.3)',
            }}
          >
            <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#141414' }}>
              <Trans>Where do I find my token?</Trans>
            </summary>
            <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
              <YnabPatHelpSteps
                linkClassName="text-[#141414]"
                onLinkClick={() => helpOpened('ynab_developer_settings')}
              />
              <span>
                <Trans>
                  Personal access tokens are only available in the YNAB web app, not the phone app.
                  No token? Use EXPORT ZIP instead.
                </Trans>
              </span>
            </div>
          </details>
        </div>
      )}

      {sourceMode === 'api' && plans.length > 0 && (
        <Select
          value={selectedPlanId}
          disabled={isConnecting}
          onValueChange={(planId) => void loadPlan(planId)}
        >
          <SelectTrigger
            aria-label={t`YNAB plan`}
            className="mt-2.5 w-full min-w-0 border-[#141414] bg-[#fbf7eb] text-[#141414]"
          >
            <SelectValue placeholder={t`Select a YNAB plan`} />
          </SelectTrigger>
          <SelectContent>
            {plans.map((plan) => (
              <SelectItem key={plan.id} value={plan.id}>
                {plan.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {sourceMode === 'zip' && !file && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            fontSize: 11,
            color: '#393939',
            lineHeight: 1.6,
            border: '1px dashed rgba(57,57,57,0.3)',
          }}
        >
          <Trans>
            <span style={{ fontWeight: 700, color: '#141414' }}>
              <Trans>Before you export:</Trans>
            </span>{' '}
            in YNAB’s{' '}
            <em>
              <Trans>Plan Settings</Trans>
            </em>
            , set Date Format to <code>2025-12-30</code>, Number Format to <code>123,456.78</code>{' '}
            and Currency Placement to “Don’t Show”. Skipping this can shift dates and break amounts.
            Details in the{' '}
            <a
              href="https://budgero.app/docs/ynab-import"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => helpOpened('import_guide')}
              style={{ color: '#141414', fontWeight: 700 }}
            >
              <Trans>import guide</Trans>
            </a>
            .
          </Trans>
        </div>
      )}
      {sourceMode === 'zip' && !file && (
        // Presentation wrapper: the click merely widens the hit area of the
        // fully keyboard-accessible "Browse files" button inside.
        <div
          role="presentation"
          aria-busy={isInspecting}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f && !isInspecting) void onFileSelected(f);
          }}
          style={{
            marginTop: 12,
            padding: '36px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            border: '2px dashed rgba(57,57,57,0.55)',
            background: '#fffdf8',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>☁</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            {isInspecting ? t`Inspecting your YNAB export…` : t`Drop your YNAB export here`}
          </div>
          <div style={{ fontSize: 11, color: '#393939', lineHeight: 1.5 }}>
            <Trans>
              In the YNAB web app, click your plan name in the top-left corner and choose{' '}
              <em>
                <Trans>Export Budget</Trans>
              </em>
              . Drop the .zip here as it is —<br />
              nothing leaves your device until you finish.
            </Trans>
          </div>
          <button
            type="button"
            disabled={isInspecting}
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
            style={{
              marginTop: 14,
              padding: '8px 16px',
              border: '1px solid #141414',
              background: 'transparent',
              fontFamily: 'inherit',
              fontSize: 11,
              letterSpacing: 1,
              cursor: 'pointer',
            }}
          >
            {isInspecting ? t`INSPECTING…` : t`BROWSE FILES`}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            disabled={isInspecting}
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFileSelected(f);
            }}
          />
        </div>
      )}
      {!hasSource && (
        <div style={{ marginTop: 14, fontSize: 11, color: '#393939', textAlign: 'center' }}>
          {sourceMode === 'api' ? (
            <Trans>Connect to YNAB to continue.</Trans>
          ) : (
            <Trans>Add your YNAB export to continue.</Trans>
          )}
          {onStartFresh && (
            <div style={{ marginTop: 6, lineHeight: 1.6 }}>
              <Trans>No token or export at hand?</Trans>{' '}
              <button
                type="button"
                onClick={() => {
                  track('ynab_import_method_chosen', { method: 'start_fresh' });
                  onStartFresh();
                }}
                style={{
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  color: '#141414',
                  fontFamily: 'inherit',
                  fontSize: 'inherit',
                  fontWeight: 700,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}
              >
                <Trans>Start fresh instead</Trans>
              </button>
              <br />
              <Trans>You can still import from YNAB later as a new budget.</Trans>
            </div>
          )}
        </div>
      )}
      {hasSource && (
        <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
          <div
            style={{
              padding: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              border: '1px dashed rgba(57,57,57,0.5)',
              background: '#fbf7eb',
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                border: '1.5px solid #141414',
                background: '#141414',
                color: '#fbf7eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              Y
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {file?.name || apiSnapshot?.plan.name}
              </div>
              <div style={{ fontSize: 10, color: '#393939' }}>
                {file ? `${file.size} · ` : t`Connected through YNAB API · `}
                {needsDateOrder
                  ? t`select the date format below`
                  : needsCreditMatching
                    ? t`match payment categories below`
                    : t`ready to import on finish`}
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#2f7d31', letterSpacing: 1 }}>
              {needsDateOrder ? t`DATE FORMAT` : needsCreditMatching ? t`MATCH CARDS` : t`✓ READY`}
            </div>
          </div>
          {preview && (
            <div
              style={{
                padding: 12,
                display: 'grid',
                gap: 10,
                border: '1px dashed rgba(57,57,57,0.35)',
                background: '#fffdf8',
                fontSize: 11,
                color: '#393939',
                lineHeight: 1.5,
              }}
            >
              <div>
                <Trans>
                  <span style={{ fontWeight: 700, color: '#141414' }}>
                    <Trans>Detected in this export:</Trans>
                  </span>{' '}
                  {preview.accountCount.toLocaleString()}{' '}
                  {preview.accountCount === 1 ? 'account' : 'accounts'} ·{' '}
                  {preview.categoryCount.toLocaleString()}{' '}
                  {preview.categoryCount === 1 ? 'category' : 'categories'} ·{' '}
                  {preview.registerRowCount.toLocaleString()} register{' '}
                  {preview.registerRowCount === 1 ? 'row' : 'rows'}
                </Trans>
              </div>

              {file && (
                <label htmlFor="onboarding-ynab-source-format" style={{ display: 'grid', gap: 5 }}>
                  <span style={{ fontWeight: 700 }}>
                    <Trans>Number format in YNAB</Trans>
                  </span>
                  <select
                    id="onboarding-ynab-source-format"
                    value={state.ynabSourceNumberFormat ?? ''}
                    onChange={(event) => set({ ynabSourceNumberFormat: event.target.value })}
                    style={{
                      padding: 8,
                      border: '1px solid #141414',
                      background: '#fffdf8',
                      color: '#141414',
                    }}
                  >
                    <option value="">
                      <Trans>Detect from file</Trans>
                    </option>
                    <option value="1,234.567">
                      <Trans>Decimal point (1,234.567)</Trans>
                    </option>
                    <option value="1.234,567">
                      <Trans>Decimal comma (1.234,567)</Trans>
                    </option>
                  </select>
                  <span>
                    <Trans>
                      Choose the separator explicitly if your amounts use three decimal places.
                    </Trans>
                  </span>
                </label>
              )}

              {apiSnapshot && preview.creditPaymentMatching && (
                <YnabCreditPaymentMatching
                  matching={preview.creditPaymentMatching}
                  value={state.ynabCreditPaymentMappings}
                  onChange={(ynabCreditPaymentMappings) => set({ ynabCreditPaymentMappings })}
                  currency={state.currency}
                  disabled={isInspecting || isConnecting}
                />
              )}

              {file && preview.dateOrderAmbiguous && (
                <YnabDateOrderChoice
                  value={state.ynabDateOrder}
                  onChange={(ynabDateOrder) => set({ ynabDateOrder })}
                  disabled={isInspecting}
                />
              )}

              {file && (
                <div
                  style={{
                    padding: 9,
                    border: '1px solid rgba(198, 137, 44, 0.5)',
                    background: 'rgba(255, 240, 190, 0.35)',
                  }}
                >
                  <Trans>
                    <span style={{ fontWeight: 700, color: '#141414' }}>
                      <Trans>Review account types after import.</Trans>
                    </span>{' '}
                    YNAB does not reliably export account types. Budgero recognizes credit cards
                    where possible and imports other accounts as Checking, so verify every account
                    before budgeting.
                  </Trans>
                </div>
              )}

              {preview.missingCategories.length > 0 && (
                <div style={{ padding: 9, border: '1px solid rgba(198,57,44,0.35)' }}>
                  <Trans>
                    <span style={{ fontWeight: 700, color: '#141414' }}>
                      <Trans>Categories missing from Plan.csv:</Trans>
                    </span>{' '}
                    {preview.missingCategories
                      .map((category) => `${category.categoryGroup} › ${category.category}`)
                      .join(', ')}
                    . Budgero will create them and report them when the import finishes.
                  </Trans>
                </div>
              )}

              {preview.splitTransactions.length > 0 && (
                <div
                  style={{
                    padding: 9,
                    border: '1px solid rgba(57,57,57,0.35)',
                  }}
                >
                  <span style={{ display: 'block', fontWeight: 700, color: '#141414' }}>
                    {plural(preview.splitTransactions.length, {
                      one: '# split transaction detected',
                      other: '# split transactions detected',
                    })}
                  </span>
                  <Trans>
                    Complete contiguous Split (1/n)…Split (n/n) sequences will be imported as split
                    transactions automatically.
                  </Trans>
                </div>
              )}
            </div>
          )}
          <div
            style={{
              padding: 10,
              fontSize: 11,
              color: '#393939',
              lineHeight: 1.5,
              border: '1px dashed rgba(57,57,57,0.3)',
            }}
          >
            <Trans>
              <span style={{ fontWeight: 700, color: '#141414' }}>
                <Trans>Heads up:</Trans>
              </span>
              YNAB’s “Age of Money”, scheduled transactions, and goals don’t carry over. Accounts,
              categories, assignments, and transaction history do.
            </Trans>
          </div>
        </div>
      )}
    </div>
  );
};
