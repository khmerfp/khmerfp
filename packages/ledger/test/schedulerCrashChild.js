// Test-only IPC child; refuses anything except the parent-verified disposable container.
import pg from 'pg'
import { spawnSync } from 'node:child_process'
import { createMarketLifecycleService } from '../src/index.js'

process.once('message', async ({ config, templateId, actor, mode }) => {
  let pool
  try {
    if (process.env.NODE_ENV !== 'test' || process.env.LEDGER_REQUIRE_POSTGRES !== 'true' || !process.env.LEDGER_CONTAINER_ID || config.host !== '127.0.0.1' || config.database !== 'khmerfp_scheduler_test' || config.user !== 'schedule_runtime' || !['before','after'].includes(mode)) throw new Error('Verified disposable scheduler target required')
    const result = spawnSync('docker', ['inspect', process.env.LEDGER_CONTAINER_ID], { encoding: 'utf8', timeout: 10000 })
    if (result.status !== 0) throw new Error('Disposable identity unavailable')
    const meta = JSON.parse(result.stdout)[0]
    if (meta.Config.Labels['khmerfp.disposable'] !== 'ledger' || meta.NetworkSettings.Ports['5432/tcp'][0].HostPort !== String(config.port)) throw new Error('Disposable identity mismatch')
    pool = new pg.Pool(config)
    let commits = 0
    const wrapped = { connect: async () => {
      const client = await pool.connect()
      return { release: error => client.release(error), query: async (...args) => {
        // The first transaction is a read-only plan; interrupt the creation transaction.
        if (args[0] === 'COMMIT' && ++commits === 2) {
          if (mode === 'after') await client.query(...args)
          process.send({ checkpoint: mode }); await new Promise(() => {})
        }
        return client.query(...args)
      } }
    } }
    await createMarketLifecycleService({ pool: wrapped, enabled: true, environment: 'test', authorize: () => true }).createNext(actor, templateId)
  } catch { process.send?.({ failed: true }); await pool?.end(); process.exitCode = 1; process.disconnect?.() }
})
