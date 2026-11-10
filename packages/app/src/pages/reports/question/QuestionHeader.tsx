import { useLingui } from '@lingui/react/macro';
import { useState, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { BackToReports } from '../BackToReports';

/** Page header for a question: back link, title (editable in place), subtitle and actions. */
export function QuestionHeader({
  title,
  subtitle,
  onRename,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Makes the title editable; receives the new (trimmed, non-empty) name. */
  onRename?: (name: string) => void;
  children?: ReactNode;
}) {
  return (
    <header className="space-y-2">
      <BackToReports />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {onRename ? (
            <EditableTitle title={title} onRename={onRename} />
          ) : (
            <h1 className="truncate text-xl font-semibold">{title}</h1>
          )}
          {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </header>
  );
}

function EditableTitle({ title, onRename }: { title: string; onRename: (name: string) => void }) {
  const { t } = useLingui();
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const name = draft.trim().replace(/\s+/g, ' ');
    if (name && name !== title) onRename(name);
    setDraft(null);
  };

  if (draft !== null) {
    return (
      <h1 className="text-xl font-semibold">
        <input
          aria-label={t`Question name`}
          value={draft}
          maxLength={120}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(null);
            }
          }}
          ref={(element) => {
            // Opened by a tap on the title: focus it with the name selected.
            if (element && document.activeElement !== element) {
              element.focus();
              element.select();
            }
          }}
          className="w-full rounded-md border bg-background px-2 py-0.5 text-xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </h1>
    );
  }
  return (
    <h1 className="text-xl font-semibold">
      <button
        type="button"
        onClick={() => setDraft(title)}
        title={t`Rename`}
        className="group -mx-1 flex max-w-full items-center gap-1.5 rounded-md px-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate">{title}</span>
        <Pencil
          className="h-4 w-4 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100"
          aria-hidden
        />
        <span className="sr-only">{t`Rename`}</span>
      </button>
    </h1>
  );
}
