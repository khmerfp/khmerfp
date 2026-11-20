// Own one fresh, labelled, loopback-only container. Never reuse a configured database URL.
import { spawnSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { assertRequiredDatabaseTests } from './requiredTests.js'
const name='khmerfp-ledger-'+randomBytes(6).toString('hex')
const password=randomBytes(24).toString('hex')
const docker=args=>{const r=spawnSync('docker',args,{encoding:'utf8',timeout:45000});if(r.status!==0)throw new Error('Disposable Docker operation failed: '+args[0]);return r.stdout.trim()}
if(['production','staging'].includes(process.env.NODE_ENV))throw new Error('Disposable tests refuse production/staging')
if(process.argv.includes('--benchmark-profile')&&!process.argv.includes('--benchmark-positions'))throw new Error('Profiling requires the explicit position benchmark')
const profilingArgs=process.argv.includes('--benchmark-profile')?['-c','track_functions=all']:[]
const id=docker(['run','-d','--rm','--name',name,'--label','khmerfp.disposable=ledger','--tmpfs','/var/lib/postgresql/data','-p','127.0.0.1::5432','-e','POSTGRES_DB=khmerfp_ledger_test','-e','POSTGRES_USER=postgres','-e','POSTGRES_PASSWORD='+password,'postgres:16',...profilingArgs])
try {
 const deadline=Date.now()+30000
 while(spawnSync('docker',['exec',id,'pg_isready','-U','postgres','-d','khmerfp_ledger_test'],{stdio:'ignore',timeout:5000}).status!==0){if(Date.now()>deadline)throw new Error('PostgreSQL readiness timeout');await new Promise(r=>setTimeout(r,300))}
 const meta=JSON.parse(docker(['inspect',id]))[0]
 const binding=meta.NetworkSettings.Ports['5432/tcp'][0]
 if(meta.Id!==id||meta.Config.Image!=='postgres:16'||meta.Config.Labels['khmerfp.disposable']!=='ledger'||binding.HostIp!=='127.0.0.1'||meta.Mounts.some(m=>m.Type==='bind'||m.Type==='volume'))throw new Error('Disposable identity mismatch')
 const env={...process.env,NODE_ENV:'test',LEDGER_DISPOSABLE_TARGET:JSON.stringify({host:'127.0.0.1',port:Number(binding.HostPort),database:'khmerfp_ledger_test',user:'postgres',password}),LEDGER_CONTAINER_ID:id}
 delete env.DATABASE_URL;delete env.MIGRATION_TEST_DATABASE_URL
  const benchmark=process.argv.slice(2).includes('--benchmark')
 const positionBenchmark=process.argv.slice(2).includes('--benchmark-positions')
 if(positionBenchmark)env.LEDGER_POSITION_BENCHMARK='true'
 if(process.argv.slice(2).some(arg=>!['--benchmark','--benchmark-positions','--benchmark-profile'].includes(arg)))throw new Error('Unsupported disposable runner argument')
 const args=benchmark?[fileURLToPath(new URL('./benchmark.js',import.meta.url))]:['--test','--test-reporter=tap',fileURLToPath(new URL('./integration.test.js',import.meta.url))]
 const child=spawn(process.execPath,args,{env:{...env,LEDGER_REQUIRE_POSTGRES:'true'},stdio:['ignore','pipe','inherit']})
 let output=''
 child.stdout.on('data',chunk=>{output+=chunk.toString();process.stdout.write(chunk)})
 process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1))})
 if(!benchmark&&process.exitCode===0){
  assertRequiredDatabaseTests(output)
  for(const required of ['exact automatic limit matching','lowest SELL then FIFO maker priority and exact price improvement example','worker connection termination before COMMIT recovers deterministically','worker connection termination after COMMIT recovers deterministically','cross-market concurrent acceptance sharing cash locks before foreign keys','automatic matching benchmark large-multifill']){
   if(!output.includes(required))throw new Error('Required automatic matching scenario did not execute: '+required)
  }
 }
 if(process.exitCode===0&&!benchmark){
  const adoption=spawn(process.execPath,['--test','--test-reporter=tap',fileURLToPath(new URL('./incrementalMigration.test.js',import.meta.url))],{env:{...env,LEDGER_REQUIRE_POSTGRES:'true'},stdio:['ignore','pipe','inherit']})
  let adoptionOutput='';adoption.stdout.on('data',chunk=>{adoptionOutput+=chunk.toString();process.stdout.write(chunk)})
  const adoptionCode=await new Promise(resolve=>adoption.on('exit',code=>resolve(code??1)))
  if(adoptionCode!==0)process.exitCode=adoptionCode;else assertRequiredDatabaseTests(adoptionOutput)
 }
 if(process.exitCode===0&&!benchmark){
  const recovery=spawn(process.execPath,['--test','--test-reporter=tap',fileURLToPath(new URL('./matchingRecovery.test.js',import.meta.url))],{env:{...env,LEDGER_REQUIRE_POSTGRES:'true'},stdio:['ignore','pipe','inherit']})
  let recoveryOutput='';recovery.stdout.on('data',chunk=>{recoveryOutput+=chunk.toString();process.stdout.write(chunk)})
  const recoveryCode=await new Promise(resolve=>recovery.on('exit',code=>resolve(code??1)))
  if(recoveryCode!==0)process.exitCode=recoveryCode;else assertRequiredDatabaseTests(recoveryOutput)
 }
 if (process.exitCode===0 && !benchmark) {
   const admin=new pg.Pool({host:'127.0.0.1',port:Number(binding.HostPort),database:'khmerfp_ledger_test',user:'postgres',password,connectionTimeoutMillis:4000})
   try {
     for (const database of ['khmerfp_migration_test','khmerfp_ctf_regression_test']) await admin.query('CREATE DATABASE '+database)
   } finally {await admin.end()}
   const root=fileURLToPath(new URL('../../../',import.meta.url))
   for (const [script,extra] of [
     ['packages/db/scripts/testBaselineMigration.js',{MIGRATION_TEST_DATABASE_URL:`postgresql://postgres:${password}@127.0.0.1:${binding.HostPort}/khmerfp_migration_test`}],
     ['packages/db/scripts/testCtfSlotCount.js',{CTF_REGRESSION_TEST_DISPOSABLE:'true',CTF_REGRESSION_TEST_DATABASE_URL:`postgresql://postgres:${password}@127.0.0.1:${binding.HostPort}/khmerfp_ctf_regression_test`}],
   ]) {
     const regression=spawn(process.execPath,[root+script],{env:{...env,...extra},stdio:'inherit'})
     const code=await new Promise(r=>regression.on('exit',value=>r(value??1)))
     if(code!==0){process.exitCode=code;break}
   }
 }

} finally {
 const meta=JSON.parse(docker(['inspect',id]))[0]
 if(meta.Id!==id||meta.Config.Labels['khmerfp.disposable']!=='ledger')throw new Error('Cleanup target mismatch')
 docker(['stop',id])
}
