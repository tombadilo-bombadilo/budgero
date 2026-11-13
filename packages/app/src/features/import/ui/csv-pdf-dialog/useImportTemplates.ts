import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnMapping, ImportConfig, ImportTemplate } from '@features/import/model/types';
import {
  mergeSyncedState,
  readSyncedState,
  syncedStateWriteBlocker,
  useSyncedState,
  WORKSPACE_SCOPE,
} from '@shared/lib/synced-state';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';

/**
 * Templates are shared by the workspace: synced state WORKSPACE_SCOPE, key
 * TEMPLATES_KEY, a map of template id → ImportTemplate (merge, so templates
 * saved on two devices both stay and a delete syncs). A template is well
 * under 1 KB, so the map holds many dozens before the 64 KB cap.
 */
export const TEMPLATES_KEY = 'importTemplates';
/** Where this device kept templates before they were synced (one list for every workspace). */
export const LEGACY_TEMPLATES_STORAGE_KEY = 'import-templates';

function isTemplate(value: unknown): value is ImportTemplate {
  const t = value as Partial<ImportTemplate> | null;
  return (
    // Ids are always template_<time>_<random>; anything else (__proto__) can't be a map key.
    typeof t?.id === 'string' &&
    /^template_[\w.-]{1,100}$/.test(t.id) &&
    typeof t.name === 'string' &&
    typeof t.numberFormat === 'string' &&
    typeof t.dateFormat === 'string' &&
    typeof t.columnMapping === 'object' &&
    t.columnMapping !== null
  );
}

/** The stored map as a list, oldest first. */
export function templatesOf(stored: unknown): ImportTemplate[] {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];
  return Object.values(stored)
    .filter(isTemplate)
    .sort(
      (a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id)
    );
}

/** Workspaces whose migration this session has run (or is running). */
const migrated = new Set<string>();

export function resetImportTemplatesForTests(): void {
  migrated.clear();
}

/**
 * Copies this device's localStorage templates into the open workspace once
 * (only ids it lacks), then removes the old key so they aren't copied into
 * every other workspace opened here later. Kept when the write fails.
 */
export async function migrateLegacyTemplates(): Promise<void> {
  const stored = readSyncedState(WORKSPACE_SCOPE, TEMPLATES_KEY);
  if (!stored.available || syncedStateWriteBlocker()) return;
  let legacy: unknown;
  try {
    const raw = localStorage.getItem(LEGACY_TEMPLATES_STORAGE_KEY);
    if (raw === null) return;
    legacy = JSON.parse(raw);
  } catch {
    legacy = [];
  }
  const known = new Set(templatesOf(stored.value).map((t) => t.id));
  const missing = (Array.isArray(legacy) ? legacy : [])
    .filter(isTemplate)
    .filter((t) => !known.has(t.id));
  if (missing.length > 0) {
    await mergeSyncedState(WORKSPACE_SCOPE, TEMPLATES_KEY, {
      set: Object.fromEntries(missing.map((t) => [t.id, t])),
    });
  }
  try {
    localStorage.removeItem(LEGACY_TEMPLATES_STORAGE_KEY);
  } catch {
    /* storage blocked: nothing to clear */
  }
}

export interface UseImportTemplatesResult {
  templates: ImportTemplate[];
  /** Saving and deleting would be written: the state has loaded and this isn't the demo. */
  canEditTemplates: boolean;
  selectedTemplate: string;
  setSelectedTemplate: (id: string) => void;
  saveAsTemplate: boolean;
  setSaveAsTemplate: (save: boolean) => void;
  templateName: string;
  setTemplateName: (name: string) => void;
  applyTemplate: () => void;
  deleteTemplate: (id: string) => void;
  /** Resolves the saved template, or null when it wasn't saved (demo, too large, write failed). */
  saveTemplate: (
    template: Omit<ImportTemplate, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<ImportTemplate | null>;
}

/**
 * Owns import-template CRUD (synced workspace state): the template list, the
 * selected/save/name form state, and applying a template onto the column
 * mapping + import config the caller owns.
 */
export function useImportTemplates(
  setColumnMapping: (mapping: ColumnMapping) => void,
  setImportConfig: React.Dispatch<React.SetStateAction<ImportConfig>>
): UseImportTemplatesResult {
  const spaceId = useActiveSpaceId();
  const stored = useSyncedState<Record<string, ImportTemplate>>(WORKSPACE_SCOPE, TEMPLATES_KEY);
  const { merge, canWrite, loaded } = stored;
  const templates = useMemo(() => templatesOf(stored.value), [stored.value]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    if (!spaceId || !loaded || !canWrite || migrated.has(spaceId)) return;
    migrated.add(spaceId);
    migrateLegacyTemplates().catch((err: unknown) => {
      migrated.delete(spaceId);
      console.warn('Failed to move import templates:', err);
    });
  }, [spaceId, loaded, canWrite]);

  const saveTemplate = useCallback(
    async (template: Omit<ImportTemplate, 'id' | 'createdAt' | 'updatedAt'>) => {
      const id = `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date().toISOString();
      const fullTemplate: ImportTemplate = { ...template, id, createdAt: now, updatedAt: now };
      try {
        return (await merge({ set: { [id]: fullTemplate } })) ? fullTemplate : null;
      } catch (err) {
        console.warn('Failed to save template:', err);
        return null;
      }
    },
    [merge]
  );

  const deleteTemplate = useCallback(
    (id: string) => {
      merge({ remove: [id] }).catch((err: unknown) =>
        console.warn('Failed to delete template:', err)
      );
    },
    [merge]
  );

  const applyTemplate = useCallback(() => {
    const template = templates.find((t) => t.id === selectedTemplate);
    if (template) {
      setColumnMapping(template.columnMapping);
      setImportConfig((prev) => ({
        ...prev,
        numberFormat: template.numberFormat,
        thousandSeparator: template.thousandSeparator || ',',
        decimalSeparator: template.decimalSeparator || '.',
        dateFormat: template.dateFormat,
        skipRows: template.skipRows || 0,
        accountCurrency: template.accountCurrency || 'USD',
      }));
    }
  }, [templates, selectedTemplate, setColumnMapping, setImportConfig]);

  return {
    templates,
    canEditTemplates: canWrite,
    selectedTemplate,
    setSelectedTemplate,
    saveAsTemplate,
    setSaveAsTemplate,
    templateName,
    setTemplateName,
    applyTemplate,
    deleteTemplate,
    saveTemplate,
  };
}
