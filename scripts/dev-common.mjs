/** Shared helpers for the dev launcher scripts (dev-cloud / dev-selfhost). */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const processes = new Set();
let shuttingDown = false;
let exitSignal = null;
let exitCode = 0;

/** Run a blocking step; exits the process on failure. */
export function runStep(label, args, env = process.env) {
  const result = spawnSync(pnpm, args, { cwd: repoRoot, stdio: 'inherit', env });
  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status ?? 1}.`);
    process.exit(result.status ?? 1);
  }
}

/** Spawn a long-running process; when one exits, the others are stopped too. */
export function spawnProcess(label, args, env = process.env) {
  const child = spawn(pnpm, args, { cwd: repoRoot, stdio: 'inherit', env });
  processes.add(child);

  child.on('exit', (code, signal) => {
    processes.delete(child);
    if (!shuttingDown) {
      shuttingDown = true;
      exitCode = code ?? 0;
      exitSignal = signal;
      for (const other of processes) other.kill('SIGTERM');
    }
    if (processes.size === 0) {
      if (exitSignal) process.kill(process.pid, exitSignal);
      else process.exit(exitCode);
    }
  });

  child.on('error', (err) => {
    console.error(`[${label}] failed to start:`, err.message);
    if (shuttingDown) return;
    shuttingDown = true;
    exitCode = 1;
    for (const other of processes) other.kill('SIGTERM');
    process.exit(1);
  });
}

function requestShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitSignal = signal;
  for (const child of processes) child.kill(signal);
}

process.on('SIGINT', () => requestShutdown('SIGINT'));
process.on('SIGTERM', () => requestShutdown('SIGTERM'));

/**
 * Common preflight: app dev stub + one-shot core/runtime dist builds so their
 * dist exists before the app/server import them (avoids the stale-dist trap).
 */
export function prepare(env = process.env) {
  runStep('App dev setup', ['--filter', '@budgero/app', 'run', 'setup:dev'], env);
  runStep('Knowledge base', ['--filter', '@budgero/app', 'run', 'build:knowledge'], env);
  runStep('Core build', ['--filter', '@budgero/core', 'run', 'build'], env);
  runStep('Runtime build', ['--filter', '@budgero/runtime', 'run', 'build'], env);
}

/** Spawn tsc --watch on core and runtime so edits there rebuild live. */
export function spawnWatchers(env = process.env) {
  spawnProcess('core', ['--filter', '@budgero/core', 'run', 'dev'], env);
  spawnProcess('runtime', ['--filter', '@budgero/runtime', 'run', 'dev'], env);
}
