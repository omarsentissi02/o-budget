/**
 * Mini-implémentation de l'API D1 au-dessus de `node:sqlite` (SQLite réel, même moteur que D1).
 * Réservé aux tests : permet d'exécuter les vraies migrations et la vraie API Hono sans réseau ni compte Cloudflare.
 * Nécessite Node ≥ 22.13 (module node:sqlite).
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Row = Record<string, unknown>;

const isQuery = (sql: string) => /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);

class FakeStatement {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    private params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new FakeStatement(this.db, this.sql, values.map((v) => (v === undefined ? null : v)) as SQLInputValue[]);
  }

  execute(): { results: Row[]; meta: { changes: number; last_row_id: number } } {
    const stmt = this.db.prepare(this.sql);
    if (isQuery(this.sql)) {
      const results = stmt.all(...this.params) as Row[];
      return { results, meta: { changes: 0, last_row_id: 0 } };
    }
    const r = stmt.run(...this.params);
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }

  async run() {
    const { results, meta } = this.execute();
    return { success: true, results, meta };
  }
  async all<T = Row>() {
    const { results, meta } = this.execute();
    return { success: true, results: results as T[], meta };
  }
  async first<T = Row>(col?: string): Promise<T | null> {
    const { results } = this.execute();
    const row = results[0];
    if (!row) return null;
    return (col ? row[col] : row) as T;
  }
}

export class FakeD1 {
  readonly raw: DatabaseSync;
  constructor() {
    this.raw = new DatabaseSync(":memory:");
    this.raw.exec("PRAGMA foreign_keys = ON;"); // activé par défaut sur D1
  }
  prepare(sql: string) {
    return new FakeStatement(this.raw, sql);
  }
  async batch(statements: FakeStatement[]) {
    this.raw.exec("BEGIN");
    try {
      const out = statements.map((s) => {
        const { results, meta } = s.execute();
        return { success: true, results, meta };
      });
      this.raw.exec("COMMIT");
      return out;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }
  async exec(sql: string) {
    this.raw.exec(sql);
    return { count: 1, duration: 0 };
  }
  query<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.raw.prepare(sql).all(...(params as SQLInputValue[])) as T[];
  }
}

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

/** Applique les migrations dans l'ordre. `after` (exclu) et `upTo` (inclus) bornent la plage. */
export function applyMigrations(db: FakeD1, opts: { after?: string; upTo?: string } = {}) {
  for (const file of migrationFiles()) {
    if (opts.after && file <= opts.after) continue;
    if (opts.upTo && file > opts.upTo) break;
    db.raw.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
}

export function newDb(upTo?: string): FakeD1 {
  const db = new FakeD1();
  applyMigrations(db, { upTo });
  return db;
}

export const asD1 = (db: FakeD1) => db as never;
