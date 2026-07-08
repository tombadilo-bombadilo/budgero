import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import type { AdminUserDetails, User } from '@features/admin/model/admin-users';
import { formatShortDate } from '../admin-users.utils';
import { TabSection } from './TabSection';
import { CompactMetric, EmptyState, SectionError } from './primitives';

export function BillingTab({
  resolvedUser,
  details,
  loading,
  error,
  onRetry,
}: {
  resolvedUser: User;
  details: AdminUserDetails | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <TabSection loading={loading} error={error} onRetry={onRetry}>
      <Card>
        <CardHeader>
          <CardTitle>Subscription Summary</CardTitle>
          <CardDescription>
            Live LemonSqueezy plan details with recent invoice history.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CompactMetric label="Plan" value={details?.subscription?.planName || 'No active plan'} />
          <CompactMetric
            label="Status"
            value={details?.subscription?.status || resolvedUser.subscription_status || 'inactive'}
          />
          <CompactMetric label="Price" value={details?.subscription?.priceFormatted || 'N/A'} />
          <CompactMetric label="LTV" value={details?.subscription?.ltvFormatted || '$0.00'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
          <CardDescription>
            Most recent LemonSqueezy invoices, capped at ten records.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SectionError message={details?.sectionErrors?.subscription} />
          {details?.subscription?.transactions.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="text-right">Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {details.subscription.transactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell>{formatShortDate(transaction.createdAt)}</TableCell>
                    <TableCell>{transaction.statusFormatted || transaction.status}</TableCell>
                    <TableCell className="capitalize">
                      {transaction.billingReason || 'subscription'}
                    </TableCell>
                    <TableCell>{transaction.totalFormatted}</TableCell>
                    <TableCell className="text-right">
                      {transaction.invoiceUrl ? (
                        <a
                          className="text-sm font-medium text-teal-700 underline underline-offset-4"
                          href={transaction.invoiceUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="text-muted-foreground">Unavailable</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState message="No transactions available for this user." />
          )}
        </CardContent>
      </Card>
    </TabSection>
  );
}
