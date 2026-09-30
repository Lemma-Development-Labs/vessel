import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";

/**
 * The narrow SQL surface the auth store needs. Two adapters: node-postgres
 * (production, DATABASE_URL) and PGlite (real Postgres compiled to WASM, used
 * for tests and for local/testnet runs without DATABASE_URL). Mainnet refuses
 * to start without DATABASE_URL (see index.ts), so PGlite never holds
 * mainnet sessions.
 */
export type Row = Record<string, unknown>;

export interface Sql {
  readonly kind: "pg" | "pglite";
  query<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** Run fn inside BEGIN/COMMIT; any throw rolls back. */
  transaction<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function pgSql(pool: Pool): Sql {
  const self: Sql = {
    kind: "pg",
    async query<T extends Row>(text: string, params: readonly unknown[] = []) {
      const res = await pool.query(text, params as unknown[]);
      return res.rows as T[];
    },
    async transaction<T>(fn: (q: Sql) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const q: Sql = {
        kind: "pg",
        async query<U extends Row>(text: string, params: readonly unknown[] = []) {
          const res = await client.query(text, params as unknown[]);
          return res.rows as U[];
        },
        transaction: () => {
          throw new Error("nested transactions are not supported");
        },
        close: async () => {},
      };
      try {
        await client.query("BEGIN");
        const out = await fn(q);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return self;
}

export function pgliteSql(db: PGlite): Sql {
  return {
    kind: "pglite",
    async query<T extends Row>(text: string, params: readonly unknown[] = []) {
      const res = await db.query<T>(text, params as unknown[]);
      return res.rows;
    },
    async transaction<T>(fn: (q: Sql) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) =>
        fn({
          kind: "pglite",
          async query<U extends Row>(text: string, params: readonly unknown[] = []) {
            const res = await tx.query<U>(text, params as unknown[]);
            return res.rows;
          },
          transaction: () => {
            throw new Error("nested transactions are not supported");
          },
          close: async () => {},
        }),
      );
    },
    close: () => db.close(),
  };
}
