import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID,randomBytes,createHash } from 'node:crypto'
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createLedger, createTradingService } from '../src/index.js'
import { createPositionFixture } from './positionCases.js'

const configured=Boolean(process.env.LEDGER_DISPOSABLE_TARGET)
if(process.env.LEDGER_REQUIRE_POSTGRES==='true'&&!configured)throw new Error('Migration adoption tests require the verified disposable runner')
test('0012 adoption on populated and inconsistent disposable PostgreSQL databases',{skip:!configured},async t=>{
 const config=JSON.parse(process.env.LEDGER_DISPOSABLE_TARGET)
 assert.equal(process.env.NODE_ENV,'test');assert.equal(config.host,'127.0.0.1');assert.equal(config.database,'khmerfp_ledger_test')
 const inspected=spawnSync('docker',['inspect',process.env.LEDGER_CONTAINER_ID],{encoding:'utf8',timeout:10000});assert.equal(inspected.status,0)
 const metadata=JSON.parse(inspected.stdout)[0];assert.equal(metadata.Config.Labels['khmerfp.disposable'],'ledger');assert.equal(metadata.Config.Image,'postgres:16');assert.equal(metadata.NetworkSettings.Ports['5432/tcp'][0].HostPort,String(config.port))
 const parent=new pg.Pool(config),pools=[]
 const temporary=mkdtempSync(join(tmpdir(),'khmerfp-incremental-adoption-'))
 const migrations=fileURLToPath(new URL('../../db/migrations/',import.meta.url))
 const oldJournal=JSON.parse(readFileSync(join(migrations,'meta/_journal.json'),'utf8'));oldJournal.entries=oldJournal.entries.slice(0,12)
 mkdirSync(join(temporary,'meta'));writeFileSync(join(temporary,'meta/_journal.json'),JSON.stringify(oldJournal))
 for(const entry of oldJournal.entries)copyFileSync(join(migrations,entry.tag+'.sql'),join(temporary,entry.tag+'.sql'))
 const key=randomUUID,sys='system:adoption-test',password=randomBytes(24).toString('hex')
 const tables=['financial_assets','financial_accounts','financial_operations','financial_journals','financial_journal_entries','financial_balance_projections','cash_reservations','cash_reservation_events','financial_audit_targets','financial_audit_deltas','position_accounts','position_journals','position_journal_entries','position_balance_projections','position_reservations','position_reservation_events','cash_position_settlements']
 try{
  await parent.query('CREATE ROLE ledger_adoption_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT')
  await parent.query("CREATE ROLE ledger_adoption_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '"+password+"'")
  const configure=async admin=>{
   await admin.query('GRANT USAGE ON SCHEMA public TO ledger_adoption_owner,ledger_adoption_runtime')
   for(const table of tables)if((await admin.query('SELECT to_regclass($1) AS name',['public.'+table])).rows[0].name)await admin.query('ALTER TABLE public.'+table+' OWNER TO ledger_adoption_owner')
   for(const table of ['trading_books','trading_commands','trading_orders','trading_fills','trading_order_events','trading_outbox']) if((await admin.query('SELECT to_regclass($1) AS name',['public.'+table])).rows[0].name)await admin.query('ALTER TABLE public.'+table+' OWNER TO ledger_adoption_owner')
   const signatures=(await admin.query("SELECT oid::regprocedure::text AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'financial_%' OR proname LIKE 'trading_%' OR proname IN ('position_execute','position_guard','position_validate'))")).rows
   for(const row of signatures)await admin.query('ALTER FUNCTION public.'+row.signature+' OWNER TO ledger_adoption_owner')
   if((await admin.query("SELECT to_regprocedure('public.trading_execute(text,text,text,jsonb)') AS name")).rows[0].name)await admin.query('GRANT EXECUTE ON FUNCTION public.trading_execute(text,text,text,jsonb) TO ledger_adoption_runtime')
   await admin.query('GRANT EXECUTE ON FUNCTION public.financial_execute(text,text,text,jsonb),public.financial_reconcile(text) TO ledger_adoption_runtime')
   await admin.query('GRANT SELECT ON public.chains,public.contract_deployments,public.ctf_position_tokens,public.chain_assets,public.ctf_conditions,public.market_outcomes,public.market_questions,public.markets TO ledger_adoption_owner')
   for(const table of ['position_token_verifications','market_outcome_tokens']) if((await admin.query('SELECT to_regclass($1) AS name',['public.'+table])).rows[0].name) await admin.query('GRANT SELECT ON public.'+table+' TO ledger_adoption_owner')
   await admin.query('GRANT UPDATE(id) ON public.markets TO ledger_adoption_owner')
  }
  const make=async database=>{
   assert.match(database,/^khmerfp_incremental_(populated|invalid|eligibility|trading)_test$/)
   assert.equal((await parent.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount,0)
   await parent.query('CREATE DATABASE '+database)
   const admin=new pg.Pool({...config,database,statement_timeout:30000});pools.push(admin)
   await migrate(drizzle(admin),{migrationsFolder:temporary});await configure(admin)
   const runtime=new pg.Pool({...config,database,user:'ledger_adoption_runtime',password,max:4});pools.push(runtime)
   const ledger=createLedger({pool:runtime,enabled:true,environment:'test',authorize:()=>true})
   const ownerTx=async work=>{const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE ledger_adoption_owner');await work(c);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
   const fixture=async(amount=10000n)=>{
    const users=(await admin.query("INSERT INTO users(email,display_name) VALUES($1,'Adoption buyer'),($2,'Adoption seller') RETURNING id",[key()+'@example.test',key()+'@example.test'])).rows
    const account=async(ownerUserId,kind,normalSide)=>(await ledger.createAccount(sys,key(),{ownerUserId,kind,normalSide,asset:'USD',accountKey:key()})).accountId
    const a=await account(users[0].id,'CUSTOMER','CREDIT'),b=await account(users[1].id,'CUSTOMER','CREDIT'),cash=await account(null,'ASSET','DEBIT')
    await ledger.post(sys,key(),[{accountId:cash,asset:'USD',side:'DEBIT',amount},{accountId:a,asset:'USD',side:'CREDIT',amount}],key())
    return {a,b,cash,actor:'user:'+users[0].id,other:'user:'+users[1].id}
   }
   return {admin,runtime,ledger,ownerTx,fixture}
  }
  const fingerprint=async admin=>{
   const rows={}
   for(const table of tables.filter(t=>t!=='financial_audit_deltas'))rows[table]=(await admin.query('SELECT to_jsonb(t) AS row FROM '+table+' t ORDER BY 1::text')).rows.map(r=>r.row).sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y)))
   return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  }
  await t.test('populated adoption retains historical partial fills, holds, settlements and balances',async()=>{
   const f=await make('khmerfp_incremental_populated_test');const {admin,runtime,ledger,fixture,ownerTx}=f
   const context=await createPositionFixture({admin,runtime,ledger,fixture,ownerTx,key,sys});const {positions,cash,a,market,unit}=context
   const reserve=async(n)=>{const cashReservationReference=key(),positionReservationReference=key();const cr=await ledger.reserve(cash.actor,key(),{accountId:cash.a,amount:BigInt(n)*60n,reference:cashReservationReference});const pr=await positions.reserve(cash.other,key(),{accountId:a.seller,quantity:BigInt(n)*unit,reference:positionReservationReference});return {buyerCashAccountId:cash.a,sellerCashAccountId:cash.b,buyerPositionAccountId:a.buyer,sellerPositionAccountId:a.seller,cashReservationId:cr.reservationId,positionReservationId:pr.reservationId,cashReservationReference,positionReservationReference,marketId:market.marketId,tokenId:market.tokenId,quantity:unit,priceCents:60n}}
   const open=await reserve(10)
   for(let i=0;i<3;i++)await positions.settle(sys,key(),{...open,matchReference:key()})
   await ledger.release(cash.actor,key(),{reservationId:open.cashReservationId,amount:60n});await positions.release(cash.other,key(),{reservationId:open.positionReservationId,quantity:unit})
   const closed=await reserve(1);await positions.settle(sys,key(),{...closed,matchReference:key()})
   assert.equal((await positions.reconcile(sys)).reconciled,true)
   const registryState=async()=> (await admin.query(`SELECT jsonb_build_object(
    'markets',(SELECT jsonb_agg(to_jsonb(m)-ARRAY['market_type','outcome_count','series_key','round_key'] ORDER BY id) FROM markets m),
    'outcomes',(SELECT jsonb_agg(to_jsonb(o)-ARRAY['range_lower','range_upper'] ORDER BY id) FROM market_outcomes o),
    'conditions',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM ctf_conditions c),
    'tokens',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM ctf_position_tokens t)) AS state`)).rows[0].state
   const originalRegistry=await registryState()
   const before=await fingerprint(admin),history=(await admin.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows
   await migrate(drizzle(admin),{migrationsFolder:migrations});await configure(admin)
   assert.equal(await fingerprint(admin),before)
   assert.deepEqual(await registryState(),originalRegistry)
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM market_outcome_tokens')).rows[0].n,4)
   const after=(await admin.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows;assert.equal(after.length,16);assert.deepEqual(after.slice(0,12),history)
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM financial_audit_deltas')).rows[0].n,0)
   await ledger.rebuild(sys,key());await positions.rebuild(sys,key())
   await positions.settle(sys,key(),{...open,matchReference:key()})
   assert.equal((await positions.reconcile(sys)).reconciled,true)
   assert.equal((await admin.query('SELECT consumed FROM position_reservations WHERE id=$1',[open.positionReservationId])).rows[0].consumed,'4000000')
   const trading=createTradingService({pool:runtime,enabled:true,environment:'test',authorize:()=>true})
   const buy=await trading.place(cash.actor,key(),{marketId:market.marketId,tokenId:market.tokenId,side:'BUY',quantity:unit,priceCents:65n,cashAccountId:cash.a,positionAccountId:a.buyer})
   const sell=await trading.place(cash.other,key(),{marketId:market.marketId,tokenId:market.tokenId,side:'SELL',quantity:unit,priceCents:60n,cashAccountId:cash.b,positionAccountId:a.seller})
   await trading.fill(sys,key(),{buyerOrderId:buy.orderId,sellerOrderId:sell.orderId,quantity:unit,priceCents:60n})
   assert.equal((await trading.reconcile(sys)).reconciled,true)
   const stable=await fingerprint(admin);await migrate(drizzle(admin),{migrationsFolder:migrations});assert.equal(await fingerprint(admin),stable)
  })
  for(const [prefixCount,database] of [[14,'khmerfp_incremental_eligibility_test'],[15,'khmerfp_incremental_trading_test']])await t.test(`forward adoption from ${prefixCount} migrations rejects corrupt state and preserves valid binary history`,async()=>{
   const f=await make(database)
   const context=await createPositionFixture({...f,key,sys})
   const prefix=mkdtempSync(join(tmpdir(),'khmerfp-eligibility-prefix-'))
   try {
    const journal=JSON.parse(readFileSync(join(migrations,'meta/_journal.json'),'utf8'));journal.entries=journal.entries.slice(0,prefixCount)
    mkdirSync(join(prefix,'meta'));writeFileSync(join(prefix,'meta/_journal.json'),JSON.stringify(journal))
    for(const entry of journal.entries)copyFileSync(join(migrations,entry.tag+'.sql'),join(prefix,entry.tag+'.sql'))
    await migrate(drizzle(f.admin),{migrationsFolder:prefix});await configure(f.admin)
    const before=await fingerprint(f.admin)
    await f.admin.query('ALTER TABLE financial_balance_projections DISABLE TRIGGER USER')
    await f.admin.query('UPDATE financial_balance_projections SET posted=posted+1 WHERE account_id=$1',[context.cash.a])
    await f.admin.query('ALTER TABLE financial_balance_projections ENABLE TRIGGER USER')
    await assert.rejects(migrate(drizzle(f.admin),{migrationsFolder:migrations}), e=>/projection differs/.test(e.cause?.message||e.message))
    assert.equal((await f.admin.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n,prefixCount)
    assert.equal((await f.admin.query('SELECT to_regclass($1) AS name',[prefixCount===14?'public.position_token_verifications':'public.trading_orders'])).rows[0].name,null)
    await f.admin.query('ALTER TABLE financial_balance_projections DISABLE TRIGGER USER')
    await f.admin.query('UPDATE financial_balance_projections SET posted=posted-1 WHERE account_id=$1',[context.cash.a])
    await f.admin.query('ALTER TABLE financial_balance_projections ENABLE TRIGGER USER')
    assert.equal(await fingerprint(f.admin),before)
    await migrate(drizzle(f.admin),{migrationsFolder:migrations});await configure(f.admin)
    assert.equal(await fingerprint(f.admin),before)
    assert.equal((await context.positions.reconcile(sys)).reconciled,true)
   }finally{rmSync(prefix,{recursive:true,force:true})}
  })
  let badFixture,badContext
  await t.test('inconsistent committed projection rejects migration without repair or history registration',async()=>{
   const f=await make('khmerfp_incremental_invalid_test');badFixture=f;const {admin,ledger,fixture}=f;const cash=await fixture()
   // Deliberate corruption of an OLD disposable fixture only. Never used for performance tests.
   await admin.query('ALTER TABLE financial_balance_projections DISABLE TRIGGER financial_balance_projections_audit')
   await admin.query('UPDATE financial_balance_projections SET posted=posted+1 WHERE account_id=$1',[cash.a])
   await admin.query('ALTER TABLE financial_balance_projections ENABLE TRIGGER financial_balance_projections_audit')
   await assert.rejects(ledger.reconcile(sys),/projection differs/)
   const before=await fingerprint(admin)
   await assert.rejects(migrate(drizzle(admin),{migrationsFolder:migrations}),e=>/projection differs/.test(e.cause?.message||e.message))
   assert.equal(await fingerprint(admin),before)
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n,12)
   assert.equal((await admin.query("SELECT to_regclass('public.financial_audit_deltas') AS name")).rows[0].name,null)
  })
  await t.test('inconsistent legacy position history also rejects adoption',async()=>{
   const f=badFixture
   await f.ledger.rebuild(sys,key())
   badContext=await createPositionFixture({...f,sys,key})
   const {admin}=f
   await admin.query('ALTER TABLE position_balance_projections DISABLE TRIGGER position_balance_projections_audit')
   await admin.query('UPDATE position_balance_projections SET posted=posted+1000000 WHERE account_id=$1',[badContext.a.buyer])
   await admin.query('ALTER TABLE position_balance_projections ENABLE TRIGGER position_balance_projections_audit')
   const before=await fingerprint(admin)
   await assert.rejects(migrate(drizzle(admin),{migrationsFolder:migrations}),e=>/position projection differs/.test(e.cause?.message||e.message))
   assert.equal(await fingerprint(admin),before)
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n,12)
  })
  await t.test('inconsistent legacy reservation counters reject adoption without repair',async()=>{
   const {admin,ledger}=badFixture
   await badContext.positions.rebuild(sys,key())
   const r=await ledger.reserve(badContext.cash.actor,key(),{accountId:badContext.cash.a,amount:600n,reference:key()})
   await admin.query('ALTER TABLE cash_reservations DISABLE TRIGGER cash_reservations_audit')
   await admin.query('UPDATE cash_reservations SET consumed=1 WHERE id=$1',[r.reservationId])
   await admin.query('ALTER TABLE cash_reservations ENABLE TRIGGER cash_reservations_audit')
   const before=await fingerprint(admin)
   await assert.rejects(migrate(drizzle(admin),{migrationsFolder:migrations}),e=>/reservation differs from immutable event history/.test(e.cause?.message||e.message))
   assert.equal(await fingerprint(admin),before)
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n,12)
  })
 }finally{
  for(const pool of pools.reverse())await pool.end()
  await parent.end()
  assert.match(relative(tmpdir(),temporary),/^khmerfp-incremental-adoption-[^\/]+$/)
  rmSync(temporary,{recursive:true,force:true})
 }
})
