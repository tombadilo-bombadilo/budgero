import { Trans, useLingui } from '@lingui/react/macro';
import { useId, useMemo, useState, type FormEvent } from 'react';
import {
  HAVING_OPS,
  havingColumns,
  type HavingOp,
  type QuestionHaving,
  type QuestionSpec,
} from '@features/reports/lib/question';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { columnLabel } from './question-labels';

/** "Only results where <metric> <op> <value>" form. */
export function HavingEditor({
  spec,
  initial,
  onSubmit,
  onCancel,
}: {
  spec: QuestionSpec;
  initial?: QuestionHaving;
  onSubmit: (having: QuestionHaving) => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const columns = havingColumns(spec);
  const [column, setColumn] = useState(initial?.column ?? columns[0]?.key ?? '');
  const [op, setOp] = useState<HavingOp>(initial?.op ?? 'gt');
  const [first, setFirst] = useState(initial?.values[0]?.toString() ?? '');
  const [second, setSecond] = useState(initial?.values[1]?.toString() ?? '');

  const opLabels: Record<HavingOp, string> = {
    gt: t`Greater than`,
    lt: t`Less than`,
    between: t`Between`,
    is: t`Is`,
    isNot: t`Is not`,
    isEmpty: t`Is empty`,
    notEmpty: t`Not empty`,
  };

  const draft = useMemo((): QuestionHaving | null => {
    if (!column) return null;
    if (op === 'isEmpty' || op === 'notEmpty') return { column, op, values: [] };
    const a = Number(first);
    if (first.trim() === '' || !Number.isFinite(a)) return null;
    if (op === 'between') {
      const b = Number(second);
      if (second.trim() === '' || !Number.isFinite(b)) return null;
      return { column, op, values: a <= b ? [a, b] : [b, a] };
    }
    return { column, op, values: [a] };
  }, [column, op, first, second]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft) onSubmit(draft);
  };

  return (
    <form onSubmit={submit} className="space-y-3 p-3">
      <p className="text-sm font-semibold">
        <Trans>Only show results where</Trans>
      </p>
      <Select value={column} onValueChange={setColumn}>
        <SelectTrigger aria-label={t`Metric`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {columns.map((item) => (
            <SelectItem key={item.key} value={item.key}>
              {columnLabel(spec.source, item)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={op} onValueChange={(next) => setOp(next as HavingOp)}>
        <SelectTrigger aria-label={t`Condition`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HAVING_OPS.map((item) => (
            <SelectItem key={item} value={item}>
              {opLabels[item]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {op !== 'isEmpty' && op !== 'notEmpty' && (
        <div className={op === 'between' ? 'grid grid-cols-2 gap-2' : ''}>
          <Input
            id={`${id}-a`}
            type="number"
            inputMode="decimal"
            step="any"
            aria-label={op === 'between' ? t`Minimum` : t`Value`}
            value={first}
            onChange={(event) => setFirst(event.target.value)}
            autoFocus
          />
          {op === 'between' && (
            <Input
              id={`${id}-b`}
              type="number"
              inputMode="decimal"
              step="any"
              aria-label={t`Maximum`}
              value={second}
              onChange={(event) => setSecond(event.target.value)}
            />
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button type="submit" size="sm" disabled={!draft}>
          {initial ? t`Update` : t`Add`}
        </Button>
      </div>
    </form>
  );
}
