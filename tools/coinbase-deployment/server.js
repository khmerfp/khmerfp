// serve the local deployment inspection page without transaction submission.
﻿import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { inspectDeployment, ORIGIN } from './preview.js'

export function createPreviewServer({ assets, inspect = inspectDeployment, token }) {
  let busy = false
  return createServer(async (req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' }
    const json = (status, body) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.headers.host !== new URL(ORIGIN).host) return json(403, { error: 'Host rejected.' })
    if (req.method === 'GET') {
      const asset = assets.get(req.url)
      if (!asset) return json(404, { error: 'Unknown path.' })
      res.writeHead(200, { ...headers, 'Content-Type': asset.type }); return res.end(asset.body)
    }
    if (req.method !== 'POST' || req.url !== '/inspect') return json(405, { error: 'Only read-only inspection is implemented.' })
    const supplied = req.headers['x-preview-token']
    if (req.headers.origin !== ORIGIN || req.headers['content-type'] !== 'application/json' ||
        typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return json(403, { error: 'Request rejected.' })
    if (busy) return json(409, { error: 'Read already in progress.' })
    busy = true
    try {
      let size = 0
      const chunks = []
      for await (const chunk of req) { size += chunk.length; if (size > 2048) return json(413, { error: 'Request too large.' }); chunks.push(chunk) }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (Object.keys(input).join() !== 'wallet') return json(400, { error: 'Only a public wallet address is accepted.' })
      return json(200, await inspect(input.wallet))
    } catch { return json(400, { error: 'Read-only inspection failed or identity differs from reviewed contracts.' }) }
    finally { busy = false }
  })
}

async function main() {
  if (process.env.COINBASE_DEPLOY_PREVIEW_ENABLED !== 'true') throw new Error('Explicit read-only preview opt-in required.')
  const root = fileURLToPath(new URL('./browser', import.meta.url))
  const token = randomBytes(32).toString('hex')
  const result = await build({ root, configFile: false, envFile: false, logLevel: 'silent', build: { write: false } })
  const assets = new Map()
  for (const bundle of Array.isArray(result) ? result : [result]) for (const item of bundle.output) {
    const name = `/${item.fileName}`
    let body = item.type === 'chunk' ? item.code : item.source
    if (name === '/index.html') body = String(body).replace('__PREVIEW_TOKEN__', token)
    const asset = { body, type: name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' }
    assets.set(name, asset); if (name === '/index.html') assets.set('/', asset)
  }
  const server = createPreviewServer({ assets, token })
  server.requestTimeout = 10000; server.headersTimeout = 8000
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5185, '127.0.0.1', resolve) })
  console.log(`Read-only deployment preview ready at ${ORIGIN}. No wallet or RPC request has run. Submission is disabled.`)
  const stop = () => { server.closeAllConnections(); server.close() }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Preview not started. Check the explicit opt-in and free local port.'); process.exitCode = 1 })
}
