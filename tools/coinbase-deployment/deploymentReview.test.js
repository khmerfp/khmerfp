// test that incomplete deployment evidence keeps execution blocked.
import test from 'node:test'
import assert from 'node:assert/strict'
import { deploymentReview, REVIEWED_TESTER } from './deploymentReview.js'
import { FACTORY, IMPLEMENTATION, FACTORY_HASH, IMPLEMENTATION_HASH } from './preview.js'
import { guardPreparationProvider } from './connection.js'
const evidence = () => ({ wallet: REVIEWED_TESTER, chainId: 84532, sdkConnected: true,
  factory: FACTORY, implementation: IMPLEMENTATION, factoryCodeHash: FACTORY_HASH,
  implementationCodeHash: IMPLEMENTATION_HASH, factoryVerifiedAtBlock: 1,
  blockHash: '0x' + 'aa'.repeat(32), deploymentStatus: 'NO_CODE' })
test('review exposes a documentation draft but never claims a quote or executable deployment', () => {
  const result = deploymentReview(evidence())
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.submissionEnabled, false)
  assert.equal(result.signingEnabled, false)
  assert.equal(result.gasEstimate, null)
  assert.equal(result.maximumFeeWei, null)
  assert.equal(result.sponsorshipConfirmed, false)
  assert.equal(result.documentationDraft.params[0].version, '2.0.0')
  assert.equal(result.installedSdkHelperVersion, '1.0')
  assert.deepEqual(result.documentationDraft.params[0].calls, [{ to: REVIEWED_TESTER, value: '0x0', data: '0x' }])
})
test('another account, wrong chain, manual read, altered contracts or changed deployment cannot receive a draft', () => {
  for (const patch of [{ wallet: '0x' + '11'.repeat(20) }, { chainId: 8453 }, { sdkConnected: false },
    { factoryCodeHash: '0x00' }, { deploymentStatus: 'CONTRACT_CODE' }, { blockHash: 'invalid' }]) {
    assert.throws(() => deploymentReview({ ...evidence(), ...patch }))
  }
})
test('even a displayed send-call draft cannot pass the preparation provider', () => {
  let forwarded = false
  const guarded = guardPreparationProvider({ request: () => { forwarded = true } })
  assert.throws(() => guarded.request(deploymentReview(evidence()).documentationDraft))
  for (const method of ['wallet_prepareCalls', 'eth_signTypedData_v4', 'eth_sendTransaction', 'wallet_sendPreparedCalls']) {
    assert.throws(() => guarded.request({ method }))
  }
  assert.equal(forwarded, false)
})
