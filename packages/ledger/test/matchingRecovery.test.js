import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID,randomBytes } from 'node:crypto'
import { spawnSync,fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createLedger,createTradingService,createMatchingService } from '../src/index.js'
import { createPositionFixture } from './positionCases.js'

const configured=Boolean(process.env.LEDGER_DISPOSABLE_TARGET)
if(process.env.LEDGER_REQUIRE_POSTGRES==='true'&&!configured)throw new Error('Required disposable target missing')
test('actual worker process termination and restart recovery',{skip:!configured},async t=>{
  assert.equal(process.env.NODE_ENV,'test')
  const config=JSON.parse(process.env.LEDGER_DISPOSABLE_TARGET)
  assert.equal(config.host,'127.0.0.1');assert.equal(config.database,'khmerfp_ledger_test')
  const inspection=spawnSync('docker',['inspect',process.env.LEDGER_CONTAINER_ID],{encoding:'utf8',timeout:10000});assert.equal(inspection.status,0)
  const meta=JSON.parse(inspection.stdout)[0];assert.equal(meta.Config.Labels['khmerfp.disposable'],'ledger');assert.equal(meta.NetworkSettings.Ports['5432/tcp'][0].HostPort,String(config.port))
  const admin=new pg.Pool(config),password=randomBytes(24).toString('hex'),runtimeConfig={...config,user:'ledger_crash_runtime',password},runtime=new pg.Pool(runtimeConfig)
  const key=randomUUID,sys='system:crash-tests',options={pool:runtime,enabled:true,environment:'test',authorize:()=>true}
  try{
    await admin.query("CREATE ROLE ledger_crash_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '"+password+"'")
    await admin.query('GRANT USAGE ON SCHEMA public TO ledger_crash_runtime')
    await admin.query('GRANT EXECUTE ON FUNCTION financial_execute(text,text,text,jsonb),financial_reconcile(text),trading_execute(text,text,text,jsonb),matching_step(text,uuid),matching_pending(text) TO ledger_crash_runtime')
    const ledger=createLedger(options),trading=createTradingService(options),engine=createMatchingService(options)
    const ownerTx=async work=>{const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE ledger_owner');await work(c);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
    const fixture=async(amount=1000000n)=>{
      const users=(await admin.query("INSERT INTO users(email,display_name) VALUES($1,'Crash buyer'),($2,'Crash seller') RETURNING id",[key()+'@example.test',key()+'@example.test'])).rows
      const account=async(ownerUserId,kind,normalSide)=>(await ledger.createAccount(sys,key(),{ownerUserId,kind,normalSide,asset:'USD',accountKey:key()})).accountId
      const a=await account(users[0].id,'CUSTOMER','CREDIT'),b=await account(users[1].id,'CUSTOMER','CREDIT'),cash=await account(null,'ASSET','DEBIT')
      await ledger.post(sys,key(),[{accountId:cash,asset:'USD',side:'DEBIT',amount},{accountId:a,asset:'USD',side:'CREDIT',amount}],key())
      return {a,b,cash,actor:'user:'+users[0].id,other:'user:'+users[1].id}
    }
    for(const [index,scenario] of [{mode:'before',paused:false},{mode:'after',paused:false},{mode:'before',paused:true},{mode:'after',paused:true}].entries())await t.test('kill Node worker '+scenario.mode+' COMMIT, then restart'+(scenario.paused?' while paused':''),async()=>{
      const {mode,paused}=scenario
      const f=await createPositionFixture({admin,runtime,ledger,sys,key,fixture,ownerTx,chainSeed:1900000+index*100})
      const {market,cash,a,positions}=f
      const place=(side)=>trading.place(side==='BUY'?cash.actor:cash.other,key(),{marketId:market.marketId,tokenId:market.tokenId,side,quantity:1000000n,priceCents:side==='BUY'?65n:60n,cashAccountId:side==='BUY'?cash.a:cash.b,positionAccountId:side==='BUY'?a.buyer:a.seller})
      const sell=await place('SELL');await engine.step(sys,market.marketId)
      const buy=await place('BUY'),before=Number((await admin.query('SELECT count(*) AS n FROM trading_fills')).rows[0].n)
      if(paused)await admin.query("UPDATE markets SET trading_status='PAUSED' WHERE id=$1",[market.marketId])
      const child=fork(fileURLToPath(new URL('./matchingCrashChild.js',import.meta.url)),[],{env:{...process.env,NODE_ENV:'test'},execArgv:[],windowsHide:true,stdio:['ignore','ignore','ignore','ipc']})
      const exited=new Promise(resolve=>child.once('exit',resolve))
      try{
        const checkpoint=new Promise((resolve,reject)=>{child.once('message',m=>m.checkpoint===mode?resolve():reject(new Error('Child verification failed')));child.once('error',reject);child.once('exit',()=>reject(new Error('Child exited before checkpoint')))})
        child.send({config:runtimeConfig,marketId:market.marketId,actor:sys,mode})
        let timer
        try{await Promise.race([checkpoint,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Worker checkpoint timeout')),15000)})])}finally{clearTimeout(timer)}
      }finally{child.kill('SIGKILL');await exited}
      const count=Number((await admin.query('SELECT count(*) AS n FROM trading_fills')).rows[0].n)
      assert.equal(count,before+(!paused&&mode==='after'?1:0))
      const restarted=createMatchingService(options)
      for(let i=0;i<3;i++)await restarted.step(sys,market.marketId)
      assert.equal(Number((await admin.query('SELECT count(*) AS n FROM trading_fills')).rows[0].n),before+(paused?0:1))
      if(paused){await trading.cancel(cash.other,key(),sell.orderId);await restarted.step(sys,market.marketId)}
      const orders=(await admin.query('SELECT status FROM trading_orders WHERE id=ANY($1::bigint[])',[[buy.orderId,sell.orderId]])).rows
      assert.deepEqual(orders.map(o=>o.status),paused?['CANCELLED','CANCELLED']:['FILLED','FILLED'])
      assert.equal((await trading.reconcile(sys)).reconciled,true);assert.equal((await positions.reconcile(sys)).reconciled,true)
    })
  }finally{await runtime.end();await admin.end()}
})
