import { runMarketRegistryCases } from './marketRegistryCases.js'
import { runPositionCases } from './positionCases.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createLedger, MAX_BIGINT } from '../src/index.js'
const configured=Boolean(process.env.LEDGER_DISPOSABLE_TARGET)
if(process.env.LEDGER_REQUIRE_POSTGRES==='true'&&!configured)throw new Error('Required disposable PostgreSQL configuration is missing')
test('PostgreSQL 16 isolated ledger integration', {skip:!configured}, async t=>{
 const config=JSON.parse(process.env.LEDGER_DISPOSABLE_TARGET)
 assert.equal(process.env.NODE_ENV,'test');assert.equal(config.host,'127.0.0.1');assert.equal(config.database,'khmerfp_ledger_test')
 const inspect=spawnSync('docker',['inspect',process.env.LEDGER_CONTAINER_ID],{encoding:'utf8',timeout:10000})
 assert.equal(inspect.status,0)
 const meta=JSON.parse(inspect.stdout)[0];assert.equal(meta.Config.Labels['khmerfp.disposable'],'ledger');assert.equal(meta.NetworkSettings.Ports['5432/tcp'][0].HostPort,String(config.port))
 const admin=new pg.Pool({...config,connectionTimeoutMillis:4000,statement_timeout:15000})
 let runtime
 try{
  const state=(await admin.query("SELECT current_database() AS db,current_setting('server_version_num')::int AS version")).rows[0]
  assert.equal(state.db,'khmerfp_ledger_test');assert.equal(Math.floor(state.version/10000),16)
  assert.equal((await admin.query("SELECT 1 FROM pg_tables WHERE schemaname='public'")).rowCount,0)
  const folder=fileURLToPath(new URL('../../db/migrations/',import.meta.url))
  try{await migrate(drizzle(admin),{migrationsFolder:folder})}catch(error){console.error('Migration cause:',error.cause?.message,error.cause?.position);throw error}
  const journal=JSON.parse(readFileSync(folder+'meta/_journal.json','utf8')).entries
  const history=await admin.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at')
  assert.equal(history.rowCount,16)
  for(let i=0;i<16;i++){const raw=readFileSync(folder+journal[i].tag+'.sql','utf8');assert.equal(history.rows[i].hash,createHash('sha256').update(raw).digest('hex'));assert.equal(history.rows[i].created_at,String(journal[i].when))}
  const tables=['financial_assets','financial_accounts','financial_operations','financial_journals','financial_journal_entries','financial_balance_projections','cash_reservations','cash_reservation_events','financial_audit_targets','financial_audit_deltas','position_accounts','position_journals','position_journal_entries','position_balance_projections','position_reservations','position_reservation_events','cash_position_settlements','trading_books','trading_commands','trading_orders','trading_fills','trading_order_events','trading_outbox']
  await admin.query('CREATE ROLE ledger_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT')
  const runtimePassword=randomBytes(18).toString('hex')
  await admin.query("CREATE ROLE ledger_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '"+runtimePassword+"'")
  await admin.query('GRANT USAGE ON SCHEMA public TO ledger_owner,ledger_runtime')
  for(const table of tables)await admin.query('ALTER TABLE public.'+table+' OWNER TO ledger_owner')
  for(const signature of ['financial_immutable()','financial_guard()','financial_audit()','financial_execute(text,text,text,jsonb)','financial_schedule_audit()','financial_validate_target()','financial_reconcile(text)','financial_cash_execute(text,text,text,jsonb)','position_execute(text,text,text,jsonb)','position_guard()','position_validate(text,bigint)','financial_protect_delta()','financial_protect_target()','financial_capture_baseline()','financial_accumulate_delta()','financial_queue_audit(text,bigint)','financial_validate_delta(text,bigint,bigint)','financial_delta_link_check()','trading_guard()','trading_validate_order(bigint)','trading_validate_command(uuid)','trading_audit()','trading_emit(uuid,bigint,text,smallint)','trading_execute(text,text,text,jsonb)'])await admin.query('ALTER FUNCTION public.'+signature+' OWNER TO ledger_owner')
  await admin.query('GRANT EXECUTE ON FUNCTION public.financial_execute(text,text,text,jsonb),public.financial_reconcile(text),public.trading_execute(text,text,text,jsonb) TO ledger_runtime')
  await admin.query('GRANT SELECT ON public.position_token_verifications,public.market_outcome_tokens,public.chains,public.contract_deployments,public.ctf_position_tokens,public.chain_assets,public.ctf_conditions,public.market_outcomes,public.market_questions,public.markets TO ledger_owner')
  await admin.query('GRANT UPDATE(id) ON public.markets TO ledger_owner')
  runtime=new pg.Pool({...config,user:'ledger_runtime',password:runtimePassword,max:12,connectionTimeoutMillis:4000})
  const ledger=createLedger({pool:runtime,enabled:true,environment:'test',authorize:()=>true})
  const sys='system:tests'
  let seq=0
  const key=()=>randomUUID()
  async function fixture(amount=10000n){
   const users=await admin.query("INSERT INTO users(email,display_name) VALUES($1,'Alice'),($2,'Bob') RETURNING id",[key()+'@example.test',key()+'@example.test'])
   const ids=users.rows.map(r=>r.id)
   const a=(await ledger.createAccount(sys,key(),{asset:'USD',ownerUserId:ids[0],accountKey:key(),kind:'CUSTOMER',normalSide:'CREDIT'})).accountId
   const b=(await ledger.createAccount(sys,key(),{asset:'USD',ownerUserId:ids[1],accountKey:key(),kind:'CUSTOMER',normalSide:'CREDIT'})).accountId
   const cash=(await ledger.createAccount(sys,key(),{asset:'USD',ownerUserId:null,accountKey:key(),kind:'ASSET',normalSide:'DEBIT'})).accountId
   const entries=n=>[{accountId:cash,asset:'USD',side:'DEBIT',amount:n},{accountId:a,asset:'USD',side:'CREDIT',amount:n}]
   const deposit=await ledger.post(sys,key(),entries(amount),'mock-deposit-'+key())
   return {a,b,cash,actor:'user:'+ids[0],other:'user:'+ids[1],entries,deposit}
  }
  const reserve=(f,n=1000n)=>ledger.reserve(f.actor,key(),{accountId:f.a,amount:n,reference:'test-'+seq++})
  const counts=async()=> (await admin.query('SELECT (SELECT count(*) FROM financial_operations)::text AS operations,(SELECT count(*) FROM financial_journals)::text AS journals,(SELECT count(*) FROM cash_reservation_events)::text AS events')).rows[0]
  async function ownerTx(work){const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE ledger_owner');await work(c);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
  await t.test('runtime cannot bypass posting, history or projection protections',async()=>{
   for(const table of tables)await assert.rejects(runtime.query('DELETE FROM public.'+table),e=>e.code==='42501')
   await assert.rejects(runtime.query('CREATE TABLE public.ledger_bypass(id int)'),e=>e.code==='42501')
   await assert.rejects(runtime.query('SET ROLE ledger_owner'),e=>e.code==='42501')
  })
  await t.test('balanced deposit and exact USD available balance',async()=>{const f=await fixture();assert.deepEqual(await ledger.balance(f.actor,f.a),{accountId:f.a,posted:'10000',reserved:'0',available:'10000'})})
  await t.test('unbalanced journal rejected at commit with complete rollback',async()=>{const f=await fixture();const before=await counts();const e=f.entries(100n);e[1].amount=99n;await assert.rejects(ledger.post(sys,key(),e,'bad'),/balanced/);assert.deepEqual(await counts(),before)})
  await t.test('identical and conflicting simultaneous idempotency keys',async()=>{const f=await fixture();const k=key();const results=await Promise.all([ledger.post(sys,k,f.entries(10n),'same'),ledger.post(sys,k,f.entries(10n),'same')]);assert.deepEqual(results[0],results[1]);assert.equal((await ledger.balance(f.actor,f.a)).posted,'10010');const k2=key();const settled=await Promise.allSettled([ledger.post(sys,k2,f.entries(10n),'a'),ledger.post(sys,k2,f.entries(20n),'b')]);assert.equal(settled.filter(s=>s.status==='fulfilled').length,1)})
  await t.test('duplicate business deposit reference is rejected even with another key', async()=>{const f=await fixture();const ref=key();await ledger.post(sys,key(),f.entries(1n),ref);await assert.rejects(ledger.post(sys,key(),f.entries(1n),ref),e=>e.code==='23505');assert.equal((await ledger.balance(f.actor,f.a)).posted,'10001')})
  await t.test('operation key cannot disclose result across actors or types',async()=>{const f=await fixture();const k=key();await ledger.reserve(f.actor,k,{accountId:f.a,amount:100n,reference:key()});await assert.rejects(ledger.reserve(f.other,k,{accountId:f.a,amount:100n,reference:key()}),/idempotency conflict/);await assert.rejects(ledger.post(sys,k,f.entries(100n),'different'),/idempotency conflict/)})
  await t.test('insufficient funds and concurrent over-reservation fail atomically',async()=>{const f=await fixture(100n);const s=await Promise.allSettled([reserve(f,75n),reserve(f,75n)]);assert.equal(s.filter(r=>r.status==='fulfilled').length,1);assert.equal((await ledger.balance(f.actor,f.a)).available,'25');await assert.rejects(reserve(f,26n),/insufficient/)})
  await t.test('partial consumption, partial release and cancellation preserve history',async()=>{const f=await fixture();const r=await reserve(f,1000n);await ledger.consume(sys,key(),{reservationId:r.reservationId,targetAccountId:f.b,amount:300n});await ledger.release(f.actor,key(),{reservationId:r.reservationId,amount:200n});assert.equal((await ledger.balance(f.actor,f.a)).reserved,'500');await ledger.cancel(f.actor,key(),r.reservationId);assert.equal((await ledger.balance(f.actor,f.a)).posted,'9700');assert.equal((await ledger.balance(f.actor,f.a)).reserved,'0');assert.equal((await ledger.balance(f.other,f.b)).posted,'300')})
  await t.test('full consumption, duplicate retry and excess consumption',async()=>{const f=await fixture();const r=await reserve(f,100n);const k=key(),terms={reservationId:r.reservationId,targetAccountId:f.b,amount:100n};assert.deepEqual(await ledger.consume(sys,k,terms),await ledger.consume(sys,k,terms));await assert.rejects(ledger.consume(sys,key(),terms),/closed/);assert.equal((await ledger.balance(f.other,f.b)).posted,'100')})
  await t.test('concurrent consumption, release and cancellation cannot spend twice',async()=>{const f=await fixture();const r=await reserve(f,100n);const s=await Promise.allSettled([ledger.consume(sys,key(),{reservationId:r.reservationId,targetAccountId:f.b,amount:100n}),ledger.release(f.actor,key(),{reservationId:r.reservationId,amount:100n}),ledger.cancel(f.actor,key(),r.reservationId)]);assert.equal(s.filter(x=>x.status==='fulfilled').length,1);assert.equal((await ledger.balance(f.actor,f.a)).reserved,'0')})
  await t.test('cross-user balance, reserve, release, cancellation and direct postings rejected',async()=>{const f=await fixture();const r=await reserve(f);for(const request of [()=>ledger.balance(f.other,f.a),()=>ledger.reserve(f.other,key(),{accountId:f.a,amount:1n,reference:key()}),()=>ledger.release(f.other,key(),{reservationId:r.reservationId,amount:1n}),()=>ledger.cancel(f.other,key(),r.reservationId),()=>ledger.consume(f.actor,key(),{reservationId:r.reservationId,targetAccountId:f.b,amount:1n}),()=>ledger.post(f.actor,key(),f.entries(1n),'bad')])await assert.rejects(request(),e=>e.code==='42501')})
  await t.test('failed consumption restores reservation, events and balances',async()=>{const f=await fixture();const r=await reserve(f,100n);const before=await counts();await assert.rejects(ledger.consume(sys,key(),{reservationId:r.reservationId,targetAccountId:f.cash,amount:50n}),/target/);assert.deepEqual(await counts(),before);assert.equal((await ledger.balance(f.actor,f.a)).reserved,'100')})
  await t.test('full reversal exactly compensates original; duplicate rejected',async()=>{const f=await fixture();await ledger.reverse(sys,key(),f.deposit.journalId);assert.equal((await ledger.balance(f.actor,f.a)).posted,'0');await assert.rejects(ledger.reverse(sys,key(),f.deposit.journalId));const q=await admin.query("SELECT sum(CASE side WHEN 'DEBIT' THEN amount::numeric ELSE -amount::numeric END)::text AS net FROM financial_journal_entries WHERE account_id=$1",[f.a]);assert.equal(q.rows[0].net,'0')})
  await t.test('reservation consumption reversal and negative-balance reversal rejected',async()=>{const f=await fixture();const r=await reserve(f,100n);const c=await ledger.consume(sys,key(),{reservationId:r.reservationId,targetAccountId:f.b,amount:100n});await assert.rejects(ledger.reverse(sys,key(),c.journalId),/ineligible/);await assert.rejects(ledger.reverse(sys,key(),f.deposit.journalId),/insufficient/);assert.equal((await ledger.balance(f.other,f.b)).posted,'100')})
  await t.test('posted journals and entries cannot be mutated or appended',async()=>{const f=await fixture();for(const sql of ["UPDATE financial_journals SET status='DRAFT' WHERE id="+f.deposit.journalId,'DELETE FROM financial_journal_entries WHERE journal_id='+f.deposit.journalId,"INSERT INTO financial_journal_entries(journal_id,account_id,asset,side,amount) VALUES("+f.deposit.journalId+','+f.a+",'USD','CREDIT',1)"])await assert.rejects(ownerTx(c=>c.query(sql)),/immutable|append/)})
  await t.test('reservation event mutation and projection bypass rejected even for owner',async()=>{const f=await fixture();await reserve(f);await assert.rejects(ownerTx(c=>c.query('UPDATE cash_reservation_events SET amount=1')),/immutable/);await assert.rejects(ownerTx(c=>c.query('UPDATE financial_balance_projections SET posted=posted+1 WHERE account_id=$1',[f.a])),/projection/)})
  await t.test('draft or directly unbalanced journals cannot commit',async()=>{const f=await fixture();await assert.rejects(ownerTx(async c=>{const op=(await c.query("INSERT INTO financial_operations(operation_key,actor,action,terms,request_hash,result) VALUES($1,'system:tests','POST','{}','invalid','{}') RETURNING id",[key()])).rows[0].id;await c.query('INSERT INTO financial_journals(operation_id) VALUES($1)',[op])}),/posted and balanced/);assert.equal((await ledger.balance(f.actor,f.a)).posted,'10000')})
  await t.test('asset mixing, disabled USDC and invalid account semantics rejected',async()=>{const f=await fixture();const e=f.entries(1n);e[1].asset='USDC';await assert.rejects(ledger.post(sys,key(),e,'bad'),/asset/);await assert.rejects(ledger.createAccount(sys,key(),{asset:'USDC',ownerUserId:null,accountKey:key(),kind:'ASSET',normalSide:'DEBIT'}),/USD/);await assert.rejects(ledger.createAccount(sys,key(),{asset:'USD',ownerUserId:null,accountKey:key(),kind:'CUSTOMER',normalSide:'DEBIT'}))})
  await t.test('large integers, BIGINT upper bound and overflow rollback',async()=>{const f=await fixture(MAX_BIGINT);assert.equal((await ledger.balance(f.actor,f.a)).posted,MAX_BIGINT.toString());await assert.rejects(ledger.post(sys,key(),f.entries(1n),'overflow'),e=>e.code==='22003');assert.equal((await ledger.balance(f.actor,f.a)).posted,MAX_BIGINT.toString());await assert.rejects(ledger.post(sys,key(),f.entries(MAX_BIGINT+1n),'overflow'),/BIGINT/)})
  await t.test('reconstruction after partial consumption/release and racing writer',async()=>{const f=await fixture();const r=await reserve(f,1000n);await ledger.consume(sys,key(),{reservationId:r.reservationId,targetAccountId:f.b,amount:300n});await ledger.release(f.actor,key(),{reservationId:r.reservationId,amount:200n});await Promise.all([ledger.rebuild(sys,key()),ledger.post(sys,key(),f.entries(7n),'race')]);assert.deepEqual(await ledger.balance(f.actor,f.a),{accountId:f.a,posted:'9707',reserved:'500',available:'9207'});await ownerTx(async c=>{await c.query('UPDATE financial_balance_projections SET posted=posted+1,reserved=reserved+1 WHERE account_id=$1',[f.a]);await c.query('SELECT financial_execute($1,$2,$3,$4)',[sys,'REBUILD',key(),'{}'])});assert.equal((await ledger.balance(f.actor,f.a)).reserved,'500')})
  await t.test('runtime connection recovers after repeated database failures',async()=>{const f=await fixture(1n);for(let i=0;i<3;i++)await assert.rejects(reserve(f,2n));await reserve(f,1n);assert.equal((await ledger.balance(f.actor,f.a)).available,'0')})
  await t.test('concurrent partial consumption and release preserve exact remaining funds',async()=>{
   const f=await fixture();const r=await reserve(f,1000n)
   await Promise.all([ledger.consume(sys,key(),{reservationId:r.reservationId,targetAccountId:f.b,amount:300n}),ledger.release(f.actor,key(),{reservationId:r.reservationId,amount:200n})])
   assert.equal((await ledger.balance(f.actor,f.a)).reserved,'500');assert.equal((await ledger.balance(f.other,f.b)).posted,'300')
  })
  await t.test('cross-user simultaneous key reuse never returns another actor result',async()=>{
   const f=await fixture();const k=key();const terms={accountId:f.a,amount:1n,reference:key()}
   const results=await Promise.allSettled([ledger.reserve(f.actor,k,terms),ledger.reserve(f.other,k,terms)])
   assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected')
  })
  await t.test('concurrent duplicate reversals have exactly one winner',async()=>{
   const f=await fixture();const results=await Promise.allSettled([ledger.reverse(sys,key(),f.deposit.journalId),ledger.reverse(sys,key(),f.deposit.journalId)])
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await ledger.balance(f.actor,f.a)).posted,'0')
  })
  await t.test('raw SQL rejects floating amounts and out-of-range integer strings',async()=>{
   const f=await fixture();for(const amount of [1,1.5,'1.5','9223372036854775808']) await assert.rejects(runtime.query('SELECT financial_execute($1,$2,$3,$4::jsonb)',[f.actor,'RESERVE',key(),JSON.stringify({accountId:f.a,amount,reference:key()})]))
  })
  await t.test('real migration credentials are refused by the service',async()=>{
   const unsafe=createLedger({pool:admin,enabled:true,environment:'test',authorize:()=>true})
   await assert.rejects(unsafe.balance(sys,'1'),/restricted runtime role/)
  })
  await t.test('non-customer signed BIGINT lower boundary and underflow rollback',async()=>{
   const account=async()=> (await ledger.createAccount(sys,key(),{asset:'USD',ownerUserId:null,accountKey:key(),kind:'ASSET',normalSide:'DEBIT'})).accountId
   const a=await account(),b=await account(),c=await account()
   const entries=(source,target,amount)=>[{accountId:source,asset:'USD',side:'DEBIT',amount},{accountId:target,asset:'USD',side:'CREDIT',amount}]
   await ledger.post(sys,key(),entries(a,b,MAX_BIGINT),key())
   await ledger.post(sys,key(),entries(c,b,1n),key())
   assert.equal((await ledger.balance(sys,b)).posted,'-9223372036854775808')
   const before=await counts()
   await assert.rejects(ledger.post(sys,key(),entries(c,b,1n),key()),e=>e.code==='22003')
   assert.deepEqual(await counts(),before)
   assert.equal((await ledger.balance(sys,c)).posted,'1')
  })
  await t.test('financial identity, function permissions and temp-schema shadowing remain protected',async()=>{
   const f=await fixture()
   for(const sql of ["UPDATE financial_accounts SET normal_side='DEBIT' WHERE id="+f.a,"UPDATE financial_accounts SET owner_user_id=NULL WHERE id="+f.a,"UPDATE financial_assets SET decimals=6 WHERE code='USD'","DELETE FROM cash_reservation_events"]){
     // DELETE on empty events would not fire a row trigger; fixtures above contain events.
     await assert.rejects(ownerTx(c=>c.query(sql)),/immutable/)
   }
   const functions=await admin.query("SELECT proname,proconfig,prosecdef,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute FROM pg_proc p WHERE pronamespace='public'::regnamespace AND (proname LIKE 'financial_%' OR proname IN ('position_execute','position_guard','position_validate'))")
   assert.equal(functions.rowCount,18)
   for(const fn of functions.rows){assert.ok(fn.proconfig.includes('search_path=pg_catalog'));assert.equal(fn.public_execute,false)}
   const client=await runtime.connect()
   try{await client.query('CREATE TEMP TABLE financial_balance_projections(account_id bigint,posted bigint,reserved bigint)');await client.query('INSERT INTO financial_balance_projections VALUES($1,999999,0)',[f.a]);const r=await client.query('SELECT public.financial_execute($1,$2,$3,$4)',[f.actor,'BALANCE',key(),JSON.stringify({accountId:f.a})]);assert.equal(r.rows[0].financial_execute.posted,'10000')}
   finally{await client.query('DROP TABLE IF EXISTS pg_temp.financial_balance_projections');client.release()}
  })
  await t.test('superuser-owned deferred audit is rejected until restricted ownership is restored',async()=>{
   const f=await fixture()
   try{await admin.query('ALTER FUNCTION public.financial_audit() OWNER TO postgres');await assert.rejects(ledger.balance(f.actor,f.a),/restricted runtime role/)}
   finally{await admin.query('ALTER FUNCTION public.financial_audit() OWNER TO ledger_owner')}
   assert.equal((await ledger.balance(f.actor,f.a)).posted,'10000')
  })
  await t.test('transaction-scoped audits deduplicate multi-journal and repeated-account changes',async()=>{
   const f=await fixture()
   await ownerTx(async c=>{
     for(let n=0;n<2;n++)await c.query('SELECT financial_execute($1,$2,$3,$4::jsonb)',[sys,'POST',key(),JSON.stringify({entries:f.entries(1n).map(e=>({...e,amount:e.amount.toString()})),reference:key()})])
     const targets=await c.query("SELECT target_kind,count(*)::int AS count FROM financial_audit_targets WHERE transaction_id=pg_current_xact_id()::text GROUP BY target_kind ORDER BY target_kind")
     assert.deepEqual(targets.rows,[{target_kind:'ACCOUNT',count:2},{target_kind:'JOURNAL',count:2},{target_kind:'OPERATION',count:2}])
     await c.query('UPDATE financial_balance_projections SET posted=posted+9 WHERE account_id=$1',[f.a])
     await c.query('UPDATE financial_balance_projections SET posted=posted-9 WHERE account_id=$1',[f.a])
   })
   assert.equal((await ledger.balance(f.actor,f.a)).posted,'10002')
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM financial_audit_targets')).rows[0].n,0)
   assert.equal((await ledger.reconcile(sys)).consistent,true)
  })
  await t.test('a later unbalanced journal rolls back all journals and target state',async()=>{
   const f=await fixture(),before=await counts()
   await assert.rejects(ownerTx(async c=>{
     for(const amount of ['1','2']){
       const entries=f.entries(1n).map(e=>({...e,amount:e.side==='DEBIT'?'1':amount}))
       await c.query('SELECT financial_execute($1,$2,$3,$4::jsonb)',[sys,'POST',key(),JSON.stringify({entries,reference:key()})])
     }
   }),/balanced/)
   assert.deepEqual(await counts(),before);assert.equal((await ledger.balance(f.actor,f.a)).posted,'10000')
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM financial_audit_targets')).rows[0].n,0)
  })
  await t.test('multiple reservation lifecycle events in one transaction reconcile exactly',async()=>{
   const f=await fixture(),r=await reserve(f,1000n)
   await ownerTx(async c=>{
     for(const [action,amount]of [['CONSUME','100'],['RELEASE','50'],['CONSUME','200']]){
       const terms={reservationId:r.reservationId,amount,...(action==='CONSUME'?{targetAccountId:f.b}:{})}
       await c.query('SELECT financial_execute($1,$2,$3,$4::jsonb)',[sys,action,key(),JSON.stringify(terms)])
     }
   })
   const balance=await ledger.balance(f.actor,f.a);assert.equal(balance.posted,'9700');assert.equal(balance.reserved,'650')
   assert.equal((await ledger.reconcile(sys)).consistent,true)
  })
  await t.test('runtime cannot forge, delete, read or truncate validation targets',async()=>{
   for(const sql of ["INSERT INTO financial_audit_targets VALUES('1','ACCOUNT',1)",'UPDATE financial_audit_targets SET target_id=1','DELETE FROM financial_audit_targets','TRUNCATE financial_audit_targets','SELECT * FROM financial_audit_targets',"SET session_replication_role='replica'"]){await assert.rejects(runtime.query(sql),e=>e.code==='42501')}
   const f=await fixture()
   await assert.rejects(ownerTx(async c=>{await c.query("SET LOCAL khmerfp.audit_done='true'");await c.query('UPDATE financial_balance_projections SET posted=posted+1 WHERE account_id=$1',[f.a])}),/projection/)
  })
  await t.test('rescheduled checks after an explicit constraint flush cannot be bypassed',async()=>{
   const f=await fixture()
   await assert.rejects(ownerTx(async c=>{
     await c.query('UPDATE financial_balance_projections SET posted=posted WHERE account_id=$1',[f.a])
     await c.query('SET CONSTRAINTS financial_target_commit_check IMMEDIATE')
     assert.equal((await c.query('SELECT count(*)::int AS n FROM financial_audit_targets')).rows[0].n,0)
     await c.query('SET CONSTRAINTS financial_target_commit_check DEFERRED')
     await c.query('UPDATE financial_balance_projections SET posted=posted+1 WHERE account_id=$1',[f.a])
   }),/projection/)
  })
  await t.test('direct event insertion without reservation update is detected at commit',async()=>{
   const f=await fixture(),r=await reserve(f)
   await assert.rejects(ownerTx(async c=>{
     const op=(await c.query("INSERT INTO financial_operations(operation_key,actor,action,terms,request_hash,result) VALUES($1,'system:tests','RELEASE','{}','fixture','{}') RETURNING id",[key()])).rows[0].id
     await c.query("INSERT INTO cash_reservation_events(reservation_id,operation_id,kind,amount) VALUES($1,$2,'RELEASE',1)",[r.reservationId,op])
   }),/missing pre-mutation reservation baseline/)
   assert.equal((await ledger.reconcile(sys)).consistent,true)
   await assert.rejects(ledger.reconcile(f.actor),e=>e.code==='42501')
  })
  await t.test('full reconciliation independently detects projection corruption before commit',async()=>{
   const f=await fixture()
   await assert.rejects(ownerTx(async c=>{
     await c.query('UPDATE financial_balance_projections SET posted=posted+1 WHERE account_id=$1',[f.a])
     await c.query('SELECT financial_reconcile($1)',[sys])
   }),/projection/)
   assert.equal((await ledger.reconcile(sys)).consistent,true)
  })
  await t.test('savepoint rollback preserves earlier target checks and discards rolled-back targets',async()=>{
   const f=await fixture()
   await ownerTx(async c=>{
     await c.query('UPDATE financial_balance_projections SET posted=posted WHERE account_id=$1',[f.a])
     await c.query('SAVEPOINT audit_rollback')
     await c.query('UPDATE financial_balance_projections SET posted=posted+2 WHERE account_id=$1',[f.a])
     await c.query('ROLLBACK TO SAVEPOINT audit_rollback');await c.query('RELEASE SAVEPOINT audit_rollback')
   })
   assert.equal((await ledger.balance(f.actor,f.a)).posted,'10000')
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM financial_audit_targets')).rows[0].n,0)
  })
  await t.test('runtime cannot attach audit SECURITY DEFINER helpers to caller-controlled tables',async()=>{
   const c=await runtime.connect()
   try{
     await c.query('CREATE TEMP TABLE fake_audit_source(id bigint)')
     for(const fn of ['financial_schedule_audit','financial_validate_target'])await assert.rejects(c.query('CREATE TRIGGER forged_audit AFTER INSERT ON fake_audit_source FOR EACH ROW EXECUTE FUNCTION public.'+fn+'()'),e=>e.code==='42501')
   }finally{await c.query('DROP TABLE IF EXISTS pg_temp.fake_audit_source');c.release()}
  })
  await t.test('opposite unbalanced journals cannot cancel each other at commit',async()=>{
   const f=await fixture(),before=await counts()
   await assert.rejects(ownerTx(async c=>{
     for(const [debit,credit]of [['1','2'],['2','1']]){
       const entries=f.entries(1n).map(e=>({...e,amount:e.side==='DEBIT'?debit:credit}))
       await c.query('SELECT financial_execute($1,$2,$3,$4::jsonb)',[sys,'POST',key(),JSON.stringify({entries,reference:key()})])
     }
   }),/balanced/)
   assert.deepEqual(await counts(),before)
  })
  await t.test('a balanced but inexact compensating journal is rejected',async()=>{
   const f=await fixture()
   await assert.rejects(ownerTx(async c=>{
     const op=(await c.query("INSERT INTO financial_operations(operation_key,actor,action,terms,request_hash,result) VALUES($1,'system:tests','REVERSE','{}','fixture','{}') RETURNING id",[key()])).rows[0].id
     const journal=(await c.query('INSERT INTO financial_journals(operation_id,reversal_of) VALUES($1,$2) RETURNING id',[op,f.deposit.journalId])).rows[0].id
     await c.query("INSERT INTO financial_journal_entries(journal_id,account_id,asset,side,amount) VALUES($1,$2,'USD','DEBIT',1),($1,$3,'USD','CREDIT',1)",[journal,f.a,f.cash])
     await c.query("UPDATE financial_journals SET status='POSTED' WHERE id=$1",[journal])
   }),/exactly compensate/)
   assert.equal((await ledger.balance(f.actor,f.a)).posted,'10000')
  })
  await t.test('audit targets cannot be attributed to a different transaction',async()=>{
   const f=await fixture()
   await assert.rejects(ownerTx(c=>c.query("INSERT INTO financial_audit_targets VALUES('0','ACCOUNT',$1)",[f.a])),/transaction mismatch/)
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM financial_audit_targets')).rows[0].n,0)
  })
  await t.test('runtime membership in any helper owner role is rejected before execution',async()=>{
   await admin.query('CREATE ROLE ledger_helper_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT')
   await admin.query('ALTER FUNCTION public.financial_cash_execute(text,text,text,jsonb) OWNER TO ledger_helper_owner')
   await admin.query('GRANT ledger_helper_owner TO ledger_runtime')
   try{await assert.rejects(ledger.balance(sys,'1'),/restricted runtime role/)}finally{
    await admin.query('REVOKE ledger_helper_owner FROM ledger_runtime')
    await admin.query('ALTER FUNCTION public.financial_cash_execute(text,text,text,jsonb) OWNER TO ledger_owner')
    await admin.query('DROP ROLE ledger_helper_owner')
   }
  })
  await runPositionCases(t,{admin,runtime,ledger,sys,key,fixture,ownerTx})
  await t.test('second migration run has unchanged history and catalog',async()=>{const fingerprint=async()=>JSON.stringify((await admin.query(`SELECT jsonb_build_object(
 'columns',(SELECT jsonb_agg(x ORDER BY relname,attnum) FROM (SELECT c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,pg_get_expr(d.adbin,d.adrelid) AS default_expr FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND NOT a.attisdropped) x),
 'constraints',(SELECT jsonb_agg(x ORDER BY conname) FROM (SELECT conname,pg_get_constraintdef(oid,true),condeferrable,condeferred FROM pg_constraint WHERE connamespace='public'::regnamespace) x),
 'indexes',(SELECT jsonb_agg(x ORDER BY indexname) FROM (SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public') x),
 'functions',(SELECT jsonb_agg(x ORDER BY proname) FROM (SELECT proname,pg_get_functiondef(oid),proacl,prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace) x),
 'triggers',(SELECT jsonb_agg(x ORDER BY tgrelid,tgname) FROM (SELECT tgrelid,tgname,tgenabled,pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)) x)
 ) AS state`)).rows[0].state);const before=await fingerprint();await migrate(drizzle(admin),{migrationsFolder:folder});assert.equal(await fingerprint(),before);assert.deepEqual((await admin.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at')).rows,history.rows)})
  await runMarketRegistryCases(t,{admin,runtime,ledger,sys,key,fixture,ownerTx})
  await t.test('checkpoint ends with complete financial reconciliation and no pending audit state',async()=>{
   const result=await ledger.reconcile(sys)
   assert.equal(result.consistent,true)
   assert.ok(BigInt(result.journals)>0n)
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM financial_audit_targets')).rows[0].n,0)
   assert.equal((await admin.query("SELECT count(*)::int AS n FROM financial_accounts a JOIN financial_balance_projections p ON p.account_id=a.id WHERE a.kind='CUSTOMER' AND (p.posted<0 OR p.reserved<0 OR p.reserved>p.posted)")).rows[0].n,0)
   assert.equal((await admin.query("SELECT asset FROM financial_journal_entries GROUP BY asset HAVING sum(CASE side WHEN 'DEBIT' THEN amount::numeric ELSE -amount::numeric END)<>0")).rowCount,0)
  })
 }finally{await runtime?.end();await admin.end()}
})
