#!/usr/bin/env node
/** Start Budgero in self-host flavor: Go API (Air) + Vite, no cloud dependencies. */
import { prepare, spawnProcess, spawnWatchers } from './dev-common.mjs';

const env = { ...process.env };
env.VITE_SELF_HOSTABLE ??= 'true';
env.SELF_HOSTABLE ??= 'true';
env.SELF_HOST_JWT_SECRET ??= 'dev-selfhost-secret';

prepare(env);

console.log('Starting Budgero self-host dev environment (API :3001, app :5173)...\n');
spawnWatchers(env);
spawnProcess('server', ['--filter', '@budgero/server', 'run', 'dev'], env);
spawnProcess('app', ['--filter', '@budgero/app', 'run', 'dev:app'], env);
