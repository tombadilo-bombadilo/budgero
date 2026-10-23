/**
 * Public entry point kept for existing imports. The implementation lives in
 * track.ts (so tests that mock this module still run the real, no-op-in-tests
 * `track` used by feature code).
 */
export * from './track';
