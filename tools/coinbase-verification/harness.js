// prepare and verify isolated ownership challenges without saving account links.
﻿import { randomBytes, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { FetchRequest, JsonRpcProvider, TypedDataEncoder, getAddress, id, keccak256 } from 'ethers'
import {
  WALLET_LINK_CHAIN, WALLET_LINK_NAME, WALLET_LINK_VERSION,
  WALLET_LINK_TTL_SECONDS, walletLinkTypes, assertWalletLinkChallenge,
} from '../../packages/domain/src/walletLinkProtocol.js'
import { verifyContractWalletControl } from '../../server/src/walletLinking/service.js'

export const MAGIC = '0x1626ba7e'
export const ORIGIN = 'http://127.0.0.1:5184'
const reject = (message) => { throw new Error(message) }

export function harnessConfig(env = {}) {
  if (env.COINBASE_PROBE_ENABLED !== 'true' || env.COINBASE_PROBE_ACK !== 'ISOLATED_TEST_ONLY') {
    reject('Explicit isolated-test opt-in is required.')
  }
  if (env.COINBASE_PROBE_CHAIN_ID && env.COINBASE_PROBE_CHAIN_ID !== String(WALLET_LINK_CHAIN)) {
    reject('Only Base Sepolia 84532 is allowed.')
  }
  if (env.COINBASE_PROBE_MAGIC && env.COINBASE_PROBE_MAGIC !== MAGIC) reject('EIP-1271 magic value cannot change.')
  const wallet = getAddress(env.COINBASE_PROBE_WALLET || '')
  if (/^0x0{40}$/i.test(wallet)) reject('A nonzero deployed tester wallet address is required.')
  const rpcUrl = new URL(env.COINBASE_PROBE_RPC_URL || 'https://sepolia.base.org')
  if (rpcUrl.protocol !== 'https:' || rpcUrl.username || rpcUrl.password || rpcUrl.search || rpcUrl.hash ||
      rpcUrl.port || isIP(rpcUrl.hostname) || !rpcUrl.hostname.includes('.') ||
      /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(rpcUrl.hostname)) {
    reject('Use a reviewed public HTTPS RPC hostname without credentials or query parameters.')
  }
  return Object.freeze({ wallet, chainId: WALLET_LINK_CHAIN, rpcUrl: rpcUrl.href, origin: ORIGIN, magic: MAGIC })
}

// no transaction or arbitrary contract call can pass this transport.
export function assertReadOnlyRequest(method, params, wallet) {
  if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(method)) {
    reject('RPC method is not allowed.')
  }
  if (method === 'eth_getCode' && getAddress(params[0]) !== wallet) reject('Unexpected RPC wallet.')
  if (method === 'eth_call') {
    const tx = params[0]
    if (getAddress(tx.to) !== wallet || !/^0x1626ba7e[0-9a-f]*$/i.test(tx.data || '') ||
        Object.keys(tx).some(key => !['to', 'data', 'gas'].includes(key))) {
      reject('Only the expected wallet EIP-1271 read is allowed.')
    }
  }
}

export function publicRpcFactory(config) {
  return () => {
    const request = new FetchRequest(config.rpcUrl)
    request.timeout = 4000
    class ReadOnlyProvider extends JsonRpcProvider {
      async send(method, params) {
        assertReadOnlyRequest(method, params, config.wallet)
        return super.send(method, params)
      }
    }
    return new ReadOnlyProvider(request, config.chainId, { cacheTimeout: -1, batchMaxCount: 1 })
  }
}

const freeze = (object) => {
  for (const value of Object.values(object)) if (value && typeof value === 'object') freeze(value)
  return Object.freeze(object)
}

export function createHarness(config, { rpcFactory = publicRpcFactory(config), now = Date.now, timeoutMs = 10000 } = {}) {
  let record
  let preflightInProgress = false
  async function preflight() {
    if (preflightInProgress) reject('Preflight already in progress.')
    preflightInProgress = true
    let rpc, timer
    try {
      rpc = rpcFactory()
      return await Promise.race([
        (async () => {
          if ((await rpc.getNetwork()).chainId !== BigInt(WALLET_LINK_CHAIN)) reject('RPC chain mismatch.')
          const block = await rpc.getBlock('latest')
          if (!block || !Number.isSafeInteger(block.number) || !/^0x[0-9a-f]{64}$/i.test(block.hash)) {
            reject('RPC block evidence unavailable.')
          }
          const code = await rpc.getCode(config.wallet, block.number)
          if (!/^0x(?:[0-9a-f]{2})+$/i.test(code)) reject('Wallet has no deployed contract code.')
          if (code.toLowerCase().startsWith('0xef0100')) reject('Delegated account requires separate review.')
          if ((await rpc.getBlock(block.number))?.hash !== block.hash) reject('Verification block changed.')
          return { chainId: WALLET_LINK_CHAIN, deployed: true, blockNumber: block.number, blockHash: block.hash, codeHash: keccak256(code) }
        })(),
        new Promise((_resolve, fail) => { timer = setTimeout(() => fail(new Error('Preflight timed out.')), timeoutMs) }),
      ])
    } finally {
      clearTimeout(timer)
      rpc?.destroy()
      preflightInProgress = false
    }
  }
  function expected() {
    return { origin: config.origin, wallet: config.wallet, userId: '1', action: 'LINK', domainSalt: id(config.origin), now: now() }
  }
  return {
    preflight,
    async issue() {
      // claiming before the first await prevents parallel challenge replacement.
      if (record?.state === 'ISSUING' || record?.state === 'VERIFYING') reject('An attempt is in progress.')
      record = { state: 'ISSUING' }
      try {
        await preflight()
        const challengeId = randomUUID()
        const nonce = `0x${randomBytes(32).toString('hex')}`
        const sessionHash = randomBytes(32).toString('hex')
        const issuedAt = Math.floor(now() / 1000)
        const challenge = freeze({ challengeId, typedData: {
          domain: { name: WALLET_LINK_NAME, version: WALLET_LINK_VERSION, chainId: WALLET_LINK_CHAIN, salt: id(config.origin) },
          types: structuredClone(walletLinkTypes), primaryType: 'WalletLink',
          message: { challengeId, action: 'LINK', userId: '1', wallet: config.wallet,
            sessionBinding: id(`1:${sessionHash}:${nonce}`), appOrigin: config.origin, nonce,
            issuedAt, expiresAt: issuedAt + WALLET_LINK_TTL_SECONDS },
        } })
        const data = assertWalletLinkChallenge(challenge, expected())
        const digest = TypedDataEncoder.hash(data.domain, data.types, data.message)
        record = { state: 'ISSUED', challenge, digest }
        return structuredClone(challenge)
      } catch (error) { record = { state: 'FAILED' }; throw error }
    },
    async verify(body) {
      if (!record || record.state !== 'ISSUED') reject('Challenge is missing, used or in progress.')
      const attempt = record
      attempt.state = 'VERIFYING'
      try {
        if (!body || Object.keys(body).sort().join() !== 'challenge,signature,walletAddress' ||
            getAddress(body.walletAddress) !== config.wallet) reject('Unexpected wallet or proof fields.')
        const data = assertWalletLinkChallenge(body.challenge, expected())
        const digest = TypedDataEncoder.hash(data.domain, data.types, data.message)
        if (body.challenge.challengeId !== attempt.challenge.challengeId || digest !== attempt.digest) {
          reject('Challenge was altered or replaced.')
        }
        const evidence = await verifyContractWalletControl({ chainId: config.chainId, wallet: config.wallet,
          digest: attempt.digest, signature: body.signature }, { rpcFactory, timeoutMs })
        assertWalletLinkChallenge(attempt.challenge, expected())
        attempt.state = 'USED'
        return { verified: true, chainId: config.chainId, method: evidence.method,
          blockNumber: evidence.blockNumber, blockHash: evidence.blockHash,
          magicValue: MAGIC, signatureBytes: (body.signature.length - 2) / 2 }
      } catch (error) { attempt.state = 'FAILED'; throw error }
    },
  }
}
