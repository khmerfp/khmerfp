import assert from 'node:assert/strict'

export async function runIncrementalCases(t,{admin,runtime,ledger,positions,sys,key,ownerTx,cash,a,market,unit,makeFixture}){
 const count=async table=>(await admin.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n
 const cashTerms=()=>({accountId:cash.a,amount:'600',reference:key()})
 const raw=(c,action,terms)=>c.query('SELECT financial_execute($1,$2,$3,$4)',[sys,action,key(),JSON.stringify(terms)]).then(r=>r.rows[0].financial_execute)
 await t.test('runtime cannot read, mutate, replace or truncate protected baselines',async()=>{
  for(const sql of ['SELECT * FROM financial_audit_deltas','DELETE FROM financial_audit_deltas','TRUNCATE financial_audit_deltas','UPDATE financial_audit_deltas SET delta_first=0'])await assert.rejects(runtime.query(sql),e=>e.code==='42501')
  await assert.rejects(ownerTx(c=>c.query('TRUNCATE financial_audit_deltas CASCADE')),/protected audit state/)
  await assert.rejects(runtime.query("SELECT financial_queue_audit('ACCOUNT',1)"),e=>e.code==='42501')
 })
 await t.test('baselines are captured once before repeated cash and reservation mutations',async()=>{
  await ownerTx(async c=>{
   const r=await raw(c,'RESERVE',cashTerms())
   const before=(await c.query("SELECT * FROM financial_audit_deltas WHERE target_kind='ACCOUNT' AND target_id=$1",[cash.a])).rows[0]
   await raw(c,'RELEASE',{reservationId:r.reservationId,amount:'100'})
   await raw(c,'RELEASE',{reservationId:r.reservationId,amount:'100'})
   const after=(await c.query("SELECT * FROM financial_audit_deltas WHERE target_kind='ACCOUNT' AND target_id=$1",[cash.a])).rows[0]
   assert.equal(after.generation,before.generation);assert.equal(after.baseline_first,before.baseline_first);assert.equal(after.baseline_second,before.baseline_second);assert.equal(after.delta_second,'400')
   const reservation=(await c.query("SELECT * FROM financial_audit_deltas WHERE target_kind='RESERVATION' AND target_id=$1",[r.reservationId])).rows[0]
   assert.equal(reservation.new_object,true);assert.equal(reservation.baseline_first,'0');assert.equal(reservation.delta_second,'200');assert.equal(reservation.event_ids.length,3)
   await raw(c,'CANCEL',{reservationId:r.reservationId})
  })
  assert.equal(await count('financial_audit_deltas'),0)
 })
 await t.test('baseline replacement and source-delta tampering are rejected even for direct owner DML',async()=>{
  for(const column of ['baseline_first','generation','delta_first'])await assert.rejects(ownerTx(async c=>{
   await raw(c,'RESERVE',cashTerms())
   await c.query('UPDATE financial_audit_deltas SET '+column+'='+(column==='generation'?'DEFAULT':column+'+1'))
  }),/protected audit state/)
  await assert.rejects(ownerTx(c=>c.query("INSERT INTO financial_audit_deltas(transaction_id,target_kind,target_id,baseline_first,baseline_second) VALUES(pg_current_xact_id()::text,'ACCOUNT',1,0,0)")),/protected audit state/)
 })
 await t.test('deleting baselines or omitting target scheduling cannot bypass commit checks',async()=>{
  await assert.rejects(ownerTx(async c=>{await raw(c,'RESERVE',cashTerms());await c.query('DELETE FROM financial_audit_deltas')}),/protected audit state/)
  await admin.query('ALTER TABLE financial_balance_projections DISABLE TRIGGER financial_balance_projections_audit')
  try{await assert.rejects(ownerTx(c=>c.query('UPDATE financial_balance_projections SET posted=posted+1 WHERE account_id=$1',[cash.a])),/orphan incremental audit context/)}finally{await admin.query('ALTER TABLE financial_balance_projections ENABLE TRIGGER financial_balance_projections_audit')}
 })
 await t.test('savepoint rollback restores both event IDs and independently accumulated deltas',async()=>{
  await ownerTx(async c=>{
   const r=await raw(c,'RESERVE',cashTerms())
   const before=(await c.query('SELECT * FROM financial_audit_deltas ORDER BY generation')).rows
   await c.query('SAVEPOINT partial')
   await raw(c,'RELEASE',{reservationId:r.reservationId,amount:'100'})
   await c.query('ROLLBACK TO SAVEPOINT partial')
   assert.deepEqual((await c.query('SELECT * FROM financial_audit_deltas ORDER BY generation')).rows,before)
   await raw(c,'CANCEL',{reservationId:r.reservationId})
  })
 })
 await t.test('immediate validation cleans contexts and later mutation captures a new generation',async()=>{
  await ownerTx(async c=>{
   await c.query('UPDATE financial_balance_projections SET posted=posted WHERE account_id=$1',[cash.a])
   const first=(await c.query("SELECT generation FROM financial_audit_deltas WHERE target_kind='ACCOUNT' AND target_id=$1",[cash.a])).rows[0].generation
   await c.query('SET CONSTRAINTS ALL IMMEDIATE')
   assert.equal((await c.query('SELECT count(*)::int AS n FROM financial_audit_deltas')).rows[0].n,0)
   await c.query('SET CONSTRAINTS ALL DEFERRED')
   await c.query('UPDATE financial_balance_projections SET posted=posted WHERE account_id=$1',[cash.a])
   const second=(await c.query("SELECT generation FROM financial_audit_deltas WHERE target_kind='ACCOUNT' AND target_id=$1",[cash.a])).rows[0].generation
   assert.notEqual(first,second)
  })
 })
 await t.test('missing authoritative delta triggers cause complete rollback rather than trusting projections',async()=>{
  // Deliberate owner-only fault injection, never used in a benchmark or production.
  const before=await ledger.balance(cash.actor,cash.a)
  await admin.query('ALTER TABLE financial_journal_entries DISABLE TRIGGER aaa_financial_journal_entries_delta')
  try{await assert.rejects(ledger.post(sys,key(),[{accountId:cash.a,asset:'USD',side:'DEBIT',amount:1n},{accountId:cash.b,asset:'USD',side:'CREDIT',amount:1n}],key()),/projection differs/)}finally{await admin.query('ALTER TABLE financial_journal_entries ENABLE TRIGGER aaa_financial_journal_entries_delta')}
  assert.deepEqual(await ledger.balance(cash.actor,cash.a),before)
 })
 await t.test('incorrect independently recorded deltas cannot commit',async()=>{
  await admin.query("CREATE FUNCTION test_wrong_delta() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE public.financial_audit_deltas SET delta_first=delta_first+1 WHERE target_kind='ACCOUNT' AND target_id=NEW.account_id AND transaction_id=pg_current_xact_id()::text; RETURN NEW; END $$")
  await admin.query('CREATE TRIGGER zzz_test_wrong_delta AFTER INSERT ON financial_journal_entries FOR EACH ROW EXECUTE FUNCTION test_wrong_delta()')
  try{await assert.rejects(ledger.post(sys,key(),[{accountId:cash.a,asset:'USD',side:'DEBIT',amount:1n},{accountId:cash.b,asset:'USD',side:'CREDIT',amount:1n}],key()),/projection differs/)}finally{await admin.query('DROP TRIGGER zzz_test_wrong_delta ON financial_journal_entries');await admin.query('DROP FUNCTION test_wrong_delta()')}
 })
 await t.test('position reservation deltas coalesce multiple mutations in one transaction',async()=>{
  await ownerTx(async c=>{
   const r=await raw(c,'POSITION_RESERVE',{accountId:a.seller,quantity:'3000000',reference:key()})
   await raw(c,'POSITION_RELEASE',{reservationId:r.reservationId,quantity:'1000000'})
   await raw(c,'POSITION_RELEASE',{reservationId:r.reservationId,quantity:'1000000'})
   await raw(c,'POSITION_CANCEL',{reservationId:r.reservationId})
   const d=(await c.query("SELECT * FROM financial_audit_deltas WHERE target_kind='POSITION_RESERVATION' AND target_id=$1",[r.reservationId])).rows[0]
   assert.equal(d.new_object,true);assert.equal(d.delta_second,'3000000');assert.equal(d.event_ids.length,4)
   const balance=(await c.query("SELECT * FROM financial_audit_deltas WHERE target_kind='POSITION_ACCOUNT' AND target_id=$1",[a.seller])).rows[0]
   assert.equal(balance.delta_second,'0')
  })
 })
 await t.test('nested source faults cannot rewrite an already captured baseline',async()=>{
  await admin.query("CREATE FUNCTION test_rewrite_baseline() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE public.financial_audit_deltas SET baseline_first=baseline_first+1 WHERE target_kind='ACCOUNT' AND target_id=NEW.account_id AND transaction_id=pg_current_xact_id()::text; RETURN NEW; END $$")
  await admin.query('CREATE TRIGGER zzz_test_rewrite_baseline AFTER INSERT ON financial_journal_entries FOR EACH ROW EXECUTE FUNCTION test_rewrite_baseline()')
  try{await assert.rejects(ledger.post(sys,key(),[{accountId:cash.a,asset:'USD',side:'DEBIT',amount:1n},{accountId:cash.b,asset:'USD',side:'CREDIT',amount:1n}],key()),/baseline and generation are immutable/)}finally{await admin.query('DROP TRIGGER zzz_test_rewrite_baseline ON financial_journal_entries');await admin.query('DROP FUNCTION test_rewrite_baseline()')}
 })
 await t.test('missing baseline capture rejects the operation and leaves no partial changes',async()=>{
  const before=await ledger.balance(cash.actor,cash.a)
  await admin.query('ALTER TABLE financial_balance_projections DISABLE TRIGGER aaa_financial_balance_projections_baseline')
  try{await assert.rejects(ledger.reserve(cash.actor,key(),{accountId:cash.a,amount:1n,reference:key()}),e=>e.code==='P0002')}finally{await admin.query('ALTER TABLE financial_balance_projections ENABLE TRIGGER aaa_financial_balance_projections_baseline')}
  assert.deepEqual(await ledger.balance(cash.actor,cash.a),before)
  assert.equal(await count('financial_audit_deltas'),0)
 })
 await t.test('connection termination rolls back source records and protected audit state together',async()=>{
  const before=await ledger.balance(cash.actor,cash.a),operations=await count('financial_operations'),c=await admin.connect()
  c.on('error',()=>{})
  try{
   await c.query('BEGIN');await c.query('SET LOCAL ROLE ledger_owner')
   await raw(c,'RESERVE',cashTerms())
   assert.ok((await c.query('SELECT count(*)::int AS n FROM financial_audit_deltas')).rows[0].n>0)
   const pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
   assert.equal((await admin.query('SELECT pg_terminate_backend($1) AS stopped',[pid])).rows[0].stopped,true)
   await assert.rejects(c.query('COMMIT'),/terminat|not queryable|closed|connection/i)
  }finally{c.release(true)}
  assert.deepEqual(await ledger.balance(cash.actor,cash.a),before)
  assert.equal(await count('financial_operations'),operations);assert.equal(await count('financial_audit_deltas'),0)
 })
 await t.test('2000 partial fills of the same reservations preserve counters and clear private state',async()=>{
  const {positions,cash,a,market,unit}=await makeFixture()
  await a.recognize(3000n*unit)
  await positions.transfer(sys,key(),{sourceAccountId:a.unallocated,targetAccountId:a.seller,quantity:2500n*unit,reference:key()})
  const cashReservationReference=key(),positionReservationReference=key()
  const cr=await ledger.reserve(cash.actor,key(),{accountId:cash.a,amount:120000n,reference:cashReservationReference})
  const pr=await positions.reserve(cash.other,key(),{accountId:a.seller,quantity:2000n*unit,reference:positionReservationReference})
  const terms={buyerCashAccountId:cash.a,sellerCashAccountId:cash.b,buyerPositionAccountId:a.buyer,sellerPositionAccountId:a.seller,cashReservationId:cr.reservationId,positionReservationId:pr.reservationId,cashReservationReference,positionReservationReference,marketId:market.marketId,tokenId:market.tokenId,quantity:unit,priceCents:60n}
  for(let i=0;i<2000;i++)await positions.settle(sys,key(),{...terms,matchReference:key()})
  assert.equal((await admin.query('SELECT consumed FROM cash_reservations WHERE id=$1',[cr.reservationId])).rows[0].consumed,'120000')
  assert.equal((await admin.query('SELECT consumed FROM position_reservations WHERE id=$1',[pr.reservationId])).rows[0].consumed,'2000000000')
  assert.equal((await positions.reconcile(sys)).reconciled,true)
  assert.equal(await count('financial_audit_deltas'),0);assert.equal(await count('financial_audit_targets'),0)
 })
 await t.test('controlled full reconstruction repairs damaged projections and subsequent settlement uses fresh baselines',async()=>{
  const corrupt=async(table,accountId,step)=>{
   // Deliberate DBA corruption fixture, restored before invoking any ledger operation.
   await admin.query('ALTER TABLE '+table+' DISABLE TRIGGER aaa_'+table+'_baseline')
   await admin.query('ALTER TABLE '+table+' DISABLE TRIGGER '+table+'_audit')
   try{await admin.query('UPDATE '+table+' SET posted=posted+$2 WHERE account_id=$1',[accountId,step])}finally{await admin.query('ALTER TABLE '+table+' ENABLE TRIGGER aaa_'+table+'_baseline');await admin.query('ALTER TABLE '+table+' ENABLE TRIGGER '+table+'_audit')}
  }
  await corrupt('financial_balance_projections',cash.a,'1')
  await assert.rejects(ledger.reconcile(sys),/projection differs/)
  await ledger.rebuild(sys,key())
  await corrupt('position_balance_projections',a.buyer,unit.toString())
  await assert.rejects(positions.reconcile(sys),/projection differs/)
  await positions.rebuild(sys,key())
  const cashReservationReference=key(),positionReservationReference=key()
  const cr=await ledger.reserve(cash.actor,key(),{accountId:cash.a,amount:60n,reference:cashReservationReference})
  const pr=await positions.reserve(cash.other,key(),{accountId:a.seller,quantity:unit,reference:positionReservationReference})
  await positions.settle(sys,key(),{buyerCashAccountId:cash.a,sellerCashAccountId:cash.b,buyerPositionAccountId:a.buyer,sellerPositionAccountId:a.seller,cashReservationId:cr.reservationId,positionReservationId:pr.reservationId,cashReservationReference,positionReservationReference,marketId:market.marketId,tokenId:market.tokenId,quantity:unit,priceCents:60n,matchReference:key()})
  assert.equal((await positions.reconcile(sys)).reconciled,true)
  assert.equal(await count('financial_audit_deltas'),0)
 })

}
