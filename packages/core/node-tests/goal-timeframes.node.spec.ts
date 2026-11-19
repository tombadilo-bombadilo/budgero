import { beforeEach, describe, expect, it } from 'vitest';
import {
  asMilli,
  describeGoalTimeframeChange,
  GoalType,
  goalTimeframeSpans,
  NodeSqlJsAdapter,
  planGoalTimeframeChange,
  resolveGoalForMonth,
  resolveGoalsForMonth,
  ServiceManager,
  type Goal,
  type Services,
} from '../src';
import { allRows } from '../src/database/sql.js';
import type { DatabaseAdapter } from '../src/database/interface.js';

/** A goal row of one category's chain (only the fields resolution reads). */
const tf = (
  id: number,
  from: string | null,
  to: string | null = null,
  extra: Partial<Goal> = {}
): Goal =>
  ({
    ID: id,
    Type: GoalType.MONTHLY,
    CategoryID: 1,
    Target: asMilli(id * 1000),
    StartDate: from ? `${from}-01` : '2020-01-01',
    EffectiveFrom: from,
    EffectiveTo: to,
    ...extra,
  }) as Goal;

const target = (goal: Goal | null) => (goal ? goal.Target / 1000 : null);

describe('goal timeframe resolution rule', () => {
  it('no goals: no goal in any month', () => {
    expect(resolveGoalForMonth([], '2019-01')).toBeNull();
  });

  it('the only goal applies from the beginning of time onwards', () => {
    const groceries200 = tf(200, '2020-01');
    expect(resolveGoalForMonth([groceries200], '2019-01')).toBe(groceries200);
    expect(resolveGoalForMonth([groceries200], '2020-01')).toBe(groceries200);
    expect(resolveGoalForMonth([groceries200], '2031-07')).toBe(groceries200);
  });

  it('a later goal caps the previous one and takes over from its start month', () => {
    const chain = [tf(250, '2021-06'), tf(200, '2020-01')];
    expect(target(resolveGoalForMonth(chain, '2019-01'))).toBe(200);
    expect(target(resolveGoalForMonth(chain, '2021-05'))).toBe(200);
    expect(target(resolveGoalForMonth(chain, '2021-06'))).toBe(250);
    expect(target(resolveGoalForMonth(chain, '2022-12'))).toBe(250);
  });

  it('a retroactive insert slots in between (issue #137 example)', () => {
    const chain = [tf(200, '2020-01'), tf(250, '2021-06'), tf(220, '2020-10')];
    expect(target(resolveGoalForMonth(chain, '2019-01'))).toBe(200);
    expect(target(resolveGoalForMonth(chain, '2020-09'))).toBe(200);
    expect(target(resolveGoalForMonth(chain, '2020-10'))).toBe(220);
    expect(target(resolveGoalForMonth(chain, '2021-05'))).toBe(220);
    expect(target(resolveGoalForMonth(chain, '2021-06'))).toBe(250);
    expect(target(resolveGoalForMonth(chain, '2022-12'))).toBe(250);
  });

  it('an ended goal stops after its end month, leaving a gap until the next one', () => {
    const chain = [tf(200, '2020-01', '2020-03'), tf(300, '2020-07')];
    expect(target(resolveGoalForMonth(chain, '2019-05'))).toBe(200);
    expect(target(resolveGoalForMonth(chain, '2020-03'))).toBe(200);
    expect(resolveGoalForMonth(chain, '2020-04')).toBeNull();
    expect(resolveGoalForMonth(chain, '2020-06')).toBeNull();
    expect(target(resolveGoalForMonth(chain, '2020-07'))).toBe(300);
  });

  it('a later goal still wins over an earlier end month that overlaps it', () => {
    const chain = [tf(200, '2020-01', '2020-12'), tf(300, '2020-06')];
    expect(target(resolveGoalForMonth(chain, '2020-05'))).toBe(200);
    expect(target(resolveGoalForMonth(chain, '2020-06'))).toBe(300);
    expect(target(resolveGoalForMonth(chain, '2021-06'))).toBe(300);
  });

  it('reads rows from older builds (no EffectiveFrom) by their StartDate month', () => {
    const legacy = tf(200, null, null, { StartDate: '2021-03-15' });
    const later = tf(300, '2021-05');
    expect(target(resolveGoalForMonth([legacy, later], '2021-04'))).toBe(200);
    expect(target(resolveGoalForMonth([legacy, later], '2021-05'))).toBe(300);
  });

  it('resolves each category separately', () => {
    const a = tf(100, '2020-01', null, { CategoryID: 1 });
    const b1 = tf(200, '2020-01', '2020-02', { CategoryID: 2 });
    const b2 = tf(250, '2020-06', null, { CategoryID: 2 });
    expect(resolveGoalsForMonth([a, b1, b2], '2020-04')).toEqual([a]);
    expect(resolveGoalsForMonth([a, b1, b2], '2020-06')).toEqual([a, b2]);
  });
});

describe('goal timeframe spans and notices', () => {
  it('spans: the first covers the beginning, ended goals stop at their end', () => {
    const spans = goalTimeframeSpans([
      tf(200, '2020-01'),
      tf(220, '2020-10', '2021-02'),
      tf(250, '2021-06'),
    ]);
    expect(spans.map(({ from, to, endedBy }) => ({ from, to, endedBy }))).toEqual([
      { from: null, to: '2020-09', endedBy: 'next' },
      { from: '2020-10', to: '2021-02', endedBy: 'end' },
      { from: '2021-06', to: null, endedBy: null },
    ]);
  });

  it('the retroactive insert shortens the 200 goal and is superseded by the 250 one', () => {
    const g200 = tf(200, '2020-01');
    const g250 = tf(250, '2021-06');
    const notices = describeGoalTimeframeChange([g200, g250], {
      kind: 'set',
      from: '2020-10',
      to: null,
    });
    expect(notices).toEqual([
      { kind: 'shortened', goal: g200, to: '2020-09' },
      { kind: 'supersededBy', goal: g250, from: '2021-06' },
    ]);
  });

  it('editing from a later month splits the timeframe', () => {
    const g200 = tf(200, '2020-01');
    expect(describeGoalTimeframeChange([g200], { kind: 'set', from: '2022-03', to: null })).toEqual(
      [{ kind: 'shortened', goal: g200, to: '2022-02' }]
    );
  });

  it('editing a timeframe in place from its start month says nothing', () => {
    const g200 = tf(200, '2020-01');
    expect(
      describeGoalTimeframeChange(
        [g200],
        { kind: 'set', from: '2020-01', to: null },
        { editing: g200, viewedMonth: '2020-01' }
      )
    ).toEqual([]);
  });

  it('rewriting a timeframe from a later month warns about the earlier months', () => {
    const g200 = tf(200, '2020-01');
    expect(
      describeGoalTimeframeChange(
        [g200],
        { kind: 'set', from: '2020-01', to: null },
        { editing: g200, viewedMonth: '2021-04' }
      )
    ).toEqual([{ kind: 'rewritesEarlier', from: null, to: '2021-03' }]);
  });

  it('picking the start of another timeframe replaces it', () => {
    const g200 = tf(200, '2020-01');
    const g250 = tf(250, '2021-06');
    expect(
      describeGoalTimeframeChange(
        [g200, g250],
        { kind: 'set', from: '2021-06', to: null },
        { editing: g200, viewedMonth: '2020-05' }
      )
    ).toEqual([{ kind: 'replaced', goal: g250 }]);
  });

  it('an end month leaves the months after it without a goal', () => {
    const g200 = tf(200, '2020-01');
    const g250 = tf(250, '2021-06');
    expect(
      describeGoalTimeframeChange([g200, g250], { kind: 'set', from: '2020-10', to: '2020-12' })
    ).toEqual([
      { kind: 'shortened', goal: g200, to: '2020-09' },
      { kind: 'noGoal', from: '2021-01', until: '2021-05' },
    ]);
  });

  it('ending from a month removes the later timeframes', () => {
    const g200 = tf(200, '2020-01');
    const g220 = tf(220, '2020-10');
    const g250 = tf(250, '2021-06');
    expect(
      describeGoalTimeframeChange([g200, g220, g250], { kind: 'endFrom', month: '2020-12' })
    ).toEqual([{ kind: 'removed', goal: g250 }]);
    expect(
      planGoalTimeframeChange([g200, g220, g250], { kind: 'endFrom', month: '2020-12' })
    ).toEqual({
      delete: [250],
      bounds: [{ id: 220, to: '2020-11' }],
      overwrite: null,
      insert: null,
    });
  });

  it('ending before the first timeframe starts removes the goal everywhere (no history)', () => {
    const g200 = tf(200, '2020-01');
    const g250 = tf(250, '2021-06');
    expect(planGoalTimeframeChange([g200, g250], { kind: 'endFrom', month: '2019-06' })).toEqual({
      delete: [200, 250],
      bounds: [],
      overwrite: null,
      insert: null,
    });
  });

  it('a new earliest timeframe warns that it also covers the months before it', () => {
    const g200 = tf(200, '2020-01');
    expect(describeGoalTimeframeChange([g200], { kind: 'set', from: '2019-06', to: null })).toEqual(
      [
        { kind: 'supersededBy', goal: g200, from: '2020-01' },
        { kind: 'rewritesEarlier', from: null, to: '2019-05' },
      ]
    );
  });

  it('two rows starting in one month: the first applies (the row setGoalFrom overwrites)', () => {
    const a = tf(3, '2020-01');
    const b = tf(5, '2020-01');
    expect(resolveGoalForMonth([b, a], '2020-04')).toBe(a);
    const spans = goalTimeframeSpans([a, b]);
    expect(spans.map(({ goal, empty }) => [goal.ID, empty])).toEqual([
      [3, false],
      [5, true],
    ]);
    expect(
      planGoalTimeframeChange([b, a], { kind: 'set', from: '2020-01', to: null }).overwrite
    ).toBe(3);
  });
});

describe('GoalService timeframes', () => {
  let db: DatabaseAdapter;
  let s: Services;
  let groceries: number;

  const fields = (amount: number) => ({
    type: GoalType.MONTHLY,
    target: asMilli(amount * 1000),
    startDate: '2020-01-01',
    targetDate: '',
  });
  const amountIn = (month: string) => {
    try {
      return s.goals.getGoalByCategoryID(groceries, month).Target / 1000;
    } catch {
      return null;
    }
  };
  const rows = () =>
    allRows<{ ID: number; Target: number; EffectiveFrom: string; EffectiveTo: string | null }>(
      db,
      'SELECT ID, Target, EffectiveFrom, EffectiveTo FROM goals WHERE CategoryID = ? ORDER BY EffectiveFrom',
      groceries
    );

  beforeEach(async () => {
    db = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(db);
    s = manager.getServices();
    const budgetId = await s.budgets.createBudget({
      name: 'B',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    const group = s.categories.addCategoryGroup('Spending', budgetId);
    groceries = s.categories.addCategory(group, budgetId, 'Groceries', '');
  });

  it('builds the issue #137 chain and resolves every month', () => {
    s.goals.createGoal(GoalType.MONTHLY, groceries, asMilli(200_000), '2020-01-01', '');
    s.goals.setGoalFrom(groceries, '2021-06', null, fields(250));
    s.goals.setGoalFrom(groceries, '2020-10', null, fields(220));
    expect(amountIn('2019-01')).toBe(200);
    expect(amountIn('2020-09')).toBe(200);
    expect(amountIn('2020-10')).toBe(220);
    expect(amountIn('2021-05')).toBe(220);
    expect(amountIn('2021-06')).toBe(250);
    expect(amountIn('2022-12')).toBe(250);
    expect(s.goals.getGoalTimeframes(groceries)).toHaveLength(3);
  });

  it('setting a goal from an existing start month replaces that timeframe in place', () => {
    const id = s.goals.createGoal(GoalType.MONTHLY, groceries, asMilli(200_000), '2020-01-01', '');
    expect(s.goals.setGoalFrom(groceries, '2020-01', null, fields(210))).toBe(id);
    expect(rows()).toEqual([
      { ID: id, Target: 210_000, EffectiveFrom: '2020-01', EffectiveTo: null },
    ]);
  });

  it('a create without a timeframe on a category with a goal fails like v1.21 (unique goal)', () => {
    s.goals.createGoal(GoalType.MONTHLY, groceries, asMilli(200_000), '2020-01-01', '');
    expect(() =>
      s.goals.createGoal(GoalType.MONTHLY, groceries, asMilli(300_000), '2024-05-01', '')
    ).toThrow(/UNIQUE constraint failed: goals.CategoryID/);
    expect(rows()).toHaveLength(1);
  });

  it('a create with a timeframe adds one, but not in a month that already starts one', () => {
    s.goals.createGoal(GoalType.MONTHLY, groceries, asMilli(200_000), '2020-01-01', '');
    s.goals.createGoal(
      GoalType.MONTHLY,
      groceries,
      asMilli(300_000),
      '2024-05-01',
      '',
      undefined,
      false,
      null,
      {
        from: '2024-05',
      }
    );
    expect(rows()).toHaveLength(2);
    expect(() =>
      s.goals.createGoal(
        GoalType.MONTHLY,
        groceries,
        asMilli(1),
        '2020-01-15',
        '',
        undefined,
        false,
        null,
        {
          from: '2020-01',
        }
      )
    ).toThrow(/already has a goal/);
  });

  it('a row restored without EffectiveFrom (v1.21 undo data) gets its StartDate month', () => {
    s.goals.restoreGoal({
      ID: 40,
      Type: 'monthly',
      CategoryID: groceries,
      Target: 5000,
      StartDate: '2023-04-12',
      TargetDate: '',
      Purpose: 'spending',
      Recurring: 0,
      CycleMonths: null,
    });
    expect(rows()).toEqual([{ ID: 40, Target: 5000, EffectiveFrom: '2023-04', EffectiveTo: null }]);
  });

  it('ending from a month keeps history and removes later timeframes', () => {
    s.goals.createGoal(GoalType.MONTHLY, groceries, asMilli(200_000), '2020-01-01', '');
    s.goals.setGoalFrom(groceries, '2021-06', null, fields(250));
    s.goals.endGoalFrom(groceries, '2021-02');
    expect(amountIn('2019-01')).toBe(200);
    expect(amountIn('2021-01')).toBe(200);
    expect(amountIn('2021-02')).toBeNull();
    expect(amountIn('2023-01')).toBeNull();
    expect(rows()).toEqual([
      expect.objectContaining({ EffectiveFrom: '2020-01', EffectiveTo: '2021-01' }),
    ]);
  });

  it('ending in the first timeframe start month removes the goal from every month', () => {
    s.goals.createGoal(GoalType.MONTHLY, groceries, asMilli(200_000), '2026-11-01', '');
    s.goals.endGoalFrom(groceries, '2026-11');
    expect(amountIn('2026-10')).toBeNull();
    expect(amountIn('2026-11')).toBeNull();
    expect(rows()).toEqual([]);
  });

  it('an in-place update only touches the named timeframe', () => {
    s.goals.createGoal(GoalType.MONTHLY, groceries, asMilli(200_000), '2020-01-01', '');
    s.goals.setGoalFrom(groceries, '2021-06', null, fields(250));
    s.goals.updateGoal(
      groceries,
      asMilli(205_000),
      GoalType.MONTHLY,
      '',
      undefined,
      false,
      null,
      null,
      '2020-01'
    );
    expect(amountIn('2020-05')).toBe(205);
    expect(amountIn('2021-06')).toBe(250);
  });

  it('an update without a timeframe (older builds) moves a single timeframe with StartDate', () => {
    s.goals.createGoal(
      GoalType.TARGET_DATE,
      groceries,
      asMilli(1_000_000),
      '2020-01-01',
      '2020-12-31'
    );
    s.goals.updateGoal(
      groceries,
      asMilli(900_000),
      GoalType.TARGET_DATE,
      '2021-12-31',
      undefined,
      false,
      null,
      '2021-03-01'
    );
    expect(rows()).toEqual([
      expect.objectContaining({ Target: 900_000, EffectiveFrom: '2021-03', EffectiveTo: null }),
    ]);
  });

  it('progress by category uses the goal of the month asked for', () => {
    s.goals.createGoal(GoalType.MONTHLY_SAVINGS, groceries, asMilli(200_000), '2020-01-01', '');
    s.goals.setGoalFrom(groceries, '2021-06', null, {
      ...fields(250),
      type: GoalType.MONTHLY_SAVINGS,
    });
    const finances = { available: 0, assigned: 0, activity: 0 };
    expect(
      s.goals.calculateGoalProgressByCategoryId(groceries, finances, '2021-05').monthlyTarget
    ).toBe(200_000);
    expect(
      s.goals.calculateGoalProgressByCategoryId(groceries, finances, '2021-06').monthlyTarget
    ).toBe(250_000);
  });

  it('getGoalsForMonth leaves out categories whose goal has ended', () => {
    s.goals.createGoal(GoalType.MONTHLY, groceries, asMilli(200_000), '2020-01-01', '');
    s.goals.endGoalFrom(groceries, '2020-06');
    expect(s.goals.getGoalsForMonth('2020-05')).toHaveLength(1);
    expect(s.goals.getGoalsForMonth('2020-06')).toHaveLength(0);
  });

  it('rejects an end month before the start month', () => {
    expect(() => s.goals.setGoalFrom(groceries, '2021-06', '2021-05', fields(1))).toThrow(
      /end month/
    );
  });
});
