// test the isolated verification server and its access restrictions.
﻿import test from 'node:test'
import { request } from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createProbeServer } from './server.js'
import { ORIGIN } from './harness.js'

const fetch = (url, options = {}) => new Promise((resolve, reject) => {
  const req = request(url, { method: options.method || 'GET', headers: options.headers }, res => {
    res.resume(); res.once('end', () => resolve({ status: res.statusCode, headers: { get: name => res.headers[name] } }))
  })
  req.once('error', reject); req.end(options.body)
})

// loopback HTTP only; no wallet SDK, public RPC or database is contacted.
test('isolated HTTP server enforces origin, host, token and endpoint boundaries', async () => {
  let calls=0
  const token='a'.repeat(64)
  const server=createProbeServer({config:{wallet:'0x1111111111111111111111111111111111111111',chainId:84532},token,
    harness:{preflight:async()=>{calls++;return {deployed:true}}}, assets:new Map([['/',{type:'text/html',body:'isolated'}]])})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base=`http://127.0.0.1:${server.address().port}`
  const headers={Host:new URL(ORIGIN).host,Origin:ORIGIN,'Content-Type':'application/json','X-Probe-Token':token}
  try {
    let response=await fetch(`${base}/preflight`,{method:'POST',headers,body:'{}'})
    assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store')
    response=await fetch(`${base}/preflight`,{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'})
    assert.equal(response.status,403)
    response=await fetch(`${base}/preflight`,{method:'POST',headers:{...headers,'X-Probe-Token':'wrong'},body:'{}'})
    assert.equal(response.status,403)
    response=await fetch(`${base}/preflight`,{method:'POST',headers:{...headers,Host:'evil.example'},body:'{}'})
    assert.equal(response.status,403)
    response=await fetch(`${base}/api/wallet-links`,{headers}); assert.equal(response.status,404)
    response=await fetch(`${base}/.env`,{headers}); assert.equal(response.status,404)
    response=await fetch(`${base}/verify`,{method:'POST',headers,body:'x'.repeat(16385)});assert.equal(response.status,413)
    assert.equal(calls,1)
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)) }
})


test('entry point refuses missing opt-in before listening or contacting a chain', () => {
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./server.js',import.meta.url))],{
    env:{COINBASE_PROBE_ENABLED:'false'},encoding:'utf8',timeout:10000,
  })
  assert.equal(result.status,1)
  assert.match(result.stderr,/Probe not started/)
  assert.equal(result.stdout,'')
})
