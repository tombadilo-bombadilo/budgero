import type { UserPreferences } from '@shared/model/auth';

export type UserPreferencesPatch = Partial<UserPreferences>;

type PreferencesSaver = (patch: UserPreferencesPatch) => void;

let preferencesSaver: PreferencesSaver | null = null;
let suspendDepth = 0;

export function registerUserPreferencesSaver(nextSaver: PreferencesSaver | null): void {
  preferencesSaver = nextSaver;
}

export function persistUserPreferencesPatch(patch: UserPreferencesPatch): void {
  if (!preferencesSaver || suspendDepth > 0) {
    return;
  }
  preferencesSaver(patch);
}

export function withUserPreferencesPersistenceSuspended<T>(fn: () => T): T {
  suspendDepth += 1;
  try {
    return fn();
  } finally {
    suspendDepth -= 1;
  }
}
