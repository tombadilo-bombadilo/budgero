import type { CommonQuery } from './types';

export const DEFAULT_SQL_QUERY = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;";

export const COMMON_QUERIES: CommonQuery[] = [
  {
    name: 'List all tables',
    query: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
  },
  {
    name: 'Database size',
    query:
      'SELECT page_count * page_size AS database_bytes FROM pragma_page_count(), pragma_page_size();',
  },
  {
    name: 'Recent users',
    query: 'SELECT id, email, created_at FROM users ORDER BY created_at DESC LIMIT 20;',
  },
  {
    name: 'Invite summary',
    query:
      'SELECT code, created_at, redeemed_at, expires_at FROM beta_invites ORDER BY created_at DESC LIMIT 10;',
  },
];

export const WRITE_OPERATIONS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'REPLACE',
  'MERGE',
] as const;

export const SQL_EDITOR_PLACEHOLDER = `-- Enter your SQL query here
SELECT name FROM sqlite_master WHERE type = 'table';`;

export const DEBOUNCE_DELAY_MS = 300;
