import { useState, type ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Label } from '@shared/ui/label';
import { Badge } from '@shared/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@shared/ui/collapsible';
import { Database, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import type { PushApiState } from './usePushApiState';

interface IdReferencePanelProps {
  state: PushApiState;
}

/** Collapsible group of reference rows (Accounts / Categories / Payees). */
function IdGroupSection({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 w-full text-left py-1 rounded-md hover:bg-muted/50">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <Label className="text-xs text-muted-foreground cursor-pointer pointer-events-none">
            {label} ({count})
          </Label>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function IdReferencePanel({ state }: IdReferencePanelProps) {
  const {
    budgets,
    accounts,
    categoryGroups,
    categories,
    payees,
    showIds,
    setShowIds,
    expandedBudgetId,
    setExpandedBudgetId,
    handleCopyId,
    handleCopyText,
  } = state;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          ID Reference
        </CardTitle>
        <CardDescription>
          Find the IDs you need for API requests. Click any ID to copy it. Payees are referenced by
          name, not id.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Collapsible open={showIds} onOpenChange={setShowIds}>
          <CollapsibleTrigger asChild>
            <Button
              variant="outline"
              className="h-auto min-h-9 w-full justify-between whitespace-normal"
            >
              <span className="text-left">Show Budget, Account, Category & Payee IDs</span>
              {showIds ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 space-y-4">
            {/* Budgets */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Budgets</Label>
              <div className="space-y-1">
                {budgets?.map((budget) => (
                  <Collapsible
                    key={budget.ID}
                    open={expandedBudgetId === budget.ID}
                    onOpenChange={(open) => setExpandedBudgetId(open ? budget.ID : null)}
                  >
                    <div className="flex items-center justify-between p-2 rounded-md bg-muted/50 hover:bg-muted">
                      <CollapsibleTrigger asChild>
                        <button className="flex items-center gap-2 flex-1 text-left">
                          {expandedBudgetId === budget.ID ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          <span className="text-sm">{budget.Name}</span>
                        </button>
                      </CollapsibleTrigger>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => handleCopyId(budget.ID, 'Budget')}
                      >
                        <Badge variant="secondary" className="font-mono text-xs">
                          ID: {budget.ID}
                        </Badge>
                        <Copy className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                    <CollapsibleContent className="pl-6 mt-2 space-y-2">
                      {expandedBudgetId === budget.ID && (
                        <>
                          {/* Accounts for this budget */}
                          <IdGroupSection label="Accounts" count={accounts?.length ?? 0}>
                            {accounts?.map((account) => (
                              <div
                                key={account.ID}
                                className="flex items-center justify-between p-2 rounded-md bg-muted/30 hover:bg-muted/50"
                              >
                                <span className="text-sm">{account.Name}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2"
                                  onClick={() => handleCopyId(account.ID, 'Account')}
                                >
                                  <Badge variant="outline" className="font-mono text-xs">
                                    {account.ID}
                                  </Badge>
                                  <Copy className="h-3 w-3 ml-1" />
                                </Button>
                              </div>
                            ))}
                            {(!accounts || accounts.length === 0) && (
                              <p className="text-xs text-muted-foreground p-2">No accounts found</p>
                            )}
                          </IdGroupSection>

                          {/* Categories for this budget */}
                          <IdGroupSection label="Categories" count={categories?.length ?? 0}>
                            {categoryGroups?.map((group) => {
                              const groupCategories = categories?.filter(
                                (c) => c.CategoryGroupID === group.ID
                              );
                              return (
                                <div key={group.ID} className="space-y-1">
                                  <div className="text-xs font-medium text-muted-foreground pl-2">
                                    {group.Name}
                                  </div>
                                  {groupCategories?.map((category) => (
                                    <div
                                      key={category.ID}
                                      className="flex items-center justify-between p-2 rounded-md bg-muted/30 hover:bg-muted/50 ml-2"
                                    >
                                      <span className="text-sm">{category.Name}</span>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2"
                                        onClick={() => handleCopyId(category.ID, 'Category')}
                                      >
                                        <Badge variant="outline" className="font-mono text-xs">
                                          {category.ID}
                                        </Badge>
                                        <Copy className="h-3 w-3 ml-1" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                            {(!categoryGroups || categoryGroups.length === 0) && (
                              <p className="text-xs text-muted-foreground p-2">
                                No categories found
                              </p>
                            )}
                          </IdGroupSection>

                          {/* Payees for this budget — name-keyed, copy the name */}
                          <IdGroupSection label="Payees" count={payees?.length ?? 0}>
                            {payees?.map((payee) => (
                              <div
                                key={payee.Name}
                                className="flex items-center justify-between p-2 rounded-md bg-muted/30 hover:bg-muted/50"
                              >
                                <span className="text-sm">{payee.Name}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2"
                                  onClick={() => handleCopyText(payee.Name, 'Payee')}
                                >
                                  <Badge variant="outline" className="font-mono text-xs">
                                    name
                                  </Badge>
                                  <Copy className="h-3 w-3 ml-1" />
                                </Button>
                              </div>
                            ))}
                            {(!payees || payees.length === 0) && (
                              <p className="text-xs text-muted-foreground p-2">No payees yet</p>
                            )}
                          </IdGroupSection>
                        </>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                ))}
                {(!budgets || budgets.length === 0) && (
                  <p className="text-sm text-muted-foreground p-2">No budgets found</p>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
