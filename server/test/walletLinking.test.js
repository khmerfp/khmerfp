import test from 'node:test'
import assert from 'node:assert/strict'
import { Interface, TypedDataEncoder, id } from 'ethers'
import {
  createWalletLinkService,
  WalletLinkError,
  verifyContractWalletControl,
  walletLinkConfig,
} from '../src/walletLinking/service.js'
import { assertWalletLinkChallenge } from '../../packages/domain/src/walletLinkProtocol.js'

const wallet = `0x${'11'.repeat(20)}`,
  wallet2 = `0x${'22'.repeat(20)}`
const origin = 'http://127.0.0.1:5173'
const actor = { userId: '1', sessionHash: 'a'.repeat(64) },
  other = { userId: '2', sessionHash: 'b'.repeat(64) }
const evidence = { method: 'EIP1271', blockNumber: 10, blockHash: `0x${'cc'.repeat(32)}` }
const error = (status, message = 'Rejected') => new WalletLinkError(message, status)
const status = (expected) => (err) => err.status === expected

test('wallet-link origin permits https or loopback http only', () => {
  for (const origin of [
    'https://khmerfp.example',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]) {
    assert.equal(walletLinkConfig({ WALLET_LINK_APP_ORIGIN: origin }).origin, origin)
  }
  for (const origin of [
    'ftp://localhost',
    'ws://localhost',
    'http://khmerfp.example',
    'https://khmerfp.example/path',
  ]) {
    assert.throws(() => walletLinkConfig({ WALLET_LINK_APP_ORIGIN: origin }), status(503))
  }
})

// a serialized memory fixture tests service policy, not PostgreSQL integration.
function fixture({ verifyControl } = {}) {
  let clock = 2000000000000,
    state = { sessions: new Map(), challenges: new Map(), wallets: new Map(), audits: [] },
    tail = Promise.resolve()
  for (const principal of [actor, other]) {
    state.sessions.set(principal.sessionHash, {
      user_id: principal.userId,
      active: true,
      step_up_at: null,
    })
  }
  const repository = {
    get state() {
      return state
    },
    transaction(work) {
      const run = async () => {
        const snapshot = structuredClone(state)
        const tx = {
          session: async (who) =>
            state.sessions.get(who.sessionHash)?.active
              ? state.sessions.get(who.sessionHash)
              : null,
          lock: async () => {},
          assertChain: async () => {},
          recentCount: async (userId) =>
            [...state.challenges.values()].filter(
              (c) => c.user_id === userId && c.created_at > clock - 60000,
            ).length,
          activeCount: async (userId, chainId) =>
            [...state.wallets.values()].filter(
              (w) =>
                w.user_id === userId &&
                w.chain_id === String(chainId) &&
                w.wallet_status !== 'REVOKED',
            ).length,
          wallet: async (chainId, address) => state.wallets.get(`${chainId}:${address}`),
          list: async (userId) => [...state.wallets.values()].filter((w) => w.user_id === userId),
          insertChallenge: async (c) =>
            state.challenges.set(c.challengeId, {
              id: c.challengeId,
              user_id: c.userId,
              session_hash: c.sessionHash,
              chain_id: String(c.chainId),
              wallet_address: c.wallet,
              action: c.action,
              app_origin: c.origin,
              nonce: c.nonce,
              typed_data: structuredClone(c.typedData),
              payload_hash: c.payloadHash,
              expires_at: c.expiresAt,
              consumed_at: null,
              created_at: clock,
            }),
          challenge: async (challengeId) => state.challenges.get(challengeId),
          consume: async (challengeId) => {
            state.challenges.get(challengeId).consumed_at = new Date(clock)
          },
          save: async (who, c, existing) => {
            const record = {
              ...existing,
              id: existing?.id || String(state.wallets.size + 1),
              user_id: who.userId,
              chain_id: c.chain_id,
              wallet_address: c.wallet_address,
              wallet_type: 'SMART_ACCOUNT',
              custody_model: 'USER_CONTROLLED',
              wallet_status: c.action === 'UNLINK' ? 'REVOKED' : 'ACTIVE',
              ownership_verification_status: 'VERIFIED',
              is_primary: false,
            }
            state.wallets.set(`${c.chain_id}:${c.wallet_address}`, record)
            return record
          },
          audit: async (userId, event, details) => state.audits.push({ userId, event, details }),
        }
        try {
          return await work(tx)
        } catch (err) {
          state = snapshot
          throw err
        }
      }
      const result = tail.then(run)
      tail = result.catch(() => {})
      return result
    },
  }
  const service = createWalletLinkService({
    repository,
    config: { origin, chainId: 84532 },
    now: () => clock,
    verifyControl: verifyControl || (async () => evidence),
  })
  return {
    service,
    repository,
    now: () => clock,
    advance: (ms) => {
      clock += ms
    },
    issue: (who = actor, action = 'LINK', address = wallet) =>
      service.issue(who, { walletAddress: address, action, chainId: 84532 }),
    submit: (challenge, who = actor) =>
      service.verify(who, { challengeId: challenge.challengeId, signature: '0x1234' }),
  }
}

test('links ownership with exact domain/user/session/action binding and grants no permissions', async () => {
  const f = fixture(),
    challenge = await f.issue()
  assertWalletLinkChallenge(challenge, {
    origin,
    wallet,
    userId: actor.userId,
    action: 'LINK',
    domainSalt: id(origin),
    now: f.now(),
  })
  assert.equal(challenge.typedData.domain.name, 'KhmerFP Wallet Ownership')
  assert.notEqual(challenge.typedData.message.sessionBinding, `0x${actor.sessionHash}`)
  assert.equal(challenge.typedData.message.expiresAt - challenge.typedData.message.issuedAt, 120)
  const result = await f.submit(challenge)
  assert.equal(result.wallet.user_id, '1')
  assert.equal(result.wallet.wallet_status, 'ACTIVE')
  assert.equal(result.grantsTradingPermission, false)
  assert.equal(f.repository.state.audits[0].details.method, 'EIP1271')
  assert.equal((await f.service.list(other)).length, 0)
})
test('rejects replay and consumes an invalid signature attempt', async () => {
  const f = fixture(),
    challenge = await f.issue()
  await f.submit(challenge)
  await assert.rejects(f.submit(challenge), status(409))
  const bad = fixture({
      verifyControl: async () => {
        throw error(401)
      },
    }),
    rejected = await bad.issue()
  await assert.rejects(bad.submit(rejected), status(401))
  await assert.rejects(bad.submit(rejected), status(409))
  assert.equal(bad.repository.state.wallets.size, 0)
})
test('rejects other users, rotated sessions, expired challenges and request replacements', async () => {
  const f = fixture(),
    challenge = await f.issue()
  await assert.rejects(f.submit(challenge, other), status(401))
  const rotated = { ...actor, sessionHash: 'c'.repeat(64) }
  f.repository.state.sessions.set(rotated.sessionHash, { user_id: actor.userId, active: true })
  await assert.rejects(f.submit(challenge, rotated), status(401))
  await assert.rejects(
    f.service.verify(actor, {
      challengeId: challenge.challengeId,
      signature: '0x1234',
      walletAddress: wallet2,
    }),
    status(400),
  )
  f.advance(120000)
  await assert.rejects(f.submit(challenge), status(410))
  assert.equal(f.repository.state.wallets.size, 0)
})
test('allows multiple wallets, rejects duplicate links and prevents cross-user takeover', async () => {
  const f = fixture()
  await f.submit(await f.issue())
  await f.submit(await f.issue(actor, 'LINK', wallet2))
  assert.equal((await f.service.list(actor)).length, 2)
  await assert.rejects(f.issue(), status(409))
  await assert.rejects(f.issue(other), status(409))
  await assert.rejects(f.issue(other, 'RELINK'), status(403))
})
test('concurrent attempts for the same wallet have one winner', async () => {
  const f = fixture(),
    first = await f.issue(),
    second = await f.issue(other)
  const results = await Promise.allSettled([f.submit(first), f.submit(second, other)])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(f.repository.state.wallets.size, 1)
  assert.equal(f.repository.state.challenges.get(second.challengeId).consumed_at !== null, true)
})
test('unlink/relink require fresh app step-up and fresh wallet proofs', async () => {
  const f = fixture()
  await f.submit(await f.issue())
  await assert.rejects(f.issue(actor, 'UNLINK'), status(403))
  f.repository.state.sessions.get(actor.sessionHash).step_up_at = new Date(f.now())
  const unlink = await f.issue(actor, 'UNLINK')
  await f.submit(unlink)
  assert.equal(f.repository.state.wallets.values().next().value.wallet_status, 'REVOKED')
  await assert.rejects(f.submit(unlink), status(409))
  await f.submit(await f.issue(actor, 'RELINK'))
  assert.equal(f.repository.state.wallets.values().next().value.wallet_status, 'ACTIVE')
  f.advance(300001)
  await assert.rejects(f.issue(actor, 'UNLINK'), status(403))
})
test('rejects session revocation or expiration while the wallet RPC is in flight', async () => {
  let f
  f = fixture({
    verifyControl: async () => {
      f.repository.state.sessions.get(actor.sessionHash).active = false
      return evidence
    },
  })
  const challenge = await f.issue()
  await assert.rejects(f.submit(challenge), status(401))
  assert.equal(f.repository.state.wallets.size, 0)
  let expired
  expired = fixture({
    verifyControl: async () => {
      expired.advance(120001)
      return evidence
    },
  })
  await assert.rejects(expired.submit(await expired.issue()), status(410))
  assert.equal(expired.repository.state.wallets.size, 0)
})
test('rejects unsupported chains, zero addresses and durable challenge rate excess', async () => {
  const f = fixture()
  await assert.rejects(
    f.service.issue(actor, { walletAddress: wallet, action: 'LINK', chainId: 8453 }),
    status(400),
  )
  await assert.rejects(f.issue(actor, 'LINK', `0x${'0'.repeat(40)}`), status(400))
  for (let i = 0; i < 5; i++) {
    await f.issue()
  }
  await assert.rejects(f.issue(), status(429))
})
test('corrupted stored typed data is rejected and its attempt is consumed', async () => {
  const f = fixture(),
    challenge = await f.issue()
  f.repository.state.challenges.get(challenge.challengeId).typed_data.message.action = 'UNLINK'
  await assert.rejects(f.submit(challenge), status(503))
  assert.equal(f.repository.state.challenges.get(challenge.challengeId).consumed_at !== null, true)
})

test('stored nonce, session binding and expiry cannot disagree with signed challenge terms', async () => {
  for (const tamper of [
    (row) => {
      row.nonce = `0x${'dd'.repeat(32)}`
    },
    (row) => {
      row.typed_data.message.sessionBinding = `0x${'ee'.repeat(32)}`
    },
    (row) => {
      row.expires_at = new Date(new Date(row.expires_at).getTime() + 1000)
    },
  ]) {
    const f = fixture()
    const challenge = await f.issue()
    const row = f.repository.state.challenges.get(challenge.challengeId)
    tamper(row)
    row.payload_hash = TypedDataEncoder.hash(
      row.typed_data.domain,
      row.typed_data.types,
      row.typed_data.message,
    )
    await assert.rejects(f.submit(challenge), status(503))
    assert.ok(row.consumed_at)
    assert.equal(f.repository.state.wallets.size, 0)
  }
})

test('EIP-1271 verifier uses the original digest and rejects undeployed/6492/wrong-chain cases', async () => {
  const abi = new Interface(['function isValidSignature(bytes32,bytes) view returns(bytes4)'])
  const digest = TypedDataEncoder.hash(
    { name: 'Wallet Link Test', chainId: 84532 },
    { Test: [{ name: 'nonce', type: 'uint256' }] },
    { nonce: 1 },
  )
  let code = '0x6000',
    magic = '0x1626ba7e',
    calls = 0,
    destroyed = 0
  const rpc = {
    getNetwork: async () => ({ chainId: 84532n }),
    getCode: async () => code,
    getBlock: async () => ({ number: 10, hash: evidence.blockHash }),
    destroy: () => {
      destroyed++
    },
    call: async (transaction) => {
      const args = abi.decodeFunctionData('isValidSignature', transaction.data)
      assert.equal(args[0], digest)
      calls++
      return abi.encodeFunctionResult('isValidSignature', [magic])
    },
  }
  const input = { chainId: 84532, wallet, digest, signature: '0x1234' },
    options = { rpcFactory: () => rpc }
  assert.deepEqual(await verifyContractWalletControl(input, options), evidence)
  magic = '0xffffffff'
  await assert.rejects(verifyContractWalletControl(input, options), status(401))
  code = '0x'
  await assert.rejects(verifyContractWalletControl(input, options), status(422))
  await assert.rejects(
    verifyContractWalletControl({ ...input, signature: `0x1234${'6492'.repeat(16)}` }, options),
    status(422),
  )
  await assert.rejects(
    verifyContractWalletControl({ ...input, chainId: 8453 }, options),
    status(400),
  )
  assert.equal(calls, 2)
  assert.equal(destroyed, 3)
})
test('EIP-1271 RPC timeout destroys the provider and never confirms control', async () => {
  let destroyed = false
  await assert.rejects(
    verifyContractWalletControl(
      { chainId: 84532, wallet, digest: id('digest'), signature: '0x1234' },
      {
        rpcFactory: () => ({
          getNetwork: () => new Promise(() => {}),
          destroy: () => {
            destroyed = true
          },
        }),
        timeoutMs: 5,
      },
    ),
    status(503),
  )
  assert.equal(destroyed, true)
})
