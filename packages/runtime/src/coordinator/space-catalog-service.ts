import type { SpaceSummary } from '../types';
import type { SpaceRegistry } from '../space-registry';
import type { KeyVault } from '../key-vault';
import { checkAbort, errorMessage, isDecryptionError } from '../utils/diagnostics';
import { scopedLogger, type RuntimeLogFn } from '../logging';

interface SpaceCatalogServiceDeps {
  listSpaces?(): Promise<SpaceSummary[]>;
  getProfile?(): Promise<{ primary_space_id?: string } | null>;
  keyVault: KeyVault;
  spaceRegistry: SpaceRegistry;
  cleanupStaleSpaceDatabases?(spaceIds: string[], opts: { suffix: string }): Promise<void>;
  opfsSuffix?: string;
  log?: RuntimeLogFn;
}

export class SpaceCatalogService {
  private readonly deps: SpaceCatalogServiceDeps;

  private readonly log: RuntimeLogFn;

  constructor(deps: SpaceCatalogServiceDeps) {
    this.deps = deps;
    this.log = deps.log ?? scopedLogger('SpaceCatalogService');
  }

  async prepareInitialSpace(masterPassword: string, signal: AbortSignal): Promise<string> {
    const profile = await this.loadProfile();
    checkAbort(signal);

    const acceptedSpaces = await this.loadAcceptedSpaces();
    checkAbort(signal);

    await this.ensureSpaceKeys(acceptedSpaces, masterPassword);
    checkAbort(signal);

    await this.cleanupStaleDatabases(acceptedSpaces);

    const initialSpace = this.deps.spaceRegistry.resolveInitialSpace(
      acceptedSpaces,
      profile?.primary_space_id
    );
    if (!initialSpace) {
      throw new Error('No workspace available to activate');
    }
    return initialSpace.space_id;
  }

  async refreshSpaces(): Promise<{
    acceptedSpaces: SpaceSummary[];
    activeSpaceId: string | null;
    activeStillAvailable: boolean;
    fallbackSpaceId: string | null;
  }> {
    const acceptedSpaces = await this.loadAcceptedSpaces();
    const mp = this.deps.keyVault.getMasterPassword();

    if (mp) {
      for (const summary of acceptedSpaces) {
        try {
          await this.deps.keyVault.ensureSpaceKey(summary.space_id, mp, acceptedSpaces);
        } catch (error) {
          this.log('warn', 'Failed to ensure space key during refresh', {
            spaceId: summary.space_id,
            error: errorMessage(error),
          });
        }
      }
    }

    this.deps.keyVault.pruneKeys(acceptedSpaces.map((s) => s.space_id));

    const activeSpaceId = this.deps.spaceRegistry.getActiveSpaceId();
    const activeStillAvailable =
      !!activeSpaceId && acceptedSpaces.some((s) => s.space_id === activeSpaceId);
    if (activeStillAvailable) {
      this.deps.spaceRegistry.notifyActiveSpaceChange(activeSpaceId);
      return { acceptedSpaces, activeSpaceId, activeStillAvailable: true, fallbackSpaceId: null };
    }

    return {
      acceptedSpaces,
      activeSpaceId,
      activeStillAvailable: false,
      fallbackSpaceId: acceptedSpaces[0]?.space_id ?? null,
    };
  }

  private async loadProfile(): Promise<{ primary_space_id?: string } | null> {
    try {
      return (await this.deps.getProfile?.()) ?? null;
    } catch (error) {
      this.log('warn', 'Failed to load profile', {
        error: errorMessage(error),
      });
      return null;
    }
  }

  private async loadAcceptedSpaces(): Promise<SpaceSummary[]> {
    let spaces: SpaceSummary[] = [];
    try {
      const apiSpaces = await this.deps.listSpaces?.();
      spaces = Array.isArray(apiSpaces) ? apiSpaces : [];
    } catch (error) {
      this.log('warn', 'Failed to list spaces; attempting offline cache', {
        error: errorMessage(error),
      });
      const cached = this.deps.spaceRegistry.loadCachedSpaceSummaries();
      if (cached?.length) {
        spaces = cached;
      } else {
        throw new Error('Unable to load workspaces while offline.');
      }
    }

    const acceptedSpaces = spaces.filter(
      (s) => s.invitation_status === 'accepted' && s.is_accessible !== false
    );
    if (!acceptedSpaces.length) {
      this.log('warn', 'No accepted spaces found', {
        totalSpaces: spaces.length,
        statuses: spaces.map((s) => s.invitation_status),
      });
      // FROZEN STRING: the app's StartupController matches on this exact
      // message (NO_ACCEPTED_SPACES_ERROR) to route to onboarding.
      throw new Error('No accepted budget spaces available for this account');
    }

    this.deps.spaceRegistry.setAvailableSpaces(acceptedSpaces);
    return acceptedSpaces;
  }

  private async ensureSpaceKeys(
    acceptedSpaces: SpaceSummary[],
    masterPassword: string
  ): Promise<void> {
    let provisioningError: unknown = null;
    for (const summary of acceptedSpaces) {
      try {
        await this.deps.keyVault.ensureSpaceKey(summary.space_id, masterPassword, acceptedSpaces);
      } catch (error) {
        if (isDecryptionError(error)) {
          provisioningError = error;
          break;
        }
        this.log('warn', 'Failed to provision space key', {
          spaceId: summary.space_id,
          error: errorMessage(error),
        });
      }
    }

    if (provisioningError) {
      throw new Error('Decryption failed: invalid master password or corrupted data', {
        cause: provisioningError,
      });
    }
  }

  private async cleanupStaleDatabases(acceptedSpaces: SpaceSummary[]): Promise<void> {
    try {
      await this.deps.cleanupStaleSpaceDatabases?.(
        acceptedSpaces.map((s) => s.space_id),
        { suffix: this.deps.opfsSuffix ?? '_sas' }
      );
    } catch {
      /* no-op */
    }
  }
}
