import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLedger, money, MAX_BIGINT } from '../src/index.js'
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

test('Drizzle schemas match the migration 0010 snapshot without drift', async()=>{
 const {generateDrizzleJson}=await import('drizzle-kit/api')
 const schema=await import('../../db/src/schema/index.js')
 const {readFileSync}=await import('node:fs')
 const snapshot=JSON.parse(readFileSync(new URL('../../db/migrations/meta/0010_snapshot.json',import.meta.url),'utf8'))
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
