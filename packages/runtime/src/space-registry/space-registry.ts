/**
 * SpaceRegistry — tracks which space is active, stores space list.
 *
 * Resolves initial space: stored default → cached → profile hint → first.
 * Does NOT orchestrate activation — that's RuntimeCoordinator's job.
 * Just state management.
 */

import type { SpaceSummary } from '../types';
import {
  SPACE_CACHE_STORAGE,
  ACTIVE_SPACE_STORAGE,
  DEFAULT_SPACE_KEY,
} from '../types/storage-keys';

export class SpaceRegistry {
  private activeSpaceId: string | null = null;

  private availableSpaces: SpaceSummary[] = [];

  private spaceListeners = new Set<(spaceId: string | null) => void>();

  private spaceListListeners = new Set<() => void>();

  getActiveSpaceId(): string | null {
    return this.activeSpaceId;
  }

  setActiveSpaceId(spaceId: string | null): void {
    this.activeSpaceId = spaceId;
    this.persistActiveSpace(spaceId);
    this.notifyActiveSpaceChange(spaceId);
  }

  listSpaces(): SpaceSummary[] {
    return this.availableSpaces;
  }

  setAvailableSpaces(spaces: SpaceSummary[]): void {
    this.availableSpaces = spaces;
    this.persistSpaceSummaries(spaces);
    this.notifyAvailableSpacesChange();
  }

  getSpace(spaceId: string): SpaceSummary | undefined {
    return this.availableSpaces.find((s) => s.space_id === spaceId);
  }

  isSpaceAvailable(spaceId: string): boolean {
    return this.availableSpaces.some((s) => s.space_id === spaceId);
  }

  updateSpaceEncryptedKey(spaceId: string, encryptedKey: string): void {
    this.availableSpaces = this.availableSpaces.map((space) =>
      space.space_id === spaceId ? { ...space, encrypted_space_key: encryptedKey } : space
    );
    this.persistSpaceSummaries(this.availableSpaces);
    this.notifyActiveSpaceChange(this.activeSpaceId);
    this.notifyAvailableSpacesChange();
  }

  /**
   * Resolve the initial space to activate.
   * Priority: stored default → cached active → profile hint → first.
   */
  resolveInitialSpace(
    spaces: SpaceSummary[],
    profileHint?: string | null
  ): SpaceSummary | undefined {
    // 1. Stored default
    const storedDefault = this.getStoredDefaultSpaceId();
    if (storedDefault) {
      const found = spaces.find((s) => s.space_id === storedDefault);
      if (found) return found;
      this.clearStoredDefaultSpaceId();
    }

    // 2. Cached active
    const cachedActive = this.loadActiveSpaceFromCache();
    if (cachedActive) {
      const found = spaces.find((s) => s.space_id === cachedActive);
      if (found) return found;
    }

    // 3. Profile hint
    if (profileHint) {
      const found = spaces.find((s) => s.space_id === profileHint);
      if (found) return found;
    }

    // 4. First
    return spaces[0];
  }

  onActiveSpaceChange(listener: (spaceId: string | null) => void): () => void {
    this.spaceListeners.add(listener);
    try {
      listener(this.activeSpaceId);
    } catch {
      /* no-op */
    }
    return () => {
      this.spaceListeners.delete(listener);
    };
  }

  onAvailableSpacesChange(listener: () => void): () => void {
    this.spaceListListeners.add(listener);
    return () => {
      this.spaceListListeners.delete(listener);
    };
  }

  // ---- Persistence ----

  private persistSpaceSummaries(spaces: SpaceSummary[]): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(SPACE_CACHE_STORAGE, JSON.stringify(spaces));
    } catch {
      /* no-op */
    }
  }

  loadCachedSpaceSummaries(): SpaceSummary[] | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(SPACE_CACHE_STORAGE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed as SpaceSummary[];
    } catch {
      return null;
    }
  }

  private persistActiveSpace(spaceId: string | null): void {
    try {
      if (typeof localStorage === 'undefined') return;
      if (spaceId) {
        localStorage.setItem(ACTIVE_SPACE_STORAGE, spaceId);
      } else {
        localStorage.removeItem(ACTIVE_SPACE_STORAGE);
      }
    } catch {
      /* no-op */
    }
  }

  private loadActiveSpaceFromCache(): string | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(ACTIVE_SPACE_STORAGE) || null;
    } catch {
      return null;
    }
  }

  private getStoredDefaultSpaceId(): string | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const value = localStorage.getItem(DEFAULT_SPACE_KEY);
      return value && value.trim().length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  private clearStoredDefaultSpaceId(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(DEFAULT_SPACE_KEY);
    } catch {
      /* no-op */
    }
  }

  // ---- Notifications ----

  notifyActiveSpaceChange(spaceId: string | null): void {
    this.spaceListeners.forEach((listener) => {
      try {
        listener(spaceId);
      } catch {
        /* no-op */
      }
    });
  }

  notifyAvailableSpacesChange(): void {
    this.spaceListListeners.forEach((listener) => {
      try {
        listener();
      } catch {
        /* no-op */
      }
    });
  }
}
