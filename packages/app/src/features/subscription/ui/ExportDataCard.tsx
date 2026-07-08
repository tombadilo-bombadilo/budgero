import { useState } from 'react';
import { Card } from '@shared/ui/card';
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
import { Download, Database, FileText, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { blobApi, spaceApi } from '@shared/api/api-client';
import { decryptAndDecompressDatabase } from '@shared/lib/crypto';
import { getTodayISO } from '@shared/lib/date-utils';
import { downloadBlob } from '@shared/lib/download';
import { getErrorMessage } from '@shared/lib/errors';
import { resultsToCsv } from '@shared/lib/sql/csv';
import { unwrapSpaceKeyWithMaster, encodeSpaceKey } from '@budgero/runtime';

// SQL.js types (loaded globally via script tag)
interface SqlJsDatabase {
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  close(): void;
}

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
}

async function loadSqlJs(): Promise<SqlJsStatic> {
  const globalWindow = window as Window & {
    initSqlJs?: (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic>;
  };

  if (typeof globalWindow.initSqlJs === 'function') {
    return globalWindow.initSqlJs({
      locateFile: (file) => `/sql.js/${file}`,
    });
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout loading SQL.js'));
    }, 15000);

    const script = document.createElement('script');
    script.src = '/sql.js/sql-wasm.js';
    script.onload = () => {
      let attempts = 0;
      const waitForInit = () => {
        if (typeof globalWindow.initSqlJs === 'function') {
          globalWindow
            .initSqlJs({
              locateFile: (file) => `/sql.js/${file}`,
            })
            .then((SQL) => {
              clearTimeout(timeout);
              resolve(SQL);
            })
            .catch((err) => {
              clearTimeout(timeout);
              reject(err);
            });
        } else if (attempts < 50) {
          attempts++;
          setTimeout(waitForInit, 100);
        } else {
          clearTimeout(timeout);
          reject(new Error('SQL.js failed to initialize'));
        }
      };
      waitForInit();
    };
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Failed to load SQL.js script'));
    };
    document.head.appendChild(script);
  });
}

interface ExportDataCardProps {
  spaceId: string | null | undefined;
  embedded?: boolean;
}

export default function ExportDataCard({ spaceId, embedded = false }: ExportDataCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [masterPassword, setMasterPassword] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportType, setExportType] = useState<'sqlite' | 'csv'>('sqlite');
  const [error, setError] = useState<string | null>(null);

  const handleExportClick = (type: 'sqlite' | 'csv') => {
    setExportType(type);
    setMasterPassword('');
    setError(null);
    setDialogOpen(true);
  };

  const handleExport = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!spaceId) {
      setError('No workspace found to export.');
      return;
    }

    if (!masterPassword.trim()) {
      setError('Please enter your master password.');
      return;
    }

    setIsExporting(true);
    setError(null);

    try {
      const spaces = await spaceApi.listSpaces();
      const space = spaces.find((s) => s.space_id === spaceId);
      if (!space) {
        throw new Error('Workspace not found.');
      }

      if (!space.encrypted_space_key) {
        throw new Error('No encryption key found for this workspace.');
      }

      let spacePassphrase: string;
      try {
        const spaceKey = await unwrapSpaceKeyWithMaster(space.encrypted_space_key, masterPassword);
        spacePassphrase = encodeSpaceKey(spaceKey);
      } catch {
        throw new Error('Failed to decrypt workspace key. Please check your master password.');
      }

      const blobResult = await blobApi.downloadBlob(spaceId);
      if (!blobResult) {
        throw new Error('No data found on server. You may not have any saved data yet.');
      }

      let decryptedData: Uint8Array;
      try {
        const result = await decryptAndDecompressDatabase(blobResult.data, spacePassphrase);
        decryptedData = result.decrypted;
      } catch {
        throw new Error('Failed to decrypt data. The workspace key may be corrupted.');
      }

      const timestamp = getTodayISO();

      if (exportType === 'sqlite') {
        downloadBlob(decryptedData, `budgero-backup-${timestamp}.db`, 'application/x-sqlite3');
        toast.success('Database exported successfully');
      } else {
        const SQL = await loadSqlJs();
        const db = new SQL.Database(decryptedData);

        try {
          const csvFiles: Record<string, string> = {};

          const tables = [
            'budgets',
            'accounts',
            'categories',
            'category_groups',
            'transactions',
            'assignments',
          ];

          for (const table of tables) {
            try {
              const result = db.exec(`SELECT * FROM ${table} ORDER BY id`);
              if (result.length > 0 && result[0].values.length > 0) {
                csvFiles[`${table}.csv`] = resultsToCsv(result[0].columns, result[0].values);
              }
            } catch {
              // Table might not exist, skip
            }
          }

          const { default: JSZip } = await import('jszip');
          const zip = new JSZip();

          Object.entries(csvFiles).forEach(([filename, content]) => {
            if (content) {
              zip.file(filename, content);
            }
          });

          const zipBlob = await zip.generateAsync({ type: 'blob' });
          downloadBlob(zipBlob, `budgero-csv-export-${timestamp}.zip`, 'application/zip');
          toast.success('CSV files exported successfully');
        } finally {
          db.close();
        }
      }

      setDialogOpen(false);
      setMasterPassword('');
    } catch (err) {
      const message = getErrorMessage(err, 'Export failed. Please try again.');
      setError(message);
      toast.error(message);
    } finally {
      setIsExporting(false);
    }
  };

  if (!spaceId) {
    return null;
  }

  const exportActions = (
    <div className="flex items-start gap-3">
      <Download className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
      <div className="flex-1 space-y-3">
        <div>
          <h3 className="font-semibold">Export Your Data</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Download your budget data before your subscription ends. You&apos;ll need your master
            password to decrypt the export.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExportClick('sqlite')}
            disabled={isExporting}
          >
            <Database className="h-4 w-4 mr-2" />
            Download SQLite
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExportClick('csv')}
            disabled={isExporting}
          >
            <FileText className="h-4 w-4 mr-2" />
            Download CSV
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {embedded ? exportActions : <Card className="p-4 md:p-6 mx-2 md:mx-0">{exportActions}</Card>}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!isExporting) {
            setDialogOpen(open);
            if (!open) {
              setMasterPassword('');
              setError(null);
            }
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter Master Password</DialogTitle>
            <DialogDescription>
              Your data is encrypted. Enter your master password to decrypt and export it.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleExport} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="export-master-password">Master Password</Label>
              <Input
                id="export-master-password"
                type="password"
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                placeholder="Enter your master password"
                disabled={isExporting}
                autoFocus
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={isExporting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isExporting || !masterPassword.trim()}>
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Export {exportType === 'sqlite' ? 'Database' : 'CSV'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
