import { useEffect, useMemo, useState, useCallback } from 'react';
import type { TransactionRule, RuleCondition, RuleAction } from '@budgero/core/browser';
import { useCategories } from '@entities/category/api/useCategories';
import { useAccounts } from '@entities/account/api/useAccounts';
import {
  type RuleFormCondition,
  type RuleFormAction,
  normalizeCondition,
  normalizeAction,
  createDefaultCondition,
  createDefaultAction,
  getDefaultPayload,
  convertCondition,
  convertAction,
  validateForm,
} from './rule-editor.utils';

export interface RuleFormValues {
  name: string;
  description: string;
  mode: 'continuous' | 'one_time' | 'autofill';
  enabled: boolean;
  runOrder: number;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

export interface UseRuleEditorStateOptions {
  open: boolean;
  budgetId: number;
  mode: 'create' | 'edit';
  initialRule?: TransactionRule | null;
  onSubmit: (values: RuleFormValues) => Promise<void> | void;
}

export function useRuleEditorState({
  open,
  budgetId,
  mode,
  initialRule,
  onSubmit,
}: UseRuleEditorStateOptions) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [modeValue, setModeValue] = useState<'continuous' | 'one_time' | 'autofill'>('continuous');
  const [runOrder, setRunOrder] = useState(0);
  const [conditions, setConditions] = useState<RuleFormCondition[]>([createDefaultCondition()]);
  const [actions, setActions] = useState<RuleFormAction[]>([createDefaultAction()]);
  const [error, setError] = useState<string | null>(null);

  const { data: categories = [] } = useCategories(budgetId);
  const { data: accounts = [] } = useAccounts(budgetId);

  // Reset form when dialog opens/closes or mode changes - defer to avoid synchronous cascade
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      if (mode === 'edit' && initialRule) {
        setName(initialRule.name);
        setDescription(initialRule.description ?? '');
        setEnabled(initialRule.enabled);
        setModeValue(initialRule.mode);
        setRunOrder(initialRule.runOrder ?? 0);
        setConditions(
          initialRule.conditions?.map(normalizeCondition) ?? [createDefaultCondition()]
        );
        setActions(initialRule.actions?.map(normalizeAction) ?? [createDefaultAction()]);
      } else if (mode === 'create') {
        setName('');
        setDescription('');
        setEnabled(true);
        setModeValue('continuous');
        setRunOrder(0);
        setConditions([createDefaultCondition()]);
        setActions([createDefaultAction(categories)]);
      }
      setError(null);
    });
    return () => cancelAnimationFrame(id);
  }, [open, mode, initialRule, categories]);

  const memoizedCategories = useMemo(
    () => [...categories].sort((a, b) => a.Name.localeCompare(b.Name)),
    [categories]
  );
  const memoizedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.Name.localeCompare(b.Name)),
    [accounts]
  );

  const addCondition = useCallback(() => {
    setConditions((prev) => [...prev, createDefaultCondition()]);
  }, []);

  const updateCondition = useCallback((index: number, patch: Partial<RuleFormCondition>) => {
    setConditions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      if (patch.field && patch.field !== prev[index].field) {
        if (patch.field === 'memo') {
          next[index].operator = 'contains';
          next[index].caseSensitive = false;
        } else if (patch.field === 'payee') {
          next[index].operator = 'contains';
          next[index].caseSensitive = false;
        } else if (patch.field === 'amount') {
          next[index].operator = '=';
          delete next[index].caseSensitive;
        } else if (patch.field === 'account') {
          next[index].operator = 'is';
          delete next[index].caseSensitive;
        }
        next[index].value = '';
      }
      return next;
    });
  }, []);

  const removeCondition = useCallback((index: number) => {
    setConditions((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== index)));
  }, []);

  const addAction = useCallback(() => {
    setActions((prev) => [...prev, createDefaultAction(categories)]);
  }, [categories]);

  const updateAction = useCallback(
    (index: number, patch: Partial<RuleFormAction>) => {
      setActions((prev) => {
        const next = [...prev];
        const current = next[index];
        const nextType = patch.type ?? current.type;
        let payload = { ...current.payload, ...patch.payload };

        if (patch.type && patch.type !== current.type) {
          payload = getDefaultPayload(nextType, categories, accounts);
        }

        next[index] = { type: nextType, payload };
        return next;
      });
    },
    [categories, accounts]
  );

  const removeAction = useCallback((index: number) => {
    setActions((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== index)));
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);
    const validationError = validateForm(name, conditions, actions);
    if (validationError) {
      setError(validationError);
      return;
    }

    const payload: RuleFormValues = {
      name: name.trim(),
      description: description.trim(),
      mode: modeValue,
      enabled,
      runOrder,
      conditions: conditions.map(convertCondition),
      actions: actions.map(convertAction),
    };

    await onSubmit(payload);
  }, [name, description, modeValue, enabled, runOrder, conditions, actions, onSubmit]);

  const dialogTitle = mode === 'create' ? 'New automation rule' : 'Edit automation rule';
  const dialogDescription =
    mode === 'create'
      ? 'Describe the conditions and actions you want Budgero to apply automatically.'
      : "Update the rule's details, then save your changes to keep automations in sync.";

  return {
    name,
    setName,
    description,
    setDescription,
    enabled,
    setEnabled,
    modeValue,
    setModeValue,
    runOrder,
    setRunOrder,
    conditions,
    actions,
    error,
    categories: memoizedCategories,
    accounts: memoizedAccounts,
    addCondition,
    updateCondition,
    removeCondition,
    addAction,
    updateAction,
    removeAction,
    handleSubmit,
    dialogTitle,
    dialogDescription,
  };
}
