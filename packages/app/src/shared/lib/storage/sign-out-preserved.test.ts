import { clearLocalStorageForSignOut } from './sign-out-preserved';

beforeEach(() => localStorage.clear());

it('clears everything except the demo, first-month and first-steps markers', () => {
  localStorage.setItem('budgero:demo-space', 'space-demo');
  localStorage.setItem('budgero:fm-opened', '{"user_1":"2026-11-9"}');
  localStorage.setItem('budgero:fm-milestones', '{"user_1":["first_assign"]}');
  localStorage.setItem('budgero:first-steps', '{}');
  localStorage.setItem('master_password_status', 'set');
  localStorage.setItem('budgero_default_space_v1', 'space-1');

  clearLocalStorageForSignOut();

  expect(localStorage.getItem('budgero:demo-space')).toBe('space-demo');
  expect(localStorage.getItem('budgero:fm-opened')).toBe('{"user_1":"2026-11-9"}');
  expect(localStorage.getItem('budgero:fm-milestones')).toBe('{"user_1":["first_assign"]}');
  expect(localStorage.getItem('budgero:first-steps')).toBe('{}');
  expect(localStorage.getItem('master_password_status')).toBeNull();
  expect(localStorage.getItem('budgero_default_space_v1')).toBeNull();
  expect(localStorage.length).toBe(4);
});

it('keeps extra keys a caller asks for', () => {
  localStorage.setItem('keep-me', '1');
  localStorage.setItem('drop-me', '1');
  clearLocalStorageForSignOut(['keep-me']);
  expect(localStorage.getItem('keep-me')).toBe('1');
  expect(localStorage.getItem('drop-me')).toBeNull();
});
