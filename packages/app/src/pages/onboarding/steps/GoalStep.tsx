import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { MonthYearCalendar } from '@shared/ui/MonthYearCalendar';
import { Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { formatDateISO } from '@shared/lib/date-utils';
import React from 'react';
import { GOAL_TEMPLATES, addMonthsIso, type GoalMode } from '../onboarding-data';
import {
  FieldLabel,
  InputRow,
  OnboardingOptionTile,
  StepHeroImage,
  Title,
  formatDateLabel,
  formatMoney,
  getCurrencySym,
  monthsBetweenNow,
  type StepProps,
} from './shared';

export const GoalStep: React.FC<StepProps> = ({ cur, state, set }) => {
  const sym = getCurrencySym(state.currency);
  const isCustom = state.goal.id === 'custom';
  const mode: GoalMode = state.goal.mode;
  const [dateOpen, setDateOpen] = React.useState(false);

  // Parse the ISO YYYY-MM-DD targetDate as a Date for the calendar popover.
  // Robust to empty / malformed values (falls back to today) so the picker
  // never receives Invalid Date.
  const targetDateObj = (() => {
    const d = new Date(state.goal.targetDate);
    if (Number.isNaN(d.getTime())) return new Date();
    return d;
  })();

  // Live preview is the "will this plan work?" copy — turns the abstract
  // amount/timeline into a monthly number (or annual projection) so the
  // user sees exactly what Budgero will assign when they land.
  const preview = (() => {
    const { target } = state.goal;
    if (target <= 0) return null;
    if (mode === 'monthly') {
      const perYear = target * 12;
      return `At ${formatMoney(sym, target)}/month, you’ll have ${formatMoney(
        sym,
        perYear
      )} saved after a year.`;
    }
    const months = monthsBetweenNow(state.goal.targetDate);
    const perMonth = target / months;
    return `Budgero will assign about ${formatMoney(
      sym,
      perMonth
    )}/month to this jar until ${formatDateLabel(state.goal.targetDate)}.`;
  })();

  return (
    <div>
      <StepHeroImage
        src="/onboarding-goals.png"
        alt="Coin character feeding a coin into a piggy bank"
      />
      <Title h={cur.title} sub={cur.subtitle} />

      {/* Template picker — also seeds mode + date + amount. Re-picking
          "Custom" keeps the user's typed label so they don't lose work. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {GOAL_TEMPLATES.map((g) => {
          const active = state.goal.id === g.id;
          return (
            <OnboardingOptionTile
              key={g.id}
              active={active}
              onClick={() =>
                set({
                  goal: {
                    id: g.id,
                    label: g.id === 'custom' && isCustom ? state.goal.label : g.label,
                    target: g.target,
                    mode: g.mode,
                    targetDate: addMonthsIso(g.monthsOut),
                  },
                })
              }
              style={{ padding: '12px 14px' }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{g.label}</div>
              <div style={{ fontSize: 10, color: '#393939', marginTop: 2 }}>
                {g.mode === 'monthly'
                  ? `suggested ${sym}${g.target.toLocaleString()}/month`
                  : `suggested ${sym}${g.target.toLocaleString()} in ${g.monthsOut} mo`}
              </div>
            </OnboardingOptionTile>
          );
        })}
      </div>

      {isCustom && (
        <div style={{ marginTop: 18 }}>
          <FieldLabel>GOAL NAME</FieldLabel>
          <InputRow
            value={state.goal.label === 'Something else' ? '' : state.goal.label}
            onChange={(v) => set({ goal: { ...state.goal, label: v } })}
            placeholder="e.g. Wedding fund"
          />
        </div>
      )}

      {/* Mode toggle — maps to Budgero's two savings goal shapes. */}
      <div style={{ marginTop: 20 }}>
        <FieldLabel marginBottom={8}>HOW DO YOU WANT TO SAVE?</FieldLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          <OnboardingOptionTile
            active={mode === 'monthly'}
            onClick={() => set({ goal: { ...state.goal, mode: 'monthly' } })}
            style={{ padding: '12px 14px' }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>Set aside each month</div>
            <div style={{ fontSize: 10, color: '#393939', marginTop: 2, lineHeight: 1.45 }}>
              Assign the same amount every month. Best for emergency funds and ongoing buckets.
            </div>
          </OnboardingOptionTile>
          <OnboardingOptionTile
            active={mode === 'target'}
            onClick={() => set({ goal: { ...state.goal, mode: 'target' } })}
            style={{ padding: '12px 14px' }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>Reach a total by a date</div>
            <div style={{ fontSize: 10, color: '#393939', marginTop: 2, lineHeight: 1.45 }}>
              Pick a target amount and deadline. Best for trips, down payments, big purchases.
            </div>
          </OnboardingOptionTile>
        </div>
      </div>

      {/* Amount + (optional) date. Labels change to match the chosen mode. */}
      <div style={{ marginTop: 18, display: 'grid', gap: 14 }}>
        <div>
          <FieldLabel>{mode === 'monthly' ? 'AMOUNT PER MONTH' : 'TOTAL TARGET'}</FieldLabel>
          <InputRow
            big
            prefix={sym}
            value={String(state.goal.target)}
            onChange={(v) => set({ goal: { ...state.goal, target: Number(v) || 0 } })}
            placeholder={mode === 'monthly' ? '200' : '5000'}
          />
        </div>
        {mode === 'target' && (
          <div>
            <FieldLabel>TARGET DATE</FieldLabel>
            {/* Reuses the same Popover + MonthYearCalendar pattern the
                main GoalForm uses, so the calendar UX matches what the user
                will see when they edit goals later. Trigger button keeps the
                paper aesthetic via inline styles. */}
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    border: '1px dashed rgba(57,57,57,0.55)',
                    background: '#fffdf8',
                    padding: '10px 14px',
                    fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: 14,
                    color: '#141414',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <CalendarIcon style={{ width: 16, height: 16, color: '#393939' }} />
                  <span style={{ flex: 1 }}>{format(targetDateObj, 'PPP')}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-auto p-0 max-h-[70vh] overflow-y-auto"
                modal
                align="start"
              >
                <MonthYearCalendar
                  selected={targetDateObj}
                  onSelect={(date) => {
                    if (!date) return;
                    set({
                      goal: {
                        ...state.goal,
                        targetDate: formatDateISO(date),
                      },
                    });
                    setDateOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      {preview && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            border: '1px dashed rgba(57,57,57,0.4)',
            background: '#fbf7eb',
            fontSize: 12,
            color: '#141414',
            lineHeight: 1.55,
          }}
        >
          <span style={{ fontWeight: 700, color: '#c6392c', letterSpacing: 1, marginRight: 6 }}>
            PLAN
          </span>
          {preview}
        </div>
      )}
    </div>
  );
};
