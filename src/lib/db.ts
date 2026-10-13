import { Pool, type PoolClient } from 'pg';
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
export async function transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
