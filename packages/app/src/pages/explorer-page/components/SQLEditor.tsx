import type { Extension } from '@codemirror/state';
import { SqlCodeMirrorEditor } from '@shared/ui/sql-code-mirror-editor';
import type { SqlEditorModules } from '@shared/hooks/useSqlEditorModules';

const PLACEHOLDER = `-- Enter your SQL query here
SELECT * FROM budgets;`;

export interface SQLEditorProps {
  value: string;
  onChange: (value: string) => void;
  extensions: Extension[];
  theme: 'light' | 'dark';
  onRun?: () => void;
  editorModules: SqlEditorModules | null;
}

export function SQLEditor({
  value,
  onChange,
  extensions,
  theme,
  onRun,
  editorModules,
}: SQLEditorProps) {
  return (
    <SqlCodeMirrorEditor
      value={value}
      onChange={onChange}
      extensions={extensions}
      isDark={theme === 'dark'}
      onRun={onRun}
      editorModules={editorModules}
      placeholder={PLACEHOLDER}
      minHeightClassName="min-h-[120px] sm:min-h-[150px]"
    />
  );
}
