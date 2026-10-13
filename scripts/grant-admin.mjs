import { Pool } from 'pg';
const email = process.argv[2];
if (!email || !process.env.DATABASE_URL) throw new Error('Usage: npm run admin:grant -- admin@example.com');
const pool = new Pool({connectionString:process.env.DATABASE_URL});
try {
  const result=await pool.query('SELECT id FROM "user" WHERE lower(email)=lower($1)',[email]);
  if (result.rowCount!==1) throw new Error('Create this account on /login first.');
  await pool.query("INSERT INTO app_roles(user_id,role) VALUES ($1,'admin') ON CONFLICT(user_id) DO UPDATE SET role='admin'",[result.rows[0].id]);
  console.log('Administrator role assigned.');
} finally { await pool.end(); }
