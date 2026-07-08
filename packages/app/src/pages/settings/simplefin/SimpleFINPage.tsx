'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Badge } from '@shared/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Beaker,
  Building2,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Unplug,
  Wallet,
} from 'lucide-react';
import { useSimpleFIN } from '@features/import/api/useSimpleFIN';
import { parseAccessUrl } from '@features/import/lib';
import { trendTextClass } from '@shared/lib/amount-color';
import { getErrorMessage } from '@shared/lib/errors';
import { InlineLoadingRow } from '@shared/ui/InlineLoadingRow';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amount);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function SimpleFINPage() {
  const {
    isConnected,
    credentials,
    claim,
    isClaiming,
    claimError,
    accounts,
    errors: accountErrors,
    isLoading,
    isFetching,
    fetchError,
    disconnect,
    refresh,
  } = useSimpleFIN();

  const [setupToken, setSetupToken] = useState('');
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!setupToken.trim()) {
      toast.error('Please enter a setup token');
      return;
    }

    try {
      claim(setupToken.trim());
      setSetupToken('');
      toast.success('Successfully connected to SimpleFIN');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to connect'));
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setShowDisconnectDialog(false);
    toast.success('Disconnected from SimpleFIN');
  };

  const parsedCredentials = credentials?.accessUrl ? parseAccessUrl(credentials.accessUrl) : null;
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  return (
    <div className="container max-w-5xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-6 sm:space-y-8">
      <SettingsPageHeader
        title="SimpleFIN"
        description="Connect to your bank accounts via SimpleFIN Bridge for automatic transaction sync."
      >
        <Badge variant="outline" className="text-amber-600 border-amber-600">
          <Beaker className="h-3 w-3 mr-1" />
          Experimental
        </Badge>
      </SettingsPageHeader>

      {/* Experimental Warning */}
      <Alert className="border-amber-500 bg-amber-500/10">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <AlertTitle className="text-amber-600">Experimental Feature</AlertTitle>
        <AlertDescription className="text-amber-600/90">
          SimpleFIN integration is currently in development. Features may change, break, or be
          removed without notice. Your credentials are stored locally in your browser. Use at your
          own risk.
        </AlertDescription>
      </Alert>

      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 size={20} />
            Connection Status
          </CardTitle>
          <CardDescription>
            {isConnected
              ? 'Your SimpleFIN Bridge connection is active.'
              : 'Connect to SimpleFIN Bridge to sync your bank accounts.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isConnected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">Connected</span>
              </div>
              {parsedCredentials && (
                <div className="text-sm text-muted-foreground">
                  <p>
                    Server: {parsedCredentials.scheme}://{parsedCredentials.host}
                  </p>
                  {credentials?.createdAt && (
                    <p>Connected: {formatDate(new Date(credentials.createdAt))}</p>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={refresh} disabled={isFetching}>
                  {isFetching ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Refresh
                </Button>
                <Button variant="destructive" onClick={() => setShowDisconnectDialog(true)}>
                  <Unplug className="h-4 w-4 mr-2" />
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  To connect, you need a SimpleFIN setup token. Get one from{' '}
                  <a
                    href="https://beta-bridge.simplefin.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    SimpleFIN Bridge
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
                <Input
                  type="text"
                  placeholder="Paste your setup token here..."
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                  className="font-mono text-sm"
                />
                {claimError && (
                  <p className="text-sm text-destructive">
                    {getErrorMessage(claimError, 'Failed to connect')}
                  </p>
                )}
              </div>
              <Button onClick={handleConnect} disabled={isClaiming || !setupToken.trim()}>
                {isClaiming ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Connect
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Account Errors */}
      {accountErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Account Errors</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside">
              {accountErrors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Fetch Error */}
      {fetchError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Failed to fetch accounts</AlertTitle>
          <AlertDescription>{getErrorMessage(fetchError, 'Unknown error')}</AlertDescription>
        </Alert>
      )}

      {/* Accounts List */}
      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet size={20} />
              Linked Accounts
            </CardTitle>
            <CardDescription>
              Accounts available through your SimpleFIN connection. Click an account to view recent
              transactions.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <InlineLoadingRow label="Loading accounts..." />
            ) : accounts.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No accounts found. Make sure your SimpleFIN connection is properly configured.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Institution</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead>Last Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.map((account) => (
                      <TableRow
                        key={account.id}
                        className={`cursor-pointer hover:bg-muted/50 ${selectedAccountId === account.id ? 'bg-muted' : ''}`}
                        onClick={() => {
                          setSelectedAccountId(
                            selectedAccountId === account.id ? null : account.id
                          );
                        }}
                      >
                        <TableCell>
                          <div className="font-medium">{account.org.name || 'Unknown'}</div>
                          {account.org.domain && (
                            <div className="text-xs text-muted-foreground">
                              {account.org.domain}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{account.name}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(parseFloat(account.balance), account.currency)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {account['available-balance']
                            ? formatCurrency(
                                parseFloat(account['available-balance']),
                                account.currency
                              )
                            : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(new Date(account['balance-date'] * 1000))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Transactions for Selected Account */}
      {selectedAccount && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Transactions - {selectedAccount.name}</CardTitle>
            <CardDescription>Recent transactions from the last 30 days.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {!selectedAccount.transactions || selectedAccount.transactions.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No transactions available for this account.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedAccount.transactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-muted-foreground">
                          {tx.posted
                            ? formatDate(new Date(tx.posted * 1000))
                            : tx.transacted_at
                              ? formatDate(new Date(tx.transacted_at * 1000))
                              : '—'}
                        </TableCell>
                        <TableCell>{tx.description}</TableCell>
                        <TableCell
                          className={`text-right font-mono ${trendTextClass(parseFloat(tx.amount))}`}
                        >
                          {formatCurrency(parseFloat(tx.amount), selectedAccount.currency)}
                        </TableCell>
                        <TableCell>
                          {tx.pending ? (
                            <Badge variant="outline" className="text-amber-600">
                              Pending
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Posted</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Disconnect Confirmation Dialog */}
      <ConfirmDialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
        title="Disconnect SimpleFIN?"
        description="This will remove your SimpleFIN credentials from this browser. You can reconnect at any time with a new setup token."
        confirmText="Disconnect"
        onConfirm={handleDisconnect}
      />
    </div>
  );
}
