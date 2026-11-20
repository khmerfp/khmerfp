import { runMarketOrderCases } from './marketOrderCases.js'
import { runLifecycleCases } from './lifecycleCases.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createTradingService, createMatchingService } from '../src/index.js'
import { runMatchingWorker } from '../src/matchingWorker.js'

// This module is invoked only by the verified Docker/PostgreSQL parent fixture.
export async function runMatchingCases(t, { admin, runtime, ledger, positions, accounts, registered, sys, key, fixture, expiredFixture, enroll, base }) {
  const folder=fileURLToPath(new URL('../../db/migrations/',import.meta.url))
  try { await migrate(drizzle(admin),{migrationsFolder:folder}) }
  catch(error) { throw new Error(`Matching adoption failed: ${error.cause?.code || 'unknown'} ${error.cause?.message || error.message}`, { cause: error }) }
  for(const table of ['matching_markets','matching_requests','trading_order_policies','trading_event_stream','trading_event_cursors','market_templates','market_template_controls','market_rounds','market_round_requirements','market_round_observations','market_lifecycle_events','market_lifecycle_cursors']) await admin.query('ALTER TABLE '+table+' OWNER TO ledger_owner')
  for(const f of (await admin.query("SELECT oid::regprocedure::text AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'matching_%' OR proname LIKE 'trading_%' OR proname LIKE 'market_schedule_%')")).rows) await admin.query('ALTER FUNCTION '+f.signature+' OWNER TO ledger_owner')
  await admin.query('GRANT EXECUTE ON FUNCTION trading_execute(text,text,text,jsonb),matching_step(text,uuid),matching_pending(text),matching_quote(text,jsonb),matching_expiring(text),matching_expire(text,uuid,integer),matching_status(text,text),matching_diagnostics(text),trading_event_markets(text),trading_event_batch(text,uuid,integer,bigint),trading_event_ack(text,uuid,bigint,jsonb) TO ledger_runtime')
  await admin.query('GRANT SELECT,INSERT,UPDATE ON public.markets,public.market_questions,public.market_outcomes,public.market_observation_specs,public.ctf_conditions,public.ctf_position_tokens TO ledger_owner')
  await admin.query('GRANT SELECT ON public.market_categories TO ledger_owner')
    await admin.query('GRANT EXECUTE ON FUNCTION public.validate_market_definition(uuid,boolean) TO ledger_owner')
    await admin.query('GRANT INSERT ON public.market_outcome_tokens TO ledger_owner')
  await admin.query('GRANT USAGE,SELECT ON SEQUENCE public.market_outcomes_id_seq,public.ctf_conditions_id_seq,public.ctf_position_tokens_id_seq TO ledger_owner')
  await admin.query('GRANT EXECUTE ON FUNCTION public.market_schedule_plan(text,uuid),public.market_schedule_create_round(text,jsonb),public.market_schedule_step(text,uuid),public.market_schedule_execute(text,text,jsonb),public.market_schedule_read(text,text,jsonb),public.market_schedule_event_streams(text),public.market_schedule_event_batch(text,uuid,integer,bigint),public.market_schedule_event_ack(text,uuid,bigint,jsonb) TO ledger_runtime')
  const options={pool:runtime,enabled:true,environment:'test',authorize:()=>true}
  const trading=createTradingService(options),engine=createMatchingService(options)
  const one=async(sql,args)=>(await admin.query(sql,args)).rows[0]
  const order=id=>one('SELECT * FROM trading_orders WHERE id=$1',[id])
  const drain=async market=>{ for(let i=0;i<2000;i++){const r=await engine.step(sys,market);if(r.state==='IDLE'||r.state==='PAUSED')return r}throw new Error('Unexpected persistent matching backlog') }
  const reconcile=async()=>{
    assert.equal((await trading.reconcile(sys)).reconciled,true)
    assert.equal((await one("SELECT count(*)::int AS n FROM matching_requests r JOIN trading_books b ON b.market_id=r.market_id JOIN trading_orders o ON o.id=r.order_id AND o.book_id=b.id WHERE r.resting='YES' AND r.state<>'DONE'")).n,0)
    assert.equal((await one('SELECT count(*)::int AS n FROM trading_order_events e LEFT JOIN trading_outbox x ON x.event_id=e.id WHERE x.id IS NULL')).n,0)
  }
  // Adopted open orders retain their priority and reservations. Close them through sequenced commands.
  for(const o of (await admin.query("SELECT id,user_id FROM trading_orders WHERE status IN ('OPEN','PARTIAL')")).rows) await trading.cancel('user:'+o.user_id,key(),o.id)
  for(const m of await engine.pending(sys))await drain(m)
  const d=registered.find(x=>x.type==='CATEGORICAL'),token=d.tokens[0]
  async function person(tok=token){
    const f=await fixture(1000000n)
    const position=(await positions.createAccount(sys,key(),{tokenId:tok.id,ownerUserId:f.actor.slice(5),accountKey:key(),kind:'CUSTOMER'})).accountId
    const a=accounts.get(tok.id)
    await a.recognize(1000n*1000000n)
    await positions.transfer(sys,key(),{sourceAccountId:a.unallocated,targetAccountId:position,quantity:1000n*1000000n,reference:key()})
    return {actor:f.actor,cash:f.a,position}
  }
  const place=(p,side,n,price,m=d,tok=token,k=key())=>trading.place(p.actor,k,{marketId:m.marketId,tokenId:tok.id,side,quantity:BigInt(n)*1000000n,priceCents:BigInt(price),cashAccountId:p.cash,positionAccountId:p.position})
  const fills=async()=> (await admin.query('SELECT * FROM trading_fills ORDER BY id')).rows
  const cleanup=async(...receipts)=>{
    for(const r of receipts){const o=await order(r.orderId);if(['OPEN','PARTIAL'].includes(o.status))await trading.cancel('user:'+o.user_id,key(),o.id)}
    await drain(d.marketId);await reconcile()
  }
  await t.test('matching migration and runtime permissions preserve the accounting boundary',async()=>{
    assert.equal((await one('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).n,20)
    for(const table of ['matching_markets','matching_requests','trading_order_policies','trading_event_stream','trading_event_cursors','market_templates','market_template_controls','market_rounds','market_round_requirements','market_round_observations','market_lifecycle_events','market_lifecycle_cursors'])await assert.rejects(runtime.query('DELETE FROM '+table),e=>e.code==='42501')
    await assert.rejects(runtime.query("SELECT trading_execute_foundation('system:tests','FILL','x','{}')"),e=>e.code==='42501')
    await assert.rejects(trading.fill(sys,key(),{}),/direct fill disabled/)
    await assert.rejects(engine.step('user:1',d.marketId),/system authorization/)
    await assert.rejects(engine.pending('user:1'),/system authorization/)
  })
  for(const [name,buyLimit,sellLimit,expected] of [['exact',60,60,60],['crossed',65,60,60],['non-crossing',55,60,null]])await t.test(name+' automatic limit matching',async()=>{
    const seller=await person(),buyer=await person(),s=await place(seller,'SELL',1,sellLimit)
    await drain(d.marketId)
    const b=await place(buyer,'BUY',1,buyLimit),before=(await fills()).length
    await drain(d.marketId)
    const after=await fills();assert.equal(after.length-before,expected===null?0:1)
    if(expected!==null){assert.equal(after.at(-1).price_cents,String(expected));assert.equal((await order(b.orderId)).status,'FILLED')}
    await cleanup(s,b)
  })
  await t.test('lowest SELL then FIFO maker priority and exact price improvement example',async()=>{
    const s1=await person(),s2=await person(),s3=await person(),buyer=await person()
    const a=await place(s1,'SELL',30,60),b=await place(s2,'SELL',50,63),c=await place(s3,'SELL',1,70)
    await drain(d.marketId)
    const buy=await place(buyer,'BUY',100,64),start=(await fills()).length
    await drain(d.marketId)
    const fs=(await fills()).slice(start);assert.deepEqual(fs.map(x=>[x.seller_order_id,x.quantity,x.price_cents]),[[a.orderId,'30000000','60'],[b.orderId,'50000000','63']])
    const o=await order(buy.orderId),r=await one('SELECT * FROM cash_reservations WHERE id=$1',[o.cash_reservation_id])
    assert.equal(o.remaining_quantity,'20000000');assert.equal(r.amount,'6400');assert.equal(r.consumed,'4950');assert.equal(r.released,'170');assert.equal(BigInt(r.amount)-BigInt(r.consumed)-BigInt(r.released),1280n)
    assert.equal((await ledger.balance(buyer.actor,buyer.cash)).reserved,'1280')
    await cleanup(buy,c)
  })
  await t.test('highest BUY priority, FIFO at equal prices, resting maker price',async()=>{
    const a=await person(),b=await person(),c=await person(),seller=await person()
    const low=await place(a,'BUY',1,60),first=await place(b,'BUY',1,65),second=await place(c,'BUY',1,65)
    await drain(d.marketId)
    const before=(await fills()).length,s=await place(seller,'SELL',2,55);await drain(d.marketId)
    const fs=(await fills()).slice(before);assert.deepEqual(fs.map(f=>[f.buyer_order_id,f.price_cents]),[[first.orderId,'65'],[second.orderId,'65']])
    await cleanup(low,s)
  })
  await t.test('incoming orders cannot become makers or be overtaken by cancellation',async()=>{
    const a=await person(),b=await person(),c=await person()
    const sell=await place(a,'SELL',2,60),buy1=await place(b,'BUY',1,65),buy2=await place(c,'BUY',1,65)
    await trading.cancel(a.actor,key(),sell.orderId)
    await drain(d.marketId)
    assert.equal((await order(buy1.orderId)).status,'FILLED');assert.equal((await order(buy2.orderId)).status,'FILLED');assert.equal((await order(sell.orderId)).status,'FILLED')
    await reconcile()
  })
  await t.test('self-trade cancels incoming remainder without skipping the best maker',async()=>{
    const p=await person(),other=await person()
    const own=await place(p,'SELL',2,60),worse=await place(other,'SELL',2,61);await drain(d.marketId)
    const b=await place(p,'BUY',3,65),n=(await fills()).length;await drain(d.marketId)
    assert.equal((await fills()).length,n);assert.equal((await order(b.orderId)).status,'CANCELLED');assert.equal((await order(own.orderId)).remaining_quantity,'2000000')
    const e=await one("SELECT payload FROM trading_order_events WHERE order_id=$1 AND kind='CANCEL'",[b.orderId]);assert.equal(e.payload.reason,'SELF_TRADE_PREVENTION')
    await cleanup(own,worse)
  })
  await t.test('self-trade after a valid partial fill preserves completed accounting',async()=>{
    const p=await person(),other=await person()
    const best=await place(other,'SELL',1,59),own=await place(p,'SELL',2,60);await drain(d.marketId)
    const b=await place(p,'BUY',3,65);await drain(d.marketId)
    const o=await order(b.orderId);assert.equal(o.filled_quantity,'1000000');assert.equal(o.cancelled_quantity,'2000000');assert.equal(o.status,'CANCELLED')
    await cleanup(best,own)
  })
  await t.test('concurrent workers, duplicate processing and submissions do not duplicate fills',async()=>{
    const a=await person(),b=await person();const seller=await place(a,'SELL',10,60);await drain(d.marketId)
    const op=key();const [x,y]=await Promise.all([place(b,'BUY',10,65,d,token,op),place(b,'BUY',10,65,d,token,op)]);assert.deepEqual(x,y)
    const n=(await fills()).length
    await Promise.all(Array.from({length:8},()=>engine.step(sys,d.marketId)))
    assert.equal((await fills()).length,n+1);assert.equal((await order(seller.orderId)).status,'FILLED')
    await reconcile()
  })
  await t.test('paused head drains in sequence, releases holds and cannot execute after resume',async()=>{
    const a=await person(),b=await person();const s=await place(a,'SELL',1,60);await drain(d.marketId)
    const buy=await place(b,'BUY',1,65);await trading.cancel(a.actor,key(),s.orderId)
    await admin.query("UPDATE markets SET trading_status='PAUSED' WHERE id=$1",[d.marketId])
    assert.equal((await engine.step(sys,d.marketId)).reason,'MARKET_PAUSED');assert.equal((await order(s.orderId)).status,'OPEN');assert.equal((await order(buy.orderId)).status,'CANCELLED')
    await drain(d.marketId);assert.equal((await order(s.orderId)).status,'CANCELLED')
    await admin.query("UPDATE markets SET trading_status='OPEN' WHERE id=$1",[d.marketId]);await drain(d.marketId)
    assert.equal((await order(buy.orderId)).status,'CANCELLED');await reconcile()
  })
  await t.test('paused partial BUY and pending SELL release unused cash and shares under concurrent cancellation',async()=>{
    const a=await person(),b=await person(),c=await person()
    const s=await place(a,'SELL',1,60);await drain(d.marketId)
    const buy=await place(b,'BUY',3,65),pendingSell=await place(c,'SELL',2,61)
    assert.equal((await engine.step(sys,d.marketId)).state,'FILLED_STEP')
    await admin.query("UPDATE markets SET trading_status='PAUSED' WHERE id=$1",[d.marketId])
    const op=key();await Promise.all([trading.cancel(b.actor,op,buy.orderId),trading.cancel(b.actor,op,buy.orderId),trading.cancel(c.actor,key(),pendingSell.orderId)])
    await Promise.all([drain(d.marketId),drain(d.marketId)])
    assert.equal((await order(buy.orderId)).filled_quantity,'1000000');assert.equal((await order(buy.orderId)).cancelled_quantity,'2000000')
    assert.equal((await ledger.balance(b.actor,b.cash)).reserved,'0');assert.equal((await positions.balance(c.actor,c.position)).reserved,'0')
    assert.equal((await order(pendingSell.orderId)).status,'CANCELLED');assert.equal((await order(s.orderId)).status,'FILLED')
    await admin.query("UPDATE markets SET trading_status='OPEN' WHERE id=$1",[d.marketId]);await drain(d.marketId);await reconcile()
  })
  for(const m of registered)await t.test(m.type+' singleton/complement and recurring-round token isolation',async()=>{
    for(const tok of m.tokens){
      const a=await person(tok),b=await person(tok)
      const s=await place(a,'SELL',1,60,m,tok),buy=await place(b,'BUY',1,65,m,tok)
      await drain(m.marketId);assert.equal((await order(s.orderId)).status,'FILLED');assert.equal((await order(buy.orderId)).status,'FILLED')
    }
    await reconcile()
  })
  await t.test('cross-token books never match and terminal cancellation is rejected',async()=>{
    const tok=d.tokens[1],a=await person(),b=await person(tok)
    const sell=await place(a,'SELL',1,60),buy=await place(b,'BUY',1,65,d,tok),n=(await fills()).length
    await drain(d.marketId);assert.equal((await fills()).length,n)
    await cleanup(sell,buy)
    await assert.rejects(trading.cancel(a.actor,key(),sell.orderId),/terminal/)
  })
  await t.test('cutoff during multi-maker processing preserves the first fill and releases remainder',async()=>{
    const m=await expiredFixture(5);await enroll(m)
    const tok=m.tokens[0];accounts.set(tok.id,await base.accounts(tok.id))
    const a=await person(tok),b=await person(tok),buyer=await person(tok)
    const s1=await place(a,'SELL',1,60,m,tok),s2=await place(b,'SELL',1,61,m,tok)
    await drain(m.marketId)
    const buy=await place(buyer,'BUY',2,65,m,tok)
    assert.equal((await engine.step(sys,m.marketId)).state,'FILLED_STEP')
    await admin.query("UPDATE markets SET trading_status='PAUSED' WHERE id=$1",[m.marketId])
    const end=(await one('SELECT trading_ends_at FROM markets WHERE id=$1',[m.marketId])).trading_ends_at.getTime()
    await new Promise(r=>setTimeout(r,Math.max(0,end-Date.now()+50)))
    await drain(m.marketId)
    const o=await order(buy.orderId);assert.equal(o.filled_quantity,'1000000');assert.equal(o.status,'EXPIRED');assert.equal((await ledger.balance(buyer.actor,buyer.cash)).reserved,'0')
    await trading.expire(sys,key(),s2.orderId);await drain(m.marketId)
    assert.equal((await order(s1.orderId)).status,'FILLED');await reconcile()
  })
  await t.test('faults after accounting and before durable progress roll back every leg',async()=>{
    const a=await person(),b=await person(),s=await place(a,'SELL',1,60);await drain(d.marketId)
    const buy=await place(b,'BUY',1,65),n=(await fills()).length
    for(const [table,timing,event] of [['trading_outbox','AFTER','INSERT'],['matching_requests','BEFORE','UPDATE']]){
      await admin.query("CREATE FUNCTION matching_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected matching fault'; END $$")
      await admin.query(`CREATE TRIGGER matching_fault ${timing} ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION matching_fault()`)
      try{await assert.rejects(engine.step(sys,d.marketId),/injected matching fault/)}finally{await admin.query(`DROP TRIGGER matching_fault ON ${table}`);await admin.query('DROP FUNCTION matching_fault()')}
      assert.equal((await fills()).length,n);assert.equal((await order(buy.orderId)).filled_quantity,'0');await reconcile()
    }
    await drain(d.marketId);assert.equal((await order(s.orderId)).status,'FILLED');await reconcile()
  })
  for(const mode of ['before','after'])await t.test('worker connection termination '+mode+' COMMIT recovers deterministically',async()=>{
    const a=await person(),b=await person(),s=await place(a,'SELL',1,60);await drain(d.marketId)
    const buy=await place(b,'BUY',1,65),n=(await fills()).length
    let fault=true
    const pool={connect:async()=>{
      const c=await runtime.connect();c.on('error',()=>{})
      return {release:e=>c.release(e),query:async(...args)=>{
        if(args[0]==='COMMIT'&&fault){
          fault=false
          if(mode==='after')await c.query(...args)
          const pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
          await admin.query('SELECT pg_terminate_backend($1)',[pid])
          const e=new Error('lost commit response');e.code='ECONNRESET';throw e
        }
        return c.query(...args)
      }}
    }}
    const faulty=createMatchingService({...options,pool})
    await assert.rejects(faulty.step(sys,d.marketId),e=>e.commitOutcome==='UNKNOWN')
    assert.equal((await fills()).length,n+(mode==='after'?1:0))
    const restarted=createMatchingService(options)
    for(let i=0;i<3;i++)await restarted.step(sys,d.marketId)
    assert.equal((await fills()).length,n+1);assert.equal((await order(buy.orderId)).status,'FILLED');assert.equal((await order(s.orderId)).status,'FILLED');await reconcile()
  })
  await t.test('fabricated worker progress cannot pass mandatory commit validation',async()=>{
    const p=await person(),buy=await place(p,'BUY',1,10)
    await assert.rejects(admin.query('UPDATE matching_requests SET steps=steps+1 WHERE order_id=$1',[buy.orderId]),/missing or fabricated/)
    await drain(d.marketId);await cleanup(buy)
  })
  for(const [name,markets,shared] of [['one-binary',[registered.find(m=>m.type==='BINARY')],false],['multiple-independent',[registered.find(m=>m.type==='BINARY'),d],false],['categorical-shared',[d,d],true],['large-multifill',[d],false]])await t.test('automatic matching benchmark '+name,async()=>{
    const accept=[],processing=[],latencies=[],commandLatencies=[],people=new Map(),initial=(await fills()).length
    const deadlocks=(await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks
    let samples=0,maxWaiters=0,stopped=false
    const sampler=(async()=>{while(!stopped){const q=await one("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");maxWaiters=Math.max(maxWaiters,q.n);samples++;await new Promise(r=>setTimeout(r,5))}})()
    const start=performance.now(),receipts=[]
    try{
      for(const m of markets){
        const tok=m.tokens[0]
        if(!people.has(m.marketId))people.set(m.marketId,{seller:await person(tok),buyer:await person(tok)})
        const {seller,buyer}=people.get(m.marketId)
        for(let i=0;i<10;i++){
          const a=shared?seller:await person(tok),b=shared?buyer:await person(tok)
          for(const [p,side,n,price] of (name==='large-multifill'?[[a,'SELL',1,60]]:[[a,'SELL',1,60],[b,'BUY',1,65]])){const tick=performance.now();receipts.push(await place(p,side,n,price,m,tok));accept.push(performance.now()-tick)}
        }
        if(name==='large-multifill'){const tick=performance.now();receipts.push(await place(buyer,'BUY',10,65,m,tok));accept.push(performance.now()-tick)}
      }
      const backlog=(await one("SELECT count(*)::int AS n FROM matching_requests WHERE state='QUEUED'")).n
      const processingStart=performance.now()
      await Promise.all(markets.map(async m=>{for(let i=0;i<100;i++){const tick=performance.now(),r=await engine.step(sys,m.marketId);latencies.push(performance.now()-tick);if(r.requestId){const q=await one('SELECT state,created_at FROM matching_requests WHERE id=$1',[r.requestId]);if(q.state==='DONE')commandLatencies.push(Date.now()-q.created_at.getTime())}if(r.state==='FILLED_STEP')processing.push(performance.now()-tick);if(r.state==='IDLE')break}}))
      const processingMs=performance.now()-processingStart,elapsed=performance.now()-start
      for(const r of receipts)assert.equal((await order(r.orderId)).status,'FILLED')
      const count=(await fills()).length-initial
      assert.equal(count,markets.length*10);assert.equal((await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks,deadlocks)
      await reconcile()
      const stats=a=>{a.sort((x,y)=>x-y);return {averageMs:a.reduce((x,y)=>x+y,0)/a.length,p95:a[Math.ceil(a.length*.95)-1],p99:a[Math.ceil(a.length*.99)-1]}}
      t.diagnostic(JSON.stringify({matchingBenchmark:name,markets:new Set(markets.map(m=>m.marketId)).size,marketLanes:markets.length,orders:receipts.length,fills:count,workers:markets.length,elapsedMs:elapsed,submission:stats(accept),commandCompletion:stats(commandLatencies),processing:stats(latencies),fill:stats(processing),acceptanceTPS:accept.length*1000/accept.reduce((a,b)=>a+b,0),processingMs,processingTPS:latencies.length*1000/processingMs,fillTPS:count*1000/processingMs,mixedOrderTPS:receipts.length*1000/elapsed,mixedFillTPS:count*1000/elapsed,initialBacklog:backlog,finalBacklog:(await one("SELECT count(*)::int AS n FROM matching_requests WHERE state='QUEUED'")).n,lockSamples:samples,maxWaiters,deadlocks:0,reconciled:true,includesFixtureSetup:true}))
    }finally{stopped=true;await sampler}
  })
  await t.test('cross-market concurrent acceptance sharing cash locks before foreign keys',async()=>{
    const other=registered.find(m=>m.type==='BINARY'),tok=other.tokens[0],buyer=await person()
    const otherPosition=(await positions.createAccount(sys,key(),{tokenId:tok.id,ownerUserId:buyer.actor.slice(5),accountKey:key(),kind:'CUSTOMER'})).accountId
    const alternate={...buyer,position:otherPosition},deadlocks=(await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks
    const receipts=[]
    for(let i=0;i<10;i++)receipts.push(...await Promise.all([place(buyer,'BUY',1,10),place(alternate,'BUY',1,10,other,tok)]))
    await Promise.all([drain(d.marketId),drain(other.marketId)])
    for(const r of receipts){const o=await order(r.orderId);assert.equal(o.status,'OPEN');await trading.cancel(buyer.actor,key(),r.orderId)}
    await Promise.all([drain(d.marketId),drain(other.marketId)])
    assert.equal((await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks,deadlocks);await reconcile()
  })
  await t.test('application worker processes persistent backlog and stops cleanly',async()=>{
    const a=await person(),b=await person();const s=await place(a,'SELL',1,60),buy=await place(b,'BUY',1,65)
    const controller=new AbortController(),errors=[]
    const running=runMatchingWorker({service:engine,actor:sys,signal:controller.signal,pollMs:25,onError:e=>errors.push(e)})
    try{for(let i=0;i<100&&(await order(buy.orderId)).status!=='FILLED';i++)await new Promise(r=>setTimeout(r,25));assert.equal((await order(buy.orderId)).status,'FILLED')}finally{controller.abort();await running}
    assert.deepEqual(errors,[]);assert.equal((await order(s.orderId)).status,'FILLED');await reconcile()
  })
  await t.test('matching adoption and second migration execution leave history stable',async()=>{
    const before=(await admin.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows
    await migrate(drizzle(admin),{migrationsFolder:folder})
    assert.deepEqual((await admin.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows,before)
    const journal=JSON.parse(readFileSync(folder+'meta/_journal.json','utf8'));assert.equal(journal.entries.length,20)
    await reconcile()
  })
  await runMarketOrderCases(t,{admin,runtime,ledger,positions,registered,accounts,base,expiredFixture,enroll,fixture,sys,key,person,place,order,one,drain,reconcile,trading,engine})
  await runLifecycleCases(t,{admin,runtime,ledger,positions,registered,accounts,base,expiredFixture,enroll,fixture,sys,key,person,place,order,one,drain,reconcile,trading,engine})

}
