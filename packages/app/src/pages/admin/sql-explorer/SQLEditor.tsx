import { SqlCodeMirrorEditor } from '@shared/ui/sql-code-mirror-editor';
import type { SQLEditorProps } from './types';
import { SQL_EDITOR_PLACEHOLDER, DEBOUNCE_DELAY_MS } from './constants';

export function SQLEditor({
  value,
  onChange,
  extensions,
  isDark,
  onRun,
  editorModules,
}: SQLEditorProps) {
  return (
    <SqlCodeMirrorEditor
      value={value}
      onChange={onChange}
      extensions={extensions}
      isDark={isDark}
      onRun={onRun}
      editorModules={editorModules}
      placeholder={SQL_EDITOR_PLACEHOLDER}
      minHeightClassName="min-h-[140px] sm:min-h-[180px]"
      debounceMs={DEBOUNCE_DELAY_MS}
    />
  );
}
