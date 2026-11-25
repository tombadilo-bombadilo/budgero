import { Trans, useLingui } from '@lingui/react/macro';
import { Keyboard } from 'lucide-react';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@shared/ui/dialog';
import {
  AMOUNT_SHORTCUT_KEYS,
  getKeyboardShortcutLabels,
  SIDEBAR_SHORTCUT_KEY,
} from '@shared/lib/keyboard-shortcuts';
import { CLEARED_SHORTCUT_KEY } from '@features/transactions/api/useClearedShortcut';
import {
  CATEGORIZE_SHORTCUT_KEY,
  MOVE_SHORTCUT_KEY,
  PAYEE_SHORTCUT_KEY,
} from '@features/transactions/api/useBatchEditShortcuts';
import { ADD_TRANSACTION_SHORTCUT_KEY } from '@features/transactions/api/useRegisterActionShortcuts';
import { DUPLICATE_SHORTCUT_KEY } from '@features/transactions/api/useDuplicateShortcut';
import {
  UNCATEGORIZED_FILTER_KEY,
  UNCLEARED_FILTER_KEY,
} from '@features/transactions/api/useQuickFilterShortcuts';

interface ShortcutGroup {
  title: string;
  items: { keys: string; label: string }[];
}

export function KeyboardShortcutsDialog() {
  const { t } = useLingui();
  const shortcuts = getKeyboardShortcutLabels();

  const groups: ShortcutGroup[] = [
    {
      title: t`General`,
      items: [
        { keys: shortcuts.search, label: t`Search and commands` },
        { keys: shortcuts.addTransaction, label: t`Add transaction` },
        { keys: SIDEBAR_SHORTCUT_KEY, label: t`Toggle sidebar` },
        { keys: shortcuts.mod('Z'), label: t`Undo` },
        { keys: shortcuts.redo, label: t`Redo` },
      ],
    },
    {
      title: t`Transactions`,
      items: [
        {
          keys: shortcuts.shift(ADD_TRANSACTION_SHORTCUT_KEY),
          label: t`Add transaction (register)`,
        },
        { keys: '↑ / ↓', label: t`Move between rows` },
        { keys: 'Space', label: t`Select or deselect the current row` },
        { keys: shortcuts.shift('↑ / ↓'), label: t`Extend the selection` },
        { keys: shortcuts.mod('A'), label: t`Select all rows` },
        { keys: 'Delete', label: t`Delete selected rows` },
        { keys: 'Esc', label: t`Clear selection` },
        { keys: CLEARED_SHORTCUT_KEY, label: t`Toggle cleared on selected rows` },
        { keys: CATEGORIZE_SHORTCUT_KEY, label: t`Change category of selected rows` },
        { keys: MOVE_SHORTCUT_KEY, label: t`Move selected rows to another account` },
        { keys: PAYEE_SHORTCUT_KEY, label: t`Set payee of selected rows` },
        { keys: shortcuts.shift(DUPLICATE_SHORTCUT_KEY), label: t`Duplicate selected rows` },
        {
          keys: shortcuts.shift(UNCLEARED_FILTER_KEY),
          label: t`Show only uncleared (account page)`,
        },
        {
          keys: shortcuts.shift(UNCATEGORIZED_FILTER_KEY),
          label: t`Show only uncategorized (account page)`,
        },
        { keys: 'Enter', label: t`Save transaction` },
        { keys: shortcuts.mod('Enter'), label: t`Save transaction from any field` },
      ],
    },
    {
      title: t`Amount fields`,
      items: [
        { keys: AMOUNT_SHORTCUT_KEYS.half, label: t`Halve amount` },
        { keys: AMOUNT_SHORTCUT_KEYS.double, label: t`Double amount` },
        { keys: AMOUNT_SHORTCUT_KEYS.zero, label: t`Set to zero` },
        { keys: AMOUNT_SHORTCUT_KEYS.tenPercent, label: t`Take 10%` },
        { keys: 'Enter', label: t`Save` },
        { keys: 'Esc', label: t`Cancel` },
      ],
    },
  ];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-muted-foreground"
          title={t`Keyboard shortcuts`}
          aria-label={t`Keyboard shortcuts`}
        >
          <Keyboard className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Keyboard shortcuts</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Speed up budgeting without leaving the keyboard.</Trans>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.title} className="space-y-1.5">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              <ul className="space-y-1">
                {group.items.map((item) => (
                  <li
                    key={`${item.keys}-${item.label}`}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span>{item.label}</span>
                    <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium">
                      {item.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
