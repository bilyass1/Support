import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { getMigrations } from 'better-auth/db/migration';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const pool = new Pool({connectionString:process.env.DATABASE_URL});
const authentication = await getMigrations({database:pool,emailAndPassword:{enabled:true,minPasswordLength:12},rateLimit:{enabled:true,storage:'database'}});
await authentication.runMigrations();
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(758321)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  const name = '001_initial.sql';
  const done = await client.query('SELECT name FROM schema_migrations WHERE name=$1',[name]);
  if (!done.rowCount) {
    await client.query(await readFile(new URL('../db/'+name,import.meta.url),'utf8'));
    await client.query('INSERT INTO schema_migrations(name) VALUES ($1)',[name]);
  }
  await client.query('COMMIT');
  console.log('Application database ready.');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await pool.end(); }
