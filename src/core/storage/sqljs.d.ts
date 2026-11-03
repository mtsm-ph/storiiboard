// The part of sql.js the memory driver uses (memoryDriver.ts). Declared here rather than adding @types/sql.js:
// sql.js is a dev-only dependency for the end-to-end tests, and these few calls are all they need.
declare module 'sql.js' {
  type SqlJsValue = string | number | null | Uint8Array;

  interface Statement {
    bind(values: readonly SqlJsValue[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, SqlJsValue>;
    free(): boolean;
  }

  interface Database {
    run(sql: string, params?: readonly SqlJsValue[]): Database;
    exec(sql: string): unknown;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }

  export type { Database, SqlJsStatic, SqlJsValue, Statement };
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
