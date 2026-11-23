import { parseAccountShortList, pickShortList } from './account-short-list';

const accounts = [{ ID: 1 }, { ID: 2 }, { ID: 3 }, { ID: 4 }, { ID: 5 }, { ID: 6 }];
const firstTwo = (list: typeof accounts) => list.slice(0, 2);

it('keeps the automatic pick while nothing in the section is pinned', () => {
  expect(pickShortList(accounts, new Set(), firstTwo)).toEqual([{ ID: 1 }, { ID: 2 }]);
  // Pins in the other section don't change this one.
  expect(pickShortList(accounts, new Set([99]), firstTwo)).toEqual([{ ID: 1 }, { ID: 2 }]);
});

it('shows exactly the pinned accounts, in list order, however many there are', () => {
  expect(pickShortList(accounts, new Set([6, 3]), firstTwo)).toEqual([{ ID: 3 }, { ID: 6 }]);
  expect(pickShortList(accounts, new Set([1, 2, 3, 4, 5]), firstTwo)).toHaveLength(5);
});

it('reads only valid ids from the stored set', () => {
  expect([...parseAccountShortList({ 3: true, 7: true, x: true, 0: true, 5: false })]).toEqual([
    3, 7,
  ]);
  expect(parseAccountShortList(null).size).toBe(0);
  expect(parseAccountShortList([1, 2]).size).toBe(0);
});
