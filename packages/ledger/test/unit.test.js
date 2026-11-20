import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLedger, createPositionLedger, createTradingService, quantity, money, MAX_BIGINT } from '../src/index.js'

test('registry migration preserves every existing accounting statement except canonical token-to-market joins', async () => {
 const {readFileSync}=await import('node:fs')
 const {sqlTokens}=await import('../../db/scripts/sqlReadability.js')
 const old=readFileSync(new URL('../../db/migrations/0011_position_accounting.sql',import.meta.url),'utf8')
 const next=readFileSync(new URL('../../db/migrations/0013_generalized_market_registry.sql',import.meta.url),'utf8')
 for(const name of ['position_validate','position_execute']){
  const before=old.match(new RegExp('CREATE FUNCTION public\\.'+name+'\\([^]*?\\$\\$;'))[0]
  const after=next.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([^]*?\\$\\$;'))[0]
  const expected=before.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('FROM public.ctf_position_tokens t JOIN public.market_outcomes o ON o.id=t.market_outcome_id WHERE t.id=','FROM public.ctf_position_tokens t JOIN public.ctf_conditions c ON c.id=t.condition_id JOIN public.market_questions o ON o.id=c.market_question_id WHERE t.id=')
  assert.deepEqual(sqlTokens(after),sqlTokens(expected),name)
 }
})
test('amounts reject Number, floats, negatives, zero and bigint overflow', () => {
  for (const amount of [1,1.5,Number.MAX_SAFE_INTEGER,'100',0n,-1n,MAX_BIGINT+1n]) assert.throws(()=>money(amount))
  assert.equal(money(9007199254740993n),'9007199254740993')
  assert.equal(money(MAX_BIGINT),MAX_BIGINT.toString())
})
test('production, missing opt-in and missing authorizer fail closed',()=>{
  for(const args of [{environment:'production',enabled:true},{environment:'staging',enabled:true},{environment:'test',enabled:false},{environment:'test',enabled:true}]) assert.throws(()=>createLedger(args))
})
test('authorization denial and unsafe amounts never acquire a database client',async()=>{
  const pool={connect(){throw new Error('must not connect')}}
  const denied=createLedger({pool,enabled:true,environment:'test',authorize:()=>false})
  await assert.rejects(denied.reserve('user:1','key',{amount:1n}),/not authorized/)
  const allowed=createLedger({pool,enabled:true,environment:'test',authorize:()=>true})
  await assert.rejects(allowed.reserve('user:1','key',{amount:1}),TypeError)
})
test('failed commit rolls back and releases the same dedicated connection',async()=>{
 const calls=[]
 const client={async query(sql){calls.push(sql);if(sql==='COMMIT')throw new Error('deferred balance check');return {rows:[{result:{},elevated:false,schema_create:false,direct_write:false,function_owner:false,unsafe_definer:false}]}},release(){calls.push('release')}}
 const ledger=createLedger({pool:{async connect(){return client}},enabled:true,environment:'test',authorize:()=>true})
 await assert.rejects(ledger.reserve('user:1','key',{amount:1n}),/deferred/)
 assert.ok(calls.includes('BEGIN'));assert.deepEqual(calls.slice(-2),['ROLLBACK','release'])
})

test('Drizzle schemas match the migration 0019 snapshot without drift', async()=>{
 const {generateDrizzleJson}=await import('drizzle-kit/api')
 const schema=await import('../../db/src/schema/index.js')
 const {readFileSync}=await import('node:fs')
 const snapshot=JSON.parse(readFileSync(new URL('../../db/migrations/meta/0019_snapshot.json',import.meta.url),'utf8'))
 const actual=generateDrizzleJson(schema,snapshot.prevId)
 assert.deepEqual(JSON.parse(JSON.stringify(actual.tables)),snapshot.tables)
})

test('an explicit test argument cannot override a production process',()=>{
 const previous=process.env.NODE_ENV
 try {process.env.NODE_ENV='production';assert.throws(()=>createLedger({enabled:true,environment:'test',authorize:()=>true}))}
 finally {if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous}
})

test('migration or directly privileged database credentials are rejected',async()=>{
 let executed=false,released=false
 const client={async query(sql){if(sql.includes('AS elevated'))return {rows:[{elevated:true,schema_create:false,direct_write:false,function_owner:false,unsafe_definer:false}]};if(sql.startsWith('SELECT public.financial_execute'))executed=true;return {rows:[]}},release(){released=true}}
 const ledger=createLedger({pool:{async connect(){return client}},enabled:true,environment:'test',authorize:()=>true})
 await assert.rejects(ledger.balance('system:test','1'),/restricted runtime role/)
 assert.equal(executed,false);assert.equal(released,true)
})

test('authorization and posting use the same immutable snapshot of caller terms',async()=>{
 let unblock,captured
 const wait=new Promise(resolve=>{unblock=resolve})
 const terms={accountId:'1',amount:10n,reference:'snapshot'}
 const client={async query(sql,params){if(sql.includes('AS elevated'))return {rows:[{elevated:false,schema_create:false,direct_write:false,function_owner:false,unsafe_definer:false}]};if(sql.startsWith('SELECT public.financial_execute'))captured=JSON.parse(params[3]);return {rows:[{result:{}}]}},release(){}}
 const ledger=createLedger({pool:{async connect(){return client}},enabled:true,environment:'test',authorize:async request=>{assert.equal(request.terms.accountId,'1');await wait;request.terms.accountId='3';return true}})
 const pending=ledger.reserve('user:1','snapshot',terms)
 terms.accountId='2';unblock();await pending
 assert.equal(captured.accountId,'1');assert.equal(captured.amount,'10')
})

test('actor objects cannot change identity between validation, authorization and SQL',async()=>{
 let authorized=false
 const ledger=createLedger({pool:{connect(){throw new Error('must not connect')}},enabled:true,environment:'test',authorize:()=>{authorized=true;return true}})
 await assert.rejects(ledger.balance({toString:()=> 'user:1',toPostgres:()=> 'system:other'},'1'),TypeError)
 assert.equal(authorized,false)
})
test('a failed rollback destroys the connection instead of returning it to the pool',async()=>{
 const rollbackError=new Error('rollback connection failure');let released
 const client={async query(sql){if(sql==='ROLLBACK')throw rollbackError;if(sql.includes('AS elevated'))return {rows:[{elevated:false,schema_create:false,direct_write:false,function_owner:false,unsafe_definer:false}]};if(sql.startsWith('SELECT public.financial_execute'))throw new Error('original failure');return {rows:[]}},release(error){released=error}}
 const ledger=createLedger({pool:{async connect(){return client}},enabled:true,environment:'test',authorize:()=>true})
 await assert.rejects(ledger.balance('user:1','1'),/original failure/)
 assert.equal(released,rollbackError)
})

test('required PostgreSQL summary rejects skips, failures and missing tests',async()=>{
 const {assertRequiredDatabaseTests}=await import('./requiredTests.js')
 const good='# tests 3\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n'
 assert.doesNotThrow(()=>assertRequiredDatabaseTests(good))
 for(const bad of ['',good.replace('# skipped 0','# skipped 1'),good.replace('# pass 3','# pass 2'),good.replace('# cancelled 0','# cancelled 1')])assert.throws(()=>assertRequiredDatabaseTests(bad))
})

test('unsafe SECURITY DEFINER ownership fails closed before ledger execution',async()=>{
 let executed=false
 const client={async query(sql){if(sql.includes('AS elevated'))return {rows:[{elevated:false,schema_create:false,direct_write:false,function_owner:false,unsafe_definer:true}]};if(sql.startsWith('SELECT public.financial_execute'))executed=true;return {rows:[]}},release(){}}
 const ledger=createLedger({pool:{async connect(){return client}},enabled:true,environment:'test',authorize:()=>true})
 await assert.rejects(ledger.balance('system:test','1'),/restricted runtime role/)
 assert.equal(executed,false)
})

test('required database mode fails rather than silently skipping absent PostgreSQL',async()=>{
 const {spawnSync}=await import('node:child_process')
 const {fileURLToPath}=await import('node:url')
 const env={...process.env,NODE_ENV:'test',LEDGER_REQUIRE_POSTGRES:'true'};delete env.LEDGER_DISPOSABLE_TARGET;delete env.NODE_TEST_CONTEXT
 const result=spawnSync(process.execPath,['--test',fileURLToPath(new URL('./integration.test.js',import.meta.url))],{env,encoding:'utf8',timeout:15000})
 assert.notEqual(result.status,0)
 assert.match(result.stdout+result.stderr,/Required disposable PostgreSQL configuration is missing/)
})


test('position base units require exact whole-share BigInts within BIGINT',()=>{
 for(const q of [1,1.5,'1000000',0n,-1000000n,1n,MAX_BIGINT+1n])assert.throws(()=>quantity(q))
 assert.equal(quantity(9223372036854000000n),'9223372036854000000')
})

test('position service authorizes canonical quantities and rejects unsafe settlement prices before connection',async()=>{
 const pool={connect(){throw new Error('must not connect')}}
 const positions=createPositionLedger({pool,environment:'test',enabled:true,authorize:()=>false})
 await assert.rejects(positions.settle('system:settlement','key',{quantity:1000000n,priceCents:60n}),/not authorized/)
 await assert.rejects(positions.settle('system:settlement','key',{quantity:1000000n,priceCents:0.6}),/BIGINT/)
 await assert.rejects(positions.reserve('user:1','key',{quantity:1n}),/whole-share/)
 assert.throws(()=>createPositionLedger({pool,enabled:true,environment:'production',authorize:()=>true}))
})


test('settlement authorization snapshots both immutable business references before async approval',async()=>{
 let approve,captured
 const wait=new Promise(resolve=>{approve=resolve})
 const terms={quantity:1000000n,priceCents:60n,cashReservationReference:'approved-buy',positionReservationReference:'approved-sell'}
 const client={async query(sql,params){if(sql.includes('AS elevated'))return {rows:[{elevated:false,schema_create:false,direct_write:false,function_owner:false,unsafe_definer:false}]};if(sql.startsWith('SELECT public.financial_execute'))captured=JSON.parse(params[3]);return {rows:[{result:{}}]}},release(){}}
 const positions=createPositionLedger({pool:{async connect(){return client}},enabled:true,environment:'test',authorize:async request=>{assert.equal(request.terms.cashReservationReference,'approved-buy');await wait;request.terms.positionReservationReference='changed-by-authorizer';return true}})
 const pending=positions.settle('system:settlement','approved-match',terms)
 terms.cashReservationReference='changed-by-caller';approve();await pending
 assert.equal(captured.cashReservationReference,'approved-buy');assert.equal(captured.positionReservationReference,'approved-sell')
 assert.equal(captured.quantity,'1000000');assert.equal(captured.priceCents,'60')
})


test('trading terms remain immutable through asynchronous authorization',async()=>{
 let resume,captured
 const ready=new Promise(resolve=>{resume=resolve})
 const client={async query(sql,args){if(sql.includes('AS elevated'))return {rows:[{elevated:false,schema_create:false,direct_write:false,function_owner:false,unsafe_definer:false}]};if(sql.startsWith('SELECT public.trading_execute'))captured=JSON.parse(args[3]);return {rows:[{result:{orderId:'1'}}]}},release(){}}
 const service=createTradingService({pool:{async connect(){return client}},enabled:true,environment:'test',authorize:async request=>{await ready;request.terms.tokenId='replacement';return true}})
 const terms={marketId:'fixture',tokenId:'7',side:'BUY',quantity:1000000n,priceCents:65n,cashAccountId:'1',positionAccountId:'2'}
 const pending=service.place('user:1','immutable-trading',terms);terms.tokenId='changed';resume();await pending
 assert.equal(captured.tokenId,'7');assert.equal(captured.quantity,'1000000')
 await assert.rejects(service.place('user:1','unsafe-trading',{...terms,quantity:1}),/whole-share/)
})

test('known commit rejection differs from an uncertain network outcome',async()=>{
 for(const code of ['23514','P0001','ECONNRESET','57P01','08006','40003']){
  const failure=Object.assign(new Error('commit fixture'),{code});let discarded
  const client={async query(sql){if(sql==='COMMIT')throw failure;if(sql.includes('AS elevated'))return {rows:[{elevated:false,schema_create:false,direct_write:false,function_owner:false,unsafe_definer:false}]};return {rows:[{result:{}}]}},release(error){discarded=error}}
  const service=createTradingService({pool:{async connect(){return client}},enabled:true,environment:'test',authorize:()=>true})
  await assert.rejects(service.recover('user:1','commit-fixture'),e=>e.commitOutcome===(['23514','P0001'].includes(code)?'ROLLED_BACK':'UNKNOWN'))
  assert.equal(discarded,['23514','P0001'].includes(code)?undefined:failure)
 }
})


test('matching worker requires an explicit abort signal and valid bounded configuration', async()=>{
 const {runMatchingWorker}=await import('../src/matchingWorker.js')
 await assert.rejects(runMatchingWorker({actor:'system:test'}),/configuration/)
 const controller=new AbortController();controller.abort()
 let called=false
 await runMatchingWorker({service:{pending:async()=>{called=true}},actor:'system:test',signal:controller.signal})
 assert.equal(called,false)
})
test('matching worker retries durable discovery without logging raw errors',async()=>{
 const {runMatchingWorker}=await import('../src/matchingWorker.js')
 const c=new AbortController(),errors=[]
 await runMatchingWorker({service:{pending:async()=>{c.abort();throw new Error('sensitive request text')}},actor:'system:test',signal:c.signal,onError:e=>errors.push(e)})
 assert.deepEqual(errors,[{code:'MATCH_DISCOVERY_FAILED'}])
})
test('deadlock retries preserve actor, operation key and immutable terms with fresh authorization',async()=>{
 let attempts=0,authorizations=0
 const calls=[]
 const pool={connect:async()=>({release(){},query:async(sql,args)=>{
  if(sql.includes('AS result')){calls.push(args);if(attempts++===0){const e=new Error('deadlock');e.code='40P01';throw e}return {rows:[{result:{ok:true}}]}}
  return {rows:[{elevated:false,schema_create:false,direct_write:false,function_owner:false,unsafe_definer:false}]}
 }})}
 const service=createTradingService({pool,enabled:true,environment:'test',authorize:()=>{authorizations++;return true}})
 assert.deepEqual(await service.place('user:1','same-key',{quantity:1000000n,priceCents:60n}),{ok:true})
 assert.equal(authorizations,2);assert.deepEqual(calls[0],calls[1])
})


test('market spending caps reject unsafe Number values before acquiring a client',async()=>{
 const service=createTradingService({pool:{connect(){throw new Error('must not connect')}},enabled:true,environment:'test',authorize:()=>true})
 await assert.rejects(service.placeMarket('user:1','cap',{quantity:1000000n,priceCents:65n,maxSpendCents:65}),/BIGINT/)
})
test('quote estimation uses a read-only repeatable-read transaction without accounting entry points',async()=>{
 const {createQuoteService}=await import('../src/index.js'),calls=[]
 const client={release(){},async query(sql){calls.push(sql);return {rows:[{result:{indicative:true},elevated:false,schema_create:false,direct_write:false,function_owner:false,unsafe_definer:false}]}}}
 const service=createQuoteService({pool:{connect:async()=>client},enabled:true,environment:'test',authorize:()=>true})
 assert.deepEqual(await service.estimate('user:1',{quantity:1000000n,priceCents:65n,maxSpendCents:65n}),{indicative:true})
 assert.equal(calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
 assert.ok(calls.some(sql=>sql.startsWith('SELECT public.matching_quote')))
 assert.ok(!calls.some(sql=>sql.includes('SELECT public.financial_execute')||sql.includes('SELECT public.trading_execute')))
})

test('lifecycle recovery status uses a read-only transaction and never reexecutes a financial command', async () => {
 const {createLifecycleService}=await import('../src/index.js'),calls=[]
 const client={release(){},async query(sql,args){calls.push({sql,args});return {rows:[{result:{state:'QUEUED'},elevated:false,schema_create:false,direct_write:false,function_owner:false,unsafe_definer:false}]}}}
 const service=createLifecycleService({pool:{connect:async()=>client},enabled:true,environment:'test',authorize:()=>true})
 assert.deepEqual(await service.status('user:1','original-command'),{state:'QUEUED'})
 assert.equal(calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
 assert.deepEqual(calls.find(c=>c.sql.includes('public.matching_status')).args,['user:1','original-command'])
 assert.ok(!calls.some(c=>c.sql.includes('SELECT public.financial_execute')||c.sql.includes('SELECT public.trading_execute')))
})

test('expiration and recovery workers require explicit safe configuration', async () => {
 const {runExpirationWorker,runRecoveryWorker,runOutboxWorker}=await import('../src/lifecycleWorker.js')
 assert.throws(()=>runExpirationWorker({}),/configuration/)
 assert.throws(()=>runRecoveryWorker({lifecycle:{},matching:{},batchSize:101n}),/configuration/)
 await assert.rejects(runOutboxWorker({}),/configuration/)
})

test('recovery workers use persisted discovery and abort without leaking raw errors', async () => {
 const {runRecoveryWorker}=await import('../src/lifecycleWorker.js'),controller=new AbortController(),errors=[]
 await runRecoveryWorker({lifecycle:{},matching:{pending:async()=>{controller.abort();throw new Error('credential-bearing error')}},actor:'system:test',signal:controller.signal,onError:e=>errors.push(e)})
 assert.deepEqual(errors,[{code:'MATCH_DISCOVERY_FAILED'}])
})

test('operation diagnostics expose action and sanitized code without actor, credentials or raw error', async () => {
 const events=[]
 const service=createTradingService({pool:{connect:async()=>{throw new Error('password and SQL must not escape into logging')}},enabled:true,environment:'test',authorize:()=>true,onDiagnostic:e=>events.push(e)})
 await assert.rejects(service.cancel('user:1','private-operation','1'))
 assert.deepEqual(events,[{event:'OPERATION_FAILED',action:'CANCEL',code:'DATABASE_OPERATION_FAILED',commitOutcome:undefined}])
})

test('round registry derivation reuses exact canonical CTF masks and independent question identities',async()=>{
 const {deriveRoundRegistry}=await import('../src/marketScheduler.js')
 const plan={templateId:'fixture',ordinal:'0',ctfQuestionId:'0x'+'1'.repeat(64),registry:{oracleAddress:'0x'+'1'.repeat(40),collateralAddress:'0x'+'2'.repeat(40)},definition:{outcomes:[{label:'YES'},{label:'NO'}]}}
 const a=deriveRoundRegistry(plan),b=deriveRoundRegistry({...plan,ordinal:'1',ctfQuestionId:'0x'+'2'.repeat(64)})
 assert.deepEqual(a.tokens.map(t=>t.mask),['1','2']);assert.notEqual(a.conditionId,b.conditionId)
 assert.equal(new Set([...a.tokens,...b.tokens].map(t=>t.positionId)).size,4)
 const categorical=deriveRoundRegistry({...plan,definition:{outcomes:[{}, {}, {}]}})
 assert.deepEqual(categorical.tokens.map(t=>t.mask),['1','6','2','5','4','3'])
})

test('market creation performs CTF derivation between database calls and preserves the authoritative plan',async()=>{
 const {marketFacade}=await import('../src/marketScheduler.js'),calls=[]
 const plan={state:'READY',templateId:'fixture',ordinal:'7',ctfQuestionId:'0x'+'3'.repeat(64),registry:{oracleAddress:'0x'+'1'.repeat(40),collateralAddress:'0x'+'2'.repeat(40)},definition:{outcomes:[{},{}]}}
 const service=marketFacade(async(actor,action,key,terms)=>{calls.push({actor,action,key,terms});return action==='PLAN'?plan:{created:true}})
 assert.deepEqual(await service.createNext('system:test','fixture'),{created:true})
 assert.deepEqual(calls.map(c=>c.action),['PLAN','CREATE_ROUND']);assert.equal(calls[1].terms.ordinal,'7');assert.equal(calls[1].terms.ctfQuestionId,plan.ctfQuestionId)
 assert.equal(calls[1].terms.tokens.length,2)
})

test('market scheduler requires explicit local worker configuration',async()=>{
 const {runMarketSchedulerWorker}=await import('../src/marketScheduler.js')
 await assert.rejects(runMarketSchedulerWorker({}),/configuration/)
})
