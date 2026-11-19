import pg from 'pg'
// Opt-in only, called after the parent verifies its fresh disposable PostgreSQL 16 container.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

export async function runPositionBenchmark({t,admin,runtime,ledger,positions,sys,key,fixture,cash,a,market,unit}) {
 const reports=[]
 const auditProfilingEnabled=(await admin.query("SHOW track_functions")).rows[0].track_functions==='all'
 const one=async(sql,args)=>(await admin.query(sql,args)).rows[0]
 const totals=async()=>({
  cash:(await one("SELECT sum(p.posted::numeric)::text AS n FROM financial_balance_projections p JOIN financial_accounts a ON a.id=p.account_id WHERE a.kind='CUSTOMER'")).n,
  positions:(await one("SELECT sum(p.posted::numeric)::text AS n FROM position_balance_projections p JOIN position_accounts a ON a.id=p.account_id WHERE a.kind<>'EXTERNAL_CONTROL'")).n,
 })
 const reconcile=async(name,before)=>{
  assert.deepEqual(await totals(),before,'trading must conserve customer cash and spendable inventory')
  const result=await positions.reconcile(sys);assert.equal(result.reconciled,true);assert.equal(result.cash.consistent,true)
  assert.equal((await one('SELECT count(*)::int AS n FROM financial_audit_targets')).n,0)
  t.diagnostic(JSON.stringify({benchmarkReconciliation:name,...result,conserved:before}))
 }
 const reservePair=async(pair,n,timed=fn=>fn())=>{
  const cashReservationReference=key(),positionReservationReference=key()
  const c=await timed(()=>ledger.reserve(pair.cash.actor,key(),{accountId:pair.cash.a,amount:BigInt(n)*60n,reference:cashReservationReference}))
  const p=await timed(()=>positions.reserve(pair.cash.other,key(),{accountId:pair.seller,quantity:BigInt(n)*unit,reference:positionReservationReference}))
  return {buyerCashAccountId:pair.cash.a,sellerCashAccountId:pair.cash.b,buyerPositionAccountId:pair.buyer,sellerPositionAccountId:pair.seller,cashReservationId:c.reservationId,positionReservationId:p.reservationId,cashReservationReference,positionReservationReference,marketId:market.marketId,tokenId:market.tokenId,quantity:unit,priceCents:60n}
 }
 const fill=v=>positions.settle(sys,key(),{...v,matchReference:key()})
 const functionSnapshot=async()=>{
  await Promise.all(runtime._clients.map(client=>client.query('SELECT pg_stat_force_next_flush()')))
  await new Promise(resolve=>setTimeout(resolve,1100))
  await admin.query('SELECT pg_stat_clear_snapshot()')
  return (await admin.query("SELECT funcname,calls,self_time FROM pg_stat_user_functions WHERE schemaname='public' AND (funcname LIKE 'financial_%' OR funcname LIKE 'position_%')")).rows
 }
 const run=async(name,work)=>{
  const before=await totals(),times=[],commitTimes=[],functionsBefore=await functionSnapshot();let done=false,samples=0,lockSamples=0,maxWaiters=0
  const deadlocksBefore=Number((await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks)
  const observer=(async()=>{while(!done){const q=await one("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND usename='ledger_runtime' AND wait_event_type='Lock'");samples++;if(q.n>0)lockSamples++;maxWaiters=Math.max(maxWaiters,q.n);await new Promise(resolve=>setTimeout(resolve,25))}})()
  const originalQuery=pg.Client.prototype.query
  pg.Client.prototype.query=function(...args){const start=performance.now(),result=originalQuery.apply(this,args);if(this.user==='ledger_runtime'&&args[0]==='COMMIT'&&result?.then)return result.finally(()=>commitTimes.push(performance.now()-start));return result}
  const start=performance.now()
  const timed=async(fn)=>{const tick=performance.now();const result=await fn();times.push(performance.now()-tick);return result}
  let extra
  try{extra=await work(timed)}finally{pg.Client.prototype.query=originalQuery;done=true;await observer}
  const elapsed=performance.now()-start
  const average=values=>values.reduce((x,y)=>x+y,0)/Math.max(1,values.length)
  const first1000AverageMs=average(times.slice(0,1000)),last1000AverageMs=average(times.slice(-1000))
  const first100AverageMs=average(times.slice(0,100)),last100AverageMs=average(times.slice(-100))
  times.sort((x,y)=>x-y)
  const percentile=p=>times[Math.max(0,Math.ceil(times.length*p)-1)]??null
  const deadlocks=Number((await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks)-deadlocksBefore
  assert.equal(deadlocks,0)
  const functionsAfter=await functionSnapshot()
  const auditFunctions=functionsAfter.map(after=>{const before=functionsBefore.find(row=>row.funcname===after.funcname);return {name:after.funcname,calls:Number(after.calls)-Number(before?.calls||0),selfMs:after.self_time-(before?.self_time||0)}}).filter(row=>row.calls>0)
  commitTimes.sort((a,b)=>a-b)
  const commit={averageMs:average(commitTimes),p50Ms:commitTimes[Math.floor(commitTimes.length*.5)]??null,p95Ms:commitTimes[Math.max(0,Math.ceil(commitTimes.length*.95)-1)]??null,p99Ms:commitTimes[Math.max(0,Math.ceil(commitTimes.length*.99)-1)]??null}
  const auditState=(await one("SELECT n_live_tup,n_dead_tup,n_tup_ins,n_tup_del,autovacuum_count FROM pg_stat_user_tables WHERE relname='financial_audit_deltas'"))
  const report={name,operations:times.length,milliseconds:Math.round(elapsed),throughput:times.length/(elapsed/1000),averageMs:times.reduce((x,y)=>x+y,0)/Math.max(1,times.length),p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),first100AverageMs,last100AverageMs,first1000AverageMs,last1000AverageMs,commit,auditFunctions,auditState,auditProfilingEnabled,maxLockWaiters:maxWaiters,lockSampleFraction:lockSamples/Math.max(1,samples),deadlocks,...extra}
  reports.push(report);t.diagnostic(JSON.stringify({positionBenchmark:report}))
  await reconcile(name,before)
 }
 // Real controlled transfers fund the fixture; recognition is owner-only, never a runtime operation.
 await a.recognize(20000n*unit)
 await positions.transfer(sys,key(),{sourceAccountId:a.unallocated,targetAccountId:a.seller,quantity:12000n*unit,reference:key()})
 const pair={cash,buyer:a.buyer,seller:a.seller}
 const shared=await reservePair(pair,10000)
 let count=0
 await run('1000 sequential atomic settlements',async timed=>{
  for(;count<1000;count++){await timed(()=>fill(shared));if((count+1)%250===0)t.diagnostic(JSON.stringify({settlementProgress:count+1}))}
  return {target:1000,completed:count}
 })
 await run('grow toward 10000 atomic settlements; 600 second additional budget',async timed=>{
  const deadline=performance.now()+600000
  for(;count<10000&&performance.now()<deadline;count++){await timed(()=>fill(shared));if((count+1)%1000===0)t.diagnostic(JSON.stringify({settlementProgress:count+1}))}
  return {target:10000,totalCompleted:count,completedTarget:count===10000,budgetSeconds:600}
 })
 for(const [table,id,actor,cancel] of [['cash_reservations',shared.cashReservationId,cash.actor,ledger.cancel],['position_reservations',shared.positionReservationId,cash.other,positions.cancel]]){
  if((await one('SELECT status FROM '+table+' WHERE id=$1',[id])).status==='OPEN')await cancel(actor,key(),id)
 }
 const independent=[]
 for(let i=0;i<8;i++){
  const c=await fixture(100000n)
  const create=async ownerUserId=>(await positions.createAccount(sys,key(),{tokenId:market.tokenId,ownerUserId,accountKey:key(),kind:'CUSTOMER'})).accountId
  const buyer=await create(c.actor.slice(5)),seller=await create(c.other.slice(5))
  await positions.transfer(sys,key(),{sourceAccountId:a.unallocated,targetAccountId:seller,quantity:100n*unit,reference:key()})
  independent.push(await reservePair({cash:c,buyer,seller},10))
 }
 await run('8 independent account pairs; 80 concurrent settlements',timed=>Promise.all(independent.map(v=>(async()=>{for(let i=0;i<10;i++)await timed(()=>fill(v))})())))
 const sharedConcurrent=await reservePair(pair,80)
 await run('8 workers shared accounts; 80 settlements',timed=>Promise.all(Array.from({length:8},()=>(async()=>{for(let i=0;i<10;i++)await timed(()=>fill(sharedConcurrent))})())))
 await run('concurrent cash and position reservations then cancellation; 128 operations',timed=>Promise.all(Array.from({length:8},()=>(async()=>{for(let i=0;i<4;i++){
  const [c,p]=await Promise.all([timed(()=>ledger.reserve(cash.actor,key(),{accountId:cash.a,amount:60n,reference:key()})),timed(()=>positions.reserve(cash.other,key(),{accountId:a.seller,quantity:unit,reference:key()}))])
  await Promise.all([timed(()=>ledger.cancel(cash.actor,key(),c.reservationId)),timed(()=>positions.cancel(cash.other,key(),p.reservationId))])
 }})())))
 await run('mixed settlement and partial release; 120 operations',timed=>Promise.all(Array.from({length:8},()=>(async()=>{for(let i=0;i<3;i++){
  const v=await reservePair(pair,2,timed);await timed(()=>fill(v))
  await timed(()=>ledger.release(cash.actor,key(),{reservationId:v.cashReservationId,amount:60n}))
  await timed(()=>positions.release(cash.other,key(),{reservationId:v.positionReservationId,quantity:unit}))
 }})())))
 const acceptance={completed10000:count===10000,within180Seconds:reports[0].milliseconds+reports[1].milliseconds<=180000,historyGrowthRatio:reports[1].last1000AverageMs/reports[0].first1000AverageMs,independent200TPS:reports[2].throughput>=200,shared75TPS:reports[3].throughput>=75,zeroDeadlocks:reports.every(r=>r.deadlocks===0)}
 acceptance.stableLatency=acceptance.historyGrowthRatio<=1.25
 t.diagnostic(JSON.stringify({positionBenchmarkSummary:reports,acceptance,auditProfilingEnabled,productionSla:false,allReconciliationsPassed:true}))
}
