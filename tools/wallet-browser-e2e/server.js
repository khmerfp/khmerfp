// run the test-only app and mock wallet checks with disposable postgres.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { Wallet, Interface, recoverAddress } from 'ethers'
import express from 'express'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindConfig from '../../client/tailwind.config.js'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
if (process.env.NODE_ENV !== 'test' || process.env.WALLET_BROWSER_E2E !== 'ISOLATED_ONLY' || !/^[a-f0-9]{64}$/.test(process.env.WALLET_BROWSER_TOKEN || '')) throw new Error('Explicit isolated test invocation required.')
const inspected = spawnSync('docker', ['inspect', 'khmerfp-wallet-browser-pg16'], { encoding: 'utf8', timeout: 10000 })
if (inspected.status !== 0) throw new Error('Cannot inspect disposable database.')
const meta = JSON.parse(inspected.stdout)[0]
if (meta.Id !== process.env.WALLET_BROWSER_CONTAINER_ID || meta.Config.Image !== 'postgres:16' || meta.Config.Labels['khmerfp.disposable'] !== 'wallet-browser' || meta.NetworkSettings.Ports['5432/tcp'][0].HostIp !== '127.0.0.1' || meta.NetworkSettings.Ports['5432/tcp'][0].HostPort !== '55436') throw new Error('Disposable target mismatch.')
if (meta.Mounts.length !== 1 || meta.Mounts[0].Type !== 'volume' || !/^[a-f0-9]{64}$/.test(meta.Mounts[0].Name) || meta.Mounts[0].Destination !== '/var/lib/postgresql/data') throw new Error('Anonymous disposable volume required.')
const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = spawnSync(process.execPath, [resolve(root, 'packages/db/scripts/validateBaseline.js')], { encoding: 'utf8', timeout: 15000 })
if (artifacts.status !== 0) throw new Error('Migration artifact validation failed.')
// no .env files or hosted database configuration are loaded.
for (const key of Object.keys(process.env)) if (/^(GOOGLE|FACEBOOK|TELEGRAM|PAYWAY|BAKONG|DATABASE_URL|WALLET_LINK)/.test(key)) delete process.env[key]
process.env.APP_ORIGINS = 'http://127.0.0.1:5187'
process.env.WALLET_LINK_APP_ORIGIN = process.env.APP_ORIGINS
process.env.WALLET_LINK_ENABLED = 'false'
process.env.PAYWAY_CHECKOUT_ENABLED = 'false'
const { connectToDatabase, disconnectFromDatabase } = await import('../../server/src/config/database.js')
const pool = await connectToDatabase('postgresql://browser_test:disposable_browser_only@127.0.0.1:55436/khmerfp_wallet_browser_e2e')
const state = (await pool.query("SELECT current_database() AS name,current_setting('server_version_num')::int AS version")).rows[0]
if (state.name !== 'khmerfp_wallet_browser_e2e' || Math.floor(state.version / 10000) !== 16) throw new Error('Wrong test database.')
if ((await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='public'")).rowCount) throw new Error('Test database must be empty.')
await migrate(drizzle(pool), { migrationsFolder: resolve(root, 'packages/db/migrations') })
await pool.query("INSERT INTO chains(chain_id,name,environment,native_symbol,enabled) VALUES(84532,'Browser fixture','testnet','ETH',true)")
const { createApp } = await import('../../server/src/app.js')
const { createWalletLinkService, verifyContractWalletControl } = await import('../../server/src/walletLinking/service.js')
const { createWalletLinkRepository } = await import('../../server/src/walletLinking/repository.js')
const { readSessionToken, hashSessionToken } = await import('../../server/src/services/authSessionService.js')
const owner = Wallet.createRandom(), other = Wallet.createRandom()
const abi = new Interface(['function isValidSignature(bytes32,bytes) view returns(bytes4)'])
let offset = 0
const failedRpcDigests = new Set()
// real verifier logic, but an in-memory contract/RPC simulation, never a public RPC.
const service = createWalletLinkService({ repository: createWalletLinkRepository(() => pool), config: { origin: process.env.APP_ORIGINS, chainId: 84532 }, now: () => Date.now() + offset,
  verifyControl: input => verifyContractWalletControl(input, { rpcFactory: () => ({
    getNetwork: async () => ({ chainId: 84532n }), getBlock: async () => ({ number: 1, hash: '0x' + 'aa'.repeat(32) }), getCode: async () => { await new Promise(resolve => setTimeout(resolve, 200)); return '0x6000' }, destroy: () => {},
    call: async tx => { const [digest, signature] = abi.decodeFunctionData('isValidSignature', tx.data); if (failedRpcDigests.has(digest)) throw new Error('Simulated RPC failure'); return abi.encodeFunctionResult('isValidSignature', [recoverAddress(digest, signature) === owner.address ? '0x1626ba7e' : '0xffffffff']) },
  }) }),
})
const app = express()
app.use(express.json())
app.use('/__test', (req, res, next) => {
  if (req.hostname !== '127.0.0.1' || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.get('X-Wallet-Test-Token') !== process.env.WALLET_BROWSER_TOKEN) return res.sendStatus(403)
  next()
})
app.post('/__test/sign', async (req, res) => {
  const session = hashSessionToken(readSessionToken(req) || '')
  const row = (await pool.query('SELECT payload_hash FROM wallet_link_challenges WHERE id=$1 AND session_hash=$2', [req.body.challengeId, session])).rows[0]
  if (!row) return res.sendStatus(403)
  if (req.body.scenario === 'rpc-failure') failedRpcDigests.add(row.payload_hash)
  if (req.body.scenario === 'expired-challenge') offset = 121000
  if (req.body.scenario === 'expired-session') await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1', [session])
  const signer = req.body.scenario === 'invalid-signature' ? other : owner
  res.json({ signature: signer.signingKey.sign(row.payload_hash).serialized })
})
app.post('/__test/step-up', async (req, res) => {
  await pool.query('UPDATE sessions SET step_up_at=clock_timestamp() WHERE token_hash=$1', [hashSessionToken(readSessionToken(req) || '')])
  res.sendStatus(204)
})
// each browser case gets a fresh app instance and its original unchanged rate limiter.
const makeApp = () => createApp({ walletLinkOptions: { enabled: () => true, service } })
let runtimeApp = makeApp()
app.post('/__test/reset-clock', async (_req, res) => { offset = 0; await pool.query('DELETE FROM auth_rate_limits'); runtimeApp = makeApp(); res.sendStatus(204) })
app.use((req, res, next) => runtimeApp(req, res, next))
const http = app.listen(4017, '127.0.0.1')
const adapter = fileURLToPath(new URL('./walletAdapter.js', import.meta.url))
const vite = await createServer({ configFile: false, envFile: false, css: { postcss: { plugins: [tailwindcss({ ...tailwindConfig, content: [resolve(root, 'client/index.html'), resolve(root, 'client/src/**/*.{js,jsx}')] }), autoprefixer()] } }, root: resolve(root, 'client'), plugins: [
  { name: 'isolated-wallet-test-only', enforce: 'pre', resolveId(source, importer) { if (source.endsWith('/services/coinbaseWallet.js') && importer?.includes('/client/src/')) return adapter } }, react(),
], define: { 'import.meta.env.VITE_WALLET_LINK_ENABLED': JSON.stringify('true'), 'import.meta.env.VITE_API_URL': JSON.stringify('') }, server: { host: '127.0.0.1', port: 5187, strictPort: true, fs: { allow: [root] }, proxy: { '/api': 'http://127.0.0.1:4017', '/__test': 'http://127.0.0.1:4017' } } })
await vite.listen()
console.log('Isolated wallet browser fixture ready; no public RPC or real signatures.')
async function close() { await vite.close(); await new Promise(resolve => http.close(resolve)); await disconnectFromDatabase(); process.exit(0) }
process.once('SIGTERM', close)
process.once('SIGINT', close)
