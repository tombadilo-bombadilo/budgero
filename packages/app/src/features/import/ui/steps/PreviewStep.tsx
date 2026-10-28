import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import type {
  PreviewRow,
  ColumnMapping,
  ImportConfig,
  ImportDecision,
} from '@features/import/model/types';
import { translateImportText } from '../../lib/import-display-text';

interface PreviewStepProps {
  busy?: boolean;
  previewData: PreviewRow[];
  previewTotalCount: number;
  previewImportableCount: number;
  previewSkippedCount: number;
  columnMapping: ColumnMapping;
  importConfig: ImportConfig;
  hasBudgetSelected: boolean;
  onBack: () => void;
  onStartImport: () => void;
  onDecision: (index: number, decision: ImportDecision) => void;
  onResolveAll: (decision: ImportDecision) => void;
}

export function PreviewStep({
  busy = false,
  previewData,
  hasBudgetSelected,
  onBack,
  onStartImport,
  onDecision,
  onResolveAll,
}: PreviewStepProps) {
  const { t } = useLingui();
  const labels = {
    new: t`New`,
    'already-imported': t`Already imported`,
    'needs-review': t`Needs review`,
    invalid: t`Invalid/skipped`,
  };

  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const unresolved = previewData.filter(
    (r) => r.duplicate.status === 'needs-review' && !r.decision
  ).length;
  const importing = previewData.filter(
    (r) =>
      r.input.valid &&
      r.decision !== 'skip' &&
      r.decision !== 'match' &&
      (r.duplicate.status === 'new' || r.decision === 'import')
  ).length;
  const matching = previewData.filter(
    (r) => r.input.valid && r.decision === 'match' && r.duplicate.candidates.length > 0
  ).length;
  const unresolvedWithCandidate = previewData.some(
    (r) => r.duplicate.status === 'needs-review' && !r.decision && r.duplicate.candidates.length > 0
  );
  const filtered = previewData.filter((r) => filter === 'all' || r.duplicate.status === filter);
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, pages - 1);
  return (
    <Card className="mx-auto w-full max-w-5xl overflow-hidden">
      <CardHeader>
        <CardTitle>
          <Trans>Review import</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            {importing} to import · {matching} matched ·{' '}
            {previewData.filter((r) => r.decision === 'skip').length} skipped · {unresolved} need a
            decision
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2" aria-label={t`Filter import rows`}>
          {['all', ...Object.keys(labels)].map((key) => (
            <Button
              key={key}
              variant={filter === key ? 'default' : 'outline'}
              onClick={() => {
                setFilter(key);
                setPage(0);
              }}
            >
              {key === 'all' ? t`All` : labels[key as keyof typeof labels]} (
              {previewData.filter((r) => key === 'all' || r.duplicate.status === key).length})
            </Button>
          ))}
        </div>
        {matching > 0 && (
          <p className="text-sm">
            <Trans>
              Rows marked Match keep the transaction you entered (category, memo, payee, splits) and
              mark it cleared. Undo right after importing reverts the matches too.
            </Trans>
          </p>
        )}
        {unresolved > 0 && (
          <div className="space-y-2">
            <p className="text-sm">
              <Trans>
                Review possible duplicates before importing. Match keeps the existing transaction
                and marks it cleared; Skip keeps it unchanged.
              </Trans>
            </p>
            <div className="flex flex-wrap gap-2">
              {unresolvedWithCandidate && (
                <Button variant="outline" onClick={() => onResolveAll('match')}>
                  <Trans>Match all unresolved</Trans>
                </Button>
              )}
              <Button variant="outline" onClick={() => onResolveAll('skip')}>
                <Trans>Skip all unresolved</Trans>
              </Button>
              <Button variant="outline" onClick={() => onResolveAll('import')}>
                <Trans>Import all unresolved as new</Trans>
              </Button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th>
                  <Trans>Row / account</Trans>
                </th>
                <th>
                  <Trans>Incoming transaction</Trans>
                </th>
                <th>
                  <Trans>Match / reason</Trans>
                </th>
                <th>
                  <Trans>Decision</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(currentPage * 50, currentPage * 50 + 50).map((row) => (
                <tr key={row.input.index} className="border-t align-top">
                  <td className="p-2">
                    {row.input.index + 1}
                    <br />
                    {row.parsed.account}
                  </td>
                  <td className="p-2">
                    {row.input.date} · {(row.input.inflow - row.input.outflow) / 1000}{' '}
                    {row.input.currency}
                    <br />
                    {row.input.payee}
                    <br />
                    <span className="break-words">{row.input.memo}</span>
                  </td>
                  <td className="p-2">
                    <strong>{labels[row.duplicate.status]}</strong>
                    <p>{translateImportText(row.duplicate.reason)}</p>
                    {row.duplicate.candidates.map((candidate) => (
                      <p key={candidate.id} className="mt-2">
                        <Trans>
                          Existing #{candidate.id}: {candidate.date} ·{' '}
                          {(candidate.inflow - candidate.outflow) / 1000} {row.input.currency}
                          <br />
                          {candidate.payee}
                          <br />
                          {candidate.memo}
                        </Trans>
                      </p>
                    ))}
                    {row.duplicate.sameFileIndex !== undefined && (
                      <p>
                        <Trans>
                          Compare with row {row.duplicate.sameFileIndex + 1} in this file.
                        </Trans>
                      </p>
                    )}
                    {row.errors.map((message, i) => (
                      <p key={i} className="text-destructive">
                        {translateImportText(message)}
                      </p>
                    ))}
                  </td>
                  <td className="p-2">
                    {row.input.valid && (
                      <div className="flex flex-col gap-2">
                        {row.duplicate.status !== 'already-imported' &&
                          row.duplicate.candidates.length > 0 && (
                            <Button
                              size="sm"
                              variant={row.decision === 'match' ? 'default' : 'outline'}
                              onClick={() => onDecision(row.input.index, 'match')}
                            >
                              <Trans>Match</Trans>
                            </Button>
                          )}
                        <Button
                          size="sm"
                          variant={row.decision === 'skip' ? 'default' : 'outline'}
                          onClick={() => onDecision(row.input.index, 'skip')}
                        >
                          <Trans>Skip</Trans>
                        </Button>
                        <Button
                          size="sm"
                          variant={row.decision === 'import' ? 'default' : 'outline'}
                          onClick={() => onDecision(row.input.index, 'import')}
                        >
                          {row.duplicate.status === 'already-imported'
                            ? t`Import anyway`
                            : t`Import as new`}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            <Trans>Previous</Trans>
          </Button>
          <span>
            <Trans>
              Page {currentPage + 1} of {pages}
            </Trans>
          </span>
          <Button
            variant="outline"
            disabled={currentPage + 1 >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            <Trans>Next</Trans>
          </Button>
        </div>
        {!importing && !matching && !unresolved && (
          <p>
            <Trans>Nothing new to import.</Trans>
          </p>
        )}
        <div className="flex justify-between gap-2">
          <Button variant="outline" onClick={onBack} disabled={busy}>
            <Trans>Back to Configuration</Trans>
          </Button>
          <Button disabled={busy || !hasBudgetSelected || unresolved > 0} onClick={onStartImport}>
            {importing
              ? plural(importing, {
                  one: `Import # transaction`,
                  other: `Import # transactions`,
                })
              : matching
                ? plural(matching, {
                    one: `Match # transaction`,
                    other: `Match # transactions`,
                  })
                : t`Finish`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
