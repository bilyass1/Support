// Only deterministic synthetic accounts in the isolated CI database.
import {Pool} from 'pg';
import {hashPassword} from 'better-auth/crypto';
import {randomUUID} from 'node:crypto';
if(process.env.SUPPORT_CI_SEED!=='yes'||new URL(process.env.DATABASE_URL).pathname!=='/supportflow_ci')throw Error('Only the isolated supportflow_ci database may be seeded.');
const pool=new Pool({connectionString:process.env.DATABASE_URL}),id=randomUUID();
try{await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt","twoFactorEnabled") VALUES($1,\'CI Admin\',\'ci-admin@example.com\',false,now(),now(),false)',[id]);await pool.query('INSERT INTO "account"(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,now(),now())',[randomUUID(),id,await hashPassword('CI-Admin-Password-123456')]);await pool.query('INSERT INTO app_roles(user_id,role) VALUES($1,\'admin\')',[id]);}finally{await pool.end();}
