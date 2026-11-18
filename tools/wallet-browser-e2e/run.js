// manage the disposable environment and run the browser test suite.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
const cwd = dirname(fileURLToPath(import.meta.url))
if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') throw new Error('Test runner refuses production and staging.')
const name = 'khmerfp-wallet-browser-pg16'
const docker = args => {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 })
  if (r.status !== 0) throw new Error(`Disposable Docker operation failed: ${args[0]}`)
  return r.stdout.trim()
}
const existing = spawnSync('docker', ['inspect', name], { encoding: 'utf8' })
if (existing.status === 0) throw new Error('Test container already exists; inspect it manually. Nothing was removed.')
const id = docker(['run', '-d', '--rm', '--name', name, '--label', 'khmerfp.disposable=wallet-browser', '-p', '127.0.0.1:55436:5432', '-e', 'POSTGRES_DB=khmerfp_wallet_browser_e2e', '-e', 'POSTGRES_USER=browser_test', '-e', 'POSTGRES_PASSWORD=disposable_browser_only', 'postgres:16'])
try {
  const deadline = Date.now() + 30000
  while (spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'browser_test', '-d', 'khmerfp_wallet_browser_e2e'], { stdio: 'ignore' }).status !== 0) {
    if (Date.now() > deadline) throw new Error('Disposable database did not become ready.')
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  const env = { ...process.env, NODE_ENV: 'test', WALLET_BROWSER_E2E: 'ISOLATED_ONLY', WALLET_BROWSER_CONTAINER_ID: id, WALLET_BROWSER_TOKEN: randomBytes(32).toString('hex') }
  const child = spawn(process.execPath, ['node_modules/playwright/cli.js', 'test', '--config=playwright.config.js'], { cwd, env, stdio: 'inherit' })
  process.exitCode = await new Promise(resolve => child.on('exit', code => resolve(code ?? 1)))
} finally {
  const meta = JSON.parse(docker(['inspect', name]))[0]
  if (meta.Id !== id || meta.Config.Labels['khmerfp.disposable'] !== 'wallet-browser') throw new Error('Cleanup identity mismatch.')
  docker(['stop', name])
}
