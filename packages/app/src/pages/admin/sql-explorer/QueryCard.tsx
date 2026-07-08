import { memo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Switch } from '@shared/ui/switch';
import { Label } from '@shared/ui/label';
import { Input } from '@shared/ui/input';
import { Play, Copy, Loader2, Shield, AlertTriangle, Save, Trash2 } from 'lucide-react';
import type { QueryCardProps } from './types';
import { COMMON_QUERIES } from './constants';
import { SQLEditor } from './SQLEditor';

export const QueryCard = memo(
  ({
    sqlQuery,
    setSqlQuery,
    isDryRun,
    setIsDryRun,
    isExecuting,
    queryResult,
    executeQuery,
    copyResultsAsCSV,
    formatSQL,
    extensions,
    isDarkMode,
    editorModules,
    savedQueries,
    isLoadingSavedQueries,
    saveQueryName,
    setSaveQueryName,
    onSaveQuery,
    onLoadQuery,
    onDeleteQuery,
  }: QueryCardProps) => {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-base">SQL Query</CardTitle>
              <CardDescription>
                Queries run against the production database.
                {isDryRun
                  ? ' Dry run mode enabled - changes will be simulated.'
                  : ' Changes take effect immediately!'}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="dry-run-toggle" className="flex items-center gap-2 cursor-pointer">
                {isDryRun ? (
                  <Shield className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                )}
                <span className="text-sm font-medium">{isDryRun ? 'Dry Run' : 'Live Mode'}</span>
              </Label>
              <Switch
                id="dry-run-toggle"
                checked={isDryRun}
                onCheckedChange={setIsDryRun}
                className="data-[state=checked]:bg-green-600"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 justify-between">
            <div className="flex gap-2">
              <Button type="button" onClick={() => executeQuery()} disabled={isExecuting}>
                {isExecuting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run Query
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={copyResultsAsCSV}
                disabled={!queryResult}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy CSV
              </Button>
            </div>
            <Button type="button" variant="outline" onClick={formatSQL}>
              Format SQL
            </Button>
          </div>
          <SQLEditor
            value={sqlQuery}
            onChange={setSqlQuery}
            extensions={extensions}
            isDark={isDarkMode}
            onRun={() => executeQuery()}
            editorModules={editorModules}
          />
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Quick Queries
            </h3>
            <div className="flex flex-wrap gap-2">
              {COMMON_QUERIES.map((item) => (
                <Button
                  key={item.name}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSqlQuery(item.query);
                    executeQuery(item.query);
                  }}
                >
                  {item.name}
                </Button>
              ))}
            </div>
          </div>

          <div className="border-t pt-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Saved Queries
            </h3>
            <div className="flex gap-2 mb-3">
              <Input
                placeholder="Query name..."
                value={saveQueryName}
                onChange={(e) => setSaveQueryName(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && saveQueryName.trim()) {
                    onSaveQuery(saveQueryName);
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => onSaveQuery(saveQueryName)}
                disabled={!saveQueryName.trim() || !sqlQuery.trim()}
              >
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
            </div>
            {isLoadingSavedQueries ? (
              <p className="text-sm text-muted-foreground">Loading saved queries...</p>
            ) : savedQueries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved queries yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {savedQueries.map((query) => (
                  <div key={query.id} className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onLoadQuery(query)}
                      title={query.query}
                    >
                      {query.name}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onDeleteQuery(query.name)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }
);

QueryCard.displayName = 'QueryCard';
