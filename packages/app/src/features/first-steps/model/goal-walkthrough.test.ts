import { useUiStore } from '@shared/store/useUiStore';
import {
  CLOSED,
  closeGoalWalkthrough,
  dispatchGoalWalkthrough,
  getGoalWalkthrough,
  goalWalkthrough,
  resetGoalWalkthroughForTests,
  startGoalWalkthrough,
  type GoalWalkthroughEvent,
  type GoalWalkthroughState,
} from './goal-walkthrough';

const rent = { id: 11, name: 'Rent', hasGoal: false };
const food = { id: 12, name: 'Groceries', hasGoal: false };
const fun = { id: 13, name: 'Fun', hasGoal: true };

function run(state: GoalWalkthroughState, ...events: GoalWalkthroughEvent[]) {
  return events.reduce(goalWalkthrough, state);
}

describe('starting ("Show me")', () => {
  it('asks to pick a category when none is selected', () => {
    expect(run(CLOSED, { type: 'start', selected: null })).toEqual({ step: 'pick' });
  });

  it('resumes at the goal types with a goal-less category already selected', () => {
    expect(run(CLOSED, { type: 'start', selected: rent })).toEqual({
      step: 'types',
      categoryId: 11,
      categoryName: 'Rent',
    });
  });

  it('asks for another one when the selected category has a goal', () => {
    expect(run(CLOSED, { type: 'start', selected: fun })).toEqual({ step: 'pick', taken: 'Fun' });
  });

  it('ignores page events while closed', () => {
    expect(run(CLOSED, { type: 'select', selected: rent }, { type: 'next' })).toBe(CLOSED);
  });
});

describe('step 1: pick', () => {
  const pick: GoalWalkthroughState = { step: 'pick' };

  it('waits for the user’s own selection, then explains the types', () => {
    expect(run(pick, { type: 'next' })).toBe(pick);
    expect(run(pick, { type: 'select', selected: null })).toBe(pick);
    expect(run(pick, { type: 'select', selected: food })).toMatchObject({
      step: 'types',
      categoryId: 12,
    });
  });

  it('stays on step 1 for a category that already has a goal', () => {
    const taken = run(pick, { type: 'select', selected: fun });
    expect(taken).toEqual({ step: 'pick', taken: 'Fun' });
    expect(run(taken, { type: 'select', selected: rent }).step).toBe('types');
  });
});

describe('steps 2 and 3', () => {
  const types = run(CLOSED, { type: 'start', selected: rent });

  it('Next asks to press Create Goal', () => {
    expect(run(types, { type: 'next' })).toEqual({
      step: 'create',
      categoryId: 11,
      categoryName: 'Rent',
    });
  });

  it('follows a newly selected category, on the same step', () => {
    expect(run(types, { type: 'select', selected: food })).toMatchObject({
      step: 'types',
      categoryId: 12,
    });
    const create = run(types, { type: 'next' }, { type: 'select', selected: food });
    expect(create).toMatchObject({ step: 'create', categoryId: 12, categoryName: 'Groceries' });
  });

  it('goes back to step 1 when the new category has a goal, or nothing is selected', () => {
    expect(run(types, { type: 'select', selected: fun })).toEqual({ step: 'pick', taken: 'Fun' });
    expect(run(types, { type: 'next' }, { type: 'select', selected: null })).toEqual({
      step: 'pick',
    });
  });

  it('keeps its place when the same category is reported again', () => {
    const create = run(types, { type: 'next' });
    expect(run(create, { type: 'select', selected: rent })).toBe(create);
  });
});

describe('step 4: the form', () => {
  const create = run(CLOSED, { type: 'start', selected: rent }, { type: 'next' });

  it('opens when the user presses Create Goal for that category', () => {
    expect(run(create, { type: 'formOpened', categoryId: 12 })).toBe(create);
    expect(run(create, { type: 'formOpened', categoryId: 11 })).toMatchObject({ step: 'form' });
  });

  it('closed without saving: back to "Press Create Goal"', () => {
    const form = run(create, { type: 'formOpened', categoryId: 11 });
    expect(run(form, { type: 'formClosed', categoryId: 11 })).toEqual(create);
  });

  it('ignores the selection while the form is open', () => {
    const form = run(create, { type: 'formOpened', categoryId: 11 });
    expect(run(form, { type: 'select', selected: { ...rent, hasGoal: true } })).toBe(form);
  });

  it('saved: on to step 5, and stays there', () => {
    const saved = run(
      create,
      { type: 'formOpened', categoryId: 11 },
      { type: 'goalSaved', categoryId: 11 }
    );
    expect(saved).toEqual({ step: 'saved', categoryId: 11, categoryName: 'Rent' });
    expect(
      run(saved, { type: 'select', selected: { ...rent, hasGoal: true } }, { type: 'next' })
    ).toBe(saved);
  });

  it('a goal saved for the category from the types step also counts', () => {
    const types = run(CLOSED, { type: 'start', selected: rent });
    expect(run(types, { type: 'goalSaved', categoryId: 11 }).step).toBe('saved');
  });
});

it('close ends it from any step', () => {
  for (const state of [
    { step: 'pick' },
    run(CLOSED, { type: 'start', selected: rent }),
    run(CLOSED, { type: 'start', selected: rent }, { type: 'next' }),
  ] as GoalWalkthroughState[]) {
    expect(run(state, { type: 'close' })).toBe(CLOSED);
  }
});

describe('the session store', () => {
  beforeEach(() => {
    resetGoalWalkthroughForTests();
    useUiStore.setState({ highlightGoalCategoryId: null });
  });

  it('closing clears the Create Goal highlight and runs the end hook once', () => {
    const end = vi.fn();
    startGoalWalkthrough(rent, end);
    dispatchGoalWalkthrough({ type: 'next' });
    useUiStore.getState().setHighlightGoalCategoryId(11);
    closeGoalWalkthrough();
    expect(getGoalWalkthrough()).toBe(CLOSED);
    expect(useUiStore.getState().highlightGoalCategoryId).toBeNull();
    closeGoalWalkthrough();
    expect(end).toHaveBeenCalledOnce();
  });

  it('starting again while open keeps the first end hook', () => {
    const first = vi.fn();
    startGoalWalkthrough(null, first);
    startGoalWalkthrough(rent, vi.fn());
    expect(getGoalWalkthrough().step).toBe('types');
    closeGoalWalkthrough();
    expect(first).toHaveBeenCalledOnce();
  });
});
