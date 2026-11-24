import pg from 'pg';
import {randomBytes,randomUUID} from 'node:crypto';
import {createLedger,createTradingService,createMatchingService} from '../src/index.js';
import {createPositionFixture} from './positionCases.js';
import {restoreLegacyFixtureOwner} from './legacyFixtureOwner.js';
// Administrator-only fixtures for a verified disposable pre-0020 database.
export async function seedCapabilityAdoptionHistory(admin,config) {
 if(process.env.NODE_ENV!=='test'||config.host!=='127.0.0.1'||!/test/.test(config.database))throw new Error('Disposable history fixture required.');
 const suffix=randomBytes(4).toString('hex'),owner='history_owner_'+suffix,login='history_fixture_'+suffix,password=randomBytes(24).toString('hex');
 await admin.query('CREATE ROLE '+owner+' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT');
 await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
 await admin.query('GRANT USAGE ON SCHEMA public TO '+owner+','+login);
 await restoreLegacyFixtureOwner(admin,owner,login);
 await admin.query('GRANT SELECT ON public.chains,public.contract_deployments,public.chain_assets,public.market_categories,public.market_outcome_tokens,public.ctf_position_tokens,public.ctf_conditions,public.market_outcomes,public.market_questions,public.markets TO '+owner);
 await admin.query('GRANT UPDATE(id) ON public.markets TO '+owner);
 await admin.query('GRANT EXECUTE ON FUNCTION public.trading_execute(text,text,text,jsonb),public.matching_step(text,uuid),public.matching_pending(text) TO '+login);
 const pool=new pg.Pool({...config,user:login,password}),sys='system:adoption-fixture',key=randomUUID,options={pool,enabled:true,environment:'test',authorize:()=>true};
 try{
  const ledger=createLedger(options);
  const fixture=async(amount=1000000n)=>{
   const users=(await admin.query("INSERT INTO users(email,display_name) VALUES($1,'Fixture A'),($2,'Fixture B') RETURNING id",[key()+'@example.test',key()+'@example.test'])).rows;
   const account=async(ownerUserId,kind,normalSide)=>(await ledger.createAccount(sys,key(),{asset:'USD',ownerUserId,kind,normalSide,accountKey:key()})).accountId;
   const a=await account(users[0].id,'CUSTOMER','CREDIT'),b=await account(users[1].id,'CUSTOMER','CREDIT'),cash=await account(null,'ASSET','DEBIT');
   const entries=n=>[{accountId:cash,asset:'USD',side:'DEBIT',amount:n},{accountId:a,asset:'USD',side:'CREDIT',amount:n}];
   const deposit=await ledger.post(sys,key(),entries(amount),key());return {a,b,cash,actor:'user:'+users[0].id,other:'user:'+users[1].id,entries,deposit};
  };
  const ownerTx=async work=>{const client=await admin.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE '+owner);await work(client);await client.query('COMMIT')}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}};
  const base=await createPositionFixture({admin,runtime:pool,sys,key,fixture,ownerTx});
  const trading=createTradingService(options),matching=createMatchingService(options),terms={marketId:base.market.marketId,tokenId:base.market.tokenId};
  const buy=await trading.place(base.cash.actor,key(),{...terms,side:'BUY',quantity:3000000n,priceCents:65n,cashAccountId:base.cash.a,positionAccountId:base.a.buyer});
  await matching.step(sys,base.market.marketId);
  await trading.place(base.cash.other,key(),{...terms,side:'SELL',quantity:2000000n,priceCents:60n,cashAccountId:base.cash.b,positionAccountId:base.a.seller});
  for(let i=0;i<5;i++)await matching.step(sys,base.market.marketId);
  const order=(await admin.query('SELECT status,filled_quantity::text,remaining_quantity::text FROM trading_orders WHERE id=$1',[buy.orderId])).rows[0];
  if(order.status!=='PARTIAL'||order.filled_quantity!=='2000000'||order.remaining_quantity!=='1000000')throw new Error('Expected partial fill adoption fixture.');
  if((await admin.query('SELECT count(*)::int AS n FROM cash_position_settlements')).rows[0].n<1)throw new Error('Completed settlement fixture missing.');
  // Real ordinary orders preempt the former fixed keys and one legacy key in
  // the future protected namespace. Never fabricate command or financial rows.
  const requestTerms={...terms,side:'BUY',quantity:1000000n,priceCents:1n,cashAccountId:base.cash.a,positionAccountId:base.a.buyer};
  const preemptions=[];
  for(const operationKey of ['capability-adoption','capability-reconciliation','system:reconcile:11111111-1111-4111-8111-111111111111']) {
   const result=await trading.place(base.cash.actor,operationKey,requestTerms);
   preemptions.push({key:operationKey,result});
  }
  for(let i=0;i<10;i++){if((await matching.step(sys,base.market.marketId)).state==='IDLE')break;}
  return {
   marketId:base.market.marketId,orderId:buy.orderId,buyerUserId:base.cash.actor.slice(5),preemptions,
   requestTerms:JSON.parse(JSON.stringify(requestTerms,(_,value)=>typeof value==='bigint'?value.toString():value)),
  };
 }finally{await pool.end();}
}
