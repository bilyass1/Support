import { Pool } from 'pg';
import { deliverPending, closeDelivery } from '../src/lib/delivery.mjs';
// Run every minute by supportflow-notifications.timer. The web process also sends right after each
// action; this job is the safety net that retries failures and does the housekeeping.
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
try{await deliverPending(pool);}
finally{await pool.end();closeDelivery();}
