import { useCallback, useState } from 'react';
import type { ColumnMapping, ImportConfig, ImportTemplate } from '@features/import/model/types';

const TEMPLATES_STORAGE_KEY = 'import-templates';

function loadStoredTemplates(): ImportTemplate[] {
  try {
    const stored = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (err) {
    console.warn('Failed to load templates:', err);
    return [];
  }
}

export interface UseImportTemplatesResult {
  templates: ImportTemplate[];
  selectedTemplate: string;
  setSelectedTemplate: (id: string) => void;
  saveAsTemplate: boolean;
  setSaveAsTemplate: (save: boolean) => void;
  templateName: string;
  setTemplateName: (name: string) => void;
  applyTemplate: () => void;
  deleteTemplate: (id: string) => void;
  saveTemplate: (
    template: Omit<ImportTemplate, 'id' | 'createdAt' | 'updatedAt'>
  ) => ImportTemplate;
}

/**
 * Owns import-template CRUD (localStorage-backed): the template list, the
 * selected/save/name form state, and applying a template onto the column
 * mapping + import config the caller owns.
 */
export function useImportTemplates(
  setColumnMapping: (mapping: ColumnMapping) => void,
  setImportConfig: React.Dispatch<React.SetStateAction<ImportConfig>>
): UseImportTemplatesResult {
  // Loaded lazily (once, on first render) rather than via a mount effect so
  // the template list is available immediately, not one render late.
  const [templates, setTemplates] = useState<ImportTemplate[]>(loadStoredTemplates);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');

  const saveTemplate = useCallback(
    (template: Omit<ImportTemplate, 'id' | 'createdAt' | 'updatedAt'>) => {
      const id = `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date().toISOString();
      const fullTemplate: ImportTemplate = { ...template, id, createdAt: now, updatedAt: now };
      const updatedTemplates = [...templates, fullTemplate];
      setTemplates(updatedTemplates);
      localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(updatedTemplates));
      return fullTemplate;
    },
    [templates]
  );

  const deleteTemplate = useCallback(
    (id: string) => {
      const updatedTemplates = templates.filter((t) => t.id !== id);
      setTemplates(updatedTemplates);
      localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(updatedTemplates));
    },
    [templates]
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
