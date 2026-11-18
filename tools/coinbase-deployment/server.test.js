// test access restrictions on the local deployment inspection server.
﻿import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createPreviewServer } from './server.js'
import { ORIGIN } from './preview.js'
const send = (url, options) => new Promise((resolve, reject) => {
  const req = request(url, options, res => { res.resume(); res.once('end', () => resolve(res.statusCode)) })
  req.once('error', reject); req.end(options.body)
})
test('HTTP preview accepts only protected read requests, never submission', async () => {
  const token = 'b'.repeat(64)
  let reads = 0
  const server = createPreviewServer({ assets: new Map(), token, inspect: async () => { reads++; return { submissionEnabled: false } } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = { Host: new URL(ORIGIN).host, Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Preview-Token': token }
  try {
    assert.equal(await send(`${base}/inspect`, { method: 'POST', headers, body: '{"wallet":"0x1111111111111111111111111111111111111111"}' }), 200)
    assert.equal(await send(`${base}/submit`, { method: 'POST', headers, body: '{}' }), 405)
    assert.equal(await send(`${base}/inspect`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{}' }), 403)
    assert.equal(await send(`${base}/inspect`, { method: 'POST', headers: { ...headers, 'X-Preview-Token': 'bad' }, body: '{}' }), 403)
    assert.equal(await send(`${base}/inspect`, { method: 'POST', headers, body: '{"wallet":"x","owners":[]}' }), 400)
    assert.equal(await send(`${base}/.env`, { method: 'GET', headers }), 404)
    assert.equal(reads, 1)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
test('preview entry refuses startup without explicit opt-in', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { COINBASE_DEPLOY_PREVIEW_ENABLED: 'false' }, encoding: 'utf8', timeout: 10000,
  })
  assert.equal(result.status, 1); assert.match(result.stderr, /Preview not started/); assert.equal(result.stdout, '')
})
