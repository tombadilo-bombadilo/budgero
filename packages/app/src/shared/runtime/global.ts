import type { AppRuntime } from '@shared/runtime/app-runtime';

let runtimeInstance: AppRuntime | null = null;

export function setRuntime(instance: AppRuntime) {
  runtimeInstance = instance;
}

export function getRuntime(): AppRuntime | null {
  return runtimeInstance;
}
