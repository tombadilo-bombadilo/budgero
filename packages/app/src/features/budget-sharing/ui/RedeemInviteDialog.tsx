import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { useRedeemSpaceInvite } from '@features/budget-sharing/api/useBudgetSpaceSharing';
import { spaceApi } from '@shared/api/api-client';
import { MasterPasswordManager } from '@shared/lib/crypto';
import { hashInviteSecret } from '@budgero/runtime';
import { getErrorMessage } from '@shared/lib/errors';

interface RedeemInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RedeemInviteDialog({ open, onOpenChange }: RedeemInviteDialogProps) {
  const [inviteSecret, setInviteSecret] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [inspectionSummary, setInspectionSummary] = useState<string | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const redeemInvite = useRedeemSpaceInvite();
  const [hasCachedPassword, setHasCachedPassword] = useState(false);

  // Reset state when dialog closes - use setState during render pattern
  const wasOpenRef = useRef(open);
  if (wasOpenRef.current && !open) {
    // Dialog just closed - reset all state
    if (inviteSecret !== '') setInviteSecret('');
    if (masterPassword !== '') setMasterPassword('');
    if (inspectionSummary !== null) setInspectionSummary(null);
    if (inspectionError !== null) setInspectionError(null);
    if (isInspecting) setIsInspecting(false);
    if (hasCachedPassword) setHasCachedPassword(false);
    if (!redeemInvite.isIdle) {
      redeemInvite.reset();
    }
  }
  wasOpenRef.current = open;

  // Check for cached password when dialog opens
  // The initial hasCachedPassword reset is handled in the render-phase setState above
  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;
    MasterPasswordManager.get()
      .then((cached) => {
        if (!active) return;
        setHasCachedPassword(Boolean(cached));
      })
      .catch(() => {
        // Error is handled silently - cached password just won't be available
      });

    return () => {
      active = false;
    };
  }, [open]);

  const inspectInvite = useCallback(async () => {
    if (!inviteSecret.trim()) {
      setInspectionError('Enter the invite secret first.');
      return;
    }

    setInspectionError(null);
    setInspectionSummary(null);
    setIsInspecting(true);

    try {
      const token = await hashInviteSecret(inviteSecret.trim());
      const inspection = await spaceApi.inspectInvite(token);
      setInspectionSummary(`Workspace: ${inspection.space_display_name || inspection.space_id}`);
    } catch (error) {
      const message = getErrorMessage(error, 'Invite not found.');
      setInspectionError(message);
    } finally {
      setIsInspecting(false);
    }
  }, [inviteSecret]);

  const handleRedeem = async () => {
    setInspectionError(null);
    try {
      const passwordToUse = masterPassword.trim() || undefined;
      const summary = await redeemInvite.mutateAsync({
        inviteSecret: inviteSecret.trim(),
        masterPassword: passwordToUse,
      });
      toast.success('Workspace joined', {
        description: `Joined workspace "${summary.display_name || summary.space_id}"`,
      });
      onOpenChange(false);
    } catch (error) {
      const message = getErrorMessage(error, 'Unable to redeem invite. Check the secret again.');
      setInspectionError(message);
    }
  };

  const disableRedeem = !inviteSecret.trim() || redeemInvite.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redeem workspace invite</DialogTitle>
          <DialogDescription>
            Enter the invite secret shared with you. Budgero will decrypt the space key locally
            using your master password.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-secret">Invite secret</Label>
            <Input
              id="invite-secret"
              value={inviteSecret}
              onChange={(event) => setInviteSecret(event.target.value)}
              placeholder="paste secret here"
              autoComplete="off"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={inspectInvite}
              disabled={isInspecting || !inviteSecret.trim()}
              loading={isInspecting}
            >
              {isInspecting ? (
                'Checking…'
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Validate secret
                </>
              )}
            </Button>
            {inspectionSummary && (
              <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-900">
                <CheckCircle2 className="mt-0.5 h-4 w-4" />
                <p>{inspectionSummary}</p>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="master-password">Master password</Label>
            <Input
              id="master-password"
              type="password"
              value={masterPassword}
              onChange={(event) => setMasterPassword(event.target.value)}
              placeholder={hasCachedPassword ? 'leave blank to use cached password' : 'required'}
            />
            <p className="text-xs text-muted-foreground">
              Your master password never leaves this device. It wraps the decrypted workspace key
              before sending it to the server.
            </p>
          </div>

          {inspectionError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <p>{inspectionError}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={redeemInvite.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleRedeem}
            disabled={disableRedeem}
            loading={redeemInvite.isPending}
          >
            {redeemInvite.isPending ? 'Joining…' : 'Join workspace'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
