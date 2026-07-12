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
  return 'An unexpected error occurred';
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
        `Master password will be remembered on this device for ${normalized} day${normalized === 1 ? '' : 's'}.`
      );
      if (storageDays !== normalized) {
        setStorageDays(normalized);
      }
    } else {
      MasterPasswordManager.setPersistenceSetting({ mode: 'memory' });
      persistUserPreferencesPatch({ master_password_storage_mode: 'memory' });
      toast.info('Master password will now stay in memory only.');
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
      setError('All fields are required');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long');
      return;
    }

    if (currentPassword === newPassword) {
      setError('New password must be different from current password');
      return;
    }

    setIsChanging(true);
    setError(null);

    try {
      // Step 1: Verify current password (best-effort in-memory check)
      if (MasterPasswordManager.canVerifyLocally()) {
        toast.info('Verifying current password...');
        const isValid = await MasterPasswordManager.verify(currentPassword);
        if (!isValid) {
          setError('Current password is incorrect');
          setIsChanging(false);
          return;
        }
      }

      // Step 2: Resolve workspace keys (ensures current password unlocks all spaces)
      toast.info('Preparing workspace keys...');
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
      toast.info('Updating workspace access credentials...');
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
      toast.info('Notifying your other devices...');
      runtime.notifyMasterPasswordChanged();

      // Step 7: Reload. In-place runtime re-init after a cipher swap proved
      // fragile (stuck loading, stale OPFS handles); a clean reload is what
      // remote devices do anyway, and the stored password unlocks silently.
      toast.success('Master password changed successfully! Reloading…');
      setShowReinitOverlay(true);
      window.location.reload();
    } catch (error: unknown) {
      console.error('[ChangePassword] ERROR:', error);
      setError(getErrorMessage(error) || 'Failed to change password. Please try again.');
      toast.error('Failed to change password');
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
        title="Security & Privacy"
        description="Manage your security settings and privacy preferences"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Security Settings
          </CardTitle>
          <CardDescription>
            Change your master password (used to encrypt your local database).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Change Master Password</h3>
            <p className="text-sm text-muted-foreground">
              Update your master password to keep your data secure. This will re-encrypt all your
              data with the new password. Sign-in password, email and 2FA are managed in your Clerk
              profile.
            </p>
            <Button
              onClick={() => setShowChangePassword(true)}
              variant="outline"
              className="w-full sm:w-auto"
            >
              <Lock className="h-4 w-4 mr-2" />
              Change Master Password
            </Button>
          </div>

          <div className="pt-6 border-t border-border/60 space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Master Password Storage</h3>
              <p className="text-sm text-muted-foreground">
                Choose how long Budgero keeps your master password after you unlock the app on this
                device.
              </p>
            </div>
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription>
                Storing your master password outside memory lowers security. Anyone with access to
                this browser profile could decrypt your data until it expires.
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
                    Keep in memory only (recommended)
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    We keep your master password in volatile memory only. Refreshing or closing the
                    tab will require it again.
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
                      Remember on this device (IndexedDB)
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Budgero stores your master password in this browser&apos;s IndexedDB until it
                      expires.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-7">
                  <Label
                    htmlFor="storage-days"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Duration
                  </Label>
                  <Select
                    value={String(storageDays)}
                    onValueChange={handleStorageDaysChange}
                    disabled={storageMode !== 'session'}
                  >
                    <SelectTrigger id="storage-days" size="sm" className="w-[140px]">
                      <SelectValue placeholder="Select days" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 day</SelectItem>
                      <SelectItem value="3">3 days</SelectItem>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="14">14 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    This cache survives app restarts and is cleared when the timer expires, you log
                    out, or you reset local data.
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
            <DialogTitle>Change Master Password</DialogTitle>
            <DialogDescription>
              Enter your current password and choose a new one. Your data will be re-encrypted with
              the new password.
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
              label="Current Password"
              value={currentPassword}
              onChange={setCurrentPassword}
              show={showCurrentPassword}
              onToggleShow={() => setShowCurrentPassword(!showCurrentPassword)}
              disabled={isChanging}
              placeholder="Enter current password"
            />

            <PasswordField
              id="new-password"
              label="New Password"
              value={newPassword}
              onChange={setNewPassword}
              show={showNewPassword}
              onToggleShow={() => setShowNewPassword(!showNewPassword)}
              disabled={isChanging}
              placeholder="Enter new password (min 8 characters)"
            />

            <PasswordField
              id="confirm-password"
              label="Confirm New Password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              show={showConfirmPassword}
              onToggleShow={() => setShowConfirmPassword(!showConfirmPassword)}
              disabled={isChanging}
              placeholder="Confirm new password"
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
              Cancel
            </Button>
            <Button
              onClick={handleChangePassword}
              disabled={isChanging || !currentPassword || !newPassword || !confirmPassword}
            >
              {isChanging ? 'Changing...' : 'Change Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reinitialization Overlay */}
      {showReinitOverlay && (
        <FullScreenLoadingOverlay
          title="Applying New Password"
          description="Please wait while we reinitialize with your new password..."
          footnote="This may take a few moments"
        />
      )}
    </div>
  );
}
