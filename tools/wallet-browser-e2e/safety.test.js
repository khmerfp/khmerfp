// test that the browser fixture refuses unsupported runtime environments.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const cwd = fileURLToPath(new URL('.', import.meta.url))
for (const mode of ['production', 'staging', 'development']) {
  test(`isolated fixture refuses ${mode} before database access`, () => {
    const result = spawnSync(process.execPath, ['server.js'], { cwd,
      env: { ...process.env, NODE_ENV: mode, WALLET_BROWSER_E2E: 'ISOLATED_ONLY', WALLET_BROWSER_TOKEN: 'a'.repeat(64) }, encoding: 'utf8', timeout: 15000 })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Explicit isolated test invocation required/)
  })
}
