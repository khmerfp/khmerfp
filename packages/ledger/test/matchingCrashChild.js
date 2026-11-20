// Test-only child: never imported by the application and never accepts production targets.
import pg from 'pg'
import { spawnSync } from 'node:child_process'
import { createMatchingService } from '../src/index.js'

process.once('message', async ({ config, marketId, actor, mode }) => {
  let pool
  try {
    if (process.env.NODE_ENV !== 'test' || process.env.LEDGER_REQUIRE_POSTGRES !== 'true' || !process.env.LEDGER_CONTAINER_ID || config.host !== '127.0.0.1' || config.database !== 'khmerfp_ledger_test' || !['ledger_crash_runtime','ledger_runtime'].includes(config.user) || !['before','after'].includes(mode)) throw new Error('Isolated test target required')
    const inspected=spawnSync('docker',['inspect',process.env.LEDGER_CONTAINER_ID],{encoding:'utf8',timeout:10000})
    if(inspected.status!==0)throw new Error('Disposable identity unavailable')
    const meta=JSON.parse(inspected.stdout)[0]
    if(meta.Config.Labels['khmerfp.disposable']!=='ledger'||meta.NetworkSettings.Ports['5432/tcp'][0].HostPort!==String(config.port))throw new Error('Disposable identity mismatch')
    pool=new pg.Pool(config)
    const wrapped={connect:async()=>{
      const client=await pool.connect()
      return {release:error=>client.release(error),query:async(...args)=>{
        if(args[0]==='COMMIT'){
          if(mode==='after')await client.query(...args)
          process.send({checkpoint:mode})
          // The parent kills this process. No commit/response can occur after this point.
          await new Promise(()=>{})
        }
        return client.query(...args)
      }}
    }}
    const engine=createMatchingService({pool:wrapped,enabled:true,environment:'test',authorize:()=>true})
    await engine.step(actor,marketId)
  }catch{process.send?.({failed:true});await pool?.end();process.exitCode=1;process.disconnect?.()}
})
