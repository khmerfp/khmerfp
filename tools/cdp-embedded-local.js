// run real CDP onboarding against a disposable local app database, never hosted data.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

if (process.env.CDP_LOCAL_DISPOSABLE !== 'APPROVED_LOCAL_ONLY' ||
    !['development', 'test'].includes(process.env.NODE_ENV) ||
    !/^[0-9a-f-]{36}$/i.test(process.env.VITE_CDP_PROJECT_ID || '')) {
  throw new Error('Explicit local disposable opt-in and a public CDP Project ID are required.')
}
const projectId = process.env.VITE_CDP_PROJECT_ID
const root = fileURLToPath(new URL('../', import.meta.url))
const name = 'khmerfp-cdp-local-pg16'
const docker = args => {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 45000 })
  if (result.status !== 0) throw new Error('Local Docker operation failed: ' + args[0])
  return result.stdout.trim()
}
if (spawnSync('docker', ['inspect', name], { encoding: 'utf8' }).status === 0) throw new Error('An existing local container needs manual review. No reuse or removal attempted.')
const artifacts = spawnSync(process.execPath, [resolve(root, 'packages/db/scripts/validateBaseline.js')], { encoding: 'utf8' })
if (artifacts.status !== 0) throw new Error('Migration artifact check failed.')
// discard inherited application secrets before importing backend services; no dotenv is used.
for (const key of Object.keys(process.env)) if (/^(DATABASE_URL|GOOGLE|FACEBOOK|TELEGRAM|PAYWAY|BAKONG|WALLET_LINK|CDP_API|CDP_WALLET)/.test(key)) delete process.env[key]
Object.assign(process.env, { NODE_ENV: 'development', APP_ORIGINS: 'http://127.0.0.1:5173',
  WALLET_LINK_APP_ORIGIN: 'http://127.0.0.1:5173', WALLET_LINK_ENABLED: 'true',
  CDP_EMBEDDED_WALLET_ENABLED: 'true', PAYWAY_CHECKOUT_ENABLED: 'false' })
const container = docker(['run', '-d', '--rm', '--name', name, '--label', 'khmerfp.disposable=cdp-local',
  '-p', '127.0.0.1:55439:5432', '-e', 'POSTGRES_DB=khmerfp_cdp_local', '-e', 'POSTGRES_USER=cdp_local',
  '-e', 'POSTGRES_PASSWORD=disposable_local_only', 'postgres:16'])
let http, vite, disconnect, closing = false, stage = 'database readiness'
async function close() {
  if (closing) return
  closing = true
  await vite?.close()
  if (http) { http.closeAllConnections(); await new Promise(resolve => http.close(resolve)) }
  await disconnect?.()
  const meta = JSON.parse(docker(['inspect', name]))[0]
  if (meta.Id !== container || meta.Config.Labels['khmerfp.disposable'] !== 'cdp-local') throw new Error('Cleanup identity mismatch.')
  docker(['stop', name])
}
try {
  const deadline = Date.now() + 30000
  while (spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'cdp_local', '-d', 'khmerfp_cdp_local'], { stdio: 'ignore' }).status !== 0) {
    if (Date.now() > deadline) throw new Error('Disposable PostgreSQL readiness timeout.')
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  const meta = JSON.parse(docker(['inspect', name]))[0]
  if (meta.Id !== container || meta.Config.Image !== 'postgres:16' || meta.Config.Labels['khmerfp.disposable'] !== 'cdp-local' ||
      meta.NetworkSettings.Ports['5432/tcp'][0].HostIp !== '127.0.0.1' || meta.NetworkSettings.Ports['5432/tcp'][0].HostPort !== '55439') throw new Error('Disposable database identity mismatch.')
  stage = 'database connection'
  const database = await import('../server/src/config/database.js')
  disconnect = database.disconnectFromDatabase
  const pool = await database.connectToDatabase('postgresql://cdp_local:disposable_local_only@127.0.0.1:55439/khmerfp_cdp_local')
  const state = (await pool.query("SELECT current_database() AS name,current_setting('server_version_num')::int AS version")).rows[0]
  if (state.name !== 'khmerfp_cdp_local' || Math.floor(state.version / 10000) !== 16 ||
      (await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='public'")).rowCount) throw new Error('Fresh disposable PostgreSQL 16 required.')
  stage = 'disposable migrations'
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const { migrate } = await import('drizzle-orm/node-postgres/migrator')
  await migrate(drizzle(pool), { migrationsFolder: resolve(root, 'packages/db/migrations') })
  await pool.query("INSERT INTO chains(chain_id,name,environment,native_symbol,enabled) VALUES(84532,'Local CDP acceptance','testnet','ETH',true)")
  stage = 'backend initialization'
  const { createApp } = await import('../server/src/app.js')
  stage = 'backend port 3000'
  http = createApp().listen(3000, '127.0.0.1')
  await new Promise((resolve, reject) => { http.once('listening', resolve); http.once('error', reject) })
  stage = 'frontend port 5173'
  const { createServer } = await import('vite')
  vite = await createServer({ root: resolve(root, 'client'), configFile: resolve(root, 'client/vite.config.js'), envFile: false,
    define: { 'import.meta.env.VITE_CDP_PROJECT_ID': JSON.stringify(projectId),
      'import.meta.env.VITE_CDP_EMBEDDED_WALLET_ENABLED': JSON.stringify('true'), 'import.meta.env.VITE_API_URL': JSON.stringify('') },
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3000' } } })
  await vite.listen()
  console.log('CDP local onboarding ready: http://127.0.0.1:5173/account/wallets')
  console.log('Real CDP SDK; disposable PostgreSQL only. Create a test KhmerFP login, then use your own CDP email. Never share OTPs. Do not click ownership signing without separate approval.')
  console.log('Stopping this launcher removes its disposable local database. No production feature was enabled.')
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().then(() => process.exit(0)) })
} catch (error) {
  console.error('Local setup stage:', stage, 'error code:', /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : error.name)
  await close()
  console.error('Local setup failed. No hosted database or production configuration was used.')
  process.exitCode = 1
}
