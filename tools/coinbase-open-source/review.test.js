// test separate-wallet inputs and official ownership signature reference values.
﻿import test from 'node:test'
import assert from 'node:assert/strict'
import { AbiCoder, Interface } from 'ethers'
import { prepareSeparateWallet, assertSeparatePrediction, replaySafeOwnershipHash,
  wrapEoaOwnerSignature, EXISTING_TESTER } from './review.js'
import { FACTORY, FACTORY_ABI } from '../coinbase-deployment/preview.js'
const owner = '0x1111111111111111111111111111111111111111'
const separate = '0x2222222222222222222222222222222222222222'
const input = { chainId: 84532, ownerAddress: owner, deploymentNonce: '7' }

test('separate wallet draft encodes the explicit public owner and selected nonce without deployment', () => {
  const plan = prepareSeparateWallet(input)
  const parsed = new Interface(FACTORY_ABI).parseTransaction({ data: plan.transactionDraft.data })
  assert.equal(parsed.name, 'createAccount')
  assert.equal(parsed.args[1], 7n)
  assert.equal(AbiCoder.defaultAbiCoder().decode(['address'], parsed.args[0][0])[0], owner)
  assert.equal(plan.transactionDraft.to, FACTORY)
  assert.equal(plan.transactionDraft.value, '0x0')
  assert.equal(plan.ownerIndex, '0')
  assert.equal(plan.executionEnabled, false)
  assert.equal(plan.provesExistingSdkAccount, false)
  assert.equal(plan.ownerControlVerified, false)
})
test('no guessed nonce, extra owner metadata, zero owner or mainnet is accepted', () => {
  for (const change of [{ deploymentNonce: undefined }, { deploymentNonce: '-1' },
    { deploymentNonce: (2n ** 256n).toString() }, { ownerAddress: `0x${'0'.repeat(40)}` },
    { chainId: 8453 }, { ownerAddress: EXISTING_TESTER }, { privateKey: 'not-accepted' }]) {
    assert.throws(() => prepareSeparateWallet({ ...input, ...change }))
  }
})
test('new account prediction cannot silently substitute the existing SDK wallet or owner', () => {
  assert.equal(assertSeparatePrediction(separate, owner), separate)
  for (const value of [EXISTING_TESTER, owner, FACTORY, `0x${'0'.repeat(40)}`]) {
    assert.throws(() => assertSeparatePrediction(value, owner))
  }
})
test('replay-safe hash matches the independent official ERC1271.t.sol static vector', () => {
  // upstream a4e83fd, test/ERC1271.t.sol:test_static; no private key or signing.
  assert.equal(replaySafeOwnershipHash({ chainId: 84532,
    wallet: '0x2Af621c1B01466256393EBA6BF183Ac2962fd98C',
    ownershipDigest: '0x9ef3f7124243b092c883252302a74d4ed968efc9f612396f1a82bbeef8931328',
  }), '0x1b03b7e3bddbb2f9b5080f154cf33fcbed9b9cd42c98409fb0730369426a0a69')
})
test('wallet, message and chain binding remain strict', () => {
  const base = { chainId: 84532, wallet: separate, ownershipDigest: `0x${'ab'.repeat(32)}` }
  const hash = replaySafeOwnershipHash(base)
  assert.notEqual(hash, replaySafeOwnershipHash({ ...base, wallet: owner }))
  assert.notEqual(hash, replaySafeOwnershipHash({ ...base, ownershipDigest: `0x${'cd'.repeat(32)}` }))
  assert.notEqual(hash, base.ownershipDigest)
  assert.throws(() => replaySafeOwnershipHash({ ...base, chainId: 8453 }))
  assert.throws(() => replaySafeOwnershipHash({ ...base, ownershipDigest: '0x12' }))
})
test('owner signature wrapper uses the official tuple; fake bytes do not imply a valid signature', () => {
  const fake = `0x${'11'.repeat(64)}1b`
  const wrapper = wrapEoaOwnerSignature({ ownerIndex: '0', signature: fake })
  const [result] = AbiCoder.defaultAbiCoder().decode(['tuple(uint256 ownerIndex,bytes signatureData)'], wrapper)
  assert.equal(result.ownerIndex, 0n)
  assert.equal(result.signatureData, fake)
  assert.throws(() => wrapEoaOwnerSignature({ ownerIndex: '1', signature: fake }))
  assert.throws(() => wrapEoaOwnerSignature({ ownerIndex: '0', signature: '0x1234' }))
})
