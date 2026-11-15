import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoService, unsigned } from '../src/demo/orderService.js'

test('demo refuses production or missing opt-in before any RPC access', async () => {
  const mode = process.env.NODE_ENV, enabled = process.env.LOCAL_DEMO_ENABLED
  try {
    process.env.NODE_ENV = 'production'; process.env.LOCAL_DEMO_ENABLED = 'true'
    await assert.rejects(createDemoService(), /disabled/)
    process.env.NODE_ENV = 'development'; delete process.env.LOCAL_DEMO_ENABLED
    await assert.rejects(createDemoService(), /disabled/)
  } finally {
    if (mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = mode
    if (enabled === undefined) delete process.env.LOCAL_DEMO_ENABLED; else process.env.LOCAL_DEMO_ENABLED = enabled
  }
})
test('amount parsing requires canonical bounded integer strings', () => {
  for (const value of [1, '-1', '1.5', '01', 'NaN', '9'.repeat(79), ((1n << 256n)).toString()]) assert.throws(() => unsigned(value), /Invalid/)
  assert.equal(unsigned('0'), 0n)
  assert.equal(unsigned('1000000'), 1000000n)
})
