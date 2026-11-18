// test public inspection results and capability handling without live signing.
﻿import test from 'node:test'
import assert from 'node:assert/strict'
import { connectPreparation, summarizeCapabilities, guardPreparationProvider } from './connection.js'
const wallet = '0x1111111111111111111111111111111111111111'

test('capability summary keeps public flags and never implies deployment or funding approval', () => {
  const summary = summarizeCapabilities({ '0x14a34': {
    atomic: { status: 'supported' }, atomicBatch: { supported: true }, paymasterService: { supported: true, url: 'sensitive-url' },
    auxiliaryFunds: { supported: true }, dataSuffix: { supported: true }, opaqueSession: 'secret',
  } })
  assert.equal(summary.baseSepoliaEntryPresent, true)
  assert.equal(summary.atomicStatus, 'supported')
  assert.equal(summary.paymasterServiceSupported, true)
  assert.equal(summary.firstUseDeploymentVerified, false)
  assert.equal(summary.sponsorshipConfirmed, false)
  assert.equal(summary.feeQuoteAvailable, false)
  assert.equal(JSON.stringify(summary).includes('secret'), false)
  assert.equal(JSON.stringify(summary).includes('sensitive-url'), false)
})
test('another chain or wildcard capabilities are not silently treated as Base Sepolia support', () => {
  for (const value of [{ '0x2105': { atomic: { status: 'supported' } } }, { '*': { paymasterService: { supported: true } } }]) {
    const summary = summarizeCapabilities(value)
    assert.equal(summary.baseSepoliaEntryPresent, false)
    assert.equal(summary.atomicStatus, 'UNKNOWN')
    assert.equal(summary.paymasterServiceSupported, null)
  }
})
test('missing, malformed and unexpected capability values remain unknown', () => {
  for (const value of [null, undefined, [], 'unexpected', {}, { '0x14a34': { atomic: { status: 'new-status' }, paymasterService: { supported: 'true' } } }]) {
    const summary = summarizeCapabilities(value)
    assert.equal(summary.atomicStatus, 'UNKNOWN')
    assert.equal(summary.paymasterServiceSupported, null)
    assert.equal(summary.firstUseDeploymentVerified, false)
  }
})
test('explicit connection uses only account, chain and capability reads for the selected wallet', async () => {
  const methods = []
  const result = await connectPreparation({ request: async request => {
    methods.push(request.method)
    if (request.method === 'eth_chainId') return '0x14a34'
    if (request.method === 'wallet_getCapabilities') {
      assert.deepEqual(request.params, [wallet, ['0x14a34']])
      return { '0x14a34': { atomic: { status: 'ready' } } }
    }
    return [wallet]
  } })
  assert.deepEqual(methods, ['eth_requestAccounts', 'eth_chainId', 'wallet_getCapabilities', 'eth_accounts', 'eth_chainId'])
  assert.equal(result.wallet, wallet)
  assert.equal(result.chainId, 84532)
  assert.equal(result.capabilities.atomicStatus, 'ready')
  assert.equal(result.submissionEnabled, false)
})
test('capability errors are sanitized and do not become an unsupported/deployed claim', async () => {
  const result = await connectPreparation({ request: async ({ method }) => {
    if (method === 'eth_chainId') return '0x14a34'
    if (method === 'wallet_getCapabilities') throw Error('private SDK details')
    return [wallet]
  } })
  assert.equal(result.capabilityReadStatus, 'UNAVAILABLE')
  assert.equal(result.capabilities.baseSepoliaEntryPresent, false)
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.equal(result.submissionEnabled, false)
})
test('wrong chain reports only its public chain ID and stops before capability inspection', async () => {
  const methods = []
  await assert.rejects(connectPreparation({ request: async ({ method }) => {
    methods.push(method)
    return method === 'eth_chainId' ? '0x2105' : [wallet]
  } }), error => error.code === 'PREVIEW_WRONG_CHAIN' && error.actualChainId === '8453')
  assert.deepEqual(methods, ['eth_requestAccounts', 'eth_chainId'])
})


test('advertised capabilities cannot unlock preparation, simulation, sponsorship or submission methods', () => {
  let forwarded = 0
  const provider = guardPreparationProvider({ request: () => { forwarded++ } })
  const reported = summarizeCapabilities({ '0x14a34': {
    atomic: { status: 'supported' }, paymasterService: { supported: true },
    wallet_prepareCalls: { supported: true }, deployment: { supported: true },
  } })
  assert.equal(reported.firstUseDeploymentVerified, false)
  assert.equal(reported.sponsorshipConfirmed, false)
  for (const method of ['wallet_prepareCalls', 'wallet_sendPreparedCalls', 'eth_estimateUserOperationGas',
    'eth_estimateGas', 'pm_getPaymasterData', 'wallet_sendCalls', 'eth_sendUserOperation']) {
    assert.throws(() => provider.request({ method }), /disabled/)
  }
  assert.equal(forwarded, 0)
})
