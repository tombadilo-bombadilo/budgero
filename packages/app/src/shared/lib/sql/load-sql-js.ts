/** sql.js, loaded globally via a script tag from /sql.js/ (same files the local database uses). */
// SQL.js types (loaded globally via script tag)
export interface SqlJsDatabase {
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  close(): void;
}

export interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
}

export async function loadSqlJs(): Promise<SqlJsStatic> {
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
