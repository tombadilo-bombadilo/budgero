import { memo, useState, useEffect, useCallback, useRef } from 'react';
import type { Extension } from '@codemirror/state';
import type { SqlEditorModules } from '@shared/hooks/useSqlEditorModules';

const EDITOR_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace';

export interface SqlCodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  extensions: Extension[];
  /** Dark theme flag (each page computes its own dark-mode boolean and passes it here). */
  isDark: boolean;
  /** Invoked when the user presses Cmd/Ctrl+Enter inside the editor. */
  onRun?: () => void;
  /** Lazily-loaded CodeMirror modules; null while loading shows the placeholder state. */
  editorModules: SqlEditorModules | null;
  /** Placeholder text shown in the empty editor. */
  placeholder: string;
  /**
   * Tailwind classes controlling the editor (and matching loading-state) min-height,
   * e.g. `min-h-[140px] sm:min-h-[180px]`.
   */
  minHeightClassName: string;
  /** Debounce delay (ms) before propagating edits to `onChange`. */
  debounceMs?: number;
}

/**
 * Shared CodeMirror-based SQL editor used by the admin SQL explorer and the
 * report explorer page. Debounces edits, wires Cmd/Ctrl+Enter to `onRun`, and
 * applies the one-dark theme when `isDark` is set.
 */
export const SqlCodeMirrorEditor = memo(
  ({
    value,
    onChange,
    extensions,
    isDark,
    onRun,
    editorModules,
    placeholder,
    minHeightClassName,
    debounceMs = 300,
  }: SqlCodeMirrorEditorProps) => {
    // Local state manages editor value for performance; props sync in on change.
    const [localValue, setLocalValue] = useState(value);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Update local value when prop changes (e.g., loading a report).
    useEffect(() => {
      void Promise.resolve().then(() => setLocalValue(value));
    }, [value]);

    const handleChange = useCallback(
      (newValue: string) => {
        setLocalValue(newValue);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          onChange(newValue);
        }, debounceMs);
      },
      [onChange, debounceMs]
    );

    useEffect(() => {
      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      };
    }, []);

    if (!editorModules) {
      return (
        <div
          className={`flex ${minHeightClassName} items-center justify-center rounded border border-dashed border-muted-foreground/50 bg-muted/30 text-xs text-muted-foreground`}
        >
          Loading SQL editor...
        </div>
      );
    }

    const CodeMirrorComponent = editorModules.CodeMirror;

    return (
      <CodeMirrorComponent
        value={localValue}
        onChange={handleChange}
        onKeyDownCapture={(e: React.KeyboardEvent) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            onRun?.();
          }
        }}
        extensions={extensions}
        theme={isDark ? editorModules.oneDark : 'light'}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: false,
        }}
        style={{
          fontSize: '12px',
          fontFamily: EDITOR_FONT_FAMILY,
        }}
        className={minHeightClassName}
      />
    );
  }
);

SqlCodeMirrorEditor.displayName = 'SqlCodeMirrorEditor';
