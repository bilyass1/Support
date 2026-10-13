import { describe,it,expect } from 'vitest';
import { creditChange,canMove,checkOpenLimit,suggestedCost } from '../src/lib/domain';
import { actionSchema } from '../src/lib/validation';
describe('credit invariants',()=>{
  it('reserves, consumes, and releases without manufacturing credits',()=>{
    expect(creditChange(100,0,0,30)).toEqual({balance:100,reserved:30});
    expect(creditChange(100,30,-30,-30)).toEqual({balance:70,reserved:0});
    expect(creditChange(100,30,0,-30)).toEqual({balance:100,reserved:0});
  });
  it.each([[20,15,0,6],[20,0,-21,0],[20,0,0,-1],[20,0,0,0.5]])('rejects an invalid wallet operation',(...args)=>expect(()=>creditChange(...args as [number,number,number,number])).toThrow());
});
describe('rules and lifecycle',()=>{
  it('enforces configured open-ticket limits and indicative category costs',()=>{
    expect(suggestedCost([{kind:'category_cost',category:'design',tokens:8}],'design')).toBe(8);
    expect(()=>checkOpenLimit([{kind:'max_open_tickets',limit:2}],2)).toThrow();
  });
  it('cannot consume before a ticket is ready or reopen a closed ticket',()=>{
    expect(()=>canMove('quoted','closed')).toThrow();
    expect(()=>canMove('closed','in_progress')).toThrow();
    expect(()=>canMove('ready','closed')).not.toThrow();
  });
  it('rejects unrecognized executable rules and fractional credits',()=>{
    expect(actionSchema.safeParse({type:'save_plan',name:'Plan',annual_tokens:100,price_minor:0,currency:'TND',support_level:'Standard',rules:[{kind:'execute',code:'...'}]}).success).toBe(false);
    expect(actionSchema.safeParse({type:'recharge',organization_id:'11111111-1111-4111-8111-111111111111',tokens:1.5,note:'Test'}).success).toBe(false);
  });
});
