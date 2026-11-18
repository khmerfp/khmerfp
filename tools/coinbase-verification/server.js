// serve the isolated local verification harness without production database access.
﻿import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { harnessConfig, createHarness, ORIGIN } from './harness.js'

// no dotenv, application startup, database or live request runs on import.
export function createProbeServer({ config, harness, assets, token }) {
  let apiBusy = false
  return createServer(async (req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' }
    const json = (status, body) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    try {
      if (req.headers.host !== new URL(ORIGIN).host) return json(403, { error: 'Unexpected host.' })
      if (req.method === 'POST') {
        const supplied = req.headers['x-probe-token'] || ''
        if (req.headers.origin !== ORIGIN || req.headers['content-type'] !== 'application/json' ||
            typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
            !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return json(403, { error: 'Request rejected.' })
        if (!['/preflight', '/challenge', '/verify'].includes(req.url)) return json(404, { error: 'Unknown endpoint.' })
        if (apiBusy) return json(409, { error: 'An operation is already in progress.' })
        apiBusy = true
        try {
          let size = 0
          const chunks = []
          for await (const chunk of req) {
            size += chunk.length
            if (size > 16384) return json(413, { error: 'Request too large.' })
            chunks.push(chunk)
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          const result = req.url === '/preflight' ? await harness.preflight() :
            req.url === '/challenge' ? await harness.issue() : await harness.verify(body)
          return json(200, result)
        } catch { return json(400, { error: 'Attempt rejected or read unavailable. Request a fresh challenge; review the configured wallet and network.' }) }
        finally { apiBusy = false }
      }
      if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' })
      if (req.url === '/config') return json(200, { wallet: config.wallet, chainId: config.chainId, origin: ORIGIN })
      const asset = assets.get(req.url)
      if (!asset) return json(404, { error: 'Unknown path.' })
      res.writeHead(200, { ...headers, 'Content-Type': asset.type })
      res.end(asset.body)
    } catch { if (!res.headersSent) json(400, { error: 'Request rejected.' }); else res.end() }
  })
}

async function main() {
  const config = harnessConfig(process.env)
  const directory = await mkdtemp(path.join(tmpdir(), 'khmerfp-coinbase-probe-'))
  const token = randomBytes(32).toString('hex')
  let server
  try {
    const output = await build({ configFile: false, envFile: false,
      root: fileURLToPath(new URL('./browser', import.meta.url)), logLevel: 'silent',
      build: { outDir: directory, emptyOutDir: true, write: false } })
    const assets = new Map()
    for (const bundle of Array.isArray(output) ? output : [output]) for (const item of bundle.output) {
      const name = `/${item.fileName}`
      let body = item.type === 'chunk' ? item.code : item.source
      const html = name === '/index.html'
      if (html) body = String(body).replace('__PROBE_TOKEN__', token)
      const asset = { body, type: html ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' }
      assets.set(name, asset)
      if (html) assets.set('/', asset)
    }
    server = createProbeServer({ config, harness: createHarness(config), assets, token })
    server.requestTimeout = 15000
    server.headersTimeout = 10000
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5184, '127.0.0.1', resolve) })
    console.log(`Isolated ownership probe ready at ${ORIGIN}. No chain requests have run. Manual approval required.`)
    const stop = async () => { server.closeAllConnections(); server.close(); await rm(directory, { recursive: true, force: true }) }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  } catch {
    server?.close()
    await rm(directory, { recursive: true, force: true })
    throw new Error('Probe startup failed. Check opt-in, public wallet configuration and local port.')
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Probe not started. Review the documented configuration; no live verification was performed.'); process.exitCode = 1 })
}
