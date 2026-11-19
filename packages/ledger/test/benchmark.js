// Real controlled operations only: no trigger disabling, bulk seeding or fake history.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createLedger } from '../src/index.js'
assert.equal(process.env.NODE_ENV,'test')
const config=JSON.parse(process.env.LEDGER_DISPOSABLE_TARGET || 'null')
assert.equal(config?.host,'127.0.0.1');assert.equal(config.database,'khmerfp_ledger_test')
const inspected=spawnSync('docker',['inspect',process.env.LEDGER_CONTAINER_ID],{encoding:'utf8',timeout:10000})
assert.equal(inspected.status,0)
const meta=JSON.parse(inspected.stdout)[0]
assert.equal(meta.Config.Labels['khmerfp.disposable'],'ledger');assert.equal(meta.Config.Image,'postgres:16')
assert.equal(meta.NetworkSettings.Ports['5432/tcp'][0].HostIp,'127.0.0.1')
assert.equal(meta.NetworkSettings.Ports['5432/tcp'][0].HostPort,String(config.port))
const admin=new pg.Pool({...config,connectionTimeoutMillis:4000,statement_timeout:15000})
let runtime,observer
const report={kind:'financial-ledger-targeted-audits',measuredAt:new Date().toISOString(),node:process.version,platform:process.platform,phases:[],architectureChanged:false,integrityChecksDisabled:false}
const baselinePath=join(tmpdir(),'khmerfp-ledger-benchmark-baseline.json')
const priorPath=join(tmpdir(),'khmerfp-ledger-benchmark.json')
if(!existsSync(baselinePath)&&existsSync(priorPath))copyFileSync(priorPath,baselinePath)
if(existsSync(baselinePath))report.baseline=JSON.parse(readFileSync(baselinePath,'utf8')).phases
const reportPath=join(tmpdir(),'khmerfp-ledger-benchmark-optimized.json')
const summaries=[]
function summarize(name,times,elapsed,errors,extra={}){
 const sorted=[...times].sort((a,b)=>a-b)
 const row={name,completed:times.length,errors,elapsedSeconds:+(elapsed/1000).toFixed(3),averageMs:times.length?+(times.reduce((a,b)=>a+b,0)/times.length).toFixed(3):null,p50Ms:times.length?+sorted[Math.ceil(sorted.length*.5)-1].toFixed(3):null,p99Ms:times.length?+sorted[Math.ceil(sorted.length*.99)-1].toFixed(3):null,p95Ms:times.length?+sorted[Math.ceil(sorted.length*.95)-1].toFixed(3):null,throughputPerSecond:+(times.length/(elapsed/1000)).toFixed(3),...extra}
 report.phases.push(row);console.log(JSON.stringify(row));summaries.push(row);return row
}
try{
 const state=(await admin.query("SELECT current_database() AS db,current_setting('server_version_num')::int AS version,version() AS details")).rows[0]
 assert.equal(state.db,'khmerfp_ledger_test');assert.equal(Math.floor(state.version/10000),16)
 assert.equal((await admin.query("SELECT 1 FROM pg_tables WHERE schemaname='public'")).rowCount,0)
 report.postgres=state.details
 await admin.query("ALTER DATABASE khmerfp_ledger_test SET track_functions='all'")
 await migrate(drizzle(admin),{migrationsFolder:fileURLToPath(new URL('../../db/migrations/',import.meta.url))})
 await admin.query('CREATE ROLE ledger_bench_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT')
 const password=randomBytes(24).toString('hex')
 await admin.query("CREATE ROLE ledger_bench_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '"+password+"'")
 const tables=['financial_assets','financial_accounts','financial_operations','financial_journals','financial_journal_entries','financial_balance_projections','cash_reservations','cash_reservation_events','financial_audit_targets','position_accounts','position_journals','position_journal_entries','position_balance_projections','position_reservations','position_reservation_events','cash_position_settlements']
 await admin.query('GRANT USAGE ON SCHEMA public TO ledger_bench_owner,ledger_bench_runtime')
 for(const table of tables)await admin.query('ALTER TABLE public.'+table+' OWNER TO ledger_bench_owner')
 for(const fn of ['financial_immutable()','financial_guard()','financial_audit()','financial_execute(text,text,text,jsonb)','financial_schedule_audit()','financial_validate_target()','financial_reconcile(text)','financial_cash_execute(text,text,text,jsonb)','position_execute(text,text,text,jsonb)','position_guard()','position_validate(text,bigint)'])await admin.query('ALTER FUNCTION public.'+fn+' OWNER TO ledger_bench_owner')
 await admin.query('GRANT EXECUTE ON FUNCTION public.financial_execute(text,text,text,jsonb),public.financial_reconcile(text) TO ledger_bench_runtime')
 await admin.query('GRANT SELECT ON public.ctf_position_tokens,public.chain_assets,public.ctf_conditions,public.market_outcomes,public.market_questions,public.markets TO ledger_bench_owner')
 await admin.query('GRANT UPDATE(id) ON public.markets TO ledger_bench_owner')
 runtime=new pg.Pool({...config,user:'ledger_bench_runtime',password,max:8,connectionTimeoutMillis:4000})
 observer=new pg.Pool({...config,max:1,connectionTimeoutMillis:4000,statement_timeout:3000})
 const ledger=createLedger({pool:runtime,enabled:true,environment:'test',authorize:()=>true})
 const sys='system:benchmark',accounts=[]
 let serial=0,posts=0
 const key=()=> 'benchmark:'+serial++
 for(let n=0;n<8;n++){
  const user=(await admin.query("INSERT INTO users(email,display_name) VALUES($1,'Benchmark') RETURNING id",['benchmark-'+n+'@example.test'])).rows[0].id
  const customer=(await ledger.createAccount(sys,key(),{asset:'USD',ownerUserId:user,accountKey:'customer-'+n,kind:'CUSTOMER',normalSide:'CREDIT'})).accountId
  const cash=(await ledger.createAccount(sys,key(),{asset:'USD',ownerUserId:null,accountKey:'cash-'+n,kind:'ASSET',normalSide:'DEBIT'})).accountId
  accounts.push({customer,cash,actor:'user:'+user})
 }
 const reconcile=async label=>{
   const result=await ledger.reconcile(sys);assert.equal(result.consistent,true)
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM financial_audit_targets')).rows[0].n,0)
   report.reconciliations??=[];report.reconciliations.push({label,...result})
   return result
 }
 const post=async n=>{const a=accounts[n%accounts.length],k=key();await ledger.post(sys,k,[{accountId:a.cash,asset:'USD',side:'DEBIT',amount:1n},{accountId:a.customer,asset:'USD',side:'CREDIT',amount:1n}],k);posts++}
 for(const target of [1000,10000,100000]){
  if(target===100000&&report.phases.at(-1)?.reachedTarget!==true){report.phases.push({name:'sequential-100000',executed:false,reason:'10,000-operation stage exceeded its measured time budget'});break}
  const start=performance.now(),times=[],errors=[]
  const budget=target===1000?120000:180000
  while(posts<target){
   if(performance.now()-start>budget)break
   const begin=performance.now()
   try{await post(posts);times.push(performance.now()-begin)}catch(e){errors.push({code:e.code||e.name});break}
   if(posts%250===0)console.log(JSON.stringify({progress:posts,lastTransactionMs:+times.at(-1).toFixed(2)}))
  }
  summarize('sequential-'+target,times,performance.now()-start,errors,{target,totalPostings:posts,reachedTarget:posts===target,budgetSeconds:budget/1000,last100AverageMs:times.length?+(times.slice(-100).reduce((a,b)=>a+b,0)/Math.min(100,times.length)).toFixed(3):null})
  await reconcile('sequential-'+target)
  if(posts<target&&target===1000){report.phases.push({name:'sequential-10000',executed:false,reason:'1,000-operation stage exceeded its time budget'});report.phases.push({name:'sequential-100000',executed:false,reason:'smaller stage did not complete'});break}
 }
 async function concurrent(name,operation,operationsPerWorkflow=1){
  const start=performance.now(),times=[],errors=[];let done=false,samples=0,lockSamples=0,maxWaiters=0
  const beforeDeadlocks=Number((await admin.query('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).rows[0].deadlocks)
  const observe=(async()=>{while(!done){const row=(await observer.query("SELECT count(*) FILTER (WHERE wait_event_type='Lock')::int AS waiters FROM pg_stat_activity WHERE datname=current_database() AND usename='ledger_bench_runtime'")).rows[0];samples++;if(row.waiters>0)lockSamples++;maxWaiters=Math.max(maxWaiters,row.waiters);await new Promise(r=>setTimeout(r,25))}})()
  const timed=async work=>{const begin=performance.now();try{const result=await work();times.push(performance.now()-begin);return result}catch(e){errors.push({code:e.code||e.name});throw e}}
  await Promise.all(Array.from({length:8},(_,worker)=>(async()=>{for(let n=0;n<5;n++){try{await operation(worker,n,timed)}catch{/* record and reconcile any failed workflow; never auto-replay */}}})()))
  done=true;await observe
  await admin.query('SELECT pg_stat_clear_snapshot()')
  const afterDeadlocks=Number((await admin.query('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).rows[0].deadlocks)
  summarize(name,times,performance.now()-start,errors,{workers:8,attempted:40*operationsPerWorkflow,lockSamples,samples,maxWaiters,deadlocks:afterDeadlocks-beforeDeadlocks,lockSamplePercent:samples?+(100*lockSamples/samples).toFixed(2):0})
  await reconcile(name)
 }
 await concurrent('independent-customer-postings',(worker,_n,timed)=>timed(()=>post(worker)))
 await concurrent('same-customer-reservations',(_worker,_n,timed)=>timed(()=>ledger.reserve(accounts[0].actor,key(),{accountId:accounts[0].customer,amount:1n,reference:key()})))
 await concurrent('mixed-cash-operations',async(worker,_n,timed)=>{
   const source=accounts[worker],target=accounts[(worker+1)%accounts.length]
   await timed(()=>post(worker))
   const r=await timed(()=>ledger.reserve(source.actor,key(),{accountId:source.customer,amount:2n,reference:key()}))
   await timed(()=>ledger.consume(sys,key(),{reservationId:r.reservationId,targetAccountId:target.customer,amount:1n}))
   await timed(()=>ledger.release(source.actor,key(),{reservationId:r.reservationId,amount:1n}))
 },4)
 await ledger.rebuild(sys,key());await reconcile('after-projection-reconstruction')
 const queries={targetedJournal:"SELECT asset,sum(CASE side WHEN 'DEBIT' THEN amount::numeric ELSE -amount::numeric END) FROM financial_journal_entries WHERE journal_id=(SELECT max(id) FROM financial_journals) GROUP BY asset",targetedAccount:"SELECT sum(CASE WHEN side='CREDIT' THEN amount::numeric ELSE -amount::numeric END) FROM financial_journal_entries WHERE account_id="+accounts[0].customer,journalBalance:"SELECT journal_id,asset,sum(CASE side WHEN 'DEBIT' THEN amount::numeric ELSE -amount::numeric END) FROM financial_journal_entries GROUP BY journal_id,asset",projection:"SELECT a.id,p.posted FROM financial_accounts a JOIN financial_balance_projections p ON p.account_id=a.id WHERE p.posted::numeric <> COALESCE((SELECT sum(CASE WHEN e.side=a.normal_side THEN e.amount::numeric ELSE -e.amount::numeric END) FROM financial_journal_entries e WHERE e.account_id=a.id),0)"}
 report.plans={}
 for(const [name,sql]of Object.entries(queries)){const plan=(await admin.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql)).rows[0]['QUERY PLAN'][0];report.plans[name]=plan;console.log(JSON.stringify({plan:name,executionMs:plan['Execution Time'],root:plan.Plan['Node Type'],rows:plan.Plan['Actual Rows']}))}
 await admin.query('SELECT pg_stat_clear_snapshot()')
 report.functionStatistics=(await admin.query("SELECT funcname,calls,total_time,self_time FROM pg_stat_user_functions WHERE funcname LIKE 'financial_%' ORDER BY funcname")).rows
 report.deadlocks=(await admin.query('SELECT deadlocks::text FROM pg_stat_database WHERE datname=current_database()')).rows[0].deadlocks
 report.history=(await admin.query('SELECT (SELECT count(*) FROM financial_operations)::text AS operations,(SELECT count(*) FROM financial_journals)::text AS journals,(SELECT count(*) FROM financial_journal_entries)::text AS entries')).rows[0]
 const sums=(await admin.query("SELECT sum(p.posted) FILTER(WHERE a.kind='CUSTOMER')::text AS customer,sum(p.posted) FILTER(WHERE a.kind='ASSET')::text AS treasury FROM financial_balance_projections p JOIN financial_accounts a ON a.id=p.account_id")).rows[0]
 assert.equal(sums.customer,String(posts));assert.equal(sums.treasury,String(posts))
 const first=report.phases.find(p=>p.name==='sequential-1000'),ten=report.phases.find(p=>p.name==='sequential-10000')
 report.acceptance={tenThousandPostings:ten?.reachedTarget===true,totalSeconds:+((first?.elapsedSeconds||0)+(ten?.elapsedSeconds||0)).toFixed(3),within180Seconds:ten?.reachedTarget===true&&(first.elapsedSeconds+ten.elapsedSeconds)<=180,noErrors:report.phases.every(p=>!p.errors?.length),noDeadlocks:report.deadlocks==='0'}
 console.log(JSON.stringify({acceptance:report.acceptance}))
 if(!Object.values(report.acceptance).every(value=>typeof value==='number'||value===true))process.exitCode=1
 report.integrityAfterBenchmark={fullReconciliationPassed:true,balanced:true,customerTotal:sums.customer,treasuryTotal:sums.treasury}
}finally{
 await observer?.end();await runtime?.end();await admin.end()
 writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n')
 console.log('Public synthetic benchmark evidence: '+reportPath)
}
