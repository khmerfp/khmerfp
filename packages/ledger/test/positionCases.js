import { runIncrementalCases } from './incrementalCases.js'
import { runPositionBenchmark } from './positionBenchmark.js'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { randomBytes } from 'node:crypto'
import { createPositionLedger, MAX_BIGINT } from '../src/index.js'

// Fixtures run only after the parent verifies a fresh, labelled Docker PostgreSQL 16 target.
export async function createPositionFixture({admin,runtime,sys,key,fixture,ownerTx,chainSeed=900000}) {
 const positions=createPositionLedger({pool:runtime,enabled:true,environment:'test',authorize:()=>true})
 const unit=1000000n
 const hex=bytes=>'0x'+randomBytes(bytes).toString('hex')
 const one=async(sql,args)=>(await admin.query(sql,args)).rows[0]
 const cash=await fixture(1000000n)
 let registrySequence=chainSeed
 async function registry({decimals=6,cutoffSeconds=3600}={}) {
  const chain=String(registrySequence++)
  await admin.query("INSERT INTO chains(chain_id,name,environment,native_symbol) VALUES($1::numeric,'Position fixture '||$1::text,'testnet','ETH')",[chain])
  const asset=await one("INSERT INTO chain_assets(chain_id,contract_address,symbol,name,decimals,asset_type) VALUES($1,$2,'MOCK','Fixture collateral',$3,'ERC20') RETURNING id",[chain,hex(20),decimals])
  const oracle=hex(20)
  const deployment=async(role,address)=>one("INSERT INTO contract_deployments(chain_id,contract_address,contract_role,contract_version,deployment_tx_hash,deployment_block_number,deployment_status) VALUES($1,$2,$3,'position-test',$4,100,'CONFIRMED') RETURNING id",[chain,address,role,hex(32)])
  const ctf=await deployment('GNOSIS_CTF',hex(20)),oracleDeployment=await deployment('ORACLE',oracle)
  const category=await one("INSERT INTO market_categories(name,slug) VALUES('Position fixtures',$1) RETURNING id",[key()])
  const market=await one("INSERT INTO markets(category_id,slug,title,description,trading_starts_at,trading_ends_at,resolution_deadline) VALUES($1,$2,'Test market','Disposable mock positions',clock_timestamp()-interval '1 hour',clock_timestamp()+$3::int*interval '1 second',clock_timestamp()+interval '3 hours') RETURNING id",[category.id,key(),cutoffSeconds])
  const question=await one("INSERT INTO market_questions(market_id,oracle_contract_deployment_id,question_text,resolution_rules,resolution_source) VALUES($1,$2,'Will fixture pass?','Fixture rules','Fixture source') RETURNING id",[market.id,oracleDeployment.id])
  const outcomes=(await admin.query("INSERT INTO market_outcomes(market_id,question_id,outcome_index,outcome_label) VALUES($1,$2,0,'YES'),($1,$2,1,'NO') RETURNING id,outcome_index",[market.id,question.id])).rows
  const condition=await one("INSERT INTO ctf_conditions(market_question_id,chain_id,ctf_contract_deployment_id,oracle_contract_deployment_id,oracle_address,ctf_question_id,condition_id,collateral_asset_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",[question.id,chain,ctf.id,oracleDeployment.id,oracle,hex(32),hex(32),asset.id])
  const tokens=[]
  for(const o of outcomes) tokens[o.outcome_index]=(await one("INSERT INTO ctf_position_tokens(condition_id,market_outcome_id,chain_id,ctf_contract_deployment_id,collateral_asset_id,outcome_index,index_set,collection_id,position_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",[condition.id,o.id,chain,ctf.id,asset.id,o.outcome_index,o.outcome_index===0?1:2,hex(32),BigInt('0x'+randomBytes(32).toString('hex')).toString()])).id
  await admin.query("UPDATE markets SET lifecycle_status='REVIEW' WHERE id=$1",[market.id])
  await admin.query("UPDATE markets SET lifecycle_status='SCHEDULED',terms_frozen_at=now(),terms_hash=$2 WHERE id=$1",[market.id,hex(32)])
  await admin.query("UPDATE markets SET lifecycle_status='ACTIVE',trading_status='OPEN' WHERE id=$1",[market.id])
  return {marketId:market.id,tokenId:tokens[0],noTokenId:tokens[1],chain}
 }
 const market=await registry()
 async function accounts(tokenId=market.tokenId) {
  const create=(kind,ownerUserId=null)=>positions.createAccount(sys,key(),{tokenId,kind,ownerUserId,accountKey:key()}).then(r=>r.accountId)
  const buyer=await create('CUSTOMER',cash.actor.slice(5)),seller=await create('CUSTOMER',cash.other.slice(5)),unallocated=await create('UNALLOCATED'),external=await create('EXTERNAL_CONTROL')
  // The fixture alone can recognize mock inventory. No runtime function exposes this action.
  async function recognize(q=1000n*unit) {
   await ownerTx(async c=>{
    const op=(await c.query("INSERT INTO financial_operations(operation_key,actor,action,terms,request_hash,result) VALUES($1,'system:tests','POSITION_FIXTURE_RECOGNITION','{}','fixture','{}') RETURNING id",[key()])).rows[0].id
    const j=(await c.query("INSERT INTO position_journals(operation_id,reference,purpose) VALUES($1,$2,'RECOGNITION') RETURNING id",[op,key()])).rows[0].id
    await c.query("INSERT INTO position_journal_entries(journal_id,account_id,token_id,side,quantity) VALUES($1,$2,$4,'OUT',$5),($1,$3,$4,'IN',$5)",[j,external,unallocated,tokenId,q.toString()])
    await c.query("UPDATE position_journals SET status='POSTED' WHERE id=$1",[j])
   })
  }
  await recognize()
  const transfer=await positions.transfer(sys,key(),{sourceAccountId:unallocated,targetAccountId:seller,quantity:100n*unit,reference:key()})
  return {buyer,seller,unallocated,external,tokenId,transfer,recognize}
 }
 const a=await accounts()
 return {positions,unit,hex,one,cash,registry,market,accounts,a}
}

export async function runPositionCases(t, {admin,runtime,ledger,sys,key,fixture,ownerTx}) {
 const {positions,unit,one,cash,registry,market,accounts,a}=await createPositionFixture({admin,runtime,ledger,sys,key,fixture,ownerTx})
 const reserve=(q=10n*unit,reference=key())=>positions.reserve(cash.other,key(),{accountId:a.seller,quantity:q,reference})
 const snapshot=async()=> (await admin.query(`SELECT jsonb_build_object('cash',(SELECT jsonb_agg(p ORDER BY account_id) FROM financial_balance_projections p),'positions',(SELECT jsonb_agg(p ORDER BY account_id) FROM position_balance_projections p),'operations',(SELECT count(*) FROM financial_operations),'settlements',(SELECT count(*) FROM cash_position_settlements),'events',(SELECT count(*) FROM position_reservation_events),'cashEvents',(SELECT count(*) FROM cash_reservation_events),'cashJournals',(SELECT count(*) FROM financial_journals),'positionJournals',(SELECT count(*) FROM position_journals),'cashEntries',(SELECT count(*) FROM financial_journal_entries),'positionEntries',(SELECT count(*) FROM position_journal_entries),'cashHolds',(SELECT jsonb_agg(r ORDER BY id) FROM cash_reservations r),'positionHolds',(SELECT jsonb_agg(r ORDER BY id) FROM position_reservations r)) AS state`)).rows[0].state
 const terms=async({q=unit,amount=10000n,positionQty=10n*unit,...overrides}={})=>{
  const cashReservationReference=key(),positionReservationReference=key()
  const c=await ledger.reserve(cash.actor,key(),{accountId:cash.a,amount,reference:cashReservationReference})
  const p=await reserve(positionQty,positionReservationReference)
  return {buyerCashAccountId:cash.a,sellerCashAccountId:cash.b,buyerPositionAccountId:a.buyer,sellerPositionAccountId:a.seller,cashReservationId:c.reservationId,positionReservationId:p.reservationId,cashReservationReference,positionReservationReference,marketId:market.marketId,tokenId:market.tokenId,quantity:q,priceCents:60n,matchReference:key(),...overrides}
 }
 await t.test('position account identity, six-decimal precision and real numeric token IDs',async()=>{
  const bad=await registry({decimals:18})
  await assert.rejects(positions.createAccount(sys,key(),{tokenId:bad.tokenId,kind:'CUSTOMER',ownerUserId:cash.actor.slice(5),accountKey:key()}),/six-decimal/)
  assert.equal((await positions.balance(cash.other,a.seller)).posted,'100000000')
  const token=await one('SELECT position_id::text FROM ctf_position_tokens WHERE id=$1',[a.tokenId]);assert.ok(BigInt(token.position_id)>MAX_BIGINT)
 })
 await t.test('position quantities reject floats, unsafe Number, fractions, negatives and overflow',async()=>{
  for(const q of [1,1.5,'1000000',0n,-unit,1n,MAX_BIGINT+1n])await assert.rejects(reserve(q),/whole-share/)
  for(const quantity of ['1','0','-1000000','1.5','9223372036855000000',1000000])await assert.rejects(runtime.query('SELECT financial_execute($1,$2,$3,$4)',[cash.other,'POSITION_RESERVE',key(),JSON.stringify({accountId:a.seller,quantity,reference:key()})]))
 })
 await t.test('external controls cannot be spent, reserved, posted through or recognized by runtime',async()=>{
  const b=await positions.balance(sys,a.external);assert.equal(b.spendable,false);assert.equal(b.available,'0')
  await assert.rejects(positions.transfer(sys,key(),{sourceAccountId:a.external,targetAccountId:a.seller,quantity:unit,reference:key()}),/not spendable/)
  await assert.rejects(positions.reserve(sys,key(),{accountId:a.external,quantity:unit,reference:key()}),/not spendable/)
  await assert.rejects(runtime.query('SELECT financial_execute($1,$2,$3,$4)',[sys,'POSITION_FIXTURE_RECOGNITION',key(),'{}']),/unknown position action/)
  await assert.rejects(runtime.query('SELECT position_execute($1,$2,$3,$4)',[sys,'POSITION_POST',key(),'{}']),e=>e.code==='42501')
 })
 await t.test('cross-user balance, transfer, reserve and reservation access are rejected',async()=>{
  const r=await reserve()
  for(const call of [()=>positions.balance(cash.actor,a.seller),()=>positions.reserve(cash.actor,key(),{accountId:a.seller,quantity:unit,reference:key()}),()=>positions.transfer(cash.actor,key(),{sourceAccountId:a.seller,targetAccountId:a.buyer,quantity:unit,reference:key()}),()=>positions.cancel(cash.actor,key(),r.reservationId)])await assert.rejects(call(),e=>e.code==='42501')
  await positions.cancel(cash.other,key(),r.reservationId)
 })
 await t.test('duplicate transfers and actor-bound conflicting idempotency never double move inventory',async()=>{
  const k=key(),v={sourceAccountId:a.seller,targetAccountId:a.buyer,quantity:unit,reference:key()}
  const before=await positions.balance(cash.other,a.seller)
  const result=await Promise.all([positions.transfer(cash.other,k,v),positions.transfer(cash.other,k,v)])
  assert.deepEqual(result[0],result[1]);assert.equal(BigInt((await positions.balance(cash.other,a.seller)).posted),BigInt(before.posted)-unit)
  await assert.rejects(positions.transfer(cash.actor,k,v),/idempotency conflict/)
  await assert.rejects(positions.transfer(cash.other,k,{...v,quantity:2n*unit}),/idempotency conflict/)
 })
 await t.test('concurrent overselling accepts exactly one reservation',async()=>{
  const available=BigInt((await positions.balance(cash.other,a.seller)).available)
  const results=await Promise.allSettled([reserve(available),reserve(available)])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  await positions.cancel(cash.other,key(),results.find(r=>r.status==='fulfilled').value.reservationId)
 })
 await t.test('partial consumption and release then cancellation preserve remaining and history',async()=>{
  const r=await reserve()
  await Promise.all([positions.consume(sys,key(),{reservationId:r.reservationId,targetAccountId:a.buyer,quantity:2n*unit}),positions.release(cash.other,key(),{reservationId:r.reservationId,quantity:3n*unit})])
  const state=await one('SELECT consumed,released,status FROM position_reservations WHERE id=$1',[r.reservationId]);assert.deepEqual(state,{consumed:'2000000',released:'3000000',status:'OPEN'})
  await positions.cancel(cash.other,key(),r.reservationId)
  await assert.rejects(positions.consume(sys,key(),{reservationId:r.reservationId,targetAccountId:a.buyer,quantity:unit}),/closed/)
 })
 await t.test('competing consume/cancel/release never exceed one reservation',async()=>{
  const r=await reserve(unit)
  const results=await Promise.allSettled([positions.consume(sys,key(),{reservationId:r.reservationId,targetAccountId:a.buyer,quantity:unit}),positions.cancel(cash.other,key(),r.reservationId),positions.release(cash.other,key(),{reservationId:r.reservationId,quantity:unit})])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 })
 await t.test('cross-token and cross-chain transfers fail without partial movements',async()=>{
  const no=await accounts(market.noTokenId),other=await accounts((await registry()).tokenId)
  for(const target of [no.buyer,other.buyer]){
   const before=await snapshot();await assert.rejects(positions.transfer(cash.other,key(),{sourceAccountId:a.seller,targetAccountId:target,quantity:unit,reference:key()}),/token mismatch/);assert.deepEqual(await snapshot(),before)
  }
 })
 await t.test('balanced position posting and exact eligible reversal preserve token conservation',async()=>{
  const v=[{accountId:a.seller,tokenId:a.tokenId,side:'OUT',quantity:unit},{accountId:a.buyer,tokenId:a.tokenId,side:'IN',quantity:unit}]
  const j=await positions.post(sys,key(),v,key());await positions.reverse(sys,key(),j.journalId)
  await assert.rejects(positions.reverse(sys,key(),j.journalId),e=>e.code==='23505')
  await assert.rejects(positions.post(sys,key(),[{...v[0],quantity:2n*unit},v[1]],key()),/balanced per token/)
 })
 await t.test('position history and account identities cannot change or accept appended entries',async()=>{
  for(const sql of ["UPDATE position_accounts SET token_id=token_id WHERE id="+a.seller,"DELETE FROM position_reservation_events","UPDATE position_journals SET status='DRAFT' WHERE id="+a.transfer.journalId,"INSERT INTO position_journal_entries(journal_id,account_id,token_id,side,quantity) VALUES("+a.transfer.journalId+','+a.seller+','+a.tokenId+",'IN',1000000)"])await assert.rejects(ownerTx(c=>c.query(sql)),/immutable|append/)
 })
 await t.test('atomic cash and position settlement conserves totals and records exact links',async()=>{
  const v=await terms({q:2n*unit}),beforeBuyer=await ledger.balance(cash.actor,cash.a),beforeSeller=await positions.balance(cash.other,a.seller)
  const result=await positions.settle(sys,key(),v)
  assert.equal(result.considerationCents,'120');assert.equal(BigInt((await ledger.balance(cash.actor,cash.a)).posted),BigInt(beforeBuyer.posted)-120n)
  assert.equal(BigInt((await positions.balance(cash.other,a.seller)).posted),BigInt(beforeSeller.posted)-2n*unit)
  assert.equal((await one('SELECT count(*)::int AS n FROM cash_position_settlements WHERE id=$1',[result.settlementId])).n,1)
  await assert.rejects(ledger.reverse(sys,key(),result.cashJournalId),/ineligible/)
  await assert.rejects(positions.reverse(sys,key(),result.positionJournalId),/ineligible/)
  await ledger.cancel(cash.actor,key(),v.cashReservationId);await positions.cancel(cash.other,key(),v.positionReservationId)
 })
 await t.test('duplicate settlement retries succeed once; changed terms or match reference do not',async()=>{
  const v=await terms(),k=key();const [x,y]=await Promise.all([positions.settle(sys,k,v),positions.settle(sys,k,v)]);assert.deepEqual(x,y)
  await assert.rejects(positions.settle(sys,k,{...v,priceCents:61n}),/idempotency conflict/)
  await assert.rejects(positions.settle(sys,key(),v),e=>e.code==='23505')
  await ledger.cancel(cash.actor,key(),v.cashReservationId);await positions.cancel(cash.other,key(),v.positionReservationId)
 })
 await t.test('settlement rejects self trade, wrong ownership, wrong market and token',async()=>{
  const v=await terms(),otherMarket=await registry()
  for(const changes of [{sellerCashAccountId:cash.a,sellerPositionAccountId:a.buyer},{sellerCashAccountId:cash.a},{marketId:otherMarket.marketId},{tokenId:market.noTokenId},{positionReservationId:'9223372036854775807'}]) {
   const before=await snapshot();await assert.rejects(positions.settle(sys,key(),{...v,...changes}));assert.deepEqual(await snapshot(),before)
  }
  await ledger.cancel(cash.actor,key(),v.cashReservationId);await positions.cancel(cash.other,key(),v.positionReservationId)
 })
 await t.test('same-owner reservation substitution and altered business references are rejected',async()=>{
  const original=await terms(),other=await terms()
  for(const changes of [{cashReservationId:other.cashReservationId},{positionReservationId:other.positionReservationId},{cashReservationReference:key()},{positionReservationReference:key()}]){
   const before=await snapshot();await assert.rejects(positions.settle(sys,key(),{...original,...changes}),/business reference mismatch/);assert.deepEqual(await snapshot(),before)
  }
  for(const v of [original,other]){await ledger.cancel(cash.actor,key(),v.cashReservationId);await positions.cancel(cash.other,key(),v.positionReservationId)}
 })
 await t.test('deferred validation independently rejects settlement terms changed after execution checks',async()=>{
  const v=await terms(),before=await snapshot()
  // Owner-only fault injection runs after the normal immutable-operation BEFORE trigger.
  // Runtime cannot create this trigger; it proves the deferred comparison is independent.
  await admin.query(`CREATE FUNCTION public.test_settlement_terms_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='SETTLE' THEN NEW.terms=jsonb_set(NEW.terms,'{cashReservationReference}','"forged-reference"'::jsonb); END IF; RETURN NEW; END $$`)
  await admin.query('CREATE TRIGGER zzz_test_settlement_terms_fault BEFORE UPDATE ON financial_operations FOR EACH ROW EXECUTE FUNCTION public.test_settlement_terms_fault()')
  try{await assert.rejects(positions.settle(sys,key(),v),/authorized operation terms or reservation references/);assert.deepEqual(await snapshot(),before)}finally{await admin.query('DROP TRIGGER zzz_test_settlement_terms_fault ON financial_operations');await admin.query('DROP FUNCTION public.test_settlement_terms_fault()')}
  await ledger.cancel(cash.actor,key(),v.cashReservationId);await positions.cancel(cash.other,key(),v.positionReservationId)
 })
 await t.test('cash and position reservation shortages roll back both legs',async()=>{
  for(const options of [{amount:1n},{q:2n*unit,positionQty:unit}]){
   const v=await terms(options),before=await snapshot();await assert.rejects(positions.settle(sys,key(),v),/insufficient remaining/);assert.deepEqual(await snapshot(),before)
   await ledger.cancel(cash.actor,key(),v.cashReservationId);await positions.cancel(cash.other,key(),v.positionReservationId)
  }
 })
 await t.test('concurrent settlements lock accounts and cannot consume reservations twice',async()=>{
  const v=await terms({positionQty:unit,amount:60n});const results=await Promise.allSettled([positions.settle(sys,key(),v),positions.settle(sys,key(),{...v,matchReference:key()})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 })
 await t.test('market pause and elapsed cutoff prevent settlement',async()=>{
  const v=await terms();await admin.query("UPDATE markets SET trading_status='PAUSED' WHERE id=$1",[market.marketId]);await assert.rejects(positions.settle(sys,key(),v),/market not open/);await admin.query("UPDATE markets SET trading_status='OPEN' WHERE id=$1",[market.marketId])
  const expired=await registry({cutoffSeconds:-1})
  await assert.rejects(positions.settle(sys,key(),{...v,marketId:expired.marketId}),/cutoff/)
  await ledger.cancel(cash.actor,key(),v.cashReservationId);await positions.cancel(cash.other,key(),v.positionReservationId)
 })
 await t.test('position audits reject projection tampering, rescheduled constraints and savepoint bypass',async()=>{
  await assert.rejects(ownerTx(async c=>{await c.query('SET CONSTRAINTS ALL IMMEDIATE');await c.query('SET CONSTRAINTS ALL DEFERRED');await c.query('SAVEPOINT attempt');await c.query('UPDATE position_balance_projections SET posted=posted+1000000 WHERE account_id=$1',[a.buyer])}),/projection differs/)
  await ownerTx(async c=>{await c.query('SAVEPOINT attempt');await c.query('UPDATE position_balance_projections SET posted=posted+1000000 WHERE account_id=$1',[a.buyer]);await c.query('ROLLBACK TO SAVEPOINT attempt')})
  await assert.rejects(runtime.query("INSERT INTO financial_audit_targets VALUES(pg_current_xact_id()::text,'POSITION_ACCOUNT',$1)",[a.buyer]),e=>e.code==='42501')
 })
 await t.test('position targets are rescheduled after prior immediate validation',async()=>{
  await assert.rejects(ownerTx(async c=>{
   await c.query('UPDATE position_balance_projections SET posted=posted WHERE account_id=$1',[a.buyer])
   await c.query('SET CONSTRAINTS ALL IMMEDIATE')
   assert.equal((await c.query('SELECT count(*)::int AS n FROM financial_audit_targets')).rows[0].n,0)
   await c.query('SET CONSTRAINTS ALL DEFERRED')
   await c.query('UPDATE position_balance_projections SET posted=posted+1000000 WHERE account_id=$1',[a.buyer])
  }),/projection differs/)
 })
 await t.test('unallocated inventory cannot go negative and aggregate cross-token balance is insufficient',async()=>{
  const available=BigInt((await positions.balance(sys,a.unallocated)).available)
  await assert.rejects(positions.transfer(sys,key(),{sourceAccountId:a.unallocated,targetAccountId:a.seller,quantity:available+unit,reference:key()}),/insufficient available positions/)
  const other=await accounts((await registry()).tokenId),before=await snapshot()
  await assert.rejects(positions.post(sys,key(),[{accountId:a.seller,tokenId:a.tokenId,side:'OUT',quantity:unit},{accountId:other.buyer,tokenId:other.tokenId,side:'IN',quantity:unit}],key()),/balanced per token/)
  assert.deepEqual(await snapshot(),before)
 })
 await t.test('an incomplete settlement operation cannot commit even through owner SQL',async()=>{
  await assert.rejects(ownerTx(c=>c.query("INSERT INTO financial_operations(operation_key,actor,action,terms,request_hash,result) VALUES($1,'system:tests','SETTLE','{}','fixture','{}')",[key()])),/incomplete settlement/)
 })
 await t.test('failure after either journal leg leaves no settlement, movements or consumed holds',async()=>{
  const v=await terms()
  for(const [table,account,side] of [['financial_journal_entries',cash.b,'CREDIT'],['position_journal_entries',a.buyer,'IN']]){
   await admin.query(`CREATE FUNCTION public.test_settlement_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_id=${account} AND NEW.side='${side}' THEN RAISE EXCEPTION 'injected late settlement failure'; END IF; RETURN NEW; END $$`)
   await admin.query(`CREATE TRIGGER test_settlement_failure AFTER INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION public.test_settlement_failure()`)
   try{const before=await snapshot();await assert.rejects(positions.settle(sys,key(),v),/injected late/);assert.deepEqual(await snapshot(),before)}finally{await admin.query(`DROP TRIGGER test_settlement_failure ON ${table}`);await admin.query('DROP FUNCTION public.test_settlement_failure()')}
  }
  await ledger.cancel(cash.actor,key(),v.cashReservationId);await positions.cancel(cash.other,key(),v.positionReservationId)
 })
 await t.test('failures after each settlement stage roll back all holds, journals, events and links',async()=>{
  const v=await terms()
  const stages=[
   ['cash_reservations','UPDATE',`NEW.id=${v.cashReservationId} AND NEW.consumed>OLD.consumed`],
   ['financial_journals','UPDATE',"NEW.status='POSTED' AND EXISTS(SELECT 1 FROM public.financial_operations WHERE id=NEW.operation_id AND action='SETTLE')"],
   ['cash_reservation_events','INSERT',`NEW.reservation_id=${v.cashReservationId} AND NEW.kind='CONSUME'`],
   ['position_reservations','UPDATE',`NEW.id=${v.positionReservationId} AND NEW.consumed>OLD.consumed`],
   ['position_journals','UPDATE',"NEW.status='POSTED' AND NEW.purpose='SETTLEMENT'"],
   ['position_reservation_events','INSERT',`NEW.reservation_id=${v.positionReservationId} AND NEW.kind='CONSUME'`],
   ['cash_position_settlements','INSERT','true'],
   ['financial_operations','UPDATE',"NEW.action='SETTLE' AND NEW.result IS NOT NULL"],
  ]
  for(const [table,event,predicate] of stages){
   await admin.query(`CREATE FUNCTION public.test_settlement_stage_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'injected stage failure'; END IF; RETURN NEW; END $$`)
   await admin.query(`CREATE TRIGGER test_settlement_stage_failure AFTER ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION public.test_settlement_stage_failure()`)
   try{const before=await snapshot();await assert.rejects(positions.settle(sys,key(),v),/injected stage failure/);assert.deepEqual(await snapshot(),before)}finally{await admin.query(`DROP TRIGGER test_settlement_stage_failure ON ${table}`);await admin.query('DROP FUNCTION public.test_settlement_stage_failure()')}
  }
  await ledger.cancel(cash.actor,key(),v.cashReservationId);await positions.cancel(cash.other,key(),v.positionReservationId)
 })
 await t.test('market closure waits for an active settlement and blocks subsequent settlement',async()=>{
  const v=await terms(),c=await admin.connect(),closer=await admin.connect()
  try{
   await c.query('BEGIN')
   await c.query('SELECT financial_execute($1,$2,$3,$4)',[sys,'SETTLE',key(),JSON.stringify(v,(_,value)=>typeof value==='bigint'?value.toString():value)])
   await closer.query("SET lock_timeout='100ms'")
   await assert.rejects(closer.query("UPDATE markets SET trading_status='PAUSED' WHERE id=$1",[market.marketId]),e=>e.code==='55P03')
   await c.query('COMMIT')
   await closer.query("UPDATE markets SET trading_status='PAUSED' WHERE id=$1",[market.marketId])
   await assert.rejects(positions.settle(sys,key(),{...v,matchReference:key()}),/market not open/)
  }finally{await c.query('ROLLBACK');c.release();await closer.query('RESET lock_timeout');closer.release();await admin.query("UPDATE markets SET trading_status='OPEN' WHERE id=$1",[market.marketId])}
  await ledger.cancel(cash.actor,key(),v.cashReservationId);await positions.cancel(cash.other,key(),v.positionReservationId)
 })
 await t.test('two opposite unbalanced token journals cannot cancel at commit',async()=>{
  await assert.rejects(ownerTx(async c=>{
   for(const side of ['IN','OUT']){
    const op=(await c.query("INSERT INTO financial_operations(operation_key,actor,action,terms,request_hash,result) VALUES($1,'system:tests','POSITION_POST','{}','fixture','{}') RETURNING id",[key()])).rows[0].id
    const j=(await c.query("INSERT INTO position_journals(operation_id,reference,purpose) VALUES($1,$2,'POST') RETURNING id",[op,key()])).rows[0].id
    await c.query('INSERT INTO position_journal_entries(journal_id,account_id,token_id,side,quantity) VALUES($1,$2,$3,$4,1000000)',[j,a.buyer,a.tokenId,side])
    await c.query("UPDATE position_journals SET status='POSTED' WHERE id=$1",[j])
   }
  }),/balanced per token/)
 })
 await t.test('position BIGINT overflow rolls back recognized inventory and all projections',async()=>{
  const v=await accounts((await registry()).tokenId)
  const before=await snapshot();await assert.rejects(v.recognize(9223372036854000000n),e=>e.code==='22003');assert.deepEqual(await snapshot(),before)
 })
 await t.test('deferred settlement checks reject market closure after execution but before commit',async()=>{
  const v=await terms(),before=await snapshot(),c=await admin.connect()
  try{
   await c.query('BEGIN')
   await c.query('SELECT financial_execute($1,$2,$3,$4)',[sys,'SETTLE',key(),JSON.stringify(v,(_,value)=>typeof value==='bigint'?value.toString():value)])
   await c.query("UPDATE markets SET trading_status='PAUSED' WHERE id=$1",[market.marketId])
   await assert.rejects(c.query('COMMIT'),/before settlement commit/)
  }finally{await c.query('ROLLBACK');c.release()}
  assert.deepEqual(await snapshot(),before)
  assert.equal((await one('SELECT trading_status FROM markets WHERE id=$1',[market.marketId])).trading_status,'OPEN')
  await ledger.cancel(cash.actor,key(),v.cashReservationId);await positions.cancel(cash.other,key(),v.positionReservationId)
 })
 await t.test('position reconstruction and full reconciliation exclude racing writers',async()=>{
  await Promise.all([positions.rebuild(sys,key()),positions.transfer(cash.other,key(),{sourceAccountId:a.seller,targetAccountId:a.buyer,quantity:unit,reference:key()})])
  const before=await positions.balance(cash.actor,a.buyer)
  await assert.rejects(ownerTx(async c=>{
   await c.query('UPDATE position_balance_projections SET posted=posted+1000000 WHERE account_id=$1',[a.buyer])
   await c.query('SELECT financial_execute($1,$2,$3,$4)',[sys,'POSITION_RECONCILE',key(),'{}'])
  }),/projection differs/)
  await ownerTx(async c=>{
   await c.query('UPDATE position_balance_projections SET posted=posted+1000000 WHERE account_id=$1',[a.buyer])
   await c.query('SELECT financial_execute($1,$2,$3,$4)',[sys,'POSITION_REBUILD',key(),'{}'])
  })
  assert.deepEqual(await positions.balance(cash.actor,a.buyer),before)
  const r=await positions.reconcile(sys);assert.equal(r.reconciled,true);assert.equal(r.cash.consistent,true)
  assert.equal((await one('SELECT count(*)::int AS n FROM financial_audit_targets')).n,0)
  assert.equal((await admin.query("SELECT token_id FROM position_journal_entries GROUP BY token_id HAVING sum(CASE side WHEN 'IN' THEN quantity::numeric ELSE -quantity::numeric END)<>0")).rowCount,0)
 })
 await t.test('practical position reservation and settlement benchmark with final reconciliation',async()=>{
  const totals=async()=>({cash:(await one('SELECT sum(posted::numeric)::text AS total FROM financial_balance_projections WHERE account_id IN ($1,$2)',[cash.a,cash.b])).total,positions:(await one("SELECT sum(p.posted::numeric)::text AS total FROM position_balance_projections p JOIN position_accounts a1 ON a1.id=p.account_id WHERE a1.kind<>'EXTERNAL_CONTROL' AND a1.token_id=$1",[market.tokenId])).total})
  const conserved=await totals()
  const durations=[];const start=performance.now()
  for(let i=0;i<40;i++){
   const tick=performance.now(),v=await terms({amount:60n,positionQty:unit});await positions.settle(sys,key(),v);durations.push(performance.now()-tick)
  }
  const elapsed=performance.now()-start;durations.sort((x,y)=>x-y)
  const concurrent=await terms({amount:480n,positionQty:8n*unit})
  const beforeDeadlocks=Number((await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks)
  let maxLockWaiters=0,sampling=false,sampleError
  const sampler=setInterval(async()=>{if(sampling)return;sampling=true;try{const sample=await one("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND usename='ledger_runtime' AND wait_event_type='Lock'");maxLockWaiters=Math.max(maxLockWaiters,sample.n)}catch(error){sampleError=error}finally{sampling=false}},5)
  const concurrentStart=performance.now()
  try{await Promise.all(Array.from({length:8},()=>positions.settle(sys,key(),{...concurrent,matchReference:key()})))}finally{clearInterval(sampler)}
  while(sampling)await new Promise(resolve=>setTimeout(resolve,1))
  if(sampleError)throw sampleError
  const concurrentMs=performance.now()-concurrentStart
  const deadlocks=Number((await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks)-beforeDeadlocks
  assert.equal(deadlocks,0)
  const reconciled=await positions.reconcile(sys);assert.equal(reconciled.reconciled,true)
  assert.deepEqual(await totals(),conserved)
  t.diagnostic(JSON.stringify({reconciliation:reconciled,conservedTotals:conserved}))
  t.diagnostic(JSON.stringify({benchmark:'8 concurrent same-account settlements',milliseconds:Math.round(concurrentMs),settlementsPerSecond:8/(concurrentMs/1000),maxSampledLockWaiters:maxLockWaiters,deadlocks,reconciled:true}))
  t.diagnostic(JSON.stringify({benchmark:'40 atomic settlements + 80 reservations',milliseconds:Math.round(elapsed),settlementsPerSecond:40/(elapsed/1000),averageMs:durations.reduce((x,y)=>x+y,0)/40,p50Ms:durations[19],p95Ms:durations[37],p99Ms:durations[39],reconciled:true}))
 })
 await runIncrementalCases(t,{admin,runtime,ledger,positions,sys,key,fixture,ownerTx,cash,a,market,unit,makeFixture:()=>createPositionFixture({admin,runtime,ledger,sys,key,fixture,ownerTx,chainSeed:910000})})
 if(process.env.LEDGER_POSITION_BENCHMARK==='true')await runPositionBenchmark({t,admin,runtime,ledger,positions,sys,key,fixture,cash,a,market,unit})

}
