import { after } from 'next/server';
import { pool } from './db';
import { deliverPending, deliveryConfigured } from './delivery.mjs';
let running:Promise<unknown>|null=null,again=false;
async function drain(){
 do{again=false;await deliverPending(pool,process.env,false);}while(again);
}
/**
 * Sends what the current request queued as soon as its response is out, instead of waiting for the
 * minute timer. One drain runs at a time per process; a request arriving meanwhile asks for one more pass.
 */
export function deliverAfterResponse(){
 if(!deliveryConfigured())return;
 after(async()=>{
  if(running){again=true;return;}
  running=drain().catch(()=>console.error('Immediate delivery failed; the timer will retry.')).finally(()=>{running=null;});
  await running;
 });
}
