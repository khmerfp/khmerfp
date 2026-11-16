import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TypedDataEncoder, id } from 'ethers'
import { assertWalletLinkChallenge } from '../../packages/domain/src/walletLinkProtocol.js'
import { verifyContractWalletControl } from '../src/walletLinking/service.js'

// explicit, read-only live proof; never create or deploy a wallet to make this pass.
test(
  'real Coinbase deployed account verifies a fresh ownership challenge on Base Sepolia',
  {
    skip:
      process.env.WALLET_LINK_REAL_VERIFY === 'true' ? false : 'real Coinbase proof not supplied',
    timeout: 15000,
  },
  async () => {
    assert.equal(process.env.NODE_ENV, 'test')
    assert.ok(process.env.WALLET_LINK_REAL_PROOF_FILE, 'fresh proof file required')
    assert.ok(process.env.WALLET_LINK_REAL_USER_ID, 'expected application user required')
    assert.ok(process.env.WALLET_LINK_REAL_ORIGIN, 'expected application origin required')
    const proof = JSON.parse(readFileSync(process.env.WALLET_LINK_REAL_PROOF_FILE, 'utf8'))
    const { challenge, walletAddress, signature } = proof
    const typedData = assertWalletLinkChallenge(challenge, {
      origin: process.env.WALLET_LINK_REAL_ORIGIN,
      wallet: walletAddress,
      userId: process.env.WALLET_LINK_REAL_USER_ID,
      action: 'LINK',
      domainSalt: id(process.env.WALLET_LINK_REAL_ORIGIN),
    })
    const digest = TypedDataEncoder.hash(typedData.domain, typedData.types, typedData.message)
    const result = await verifyContractWalletControl({
      chainId: 84532,
      wallet: walletAddress,
      digest,
      signature,
    })
    assert.equal(result.method, 'EIP1271')
    assert.ok(result.blockNumber >= 0)
    assert.match(result.blockHash, /^0x[0-9a-f]{64}$/i)
    // verification alone never writes a user identity or consumes a server challenge.
  },
)
