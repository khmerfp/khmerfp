// exercise real ECDSA verification against an isolated in-memory RPC boundary.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Wallet, id } from 'ethers'
import { verifyEmbeddedWalletControl, verifyContractWalletControl, walletLinkConfig } from '../src/walletLinking/service.js'

const owner = Wallet.createRandom(), other = Wallet.createRandom(), digest = id('isolated-cdp-ownership')
const hash = '0x' + 'ab'.repeat(32)
function options({ code = '0x', chain = 84532n, changedBlock = false } = {}) {
  let reads = 0
  return { rpcFactory: () => ({ getNetwork: async () => ({ chainId: chain }),
    getBlock: async () => ({ number: 1, hash: changedBlock && reads++ ? '0x' + 'cd'.repeat(32) : hash }),
    getCode: async () => code, destroy() {},
    call: async () => { throw Object.assign(new Error('Invalid contract signature'), { code: 'CALL_EXCEPTION' }) },
  }) }
}
const proof = (wallet = owner, message = digest) => ({ chainId: 84532, wallet: owner.address,
  digest: message, signature: wallet.signingKey.sign(digest).serialized })

test('embedded EOA opt-in is ignored in production, staging and without an explicit flag', () => {
  for (const NODE_ENV of ['production', 'staging', undefined]) assert.equal(walletLinkConfig({
    WALLET_LINK_APP_ORIGIN: 'http://127.0.0.1:5173', CDP_EMBEDDED_WALLET_ENABLED: 'true', NODE_ENV,
  }).embeddedEoa, false)
  assert.equal(walletLinkConfig({ WALLET_LINK_APP_ORIGIN: 'http://127.0.0.1:5173',
    NODE_ENV: 'test', CDP_EMBEDDED_WALLET_ENABLED: 'true' }).embeddedEoa, true)
})
test('empty-code embedded EOA accepts a valid signature and reports its distinct verification method', async () => {
  assert.deepEqual(await verifyEmbeddedWalletControl(proof(), options()), {
    method: 'EIP712_EOA', blockNumber: 1, blockHash: hash,
  })
})
test('wrong signer, changed message, invalid bytes, wrong chain and changed block are rejected', async () => {
  for (const input of [proof(other), proof(owner, id('altered')), { ...proof(), signature: '0x1234' }]) {
    await assert.rejects(verifyEmbeddedWalletControl(input, options()), e => e.status === 401)
  }
  await assert.rejects(verifyEmbeddedWalletControl({ ...proof(), chainId: 8453 }, options()), /Unsupported/)
  await assert.rejects(verifyEmbeddedWalletControl(proof(), options({ chain: 8453n })), /network mismatch/)
  await assert.rejects(verifyEmbeddedWalletControl(proof(), options({ changedBlock: true })), /block changed/)
})
test('contract and delegated addresses never fall back to EOA recovery', async () => {
  for (const code of ['0x6000', '0xef0100' + '11'.repeat(20)]) {
    await assert.rejects(verifyEmbeddedWalletControl(proof(), options({ code })), e => e.status === 401)
  }
  await assert.rejects(verifyContractWalletControl(proof(), options()), e => e.status === 422)
})
test('undeployed smart-account and EIP-6492 wrappers are not accepted as EOA proofs', async () => {
  await assert.rejects(verifyEmbeddedWalletControl({ ...proof(), signature: proof().signature + '6492'.repeat(16) }, options()), e => e.status === 422)
  await assert.rejects(verifyEmbeddedWalletControl({ ...proof(), wallet: other.address }, options()), e => e.status === 401)
})

test('malformed RPC blocks and bytecode fail closed before any signature call', async () => {
  for (const block of [null, { number: -1, hash }, { number: 1 }, { number: 1.5, hash }, { number: 1, hash: 'invalid' }]) {
    let calls = 0
    const input = { chainId: 84532, wallet: owner.address, digest, signature: '0x' + '11'.repeat(65) }
    const rpcFactory = () => ({ getNetwork: async () => ({ chainId: 84532n }),
      getBlock: async () => block, getCode: async () => '0x6000', destroy() {},
      call: async () => { calls++; throw new Error('Must not call') },
    })
    await assert.rejects(verifyEmbeddedWalletControl(input, { rpcFactory }), e => e.status === 503)
    assert.equal(calls, 0)
  }
  for (const code of [null, '0x0', '0xzz', 'not-bytecode']) {
    await assert.rejects(verifyEmbeddedWalletControl({ chainId: 84532, wallet: owner.address, digest,
      signature: '0x' + '11'.repeat(65) }, options({ code })), e => e.status === 503)
  }
})
