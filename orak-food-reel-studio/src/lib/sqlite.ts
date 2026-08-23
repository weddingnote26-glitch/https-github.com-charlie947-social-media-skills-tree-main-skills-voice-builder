import { Database as WasmDatabase } from "node-sqlite3-wasm";

/**
 * SQLite 얇은 호환 계층.
 *
 * 왜 필요한가:
 *  - better-sqlite3 같은 네이티브 모듈은 Node 버전이 바뀌면 C++ 컴파일이 필요해지고,
 *    Windows에서는 Visual Studio 설치를 요구해 일반 사용자가 설치에 실패합니다.
 *  - node-sqlite3-wasm 은 WebAssembly라 어떤 Node 버전에서도 컴파일 없이 동작합니다.
 *
 * 호출부(86곳)를 고치지 않으려고 better-sqlite3와 같은 모양의 API를 제공합니다.
 *   db.prepare(sql).run/get/all(...)   db.exec(sql)   db.pragma(str)   db.transaction(fn)
 */

export type Row = Record<string, unknown>;
type Bind = unknown[] | Record<string, unknown> | undefined;

/** better-sqlite3 호출 방식(가변 인자)을 node-sqlite3-wasm 방식(배열/객체)으로 변환 */
function normalize(sql: string, args: unknown[]): Bind {
  if (args.length === 0) return undefined;
  const first = args[0];
  const isPlainObject =
    args.length === 1 &&
    first !== null &&
    typeof first === "object" &&
    !Array.isArray(first) &&
    !Buffer.isBuffer(first) &&
    !(first instanceof Uint8Array);

  if (isPlainObject) {
    // 명명 파라미터: better-sqlite3는 { id } 처럼 접두사 없이 받지만
    // node-sqlite3-wasm 은 { "@id" } 처럼 SQL에 쓰인 접두사가 필요합니다.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(first as Record<string, unknown>)) {
      if (k.startsWith("@") || k.startsWith(":") || k.startsWith("$")) {
        out[k] = v;
        continue;
      }
      const prefix = sql.includes(`@${k}`) ? "@" : sql.includes(`:${k}`) ? ":" : sql.includes(`$${k}`) ? "$" : "@";
      out[prefix + k] = v;
    }
    return out;
  }
  return args as unknown[];
}

/** undefined 는 바인딩할 수 없으므로 null 로 (better-sqlite3와 동작을 맞춤) */
function clean(bind: Bind): Bind {
  if (bind === undefined) return undefined;
  if (Array.isArray(bind)) return bind.map((v) => (v === undefined ? null : v));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bind)) out[k] = v === undefined ? null : v;
  return out;
}

export interface Statement {
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...args: unknown[]): Row | undefined;
  all(...args: unknown[]): Row[];
}

export class SqliteDatabase {
  private db: WasmDatabase;

  constructor(file: string) {
    this.db = new WasmDatabase(file);
  }

  prepare(sql: string): Statement {
    const db = this.db;
    return {
      run(...args: unknown[]) {
        // 드라이버가 돌려주는 변경 행 수를 그대로 넘긴다.
        // 예전에는 0을 고정으로 돌려줬는데, 삭제 건수를 세는 화면이 늘 "0개"라고 말했다.
        const res = db.run(sql, clean(normalize(sql, args)) as never);
        return { changes: res?.changes ?? 0, lastInsertRowid: res?.lastInsertRowid ?? 0 };
      },
      get(...args: unknown[]) {
        return (db.get(sql, clean(normalize(sql, args)) as never) ?? undefined) as Row | undefined;
      },
      all(...args: unknown[]) {
        return db.all(sql, clean(normalize(sql, args)) as never) as Row[];
      },
    };
  }

  /** 여러 문장을 한 번에 (스키마 생성용) */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(statement: string): void {
    try {
      this.db.run(`PRAGMA ${statement}`);
    } catch {
      // WASM 빌드가 지원하지 않는 PRAGMA는 무시 (동작에 영향 없음)
    }
  }

  /** better-sqlite3 의 db.transaction(fn) 과 같은 사용감 */
  transaction<T extends (...a: never[]) => unknown>(fn: T): T {
    const db = this.db;
    return ((...a: never[]) => {
      db.run("BEGIN");
      try {
        const out = fn(...a);
        db.run("COMMIT");
        return out;
      } catch (e) {
        try { db.run("ROLLBACK"); } catch { /* 이미 롤백됨 */ }
        throw e;
      }
    }) as T;
  }

  close(): void {
    this.db.close();
  }
}
