import { useEffect, useState } from 'react';

type CodeMirrorModule = typeof import('@uiw/react-codemirror');
type SqlLangModule = typeof import('@codemirror/lang-sql');
type AutocompleteModule = typeof import('@codemirror/autocomplete');
type ThemeModule = typeof import('@codemirror/theme-one-dark');
type ViewModule = typeof import('@codemirror/view');

export interface SqlEditorModules {
  CodeMirror: CodeMirrorModule['default'];
  sql: SqlLangModule['sql'];
  autocompletion: AutocompleteModule['autocompletion'];
  oneDark: ThemeModule['oneDark'];
  keymap: ViewModule['keymap'];
  SQLDialect: SqlLangModule['SQLDialect'];
  PostgreSQL: SqlLangModule['PostgreSQL'];
}

export function useSqlEditorModules(): SqlEditorModules | null {
  const [modules, setModules] = useState<SqlEditorModules | null>(null);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      import('@uiw/react-codemirror'),
      import('@codemirror/lang-sql'),
      import('@codemirror/autocomplete'),
      import('@codemirror/theme-one-dark'),
      import('@codemirror/view'),
    ])
      .then(([cmModule, langSqlModule, autocompleteModule, themeModule, viewModule]) => {
        if (cancelled) return;

        setModules({
          CodeMirror: (cmModule as CodeMirrorModule).default,
          sql: (langSqlModule as SqlLangModule).sql,
          autocompletion: (autocompleteModule as AutocompleteModule).autocompletion,
          oneDark: (themeModule as ThemeModule).oneDark,
          keymap: (viewModule as ViewModule).keymap,
          SQLDialect: (langSqlModule as SqlLangModule).SQLDialect,
          PostgreSQL: (langSqlModule as SqlLangModule).PostgreSQL,
        });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('[useSqlEditorModules] Failed to load CodeMirror modules', error);
          setModules(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return modules;
}
