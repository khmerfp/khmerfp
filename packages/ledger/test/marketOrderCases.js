import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createQuoteService } from '../src/index.js'

export async function runMarketOrderCases(t, ctx) {
 const {admin,runtime,ledger,positions,registered,accounts,base,expiredFixture,enroll,sys,key,person,place,order,one,drain,reconcile,trading,engine}=ctx
 const d=registered.find(m=>m.type==='CATEGORICAL'),tok=d.tokens[0],unit=1000000n
 const quotes=createQuoteService({pool:runtime,enabled:true,environment:'test',authorize:()=>true})
 const terms=(p,side,n,price,cap,m=d,token=tok)=>({marketId:m.marketId,tokenId:token.id,side,quantity:BigInt(n)*unit,priceCents:BigInt(price),cashAccountId:p.cash,positionAccountId:p.position,...(side==='BUY'?{maxSpendCents:BigInt(cap??BigInt(n)*BigInt(price))}:{})})
 const market=(p,side,n,price,cap,m=d,token=tok,op=key())=>trading.placeMarket(p.actor,op,terms(p,side,n,price,cap,m,token))
 const quote=(p,side,n,price,cap,m=d,token=tok)=>{const {cashAccountId:unusedCash,positionAccountId:unusedPosition,...q}=terms(p,side,n,price,cap,m,token);void unusedCash;void unusedPosition;return quotes.estimate(p.actor,q)}
 const rest=async(p,side,n,price,m=d,token=tok)=>{const r=await place(p,side,n,price,m,token);await drain(m.marketId);return r}
 const hold=async r=>{const o=await order(r.orderId);return o.side==='BUY'?one('SELECT * FROM cash_reservations WHERE id=$1',[o.cash_reservation_id]):one('SELECT * FROM position_reservations WHERE id=$1',[o.position_reservation_id])}
 const cancel=async(r,m=d)=>{const o=await order(r.orderId);if(['OPEN','PARTIAL'].includes(o.status))await trading.cancel('user:'+o.user_id,key(),o.id);await drain(m.marketId)}
 const fs=async id=>(await admin.query('SELECT * FROM trading_fills WHERE buyer_order_id=$1 OR seller_order_id=$1 ORDER BY id',[id])).rows
 const snapshot=async()=> (await one(`SELECT jsonb_build_object('operations',(SELECT count(*) FROM financial_operations),'orders',(SELECT count(*) FROM trading_orders),'requests',(SELECT count(*) FROM matching_requests),'cash',(SELECT jsonb_agg(p ORDER BY account_id) FROM financial_balance_projections p),'positions',(SELECT jsonb_agg(p ORDER BY account_id) FROM position_balance_projections p)) AS state`)).state
 async function terminal(r,status,qty){const o=await order(r.orderId);assert.equal(o.status,status);assert.equal(o.filled_quantity,BigInt(qty)*unit+'');assert.equal(o.remaining_quantity,'0');const h=await hold(r);assert.equal(BigInt(h.amount??h.quantity)-BigInt(h.consumed)-BigInt(h.released),0n);assert.equal((await one("SELECT count(*)::int AS n FROM matching_requests WHERE order_id=$1 AND resting='YES'",[o.id])).n,0)}
 await t.test('market policy and quote permissions remain restricted',async()=>{
  await assert.rejects(runtime.query('DELETE FROM trading_order_policies'),e=>e.code==='42501')
  await assert.rejects(runtime.query("SELECT trading_accept_market('user:1','x','{}')"),e=>e.code==='42501')
  await assert.rejects(quotes.estimate('system:test',{}),/authorized user/)
 })
 await t.test('fully filled market BUY releases all unused cash and never rests',async()=>{
  const a=await person(),b=await person();const s=await rest(a,'SELL',2,60),buy=await market(b,'BUY',2,65,130)
  assert.equal((await hold(buy)).amount,'130');await drain(d.marketId);await terminal(buy,'FILLED',2)
  const h=await hold(buy);assert.equal(h.consumed,'120');assert.equal(h.released,'10');assert.equal((await order(s.orderId)).status,'FILLED');await reconcile()
 })
 await t.test('market SELL uses highest resting BUY price and exact position holds',async()=>{
  const a=await person(),b=await person();const buy=await rest(a,'BUY',2,65),sell=await market(b,'SELL',2,55)
  await drain(d.marketId);await terminal(sell,'FILLED',2);assert.equal((await fs(sell.orderId))[0].price_cents,'65');assert.equal((await order(buy.orderId)).status,'FILLED');await reconcile()
 })
 await t.test('independent BUY cash cap bounds multiple makers and partial finalization',async()=>{
  const a=await person(),b=await person(),c=await person()
  const s1=await rest(a,'SELL',3,60),s2=await rest(b,'SELL',5,63),buy=await market(c,'BUY',10,65,250)
  await drain(d.marketId);await terminal(buy,'CANCELLED',4)
  assert.deepEqual((await fs(buy.orderId)).map(f=>[f.quantity,f.price_cents]),[['3000000','60'],['1000000','63']])
  const h=await hold(buy);assert.equal(h.amount,'250');assert.equal(h.consumed,'243');assert.equal(h.released,'7')
  await cancel(s1);await cancel(s2);await reconcile()
 })
 for(const side of ['BUY','SELL'])await t.test('empty '+side+' IOC cancels and releases every hold',async()=>{
  const p=await person(),r=await market(p,side,2,60,120);await drain(d.marketId);await terminal(r,'CANCELLED',0);await reconcile()
 })
 await t.test('insufficient liquidity partially executes and releases the remainder',async()=>{
  const a=await person(),b=await person();await rest(a,'SELL',2,60)
  const r=await market(b,'BUY',5,65,325);await drain(d.marketId);await terminal(r,'CANCELLED',2);assert.equal((await hold(r)).released,'205');await reconcile()
 })
 for(const side of ['BUY','SELL'])await t.test(side+' execution price protection cannot be exceeded',async()=>{
  const a=await person(),b=await person(),maker=await rest(a,side==='BUY'?'SELL':'BUY',2,side==='BUY'?61:60)
  const r=await market(b,side,2,side==='BUY'?60:61,120);await drain(d.marketId);await terminal(r,'CANCELLED',0);assert.equal((await fs(r.orderId)).length,0);await cancel(maker);await reconcile()
 })
 await t.test('invalid price, quantity and caps fail at service and database boundaries',async()=>{
  const p=await person(),baseTerms=terms(p,'BUY',2,65,130)
  for(const bad of [{priceCents:0n},{priceCents:100n},{quantity:1n},{maxSpendCents:0n},{maxSpendCents:131n},{maxSpendCents:1.2},{quantity:2000000}])await assert.rejects(trading.placeMarket(p.actor,key(),{...baseTerms,...bad}))
  const raw={...baseTerms,quantity:'1000001',priceCents:'65',maxSpendCents:'130'}
  await assert.rejects(runtime.query('SELECT trading_execute($1,$2,$3,$4::jsonb)',[p.actor,'PLACE_MARKET',key(),JSON.stringify(raw)]),/whole/)
  await assert.rejects(trading.placeMarket(p.actor,key(),{...terms(p,'SELL',2,60),maxSpendCents:120n}),/cap|terms/)
  await assert.rejects(trading.place(p.actor,key(),{...baseTerms,orderType:'MARKET'}),/limit order terms/)
  const buy=await market(p,'BUY',1,60,60)
  await assert.rejects(admin.query('UPDATE trading_order_policies SET max_spend_cents=max_spend_cents+1 WHERE order_id=$1',[buy.orderId]),/immutable/)
  await drain(d.marketId);await reconcile()
 })
 await t.test('insufficient cash or shares produces rejected IOC without reservations',async()=>{
  const p=await person(),buy=await market(p,'BUY',20000,99,1980000),sell=await market(p,'SELL',2000,60)
  await drain(d.marketId)
  for(const r of [buy,sell]){const o=await order(r.orderId);assert.equal(o.status,'REJECTED');assert.equal(o.cash_reservation_id,null);assert.equal(o.position_reservation_id,null)}
  await reconcile()
 })
 await t.test('quote is read-only and returns exact multi-maker quantity, cost and rational average',async()=>{
  const a=await person(),b=await person(),c=await person(),s1=await rest(a,'SELL',3,60),s2=await rest(b,'SELL',5,63)
  const before=await snapshot(),q=await quote(c,'BUY',10,65,250)
  assert.deepEqual(await snapshot(),before);assert.equal(q.requestedQuantity,'10000000');assert.equal(q.estimatedExecutableQuantity,'4000000');assert.equal(q.estimatedUnfilledQuantity,'6000000');assert.equal(q.estimatedTotalCents,'243');assert.equal(q.bestAvailablePriceCents,'60');assert.equal(q.estimatedWorstExecutionPriceCents,'63');assert.deepEqual(q.estimatedAverageExecutionPriceCents,{numerator:'243',denominator:'4'});assert.equal(q.indicative,true);assert.ok(q.snapshotId&&q.bookVersion&&q.generatedAt)
  const buy=await market(c,'BUY',10,65,250);await drain(d.marketId);await terminal(buy,'CANCELLED',4);assert.equal((await hold(buy)).consumed,q.estimatedTotalCents)
  await cancel(s1);await cancel(s2);await reconcile()
 })
 await t.test('stale quotes neither promise old liquidity nor override submitted protection',async()=>{
  const a=await person(),b=await person(),s=await rest(a,'SELL',2,60),q=await quote(b,'BUY',2,65,130)
  assert.equal(q.estimatedTotalCents,'120');await cancel(s)
  await rest(a,'SELL',2,64);const r=await market(b,'BUY',2,65,130);await drain(d.marketId);await terminal(r,'FILLED',2);assert.equal((await hold(r)).consumed,'128')
  const high=await rest(a,'SELL',2,66),q2=await quote(b,'BUY',2,65,130)
  assert.equal(q2.estimatedExecutableQuantity,'0');const r2=await market(b,'BUY',2,65,130);await drain(d.marketId);await terminal(r2,'CANCELLED',0);await cancel(high);await reconcile()
 })
 await t.test('market self-trade prevention preserves earlier fills and does not skip the best own maker',async()=>{
  const a=await person(),b=await person();await rest(b,'SELL',1,59);const own=await rest(a,'SELL',2,60)
  const q=await quote(a,'BUY',3,65,195);assert.equal(q.estimatedExecutableQuantity,'1000000');assert.equal(q.stoppedReason,'SELF_TRADE_PREVENTION')
  const r=await market(a,'BUY',3,65,195);await drain(d.marketId);await terminal(r,'CANCELLED',1);assert.equal((await hold(r)).consumed,'59');assert.equal((await order(own.orderId)).filled_quantity,'0');await cancel(own);await reconcile()
 })
 await t.test('concurrent market/limit commands and duplicate market keys create no duplicate fills',async()=>{
  const seller=await person(),buyers=await Promise.all(Array.from({length:5},()=>person()))
  await rest(seller,'SELL',10,60)
  const results=await Promise.all(buyers.map((b,i)=>i%2?place(b,'BUY',2,65):market(b,'BUY',2,65,130)))
  await Promise.all([drain(d.marketId),drain(d.marketId)])
  for(const r of results)assert.equal((await order(r.orderId)).status,'FILLED')
  const p=await person(),op=key(),[a,b]=await Promise.all([market(p,'BUY',2,65,130,d,tok,op),market(p,'BUY',2,65,130,d,tok,op)])
  assert.deepEqual(a,b);await assert.rejects(market(p,'BUY',2,65,120,d,tok,op),/conflicting/)
  await drain(d.marketId);await terminal(a,'CANCELLED',0);await reconcile()
 })
 for(const m of registered)await t.test('IOC exact-token '+m.type+' singleton/complement and round compatibility',async()=>{
  for(const token of m.tokens.slice(0,2)){
   const a=await person(token),b=await person(token),s=await rest(a,'SELL',1,60,m,token),r=await market(b,'BUY',1,65,65,m,token)
   await drain(m.marketId);await terminal(r,'FILLED',1);assert.equal((await order(s.orderId)).status,'FILLED')
  }
  await reconcile()
 })
 await t.test('market orders and quotes reject cross-token and cross-round account substitutions',async()=>{
  const p=await person(),other=registered.find(m=>m.marketId!==d.marketId),token=other.tokens[0]
  await assert.rejects(market(p,'BUY',1,65,65,other,tok))
  await assert.rejects(quote(p,'BUY',1,65,65,other,tok),/token market mismatch/)
  await assert.rejects(market(p,'SELL',1,60,undefined,d,token))
  await reconcile()
 })
 await t.test('paused partially filled IOC releases residual cash in sequence',async()=>{
  const a=await person(),b=await person();await rest(a,'SELL',1,60)
  const r=await market(b,'BUY',2,65,65);await engine.step(sys,d.marketId)
  await admin.query("UPDATE markets SET trading_status='PAUSED' WHERE id=$1",[d.marketId]);await trading.cancel(b.actor,key(),r.orderId)
  await drain(d.marketId);await terminal(r,'CANCELLED',1);assert.equal((await hold(r)).released,'5')
  await admin.query("UPDATE markets SET trading_status='OPEN' WHERE id=$1",[d.marketId]);await reconcile()
 })
 await t.test('IOC expiration after budget exhaustion preserves fills and cannot leak a closed hold',async()=>{
  const m=await expiredFixture(6);await enroll(m);const token=m.tokens[0];accounts.set(token.id,await base.accounts(token.id))
  const a=await person(token),b=await person(token);await rest(a,'SELL',1,60,m,token)
  const r=await market(b,'BUY',2,65,60,m,token);await engine.step(sys,m.marketId)
  const end=(await one('SELECT trading_ends_at FROM markets WHERE id=$1',[m.marketId])).trading_ends_at.getTime();await new Promise(resolve=>setTimeout(resolve,Math.max(0,end-Date.now()+50)))
  await drain(m.marketId);await terminal(r,'EXPIRED',1);await reconcile()
 })
 await t.test('IOC finalization failure rolls back cancellation, release and progress together',async()=>{
  const a=await person(),b=await person();await rest(a,'SELL',1,60)
  const r=await market(b,'BUY',2,65,65);await engine.step(sys,d.marketId)
  const before=await snapshot()
  await admin.query("CREATE FUNCTION ioc_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected IOC finalization fault'; END $$")
  await admin.query('CREATE TRIGGER ioc_fault BEFORE UPDATE ON matching_requests FOR EACH ROW EXECUTE FUNCTION ioc_fault()')
  try{await assert.rejects(engine.step(sys,d.marketId),/injected IOC finalization fault/)}finally{await admin.query('DROP TRIGGER ioc_fault ON matching_requests');await admin.query('DROP FUNCTION ioc_fault()')}
  assert.deepEqual(await snapshot(),before);assert.equal((await order(r.orderId)).status,'PARTIAL');await drain(d.marketId);await terminal(r,'CANCELLED',1);await reconcile()
 })
 for(const finalization of [false,true])for(const mode of ['before','after'])await t.test('IOC worker kill '+mode+' COMMIT '+(finalization?'during finalization':'during partial execution'),async()=>{
  const a=await person(),b=await person();await rest(a,'SELL',1,60)
  const r=await market(b,'BUY',2,65,65);if(finalization)await engine.step(sys,d.marketId)
  const config=Object.fromEntries(['host','port','database','user','password'].map(k=>[k,runtime.options[k]]))
  const child=fork(fileURLToPath(new URL('./matchingCrashChild.js',import.meta.url)),[],{env:{...process.env,NODE_ENV:'test'},execArgv:[],windowsHide:true,stdio:['ignore','ignore','ignore','ipc']})
  const exited=new Promise(resolve=>child.once('exit',resolve))
  try{let timer;const checkpoint=new Promise((resolve,reject)=>{child.once('message',m=>m.checkpoint===mode?resolve():reject(new Error('Isolated worker failed')));child.once('error',reject);child.once('exit',()=>reject(new Error('Worker exited before checkpoint')))})
   child.send({config,marketId:d.marketId,actor:sys,mode})
   try{await Promise.race([checkpoint,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('IOC worker checkpoint timeout')),15000)})])}finally{clearTimeout(timer)}
  }finally{child.kill('SIGKILL');await exited}
  await drain(d.marketId);await terminal(r,'CANCELLED',1);assert.equal((await fs(r.orderId)).length,1);assert.equal((await hold(r)).consumed,'60');assert.equal((await hold(r)).released,'5');await reconcile()
 })
 for(const [name,m,count] of [['binary',registered.find(m=>m.type==='BINARY'),8],['categorical-multi',d,8]])await t.test('IOC benchmark '+name,async()=>{
  const token=m.tokens[0],seller=await person(token),buyer=await person(token),times=[],finalize=[]
  const deadlocks=(await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks
  let maxWaiters=0,stop=false
  const monitor=(async()=>{while(!stop){maxWaiters=Math.max(maxWaiters,(await one("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).n);await new Promise(r=>setTimeout(r,5))}})()
  const start=performance.now()
  try{
   for(let i=0;i<count;i++){
    await rest(seller,'SELL',1,60,m,token);await rest(seller,'SELL',1,61,m,token)
    const r=await market(buyer,'BUY',3,65,195,m,token),tick=performance.now()
    await engine.step(sys,m.marketId);await engine.step(sys,m.marketId)
    const last=performance.now();await engine.step(sys,m.marketId);finalize.push(performance.now()-last);times.push(performance.now()-tick)
    await terminal(r,'CANCELLED',2)
   }
   assert.equal((await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks,deadlocks);await reconcile()
   const stats=a=>{a.sort((x,y)=>x-y);return {averageMs:a.reduce((x,y)=>x+y,0)/a.length,p95:a[Math.ceil(a.length*.95)-1],p99:a[Math.ceil(a.length*.99)-1]}}
   t.diagnostic(JSON.stringify({marketOrderBenchmark:name,orders:count,fills:count*2,makersPerOrder:2,requestedShares:3,executedShares:2,elapsedMs:performance.now()-start,execution:stats(times),finalization:stats(finalize),executionTPS:count*1000/times.reduce((x,y)=>x+y,0),maxWaiters,deadlocks:0,reconciled:true}))
  }finally{stop=true;await monitor}
 })
 await t.test('shared-cash IOC concurrency benchmark across distinct canonical books',async()=>{
  const other=d.tokens[1],buyer=await person(),a=await person(),b=await person(other)
  const otherPosition=(await positions.createAccount(sys,key(),{tokenId:other.id,ownerUserId:buyer.actor.slice(5),accountKey:key(),kind:'CUSTOMER'})).accountId
  const alternate={...buyer,position:otherPosition},times=[],accept=[]
  const deadlocks=(await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks
  let stopped=false,maxWaiters=0
  const observer=(async()=>{while(!stopped){maxWaiters=Math.max(maxWaiters,(await one("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).n);await new Promise(r=>setTimeout(r,5))}})()
  const start=performance.now()
  try{
   for(let i=0;i<6;i++){
    await rest(a,'SELL',1,60);await rest(b,'SELL',1,61,d,other)
    let tick=performance.now();const receipts=await Promise.all([market(buyer,'BUY',2,65,130),market(alternate,'BUY',2,65,130,d,other)]);accept.push(performance.now()-tick)
    tick=performance.now();await Promise.all([drain(d.marketId),drain(d.marketId)]);times.push(performance.now()-tick)
    for(const r of receipts)await terminal(r,'CANCELLED',1)
   }
   assert.equal((await ledger.balance(buyer.actor,buyer.cash)).reserved,'0');assert.equal((await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks,deadlocks);await reconcile()
   const stats=a=>{a.sort((x,y)=>x-y);return {averageMs:a.reduce((x,y)=>x+y,0)/a.length,p95:a[Math.ceil(a.length*.95)-1],p99:a[Math.ceil(a.length*.99)-1]}}
   t.diagnostic(JSON.stringify({marketOrderBenchmark:'shared-cash-two-books',orders:12,fills:12,workers:2,elapsedMs:performance.now()-start,pairedAcceptance:stats(accept),pairedExecution:stats(times),executionTPS:12*1000/times.reduce((x,y)=>x+y,0),maxWaiters,deadlocks:0,reconciled:true}))
  }finally{stopped=true;await observer}
 })
 await t.test('suppressed IOC policy insertion cannot commit a market order or financial hold',async()=>{
  const p=await person(),before=await snapshot()
  await admin.query('CREATE FUNCTION suppress_ioc_policy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$')
  await admin.query('CREATE TRIGGER suppress_ioc_policy BEFORE INSERT ON trading_order_policies FOR EACH ROW EXECUTE FUNCTION suppress_ioc_policy()')
  try{await assert.rejects(market(p,'BUY',2,65,130),/missing or fabricated market execution policy/)}finally{await admin.query('DROP TRIGGER suppress_ioc_policy ON trading_order_policies');await admin.query('DROP FUNCTION suppress_ioc_policy()')}
  assert.deepEqual(await snapshot(),before);await reconcile()
 })
 await t.test('IOC reconstruction followed by new execution preserves every accounting projection',async()=>{
  await ledger.rebuild(sys,key());await positions.rebuild(sys,key())
  const a=await person(),b=await person();await rest(a,'SELL',1,60);const r=await market(b,'BUY',1,65,65);await drain(d.marketId);await terminal(r,'FILLED',1);await reconcile()
 })
}
