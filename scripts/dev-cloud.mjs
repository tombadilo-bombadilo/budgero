#!/usr/bin/env node
/**
 * Start Budgero in cloud (SaaS) flavor: Go API + Vite bound to 0.0.0.0 so the
 * app is reachable from other devices on your network (e.g. phone testing).
 *
 * Requires VITE_CLERK_PUBLISHABLE_KEY in packages/app/.env.local.
 */
import { prepare, spawnProcess, spawnWatchers } from './dev-common.mjs';

prepare();

console.log('Starting Budgero cloud-flavor dev environment (API :3001, app :5173)...\n');
spawnWatchers();
spawnProcess('server', ['--filter', '@budgero/server', 'run', 'dev']);
spawnProcess('app', [
  '--filter',
  '@budgero/app',
  'run',
  'dev:app',
  '--',
  '--host',
  '0.0.0.0',
  '--port',
  '5173',
  '--strictPort',
]);
