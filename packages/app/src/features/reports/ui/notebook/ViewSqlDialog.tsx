import { Trans, useLingui } from '@lingui/react/macro';
import { Code2, Copy } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { Textarea } from '@shared/ui/textarea';

interface ViewSqlDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sql: string;
  onConvert: () => void;
}

/** "View the SQL": the compiled, read-only query, with "Convert to SQL". */
export function ViewSqlDialog({ open, onOpenChange, sql, onConvert }: ViewSqlDialogProps) {
  const { t } = useLingui();
  const copy = () => {
    navigator.clipboard
      .writeText(sql)
      .then(() => toast.success(t`SQL copied`))
      .catch(() => toast.error(t`Failed to copy to clipboard. Please try again.`));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[95vw] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            <Trans>The SQL behind this question</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Read-only. Convert to SQL to edit it by hand; a converted question can’t go back to
              the notebook editor.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <Textarea
          readOnly
          value={sql}
          aria-label={t`SQL query`}
          spellCheck={false}
          rows={18}
          className="min-h-0 flex-1 resize-none bg-muted/40 font-mono text-xs leading-relaxed"
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={copy}>
            <Copy className="h-4 w-4" aria-hidden />
            <Trans>Copy</Trans>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              onConvert();
            }}
          >
            <Code2 className="h-4 w-4" aria-hidden />
            <Trans>Convert to SQL</Trans>
          </Button>
          <Button onClick={() => onOpenChange(false)}>
            <Trans>Close</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
