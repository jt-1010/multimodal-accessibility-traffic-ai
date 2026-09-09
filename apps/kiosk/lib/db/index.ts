import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import * as schema from './schema';

/**
 * PGlite is real Postgres compiled to WASM, running in-process.
 *
 * We get actual Postgres semantics — jsonb, serial, foreign keys, the same SQL
 * we would write against a hosted instance — with no Docker daemon and no
 * connection string to configure. When this moves to a real server, the schema
 * and every query carry over unchanged; only this file changes.
 */

const DATA_DIR = path.join(process.cwd(), '.pglite');

type Db = ReturnType<typeof drizzle<typeof schema>>;

// Cache across HMR reloads in dev, or every edit leaks a database handle.
const globalForDb = globalThis as unknown as { __signorderDb?: Promise<Db> };

async function create(): Promise<Db> {
  const client = new PGlite(DATA_DIR);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  return db;
}

export function getDb(): Promise<Db> {
  globalForDb.__signorderDb ??= create();
  return globalForDb.__signorderDb;
}

export { schema };
