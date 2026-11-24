import {seedCapabilityAdoptionHistory} from './capabilityHistoryFixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {provisionCapabilityRoles} from './capabilityRoles.js';
import {startTradingProcess,stopTradingProcess} from '../../../server/src/trading/processLauncher.js';
const configured=Boolean(process.env.LEDGER_DISPOSABLE_TARGET);
if(process.env.LEDGER_REQUIRE_POSTGRES==='true'&&!configured)throw new Error('Required capability database missing.');
const folder=fileURLToPath(new URL('../../db/migrations/',import.meta.url));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('capability separation fresh and populated migration adoption',{skip:!configured},async t=>{
 const config=JSON.parse(process.env.LEDGER_DISPOSABLE_TARGET);
 assert.equal(process.env.NODE_ENV,'test');assert.equal(config.host,'127.0.0.1');assert.equal(config.database,'khmerfp_ledger_test');
 const meta=JSON.parse(spawnSync('docker',['inspect',process.env.LEDGER_CONTAINER_ID],{encoding:'utf8'}).stdout)[0];
 assert.equal(meta.Config.Labels['khmerfp.disposable'],'ledger');assert.equal(meta.Config.Image,'postgres:16');assert.equal(meta.NetworkSettings.Ports['5432/tcp'][0].HostPort,String(config.port));
 const parent=new pg.Pool(config);
 try{for(const populated of [false,true])await t.test(populated?'populated history and partial reservation adoption':'fresh migration and role enforcement',async()=>{
  const database='khmerfp_capability_test_'+randomBytes(4).toString('hex');
  await parent.query('CREATE DATABASE '+database);
  const admin=new pg.Pool({...config,database});let roles;
  const temp=mkdtempSync(join(tmpdir(),'khmerfp-capability-prefix-'));
  try{
   mkdirSync(join(temp,'meta'));const journal=JSON.parse(readFileSync(join(folder,'meta/_journal.json'),'utf8'));
   for(const e of journal.entries.filter(e=>e.idx<20))copyFileSync(join(folder,e.tag+'.sql'),join(temp,e.tag+'.sql'));
   writeFileSync(join(temp,'meta/_journal.json'),JSON.stringify({...journal,entries:journal.entries.filter(e=>e.idx<20)}));
   await migrate(drizzle(admin),{migrationsFolder:temp});
   const users=(await admin.query("INSERT INTO users(email,display_name) VALUES($1,'A'),($2,'B') RETURNING id",[randomUUID()+'@example.test',randomUUID()+'@example.test'])).rows;
   const sessions=[];
   for(const user of users){const hash=randomBytes(32).toString('hex');sessions.push(hash);await admin.query("INSERT INTO sessions(token_hash,user_id,idle_expires_at,expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",[hash,user.id]);}
   async function cash(action,terms,actor='system:fixture'){return (await admin.query('SELECT public.financial_execute($1,$2,$3,$4::jsonb) AS result',[actor,action,randomUUID(),JSON.stringify(terms)])).rows[0].result;}
   if(populated){
    const accounts=[];
    for(const [owner,kind,normalSide] of [[null,'ASSET','DEBIT'],[users[0].id,'CUSTOMER','CREDIT'],[users[1].id,'CUSTOMER','CREDIT']])accounts.push((await cash('ACCOUNT',{asset:'USD',ownerUserId:owner,accountKey:randomUUID(),kind,normalSide})).accountId);
    await cash('POST',{entries:[{accountId:accounts[0],asset:'USD',side:'DEBIT',amount:'10000'},{accountId:accounts[1],asset:'USD',side:'CREDIT',amount:'10000'}],reference:randomUUID()});
    const hold=await cash('RESERVE',{accountId:accounts[1],amount:'1000',reference:randomUUID()},'user:'+users[0].id);
    await cash('CONSUME',{reservationId:hold.reservationId,amount:'100',targetAccountId:accounts[2]});
    await cash('RELEASE',{reservationId:hold.reservationId,amount:'200'},'user:'+users[0].id);
   }
   const history=populated?await seedCapabilityAdoptionHistory(admin,{...config,database}):null;
   if(history)for(const key of ['capability-adoption','capability-reconciliation']) {
    await assert.rejects(admin.query("SELECT public.trading_execute('system:migration','RECONCILE',$1,'{}')",[key]),error=>error.code==='42501');
   }
   const state=async()=> (await admin.query(`SELECT jsonb_build_object('accounts',(SELECT jsonb_agg(t ORDER BY id) FROM financial_accounts t),'operations',(SELECT jsonb_agg(t ORDER BY id) FROM financial_operations t),'journals',(SELECT jsonb_agg(t ORDER BY id) FROM financial_journals t),'entries',(SELECT jsonb_agg(t ORDER BY id) FROM financial_journal_entries t),'balances',(SELECT jsonb_agg(t ORDER BY account_id) FROM financial_balance_projections t),'reservations',(SELECT jsonb_agg(t ORDER BY id) FROM cash_reservations t),'events',(SELECT jsonb_agg(t ORDER BY id) FROM cash_reservation_events t),'positions',(SELECT jsonb_agg(t ORDER BY account_id) FROM position_balance_projections t),'positionJournals',(SELECT jsonb_agg(t ORDER BY id) FROM position_journals t),'positionEntries',(SELECT jsonb_agg(t ORDER BY id) FROM position_journal_entries t),'positionReservations',(SELECT jsonb_agg(t ORDER BY id) FROM position_reservations t),'positionEvents',(SELECT jsonb_agg(t ORDER BY id) FROM position_reservation_events t),'orders',(SELECT jsonb_agg(t ORDER BY id) FROM trading_orders t),'fills',(SELECT jsonb_agg(t ORDER BY id) FROM trading_fills t),'settlements',(SELECT jsonb_agg(t ORDER BY id) FROM cash_position_settlements t)) AS state`)).rows[0].state;
   const legacyRole='legacy_columns_'+randomBytes(4).toString('hex');
   await admin.query('CREATE ROLE '+legacyRole+' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE');
   await admin.query('GRANT SELECT(posted),UPDATE(reserved) ON financial_balance_projections TO '+legacyRole);
   await admin.query('GRANT SELECT(posted) ON financial_balance_projections TO PUBLIC');
   const before=digest(await state());
   if(populated){
    const account=(await admin.query('SELECT account_id,posted::text FROM financial_balance_projections ORDER BY account_id LIMIT 1')).rows[0];
    const tamper=async posted=>{const client=await admin.connect();try{await client.query('BEGIN');await client.query('ALTER TABLE financial_balance_projections DISABLE TRIGGER USER');await client.query('UPDATE financial_balance_projections SET posted=$1 WHERE account_id=$2',[posted,account.account_id]);await client.query('ALTER TABLE financial_balance_projections ENABLE TRIGGER USER');await client.query('COMMIT')}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}};
    await tamper(String(BigInt(account.posted)+1n));const corrupted=digest(await state());
    await assert.rejects(migrate(drizzle(admin),{migrationsFolder:folder}));
    assert.equal(digest(await state()),corrupted,'migration must not repair inconsistent history');
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n,20);
    await tamper(account.posted);assert.equal(digest(await state()),before);
   }
   await migrate(drizzle(admin),{migrationsFolder:folder}).catch(error=>{throw new Error(error.cause?.message||error.message)});assert.equal(digest(await state()),before);
   await migrate(drizzle(admin),{migrationsFolder:folder}).catch(error=>{throw new Error(error.cause?.message||error.message)});assert.equal(digest(await state()),before);
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n,21);
   assert.equal((await admin.query("SELECT has_column_privilege($1,'public.financial_balance_projections','posted','SELECT') OR has_column_privilege($1,'public.financial_balance_projections','reserved','UPDATE') AS allowed",[legacyRole])).rows[0].allowed,false);
   roles=await provisionCapabilityRoles(admin,{...config,database},'negative');
   const denied=async(pool,sql,args=[])=>assert.rejects(pool.query(sql,args),e=>e.code==='42501');
   const expectedFunctions={http:['http_order','http_quote','http_status','private_read','public_read'],matching:['matching'],scheduler:['scheduler'],admin:['market_admin'],reconcile:['reconcile'],read:['public_read'],funding:[]};
   for(const [kind,pool] of Object.entries(roles.pools)){
    const available=(await pool.query("SELECT proname FROM pg_proc WHERE pronamespace='custodial_api'::regnamespace AND has_function_privilege(current_user,oid,'EXECUTE') ORDER BY proname")).rows.map(r=>r.proname);
    assert.deepEqual(available,expectedFunctions[kind].slice().sort());
    const rawCapabilities=(await pool.query("SELECT p.oid::regprocedure::text AS signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'financial_%' OR p.proname LIKE 'position_%' OR p.proname LIKE 'trading_%' OR p.proname LIKE 'matching_%' OR p.proname LIKE 'market_schedule_%') AND has_function_privilege(current_user,p.oid,'EXECUTE')")).rows;
    assert.deepEqual(rawCapabilities,[],kind+' must not execute any raw financial, settlement, matching or scheduler function');
    await denied(pool,"SELECT public.position_execute('system:forged','SETTLE','forged','{}')");
    await denied(pool,"SELECT public.financial_execute('system:forged','POST','forged','{}')");
    await denied(pool,"SELECT public.trading_execute('system:forged','FILL','forged','{}')");
    await denied(pool,"SELECT public.market_schedule_execute('system:forged','CREATE_TEMPLATE','{}')");
    await denied(pool,'UPDATE financial_balance_projections SET posted=posted+1');
    await denied(pool,'DELETE FROM financial_audit_deltas');
    await denied(pool,'SET ROLE kf_migration');await denied(pool,'SET ROLE kf_core_owner');await denied(pool,'SET ROLE kf_api_owner');
    await denied(pool,'CREATE TABLE public.forbidden(id int)');
   }
   await denied(roles.pools.http,"SELECT custodial_api.http_order($1,'POST','forged','{}')",[sessions[0]]);
   await denied(roles.pools.http,'SELECT custodial_api.session_user_id($1)',[sessions[0]]);
   if(history)await denied(roles.pools.http,"SELECT custodial_api.http_order($1,'CANCEL','foreign-cancel',$2)",[sessions[0],JSON.stringify({orderId:history.orderId})]);
   await denied(roles.pools.http,'SELECT custodial_api.reconcile()');
   await denied(roles.pools.http,"SELECT custodial_api.http_order($1,'RECONCILE','forged','{}')",[sessions[0]]);
   if(history){
    const hash=randomBytes(32).toString('hex');
    await admin.query("INSERT INTO sessions(token_hash,user_id,idle_expires_at,expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",[hash,history.buyerUserId]);
    const replay=(key,terms=history.requestTerms,session=hash)=>roles.pools.http.query("SELECT custodial_api.http_order($1,'PLACE',$2,$3::jsonb) AS result",[session,key,JSON.stringify(terms)]);
    for(const entry of history.preemptions){
     const results=await Promise.all([replay(entry.key),replay(entry.key)]);
     for(const result of results)assert.deepEqual(result.rows[0].result,entry.result);
     await assert.rejects(replay(entry.key,{...history.requestTerms,priceCents:'2'}),error=>error.code==='P0001'&&/conflict/i.test(error.message));
     await denied(roles.pools.http,"SELECT custodial_api.http_order($1,'PLACE',$2,$3::jsonb)",[sessions[0],entry.key,JSON.stringify(history.requestTerms)]);
    }
    await denied(roles.pools.http,"SELECT custodial_api.http_order($1,'PLACE',$2,$3::jsonb)",[hash,'system:reconcile:'+randomUUID(),JSON.stringify(history.requestTerms)]);
    assert.equal(digest(await state()),before,'replays and rejected collisions must not mutate financial history');
   }
   const boundaries=(await admin.query("SELECT f.proname,f.prosecdef,f.proconfig,r.rolcanlogin,r.rolsuper,r.rolcreaterole,r.rolbypassrls FROM pg_proc f JOIN pg_roles r ON r.oid=f.proowner WHERE f.pronamespace='custodial_api'::regnamespace")).rows;
   assert.equal(boundaries.length,10);
   for(const f of boundaries){assert.equal(f.prosecdef,true);assert.ok(f.proconfig.includes('search_path=pg_catalog'));assert.equal(f.rolcanlogin,false);assert.equal(f.rolsuper,false);assert.equal(f.rolcreaterole,false);assert.equal(f.rolbypassrls,false);}
   await denied(roles.pools.http,"SELECT custodial_api.http_order($1,'FILL','forged','{}')",[sessions[0]]);
   await denied(roles.pools.http,"SELECT custodial_api.matching('STEP','{}')");
   await denied(roles.pools.http,"SELECT custodial_api.market_admin('PAUSE','{}')");
   await denied(roles.pools.http,'SET ROLE kf_trading_http');
   await denied(roles.pools.http,'SET SESSION AUTHORIZATION kf_core_owner');
   await denied(roles.pools.http,'GRANT kf_market_admin TO '+roles.names.http);
   await denied(roles.pools.http,"SELECT custodial_api.scheduler('CREATE_ROUND','{}')");
   await denied(roles.pools.matching,"SELECT custodial_api.scheduler('DISCOVER','{}')");
   await denied(roles.pools.scheduler,"SELECT custodial_api.matching('PENDING','{}')");
   await denied(roles.pools.scheduler,"SELECT custodial_api.scheduler('OBSERVE','{}')");
   await denied(roles.pools.admin,"SELECT custodial_api.market_admin('OBSERVE','{}')");
   await denied(roles.pools.read,"SELECT custodial_api.private_read($1,'READ_8','[]')",[sessions[0]]);
   await denied(roles.pools.http,'SELECT * FROM sessions');await denied(roles.pools.read,'SELECT * FROM trading_orders');
   await assert.rejects(roles.pools.http.query("SELECT custodial_api.private_read($1,'READ_8','[]')",['0'.repeat(64)]),e=>e.code==='28000');
   const own=(await roles.pools.http.query("SELECT custodial_api.private_read($1,'READ_8',$2) AS result",[sessions[0],JSON.stringify([users[1].id])])).rows[0].result;
   const expected=(await admin.query("SELECT id::text FROM financial_accounts WHERE owner_user_id=$1 AND kind='CUSTOMER' AND asset='USD'",[users[0].id])).rows;
   assert.deepEqual(own,expected);
   await admin.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[sessions[0]]);
   await assert.rejects(roles.pools.http.query("SELECT custodial_api.private_read($1,'READ_8','[]')",[sessions[0]]),e=>e.code==='28000');
   await admin.query("UPDATE sessions SET idle_expires_at=now()-interval '1 second' WHERE token_hash=$1",[sessions[1]]);
   await assert.rejects(roles.pools.http.query("SELECT custodial_api.private_read($1,'READ_8','[]')",[sessions[1]]),e=>e.code==='28000');
   for(const result of await Promise.all(Array.from({length:4},()=>roles.pools.reconcile.query('SELECT custodial_api.reconcile() AS result'))))assert.equal(result.rows[0].result.reconciled,true);
   assert.equal(digest(await state()),before);
   assert.equal((await admin.query('SELECT (SELECT count(*) FROM financial_audit_targets)+(SELECT count(*) FROM financial_audit_deltas) AS n')).rows[0].n,'0');
   const authName='cap_auth_'+randomBytes(4).toString('hex'),authPassword=randomBytes(24).toString('hex');
   await admin.query(`CREATE ROLE ${authName} LOGIN PASSWORD '${authPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
   await admin.query(`GRANT SELECT ON public.users,public.sessions TO ${authName}`);
   await admin.query(`GRANT UPDATE(last_seen_at,idle_expires_at) ON public.sessions TO ${authName}`);
   const authUrl=new URL(roles.urls.http);authUrl.username=authName;authUrl.password=authPassword;
   const http=await startTradingProcess('http',{...process.env,NODE_ENV:'test',CUSTODIAL_TRADING_LOCAL:'true',CUSTODIAL_TRADING_DISPOSABLE:'true',DATABASE_URL:authUrl.href,TRADING_RUNTIME_DATABASE_URL:roles.urls.http,TRADING_READ_DATABASE_URL:roles.urls.read,PORT:'0'});
   try{assert.equal((await fetch('http://127.0.0.1:'+http.ready.port+'/api/trading/markets')).status,200);}finally{await stopTradingProcess(http);}
   // Real child processes use distinct role credentials and recover durable empty queues.
   const env={...process.env,NODE_ENV:'test',CUSTODIAL_TRADING_LOCAL:'true',CUSTODIAL_TRADING_DISPOSABLE:'true',TRADING_MATCHING_DATABASE_URL:roles.urls.matching,TRADING_SCHEDULER_DATABASE_URL:roles.urls.scheduler};
   for(const mode of ['matching','scheduler']){const child=await startTradingProcess(mode,env);assert.ok(child.pid);await stopTradingProcess(child);}
  }finally{await roles?.close();await admin.end();if(resolve(temp).startsWith(resolve(tmpdir())+String.fromCharCode(92))||resolve(temp).startsWith(resolve(tmpdir())+'/'))rmSync(temp,{recursive:true,force:true});}
 });}finally{await parent.end();}
});
