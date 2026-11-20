import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { createTradingService } from '../src/index.js'

// Internal service tests only; no HTTP fill endpoint and no automatic counterpart selection.
export async function runTradingCases(t, { admin, runtime, ledger, positions, cash, accounts, registered, sys, key, expiredFixture, enroll, base, fixture }) {
  const trading = createTradingService({ pool: runtime, enabled: true, environment: 'test', authorize: () => true })
  const one = async (sql, args) => (await admin.query(sql, args)).rows[0]
  const order = id => one('SELECT * FROM trading_orders WHERE id=$1', [id])
  const place = (d, token, side, quantity=2000000n, priceCents=65n, operation=key()) => {
    const a=accounts.get(token.id)
    return trading.place(side==='BUY'?cash.actor:cash.other, operation, { marketId:d.marketId,tokenId:token.id,side,quantity,priceCents,cashAccountId:side==='BUY'?cash.a:cash.b,positionAccountId:side==='BUY'?a.buyer:a.seller })
  }
  const pair = async (d, token, quantity=2000000n) => ({buy:await place(d,token,'BUY',quantity),sell:await place(d,token,'SELL',quantity,60n)})
  const fill = (p, quantity=1000000n, operation=key()) => trading.fill(sys,operation,{buyerOrderId:p.buy.orderId,sellerOrderId:p.sell.orderId,quantity,priceCents:60n})
  const snapshot = async () => {
    const result={}
    for(const table of ['trading_books','trading_commands','trading_orders','trading_fills','trading_order_events','trading_outbox','financial_operations','financial_balance_projections','position_balance_projections'])result[table]=(await admin.query('SELECT to_jsonb(t) AS row FROM '+table+' t ORDER BY to_jsonb(t)::text')).rows
    return result
  }
  await t.test('trading authorization and production opt-in fail closed',async()=>{
    const denied=createTradingService({pool:runtime,enabled:true,environment:'test',authorize:()=>false})
    await assert.rejects(denied.place(cash.actor,key(),{}),/not authorized/)
    assert.throws(()=>createTradingService({pool:runtime,enabled:true,environment:'production',authorize:()=>true}))
    for(const table of ['trading_books','trading_commands','trading_orders','trading_fills','trading_order_events','trading_outbox'])await assert.rejects(runtime.query('DELETE FROM '+table),e=>e.code==='42501')
  })
  for(const d of registered){
    await t.test(`${d.type}: persistent canonical books, full and partial fills, cancellation and outbox`,async()=>{
      for(const tok of d.tokens){
        const p=await pair(d,tok),before=await order(p.buy.orderId)
        const op=key(),[a,b]=await Promise.all([fill(p,1000000n,op),fill(p,1000000n,op)])
        assert.deepEqual(a,b);assert.equal(a.settlementScope,'INTERNAL_LEDGER')
        const partial=await order(p.buy.orderId);assert.equal(partial.status,'PARTIAL');assert.equal(partial.remaining_quantity,'1000000')
        const hold=await one('SELECT * FROM cash_reservations WHERE id=$1',[before.cash_reservation_id]);assert.equal(hold.released,'5');assert.equal(BigInt(hold.amount)-BigInt(hold.consumed)-BigInt(hold.released),65n)
        await fill(p)
        assert.equal((await order(p.buy.orderId)).status,'FILLED')
        await assert.rejects(fill(p),/incompatible/)
        await assert.rejects(trading.cancel(cash.actor,key(),p.buy.orderId),/terminal/)
        const cancel=await place(d,tok,'SELL',1000000n,60n);await trading.cancel(cash.other,key(),cancel.orderId)
        assert.equal((await order(cancel.orderId)).status,'CANCELLED')
        assert.equal((await one('SELECT count(*)::int AS n FROM trading_order_events e LEFT JOIN trading_outbox o ON o.event_id=e.id WHERE o.id IS NULL')).n,0)
      }
      assert.equal((await trading.reconcile(sys)).reconciled,true)
    })
  }
  const d=registered.find(d=>d.type==='CATEGORICAL'),tok=d.tokens[0]
  await t.test('concurrent identical and conflicting submissions are durable and actor-bound',async()=>{
    const op=key(),[a,b]=await Promise.all([place(d,tok,'BUY',1000000n,65n,op),place(d,tok,'BUY',1000000n,65n,op)])
    assert.deepEqual(a,b);assert.deepEqual(await trading.recover(cash.actor,op),a)
    await assert.rejects(runtime.query("SELECT public.trading_execute(NULL,'RECOVER',$1,'{}')",[op]),/invalid trading request/)
    await assert.rejects(place(d,tok,'BUY',2000000n,65n,op),/conflicting/)
    await assert.rejects(trading.recover(cash.other,op),/another actor/)
    await trading.cancel(cash.actor,key(),a.orderId)
    const results=await Promise.allSettled(Array.from({length:4},()=>place(d,tok,'BUY',1000000000000000000n)))
    assert.ok(results.every(r=>r.status==='fulfilled'&&r.value.status==='REJECTED'))
    const oversell=await place(d,tok,'SELL',1000000000000000000n,60n)
    assert.equal(oversell.status,'REJECTED');assert.equal((await order(oversell.orderId)).position_reservation_id,null)
  })
  await t.test('wrong accounts, tokens, books, limits and unauthorized fills are rejected',async()=>{
    const p=await pair(d,tok),other=await pair(d,d.tokens[1]),before=await snapshot()
    await assert.rejects(trading.fill(cash.actor,key(),{buyerOrderId:p.buy.orderId,sellerOrderId:p.sell.orderId,quantity:1000000n,priceCents:60n}),/capability/)
    await assert.rejects(trading.fill(sys,key(),{buyerOrderId:p.buy.orderId,sellerOrderId:other.sell.orderId,quantity:1000000n,priceCents:60n}),/incompatible/)
    await assert.rejects(trading.fill(sys,key(),{buyerOrderId:p.buy.orderId,sellerOrderId:p.sell.orderId,quantity:3000000n,priceCents:60n}),/limits/)
    await assert.rejects(trading.fill(sys,key(),{buyerOrderId:p.buy.orderId,sellerOrderId:p.sell.orderId,quantity:1000000n,priceCents:66n}),/limits/)
    await assert.rejects(place(d,tok,'BUY',1000000n,100n),/invalid/)
    await assert.rejects(trading.fill(sys,key(),{buyerOrderId:p.buy.orderId,sellerOrderId:p.sell.orderId,quantity:1000000n,priceCents:59n}),/limits/)
    await assert.rejects(place(d,tok,'BUY',1000001n),/whole-share/)
    assert.deepEqual(await snapshot(),before)
    // A user cannot release an order hold independently of its order state.
    const row=await order(p.buy.orderId)
    await assert.rejects(ledger.cancel(cash.actor,key(),row.cash_reservation_id),/order cash reservation mismatch/)
    await trading.cancel(cash.actor,key(),p.buy.orderId);await trading.cancel(cash.other,key(),p.sell.orderId)
    await trading.cancel(cash.actor,key(),other.buy.orderId);await trading.cancel(cash.other,key(),other.sell.orderId)
  })
  await t.test('self trades and cross-market, chain, condition and round counterparties fail',async()=>{
    const p=await pair(d,tok),a=accounts.get(tok.id)
    const own=await trading.place(cash.actor,key(),{marketId:d.marketId,tokenId:tok.id,side:'SELL',quantity:1000000n,priceCents:60n,cashAccountId:cash.a,positionAccountId:a.buyer})
    await assert.rejects(fill({buy:p.buy,sell:own}),/self trade/)
    await trading.cancel(cash.actor,key(),own.orderId)
    for(const other of registered.filter(other=>other.marketId!==d.marketId)){
      const seller=await place(other,other.tokens[0],'SELL',1000000n,60n)
      await assert.rejects(fill({buy:p.buy,sell:seller}),/incompatible/)
      await trading.cancel(cash.other,key(),seller.orderId)
    }
    const foreign=await base.registry(),fa=await base.accounts(foreign.tokenId);accounts.set(foreign.tokenId,fa)
    const seller=await place({marketId:foreign.marketId},{id:foreign.tokenId},'SELL',1000000n,60n)
    await assert.rejects(fill({buy:p.buy,sell:seller}),/incompatible/)
    await trading.cancel(cash.other,key(),seller.orderId)
    await trading.cancel(cash.actor,key(),p.buy.orderId);await trading.cancel(cash.other,key(),p.sell.orderId)
  })
  await t.test('paused markets block acceptance/fills while cancellation remains available',async()=>{
    const p=await pair(d,tok)
    await admin.query("UPDATE markets SET trading_status='PAUSED' WHERE id=$1",[d.marketId])
    await assert.rejects(place(d,tok,'BUY'),/paused/);await assert.rejects(fill(p),/paused/)
    await trading.cancel(cash.actor,key(),p.buy.orderId);await trading.cancel(cash.other,key(),p.sell.orderId)
    await admin.query("UPDATE markets SET trading_status='OPEN' WHERE id=$1",[d.marketId])
  })
  await t.test('all failure boundaries roll back trading and accounting together',async()=>{
    for(const table of ['trading_orders','cash_reservations','position_reservations','trading_fills','trading_order_events','trading_outbox']){
      const p=table==='trading_fills'?await pair(d,tok):null
      const before=await snapshot()
      await admin.query(`CREATE FUNCTION public.test_trading_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected trading failure'; END $$`)
      try{
        await admin.query('CREATE TRIGGER zz_test_failure AFTER INSERT ON '+table+' FOR EACH ROW EXECUTE FUNCTION public.test_trading_failure()')
        await assert.rejects(p?fill(p):place(d,tok,table==='position_reservations'?'SELL':'BUY'),/injected trading failure/)
        assert.deepEqual(await snapshot(),before)
      }finally{
        await admin.query('DROP TRIGGER zz_test_failure ON '+table);await admin.query('DROP FUNCTION public.test_trading_failure()')
      }
      if(p){await trading.cancel(cash.actor,key(),p.buy.orderId);await trading.cancel(cash.other,key(),p.sell.orderId)}
    }
    assert.equal((await trading.reconcile(sys)).reconciled,true)
  })
  await t.test('terminal state and mandatory deferred reservation validation cannot be bypassed',async()=>{
    const p=await pair(d,tok);await trading.cancel(cash.actor,key(),p.buy.orderId)
    await assert.rejects(admin.query("UPDATE trading_orders SET status='OPEN' WHERE id=$1",[p.buy.orderId]),/transition/)
    await assert.rejects(admin.query('UPDATE trading_orders SET limit_price_cents=64 WHERE id=$1',[p.sell.orderId]),/immutable/)
    await trading.cancel(cash.other,key(),p.sell.orderId)
  })
  await t.test('orders and outbox events are invisible until commit and vanish on rollback',async()=>{
    const before=(await one('SELECT count(*)::int AS n FROM trading_outbox')).n
    const a=accounts.get(tok.id),c=await runtime.connect()
    try {
      await c.query('BEGIN')
      const result=(await c.query("SELECT public.trading_execute($1,'PLACE',$2,$3::jsonb) AS result",[cash.actor,key(),JSON.stringify({marketId:d.marketId,tokenId:tok.id,side:'BUY',quantity:'1000000',priceCents:'65',cashAccountId:cash.a,positionAccountId:a.buyer})])).rows[0].result
      assert.equal((await one('SELECT count(*)::int AS n FROM trading_outbox')).n,before)
      assert.equal((await admin.query('SELECT 1 FROM trading_orders WHERE id=$1',[result.orderId])).rowCount,0)
      await c.query('ROLLBACK')
      assert.equal((await one('SELECT count(*)::int AS n FROM trading_outbox')).n,before)
    } finally {await c.query('ROLLBACK');c.release()}
  })
  await t.test('mandatory deferred outbox failure prevents a successful commit',async()=>{
    const before=await snapshot()
    await admin.query(`CREATE FUNCTION public.test_drop_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`)
    try {
      await admin.query('CREATE TRIGGER zz_drop_outbox BEFORE INSERT ON trading_outbox FOR EACH ROW EXECUTE FUNCTION public.test_drop_outbox()')
      await assert.rejects(place(d,tok,'BUY'),e=>/outbox/.test(e.message)&&e.commitOutcome==='ROLLED_BACK')
      assert.deepEqual(await snapshot(),before)
    } finally {await admin.query('DROP TRIGGER zz_drop_outbox ON trading_outbox');await admin.query('DROP FUNCTION public.test_drop_outbox()')}
  })
  await t.test('expired rounds reject acceptance while explicit expiry releases orders',async()=>{
    const expired=await expiredFixture();await enroll(expired)
    const token=expired.tokens[0],a=await base.accounts(token.id);accounts.set(token.id,a)
    await assert.rejects(place(expired,token,'BUY'),/cutoff/)
    // Existing active orders can always be cancelled; the explicit expiry path cannot run early.
    const active=await place(d,tok,'BUY')
    await assert.rejects(trading.expire(sys,key(),active.orderId),/not expired/)
    await trading.cancel(cash.actor,key(),active.orderId)
    const soon=await expiredFixture(8);await enroll(soon)
    const soonToken=soon.tokens[0],soonAccounts=await base.accounts(soonToken.id);accounts.set(soonToken.id,soonAccounts)
    const pending=await place(soon,soonToken,'BUY')
    const deadline=Date.now()+15000
    while(!(await one('SELECT clock_timestamp()>=trading_ends_at AS closed FROM markets WHERE id=$1',[soon.marketId])).closed){
      if(Date.now()>deadline)throw new Error('Disposable cutoff fixture did not close')
      await new Promise(r=>setTimeout(r,100))
    }
    await trading.expire(sys,key(),pending.orderId)
    assert.equal((await order(pending.orderId)).status,'EXPIRED')
  })
  await t.test('book-lock waits cannot accept an order after the trading deadline',async()=>{
    const m=await expiredFixture(4);await enroll(m);const token=m.tokens[0]
    const a=await base.accounts(token.id);accounts.set(token.id,a)
    const book=await one('INSERT INTO trading_books(token_id,market_id) VALUES($1,$2) RETURNING id',[token.id,m.marketId])
    const blocker=await admin.connect();let pending
    try{
      await blocker.query('BEGIN');await blocker.query('SELECT id FROM trading_books WHERE id=$1 FOR UPDATE',[book.id])
      pending=place(m,token,'BUY').then(value=>({value}),error=>({error}))
      const deadline=Date.now()+10000
      while(!(await one('SELECT clock_timestamp()>=trading_ends_at AS closed FROM markets WHERE id=$1',[m.marketId])).closed){if(Date.now()>deadline)throw new Error('cutoff fixture timeout');await new Promise(r=>setTimeout(r,50))}
      await blocker.query('COMMIT')
      const result=await pending;assert.match(result.error?.message||'',/cutoff/)
      assert.equal((await one('SELECT count(*)::int AS n FROM trading_orders WHERE book_id=$1',[book.id])).n,0)
    }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending}
  })
  await t.test('mandatory commit-time deadline rejects a previously valid uncommitted order',async()=>{
    const m=await expiredFixture(4);await enroll(m);const token=m.tokens[0]
    const a=await base.accounts(token.id),c=await runtime.connect()
    try{
      await c.query('BEGIN')
      await c.query("SELECT public.trading_execute($1,'PLACE',$2,$3::jsonb)",[cash.actor,key(),JSON.stringify({marketId:m.marketId,tokenId:token.id,side:'BUY',quantity:'1000000',priceCents:'65',cashAccountId:cash.a,positionAccountId:a.buyer})])
      const deadline=Date.now()+10000
      while(!(await one('SELECT clock_timestamp()>=trading_ends_at AS closed FROM markets WHERE id=$1',[m.marketId])).closed){if(Date.now()>deadline)throw new Error('commit cutoff fixture timeout');await new Promise(r=>setTimeout(r,50))}
      await assert.rejects(c.query('COMMIT'),/cutoff/)
      assert.equal((await one('SELECT count(*)::int AS n FROM trading_books WHERE market_id=$1',[m.marketId])).n,0)
    }finally{await c.query('ROLLBACK');c.release()}
  })
  await t.test('uncertain committed result recovers by the original durable command key',async()=>{
    let lost=false
    const pool={async connect(){const c=await runtime.connect();return {async query(sql,...args){const r=await c.query(sql,...args);if(sql==='COMMIT'&&!lost){lost=true;throw new Error('simulated lost commit response')}return r},release(error){c.release(error)}}}}
    const service=createTradingService({pool,enabled:true,environment:'test',authorize:()=>true})
    const op=key(),a=accounts.get(tok.id),terms={marketId:d.marketId,tokenId:tok.id,side:'BUY',quantity:1000000n,priceCents:65n,cashAccountId:cash.a,positionAccountId:a.buyer}
    await assert.rejects(service.place(cash.actor,op,terms),e=>e.commitOutcome==='UNKNOWN')
    const recovered=await trading.recover(cash.actor,op)
    assert.deepEqual(await trading.place(cash.actor,op,terms),recovered)
    await trading.cancel(cash.actor,key(),recovered.orderId)
  })
  await t.test('canonical aliases and distinct rounds resolve to correct persistent books',async()=>{
    const rows=(await admin.query(`SELECT x.market_outcome_id,x.polarity,b.id AS book FROM market_outcome_tokens x JOIN trading_books b ON b.token_id=x.token_id JOIN markets m ON m.id=b.market_id WHERE m.market_type='BINARY'`)).rows
    assert.ok(rows.length>=4)
    for(const binary of registered.filter(d=>d.type==='BINARY'))assert.equal((await one('SELECT count(*)::int AS n FROM trading_books WHERE market_id=$1',[binary.marketId])).n,2)
    assert.equal((await positions.reconcile(sys)).reconciled,true)
  })
  await t.test('order acceptance and fill workloads report contention and reconcile',async()=>{
    const binary=registered.find(d=>d.type==='BINARY')
    for(const [name,market,token,shared] of [['binary-independent',binary,binary.tokens[0],false],['categorical-independent',d,tok,false],['shared-balances',d,tok,true]]) {
      const workers=[]
      for(let i=0;i<2;i++) {
        if(shared){const sharedToken=d.tokens[i];workers.push({cash,buyer:accounts.get(sharedToken.id).buyer,seller:accounts.get(sharedToken.id).seller,market:d,token:sharedToken});continue}
        const f=await fixture(100000n)
        const create=async user=>(await positions.createAccount(sys,key(),{tokenId:token.id,ownerUserId:user,accountKey:key(),kind:'CUSTOMER'})).accountId
        const buyer=await create(f.actor.slice(5)),seller=await create(f.other.slice(5))
        await positions.transfer(sys,key(),{sourceAccountId:accounts.get(token.id).unallocated,targetAccountId:seller,quantity:20000000n,reference:key()})
        workers.push({cash:f,buyer,seller,market,token})
      }
      const accept=[],fills=[],start=performance.now()
      const deadlocks=(await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks
      let stop=false,lockSamples=0,maxWaiters=0
      const observer=(async()=>{while(!stop){const r=await one("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND usename='ledger_runtime' AND wait_event_type='Lock'");lockSamples+=r.n>0?1:0;maxWaiters=Math.max(maxWaiters,r.n);await new Promise(r=>setTimeout(r,20))}})()
      try{await Promise.all(workers.map(async w=>{
        for(let i=0;i<10;i++) {
          const terms={marketId:w.market.marketId,tokenId:w.token.id,quantity:1000000n,priceCents:65n}
          let tick=performance.now();const buy=await trading.place(w.cash.actor,key(),{...terms,side:'BUY',cashAccountId:w.cash.a,positionAccountId:w.buyer});accept.push(performance.now()-tick)
          tick=performance.now();const sell=await trading.place(w.cash.other,key(),{...terms,side:'SELL',priceCents:60n,cashAccountId:w.cash.b,positionAccountId:w.seller});accept.push(performance.now()-tick)
          tick=performance.now();await fill({buy,sell});fills.push(performance.now()-tick)
        }
      }))}finally{stop=true;await observer}
      const elapsed=performance.now()-start
      const historicalDeadlocks=Number((await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks)-Number(deadlocks)
      // This is the immutable 0015 historical prefix. 0016 fixes FK lock upgrades; its worker suite requires zero deadlocks.
      assert.equal((await trading.reconcile(sys)).reconciled,true)
      const stats=values=>{values.sort((a,b)=>a-b);return {count:values.length,averageMs:values.reduce((a,b)=>a+b,0)/values.length,p95:values[Math.ceil(values.length*.95)-1],p99:values[Math.ceil(values.length*.99)-1]}}
      t.diagnostic(JSON.stringify({tradingBenchmark:name,measurement:'mixed acceptance/fill workload',elapsedMs:elapsed,acceptance:stats(accept),fills:stats(fills),acceptanceThroughput:accept.length*1000/elapsed,fillThroughput:fills.length*1000/elapsed,lockSamples,maxWaiters,deadlocks:historicalDeadlocks,reconciled:true}))
    }
  })
}
