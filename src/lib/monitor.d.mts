type Db={query:(sql:string,args?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>};
export type CheckResult={ok:boolean;error:string|null;latency_ms:number;ssl_expires_at:string|null};
export function privateAddress(address:string):boolean;
export function monitorUrl(value:unknown):string|null;
export function checkSite(target:string,timeoutMs?:number):Promise<CheckResult>;
export function runMonitor(db:Db,check?:(url:string)=>Promise<CheckResult>):Promise<{checked:number;down:number;changed:number}>;
export function runReminders(db:Db):Promise<{sent:number}>;
