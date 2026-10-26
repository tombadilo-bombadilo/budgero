import { Trans, useLingui } from '@lingui/react/macro';
import { CircleHelp, ExternalLink } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { cn } from '@shared/lib/utils';

export const YNAB_DEVELOPER_SETTINGS_URL = 'https://app.ynab.com/settings/developer';

interface YnabPatHelpStepsProps {
  linkClassName?: string;
  onLinkClick?: () => void;
}

/** The numbered "create a personal access token" steps, shared by the popover and onboarding. */
export function YnabPatHelpSteps({ linkClassName, onLinkClick }: YnabPatHelpStepsProps) {
  return (
    <>
      <ol className="list-decimal space-y-1.5 pl-4">
        <li>
          <Trans>Sign in to the YNAB web app and open Account Settings.</Trans>
        </li>
        <li>
          <Trans>Open Developer Settings, then find Personal Access Tokens.</Trans>
        </li>
        <li>
          <Trans>Select New Token, enter your password, and choose Generate.</Trans>
        </li>
        <li>
          <Trans>Copy the token when it appears and paste it here.</Trans>
        </li>
      </ol>
      <p className="text-[11px]">
        <Trans>
          YNAB shows the full token only once. Treat it like a password; you can revoke it later
          from the same screen.
        </Trans>
      </p>
      <a
        href={YNAB_DEVELOPER_SETTINGS_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onLinkClick}
        className={cn(
          'inline-flex items-center gap-1 font-medium underline underline-offset-2',
          linkClassName
        )}
      >
        <Trans>
          Open YNAB Developer Settings
          <ExternalLink className="size-3" />
        </Trans>
      </a>
    </>
  );
}

interface YnabPatHelpPopoverProps {
  className?: string;
  onOpenChange?: (open: boolean) => void;
}

export function YnabPatHelpPopover({ className, onOpenChange }: YnabPatHelpPopoverProps) {
  const { t } = useLingui();

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('size-5 rounded-full text-muted-foreground', className)}
          aria-label={t`How to create a YNAB personal access token`}
        >
          <CircleHelp className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] space-y-3 text-xs text-muted-foreground"
      >
        <p className="font-medium text-foreground">
          <Trans>Create a YNAB personal access token</Trans>
        </p>
        <YnabPatHelpSteps linkClassName="text-primary" />
      </PopoverContent>
    </Popover>
  );
}
