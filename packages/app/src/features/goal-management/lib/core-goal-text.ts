import { msg, t } from '@lingui/core/macro';
import { i18n } from '@lingui/core';
import type { MessageDescriptor } from '@lingui/core';
import { describeLocalizedGoalCycle } from './goal-cycle-label';

/**
 * packages/core computes goal progress and returns English strings that double
 * as stable keys (plus {{token}} templates with raw values). Core stays free
 * of any i18n dependency; this map is the single translation boundary. The
 * core test suite renders the same templates, so key drift fails there and
 * merely falls back to English here.
 */
const CORE_GOAL_TEXT: Record<string, MessageDescriptor> = {
  'Target Balance': msg`Target Balance`,
  'Spending lowers the balance, so assign again to top it back up': msg`Spending lowers the balance, so assign again to top it back up`,
  'Goal: have this amount available, with no date and no repeat': msg`Goal: have this amount available, with no date and no repeat`,
  'Balance to reach': msg`Balance to reach`,
  Activity: msg`Activity`,
  'All-time total': msg`All-time total`,
  'Allocate This Month': msg`Allocate This Month`,
  'Allocate {{monthlyNeeded}} more this month': msg`Allocate {monthlyNeeded} more this month`,
  "Allocate {{stillNeeded}} more to complete this month's target": msg`Allocate {stillNeeded} more to complete this month's target`,
  'Allocated This Month': msg`Allocated This Month`,
  'Allocated so far: {{totalAssigned}} of {{target}} ({{pct}})': msg`Allocated so far: {totalAssigned} of {target} ({pct})`,
  'Allocated this month': msg`Allocated this month`,
  'Already scheduled': msg`Already scheduled`,
  'Amount needed available': msg`Amount needed available`,
  'Amount to start the month with': msg`Amount to start the month with`,
  'Assign this to reach target': msg`Assign this to reach target`,
  'Assign {{needed}} to reach your target': msg`Assign {needed} to reach your target`,
  'Assigned This Month': msg`Assigned This Month`,
  'Average Saved': msg`Average Saved`,
  'Build consistent savings habits': msg`Build consistent savings habits`,
  'Building habits takes time - keep trying!': msg`Building habits takes time - keep trying!`,
  'Consecutive months': msg`Consecutive months`,
  'Continue allocating {{monthlyTarget}} each month to reach your goal': msg`Continue allocating {monthlyTarget} each month to reach your goal`,
  'Create a goal to track your financial progress': msg`Create a goal to track your financial progress`,
  'Current Streak': msg`Current Streak`,
  'Current balance': msg`Current balance`,
  'Current progress': msg`Current progress`,
  'Currently Available': msg`Currently Available`,
  'Cycle: {{cycleStart}} to {{cycleEnd}}': msg`Cycle: {cycleStart} to {cycleEnd}`,
  'Exceeded target! Saved {{saved}} this month': msg`Exceeded target! Saved {saved} this month`,
  'Final month! Allocate {{stillNeeded}} to complete': msg`Final month! Allocate {stillNeeded} to complete`,
  'For this month': msg`For this month`,
  'Gap to target': msg`Gap to target`,
  'Goal Amount': msg`Goal Amount`,
  'Goal: Save {{monthlyTarget}} every month': msg`Goal: Save {monthlyTarget} every month`,
  'Goal: start each month with this amount available': msg`Goal: start each month with this amount available`,
  'Good progress - aim for more consistency': msg`Good progress - aim for more consistency`,
  'Great job! Monthly goal achieved. Total saved: {{totalSaved}}': msg`Great job! Monthly goal achieved. Total saved: {totalSaved}`,
  'Halfway there! Save {{needed}} more this month': msg`Halfway there! Save {needed} more this month`,
  'Income this month': msg`Income this month`,
  'Increase savings to reach your {{target}} monthly goal': msg`Increase savings to reach your {target} monthly goal`,
  'Leftover balance rolls into next month': msg`Leftover balance rolls into next month`,
  'Monthly Available Target': msg`Monthly Available Target`,
  'Monthly Pace': msg`Monthly Pace`,
  'Monthly Savings Goal': msg`Monthly Savings Goal`,
  'Monthly Target': msg`Monthly Target`,
  'Nearly there! Complete this month to maintain your streak': msg`Nearly there! Complete this month to maintain your streak`,
  'Need {{needed}} more available': msg`Need {needed} more available`,
  'No Goal': msg`No Goal`,
  'No savings target set': msg`No savings target set`,
  'On track — {{needed}} still needed over 1 more month.': msg`On track — {needed} still needed over 1 more month.`,
  'On track — {{needed}} still needed over {{monthsMore}} more months.': msg`On track — {needed} still needed over {monthsMore} more months.`,
  'Overspent by {{overspent}}': msg`Overspent by {overspent}`,
  'Per month historically': msg`Per month historically`,
  'Planned Future': msg`Planned Future`,
  'Progress resets at the start of each month': msg`Progress resets at the start of each month`,
  'Progress: {{available}} of {{target}} ({{pct}})': msg`Progress: {available} of {target} ({pct})`,
  'Recurring Yearly Allocation Target': msg`Recurring Yearly Allocation Target`,
  'Recurring Yearly Available Target': msg`Recurring Yearly Available Target`,
  'Remaining to allocate': msg`Remaining to allocate`,
  'Save each month': msg`Save each month`,
  'Save {{needed}} more this month': msg`Save {needed} more this month`,
  'Saved This Month': msg`Saved This Month`,
  "Spending during the month doesn't reduce progress — only what you assign matters": msg`Spending during the month doesn't reduce progress — only what you assign matters`,
  'Spending this month': msg`Spending this month`,
  'Start saving {{monthlyTarget}} this month': msg`Start saving {monthlyTarget} this month`,
  "Start this month's savings - aim for {{target}}": msg`Start this month's savings - aim for {target}`,
  'Still Needed': msg`Still Needed`,
  'Success Rate': msg`Success Rate`,
  'Sum of assignments in cycle': msg`Sum of assignments in cycle`,
  'Target Available': msg`Target Available`,
  'Target amount fully allocated for this cycle.': msg`Target amount fully allocated for this cycle.`,
  'Target amount is available and ready to use.': msg`Target amount is available and ready to use.`,
  'Target date has passed': msg`Target date has passed`,
  'Target met — category is fully funded': msg`Target met — category is fully funded`,
  'Target per remaining month': msg`Target per remaining month`,
  'Target: allocate {{target}} by {{targetDate}}': msg`Target: allocate {target} by {targetDate}`,
  'Target: {{target}} available by {{targetDate}}': msg`Target: {target} available by {targetDate}`,
  'This is your final month!': msg`This is your final month!`,
  "This month's target met! Continue with {{monthlyTarget}}/month to stay on track": msg`This month's target met! Continue with {monthlyTarget}/month to stay on track`,
  'To complete the goal': msg`To complete the goal`,
  'To reach target available': msg`To reach target available`,
  'To stay on pace': msg`To stay on pace`,
  'Total Allocated': msg`Total Allocated`,
  'Total Saved': msg`Total Saved`,
  'Total to allocate': msg`Total to allocate`,
  'Tracks the actual balance — spending reduces progress': msg`Tracks the actual balance — spending reduces progress`,
  'Tracks total assignments — spending does not affect progress': msg`Tracks total assignments — spending does not affect progress`,
  'Unknown savings type': msg`Unknown savings type`,
  'Yearly Allocation Target': msg`Yearly Allocation Target`,
  'Yearly Available Target': msg`Yearly Available Target`,
  "You've saved {{totalSaved}} total": msg`You've saved {totalSaved} total`,
  '{{monthsRemaining}} months remaining': msg`{monthsRemaining} months remaining`,
  '{{successfulMonths}}/{{monthsTracked}} months': msg`{successfulMonths}/{monthsTracked} months`,
  '⚠️ Target date passed - need {{needed}} more': msg`⚠️ Target date passed - need {needed} more`,
  '⚠️ Target date passed - need {{needed}} more available': msg`⚠️ Target date passed - need {needed} more available`,
  '✓ Fully allocated!': msg`✓ Fully allocated!`,
  '✓ Goal exceeded by {{excess}}': msg`✓ Goal exceeded by {excess}`,
  '✓ Target amount available!': msg`✓ Target amount available!`,
  '✓ Target available!': msg`✓ Target available!`,
  '✓ This month done! {{totalAssigned}} of {{target}} allocated': msg`✓ This month done! {totalAssigned} of {target} allocated`,
  '✓ This month funded! {{available}}/{{target}} available': msg`✓ This month funded! {available}/{target} available`,
  "✓ This month's {{monthlyTarget}} allocated!": msg`✓ This month's {monthlyTarget} allocated!`,
  "✓ This month's {{monthlyTarget}} saved!": msg`✓ This month's {monthlyTarget} saved!`,
  '✓ {{assigned}} allocated this month — on track!': msg`✓ {assigned} allocated this month — on track!`,
  '🌟 Excellent consistency! Keep it up!': msg`🌟 Excellent consistency! Keep it up!`,
};

export function translateGoalText(text: string): string {
  const cycle =
    /^Cycle: (\d{4}-\d{2}) to (\d{4}-\d{2})(?: \(repeats (yearly|quarterly|monthly|every (\d+) months)\))?$/.exec(
      text
    );
  if (cycle) {
    const [, start, end, cadence, months] = cycle;
    if (!cadence) return t`Cycle: ${start} to ${end}`;
    const interval =
      cadence === 'yearly'
        ? 12
        : cadence === 'quarterly'
          ? 3
          : cadence === 'monthly'
            ? 1
            : Number(months);
    const frequency = describeLocalizedGoalCycle(interval);
    return t`Cycle: ${start} to ${end} (repeats ${frequency})`;
  }
  const descriptor = CORE_GOAL_TEXT[text];
  if (!descriptor) return text;
  // Lingui uses {token}; core's rich formatter uses {{token}}. Pass the core
  // markers as literal values so translation preserves them for the second
  // stage, which formats milliunits, dates, and styled currency spans.
  const placeholders = Object.fromEntries(
    Array.from(text.matchAll(/\{\{(\w+)\}\}/g), ([marker, key]) => [key, marker])
  );
  return i18n._({ ...descriptor, values: placeholders });
}
