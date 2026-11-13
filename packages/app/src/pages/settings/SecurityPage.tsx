import { plural, t } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Shield, AlertTriangle, Lock, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { useProfile } from '@entities/user/api/useAuth';
import { MasterPasswordManager } from '@shared/lib/crypto';
import { persistUserPreferencesPatch } from '@shared/lib/user-preferences-sync';
import { wrapSpaceKeyWithMaster } from '@budgero/runtime';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { FullScreenLoadingOverlay } from '@shared/ui/full-screen-loading-overlay';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';

import { PrivacySettingsCard } from './components';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return t`An unexpected error occurred`;
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  show,
  onToggleShow,
  disabled,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggleShow: () => void;
  disabled: boolean;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
          onClick={onToggleShow}
          disabled={disabled}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export default function SecurityPage() {
  const { t } = useLingui();

  const runtime = useRuntime();
  const { data: profile } = useProfile();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReinitOverlay, setShowReinitOverlay] = useState(false);
  const [storageMode, setStorageMode] = useState<'memory' | 'session'>('memory');
  const [storageDays, setStorageDays] = useState<number>(7);

  const typedProfile = profile as import('@shared/model/auth').User | undefined;

  // Seed from server-side preferences when available, falling back to the
  // local mirror (used when offline or before the profile has loaded). The
  // server is the source of truth — we never store the actual password there,
  // only the mode + retention days.
  useEffect(() => {
    const serverPrefs = typedProfile?.preferences;
    if (serverPrefs) {
      setStorageMode(serverPrefs.master_password_storage_mode);
      if (serverPrefs.master_password_storage_mode === 'session') {
        setStorageDays(serverPrefs.master_password_storage_days);
      }
      return;
    }
    const persistence = MasterPasswordManager.getPersistenceSetting();
    setStorageMode(persistence.mode);
    if (persistence.mode === 'session') {
      setStorageDays(persistence.days);
    }
  }, [typedProfile?.preferences]);

  const applyStoragePreference = (nextMode: 'memory' | 'session', days = storageDays) => {
    if (nextMode === 'session') {
      const normalized = Math.max(1, Math.min(30, Math.round(days)));
      MasterPasswordManager.setPersistenceSetting({ mode: 'session', days: normalized });
      persistUserPreferencesPatch({
        master_password_storage_mode: 'session',
        master_password_storage_days: normalized,
      });
      toast.success(
        plural(normalized, {
          one: `Master password will be remembered on this device for # day.`,
          other: `Master password will be remembered on this device for # days.`,
        })
      );
      if (storageDays !== normalized) {
        setStorageDays(normalized);
      }
    } else {
      MasterPasswordManager.setPersistenceSetting({ mode: 'memory' });
      persistUserPreferencesPatch({ master_password_storage_mode: 'memory' });
      toast.info(t`Master password will now stay in memory only.`);
    }
  };

  const handleStorageModeChange = (value: string) => {
    if (value !== 'memory' && value !== 'session') return;
    if (value === storageMode) return;
    setStorageMode(value);
    applyStoragePreference(value);
  };

  const handleStorageDaysChange = (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const normalized = Math.max(1, Math.min(30, Math.round(parsed)));
    if (normalized === storageDays) return;
    setStorageDays(normalized);
    if (storageMode === 'session') {
      applyStoragePreference('session', normalized);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t`All fields are required`);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t`New passwords do not match`);
      return;
    }

    if (newPassword.length < 8) {
      setError(t`New password must be at least 8 characters long`);
      return;
    }

    if (currentPassword === newPassword) {
      setError(t`New password must be different from current password`);
      return;
    }

    setIsChanging(true);
    setError(null);

    try {
      // Step 1: Verify current password (best-effort in-memory check)
      if (MasterPasswordManager.canVerifyLocally()) {
        toast.info(t`Verifying current password...`);
        const isValid = await MasterPasswordManager.verify(currentPassword);
        if (!isValid) {
          setError(t`Current password is incorrect`);
          setIsChanging(false);
          return;
        }
      }

      // Step 2: Resolve workspace keys (ensures current password unlocks all spaces)
      toast.info(t`Preparing workspace keys...`);
      const spaces = runtime.listSpaces();
      if (!spaces.length) {
        throw new Error('No accepted workspaces found for this account');
      }

      const workspaceKeys: { spaceId: string; key: Uint8Array }[] = [];
      for (const space of spaces) {
        try {
          const key = await runtime.requireSpaceKey(space.space_id);
          workspaceKeys.push({ spaceId: space.space_id, key });
        } catch (unwrapError) {
          console.error('[ChangePassword] Failed to unwrap space key', {
            spaceId: space.space_id,
            error: unwrapError,
          });
          throw new Error('Unable to access a workspace key with the provided master password.');
        }
      }

      // NOTE: changing the master password does NOT touch the space keys —
      // the server blob and every synced payload stay encrypted with the
      // (unchanged) space key. Only two things depend on the master
      // password: the server-side wrapped copies of the space keys, and the
      // local OPFS at-rest cipher. So the flow is: re-wrap, re-key OPFS,
      // notify this user's other devices, reload.

      // Step 3: Re-wrap every workspace key locally, then commit the complete
      // set atomically. A sequential update can strand an account with some
      // spaces under the old password and others under the new one.
      toast.info(t`Updating workspace access credentials...`);
      const apis = await import('@shared/api/api-client');
      const wrappedKeys: Record<string, string> = {};
      for (const entry of workspaceKeys) {
        wrappedKeys[entry.spaceId] = await wrapSpaceKeyWithMaster(entry.key, newPassword);
      }
      await apis.spaceApi.updateEncryptedKeys(wrappedKeys);

      // Step 4: Update stored master password locally
      await MasterPasswordManager.store(newPassword);

      // Step 5: Re-encrypt local OPFS persistence under the new password so
      // the post-change reload decrypts it directly (no snapshot fallback).
      // Best-effort: on failure the next startup falls back to the server
      // blob, which is unchanged (space key ≠ master password).
      try {
        await runtime.rekeyLocalPersistence(newPassword);
      } catch (rekeyError) {
        console.warn('[Security] Failed to re-key local persistence', rekeyError);
      }

      // Step 6: Tell THIS USER's other devices (and only them — space
      // members keep their own passwords) so they reload and re-prompt.
      toast.info(t`Notifying your other devices...`);
      runtime.notifyMasterPasswordChanged();

      // Step 7: Reload. In-place runtime re-init after a cipher swap proved
      // fragile (stuck loading, stale OPFS handles); a clean reload is what
      // remote devices do anyway, and the stored password unlocks silently.
      toast.success(t`Master password changed successfully! Reloading…`);
      setShowReinitOverlay(true);
      window.location.reload();
    } catch (error: unknown) {
      console.error('[ChangePassword] ERROR:', error);
      setError(getErrorMessage(error) || t`Failed to change password. Please try again.`);
      toast.error(t`Failed to change password`);
    } finally {
      setIsChanging(false);
    }
  };

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };
  return (
    <div className="container max-w-4xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-6 sm:space-y-8">
      <SettingsPageHeader
        title={t`Security & Privacy`}
        description={t`Manage your security settings and privacy preferences`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>
              <Shield className="h-5 w-5" />
              Security Settings
            </Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Change your master password (used to encrypt your local database).</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-medium">
              <Trans>Change Master Password</Trans>
            </h3>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Change the password that unlocks your data. Your data stays encrypted, and your
                other devices will ask for the new password. Sign-in password, email and 2FA are
                managed in your Clerk profile.
              </Trans>
            </p>
            <Button
              onClick={() => setShowChangePassword(true)}
              variant="outline"
              className="w-full sm:w-auto"
            >
              <Trans>
                <Lock className="h-4 w-4 mr-2" />
                Change Master Password
              </Trans>
            </Button>
          </div>

          <div className="pt-6 border-t border-border/60 space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">
                <Trans>Master Password Storage</Trans>
              </h3>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Choose how long Budgero keeps your master password after you unlock the app on
                  this device.
                </Trans>
              </p>
            </div>
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription>
                <Trans>
                  Storing your master password outside memory lowers security. Anyone with access to
                  this browser profile could decrypt your data until it expires.
                </Trans>
              </AlertDescription>
            </Alert>
            <RadioGroup
              value={storageMode}
              onValueChange={handleStorageModeChange}
              className="space-y-3"
            >
              <div
                className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${storageMode === 'memory' ? 'border-primary/60 bg-primary/5' : 'border-border/70 bg-muted/20'}`}
              >
                <RadioGroupItem value="memory" id="storage-memory" className="mt-1" />
                <div className="space-y-1">
                  <Label htmlFor="storage-memory" className="text-sm font-medium">
                    <Trans>Keep in memory only (recommended)</Trans>
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    <Trans>
                      We keep your master password in volatile memory only. Refreshing or closing
                      the tab will require it again.
                    </Trans>
                  </p>
                </div>
              </div>

              <div
                className={`flex flex-col gap-3 rounded-md border p-3 transition-colors ${storageMode === 'session' ? 'border-primary/60 bg-primary/5' : 'border-border/70 bg-muted/10'}`}
              >
                <div className="flex items-start gap-3">
                  <RadioGroupItem value="session" id="storage-session" className="mt-1" />
                  <div className="space-y-1">
                    <Label htmlFor="storage-session" className="text-sm font-medium">
                      <Trans>Remember on this device (IndexedDB)</Trans>
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      <Trans>
                        Budgero stores your master password in this browser's IndexedDB until it
                        expires.
                      </Trans>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-7">
                  <Label
                    htmlFor="storage-days"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    <Trans>Duration</Trans>
                  </Label>
                  <Select
                    value={String(storageDays)}
                    onValueChange={handleStorageDaysChange}
                    disabled={storageMode !== 'session'}
                  >
                    <SelectTrigger id="storage-days" size="sm" className="w-[140px]">
                      <SelectValue placeholder={t`Select days`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">
                        <Trans>1 day</Trans>
                      </SelectItem>
                      <SelectItem value="3">
                        <Trans>3 days</Trans>
                      </SelectItem>
                      <SelectItem value="7">
                        <Trans>7 days</Trans>
                      </SelectItem>
                      <SelectItem value="14">
                        <Trans>14 days</Trans>
                      </SelectItem>
                      <SelectItem value="30">
                        <Trans>30 days</Trans>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    <Trans>
                      This cache survives app restarts and is cleared when the timer expires, you
                      log out, or you reset local data.
                    </Trans>
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>
        </CardContent>
      </Card>

      {/* Privacy Settings */}
      <PrivacySettingsCard />

      {/* Change Password Dialog */}
      <Dialog
        open={showChangePassword}
        onOpenChange={(open) => {
          setShowChangePassword(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              <Trans>Change Master Password</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                Enter your current password and choose a new one. Your data stays encrypted; only
                the password that unlocks it changes.
              </Trans>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <PasswordField
              id="current-password"
              label={t`Current Password`}
              value={currentPassword}
              onChange={setCurrentPassword}
              show={showCurrentPassword}
              onToggleShow={() => setShowCurrentPassword(!showCurrentPassword)}
              disabled={isChanging}
              placeholder={t`Enter current password`}
            />

            <PasswordField
              id="new-password"
              label={t`New Password`}
              value={newPassword}
              onChange={setNewPassword}
              show={showNewPassword}
              onToggleShow={() => setShowNewPassword(!showNewPassword)}
              disabled={isChanging}
              placeholder={t`Enter new password (min 8 characters)`}
            />

            <PasswordField
              id="confirm-password"
              label={t`Confirm New Password`}
              value={confirmPassword}
              onChange={setConfirmPassword}
              show={showConfirmPassword}
              onToggleShow={() => setShowConfirmPassword(!showConfirmPassword)}
              disabled={isChanging}
              placeholder={t`Confirm new password`}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowChangePassword(false);
                resetForm();
              }}
              disabled={isChanging}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              onClick={handleChangePassword}
              disabled={isChanging || !currentPassword || !newPassword || !confirmPassword}
            >
              {isChanging ? t`Changing...` : t`Change Password`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reinitialization Overlay */}
      {showReinitOverlay && (
        <FullScreenLoadingOverlay
          title={t`Applying New Password`}
          description={t`Please wait while we reinitialize with your new password...`}
          footnote="This may take a few moments"
        />
      )}
    </div>
  );
}
