// Run by supportflow-monitor.timer every five minutes: site availability, then renewal and expiry reminders.
import pg from 'pg';
import { runMonitor, runReminders } from '../src/lib/monitor.mjs';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
try {
  const monitor = await runMonitor(pool);
  const reminders = await runReminders(pool);
  console.log(JSON.stringify({ monitor, reminders }));
} finally { await pool.end(); }
