import { randomBytes, randomUUID } from 'node:crypto'
import {
  Contract,
  FetchRequest,
  JsonRpcProvider,
  TypedDataEncoder,
  getAddress,
  id,
  keccak256,
} from 'ethers'
import {
  WALLET_LINK_ACTIONS,
  WALLET_LINK_CHAIN,
  WALLET_LINK_NAME,
  WALLET_LINK_VERSION,
  WALLET_LINK_TTL_SECONDS,
  walletLinkTypes,
  isWalletLinkChallengeId,
  assertWalletLinkChallenge,
} from '../../../packages/domain/src/walletLinkProtocol.js'

export class WalletLinkError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
export const fail = (message, status = 400) => {
  throw new WalletLinkError(message, status)
}
const sensitive = (action) => action === 'UNLINK' || action === 'RELINK'

export function walletLinkConfig(env = process.env) {
  const origin = env.WALLET_LINK_APP_ORIGIN
  if (!origin) {
    fail('Wallet linking needs a reviewed application origin.', 503)
  }
  const parsed = new URL(origin)
  const localHttp =
    parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)
  if (parsed.origin !== origin || (parsed.protocol !== 'https:' && !localHttp)) {
    fail('Invalid wallet-link application origin.', 503)
  }
  return { origin, chainId: WALLET_LINK_CHAIN }
}

export async function verifyContractWalletControl(
  { chainId, wallet, digest, signature },
  {
    rpcFactory = (request) =>
      new JsonRpcProvider(request, WALLET_LINK_CHAIN, { cacheTimeout: -1, batchMaxCount: 1 }),
    timeoutMs = 10000,
  } = {},
) {
  if (chainId !== WALLET_LINK_CHAIN) {
    fail('Unsupported wallet-link chain.')
  }
  if (typeof signature !== 'string' || !/^0x(?:[0-9a-f]{2}){1,4096}$/i.test(signature)) {
    fail('Invalid signature.', 401)
  }
  if (signature.toLowerCase().endsWith('6492'.repeat(16))) {
    fail(
      'Undeployed or EIP-6492 wallet signatures are not supported. No deployment or factory execution will be performed.',
      422,
    )
  }
  const request = new FetchRequest('https://sepolia.base.org')
  request.timeout = 4000
  const rpc = rpcFactory(request)
  let timer
  try {
    return await Promise.race([
      (async () => {
        if ((await rpc.getNetwork()).chainId !== BigInt(WALLET_LINK_CHAIN)) {
          fail('Wallet verification network mismatch.', 503)
        }
        const block = await rpc.getBlock('latest')
        if (!block) {
          fail('Wallet verification unavailable.', 503)
        }
        if ((await rpc.getCode(wallet, block.number)) === '0x') {
          fail('Smart wallet is not deployed on Base Sepolia; ownership is not verified.', 422)
        }
        const contract = new Contract(
          wallet,
          ['function isValidSignature(bytes32,bytes) view returns(bytes4)'],
          rpc,
        )
        const valid = await contract.isValidSignature(digest, signature, {
          blockTag: block.number,
          gasLimit: 500000,
        })
        if (valid !== '0x1626ba7e') {
          fail('Wallet ownership signature was rejected.', 401)
        }
        if ((await rpc.getBlock(block.number))?.hash !== block.hash) {
          fail('Verification block changed; request a new challenge.', 503)
        }
        return { method: 'EIP1271', blockNumber: block.number, blockHash: block.hash }
      })(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new WalletLinkError('Wallet verification timed out. Request a new challenge.', 503),
            ),
          timeoutMs,
        )
      }),
    ])
  } catch (error) {
    if (error instanceof WalletLinkError) {
      throw error
    }
    if (error.code === 'CALL_EXCEPTION' || error.code === 'BAD_DATA') {
      fail('Wallet ownership signature was rejected.', 401)
    }
    fail('Wallet verification unavailable. Request a new challenge later.', 503)
  } finally {
    clearTimeout(timer)
    rpc.destroy()
  }
}

export function createWalletLinkService({
  repository,
  config,
  verifyControl = verifyContractWalletControl,
  now = Date.now,
}) {
  function assertSession(session, actor, action) {
    if (!session || String(session.user_id) !== String(actor.userId)) {
      fail('Application session is no longer valid.', 401)
    }
    if (
      sensitive(action) &&
      (!session.step_up_at ||
        now() - new Date(session.step_up_at).getTime() > 300000 ||
        new Date(session.step_up_at).getTime() > now())
    ) {
      fail(
        'Fresh application step-up authentication is required before unlinking or relinking.',
        403,
      )
    }
  }
  function actorValid(actor) {
    if (
      !actor ||
      !/^[1-9][0-9]*$/.test(String(actor.userId)) ||
      !/^[a-f0-9]{64}$/.test(actor.sessionHash || '')
    ) {
      fail('Authentication required.', 401)
    }
  }
  function checkWallet(record, actor, action) {
    if (record && String(record.user_id) !== String(actor.userId)) {
      fail('Wallet cannot be linked to this account.', 409)
    }
    if (record?.wallet_status === 'SUSPENDED') {
      fail('Suspended wallets require administrator review.', 409)
    }
    if (
      record &&
      (record.wallet_type !== 'SMART_ACCOUNT' || record.custody_model !== 'USER_CONTROLLED')
    ) {
      fail('This wallet identity needs a separate custody review.', 409)
    }
    if (action === 'LINK' && record) {
      fail(
        'Wallet already has an identity record; use a fresh relink proof if it was revoked.',
        409,
      )
    }
    if (action === 'UNLINK' && record?.wallet_status !== 'ACTIVE') {
      fail('Wallet is not actively linked.', 409)
    }
    if (action === 'RELINK' && record?.wallet_status !== 'REVOKED') {
      fail('Only a revoked wallet belonging to this user may be relinked.', 409)
    }
  }
  return {
    async list(actor) {
      actorValid(actor)
      return repository.transaction(async (tx) => {
        assertSession(await tx.session(actor), actor, 'LINK')
        return tx.list(actor.userId)
      })
    },
    async issue(actor, body) {
      actorValid(actor)
      if (
        !body ||
        Object.keys(body).sort().join() !== 'action,chainId,walletAddress' ||
        body.chainId !== config.chainId ||
        !WALLET_LINK_ACTIONS.includes(body.action)
      ) {
        fail('Invalid wallet-link request.')
      }
      let wallet
      try {
        wallet = getAddress(body.walletAddress).toLowerCase()
      } catch {
        fail('Invalid wallet address.')
      }
      if (/^0x0{40}$/.test(wallet)) {
        fail('Zero wallet address is not allowed.')
      }
      return repository.transaction(async (tx) => {
        assertSession(await tx.session(actor), actor, body.action)
        await tx.lock(actor.userId, config.chainId, wallet)
        if ((await tx.recentCount(actor.userId)) >= 5) {
          fail('Too many wallet-link challenges. Wait one minute.', 429)
        }
        await tx.assertChain(config.chainId)
        checkWallet(await tx.wallet(config.chainId, wallet), actor, body.action)
        if (
          body.action !== 'UNLINK' &&
          (await tx.activeCount(actor.userId, config.chainId)) >= 10
        ) {
          fail('Wallet limit reached.', 409)
        }
        const challengeId = randomUUID(),
          nonce = `0x${randomBytes(32).toString('hex')}`,
          issuedAt = Math.floor(now() / 1000)
        const typedData = {
          domain: {
            name: WALLET_LINK_NAME,
            version: WALLET_LINK_VERSION,
            chainId: config.chainId,
            salt: id(config.origin),
          },
          types: walletLinkTypes,
          primaryType: 'WalletLink',
          message: {
            challengeId,
            action: body.action,
            userId: String(actor.userId),
            wallet,
            sessionBinding: id(`${actor.userId}:${actor.sessionHash}:${nonce}`),
            appOrigin: config.origin,
            nonce,
            issuedAt,
            expiresAt: issuedAt + WALLET_LINK_TTL_SECONDS,
          },
        }
        const payloadHash = TypedDataEncoder.hash(
          typedData.domain,
          typedData.types,
          typedData.message,
        )
        await tx.insertChallenge({
          challengeId,
          userId: actor.userId,
          sessionHash: actor.sessionHash,
          wallet,
          chainId: config.chainId,
          action: body.action,
          origin: config.origin,
          nonce,
          typedData,
          payloadHash,
          expiresAt: new Date(typedData.message.expiresAt * 1000),
        })
        return { challengeId, typedData }
      })
    },
    async verify(actor, body) {
      actorValid(actor)
      if (
        !body ||
        Object.keys(body).sort().join() !== 'challengeId,signature' ||
        !isWalletLinkChallengeId(body.challengeId)
      ) {
        fail('Invalid wallet-link proof.')
      }
      const result = await repository.transaction(async (tx) => {
        const session = await tx.session(actor)
        assertSession(session, actor, 'LINK')
        const challenge = await tx.challenge(body.challengeId)
        if (
          !challenge ||
          String(challenge.user_id) !== String(actor.userId) ||
          challenge.session_hash !== actor.sessionHash ||
          challenge.app_origin !== config.origin
        ) {
          fail('Challenge does not belong to this user and session.', 401)
        }
        if (challenge.consumed_at) {
          fail('Challenge has already been used.', 409)
        }
        if (new Date(challenge.expires_at).getTime() <= now()) {
          fail('Challenge expired.', 410)
        }
        assertSession(session, actor, challenge.action)
        await tx.consume(challenge.id)
        // commit failed attempts too, so a proof can never be tried repeatedly.
        try {
          try {
            assertWalletLinkChallenge(
              { challengeId: challenge.id, typedData: challenge.typed_data },
              {
                origin: config.origin,
                wallet: challenge.wallet_address,
                userId: actor.userId,
                action: challenge.action,
                domainSalt: id(config.origin),
                now: now(),
              },
            )
            const message = challenge.typed_data.message
            if (
              message.nonce !== challenge.nonce ||
              message.sessionBinding !==
                id(`${actor.userId}:${actor.sessionHash}:${challenge.nonce}`) ||
              message.expiresAt * 1000 !== new Date(challenge.expires_at).getTime()
            ) {
              fail('Stored challenge binding check failed.', 503)
            }
          } catch {
            fail('Stored challenge integrity check failed.', 503)
          }
          const digest = TypedDataEncoder.hash(
            challenge.typed_data.domain,
            challenge.typed_data.types,
            challenge.typed_data.message,
          )
          if (digest !== challenge.payload_hash) {
            fail('Stored challenge integrity check failed.', 503)
          }
          const evidence = await verifyControl({
            chainId: Number(challenge.chain_id),
            wallet: challenge.wallet_address,
            digest,
            signature: body.signature,
          })
          if (
            evidence?.method !== 'EIP1271' ||
            !Number.isSafeInteger(evidence.blockNumber) ||
            !/^0x[0-9a-f]{64}$/i.test(evidence.blockHash || '')
          ) {
            fail('Wallet verification returned incomplete evidence.', 503)
          }
          assertSession(await tx.session(actor), actor, challenge.action)
          if (new Date(challenge.expires_at).getTime() <= now()) {
            fail('Challenge expired while verifying.', 410)
          }
          await tx.lock(actor.userId, Number(challenge.chain_id), challenge.wallet_address)
          await tx.assertChain(Number(challenge.chain_id))
          const record = await tx.wallet(Number(challenge.chain_id), challenge.wallet_address)
          checkWallet(record, actor, challenge.action)
          if (
            challenge.action !== 'UNLINK' &&
            (await tx.activeCount(actor.userId, Number(challenge.chain_id))) >= 10
          ) {
            fail('Wallet limit reached.', 409)
          }
          const linked = await tx.save(actor, challenge, record)
          await tx.audit(actor.userId, 'wallet_ownership_changed', {
            challengeId: challenge.id,
            action: challenge.action,
            walletId: String(linked.id),
            payloadHash: digest,
            signatureHash: keccak256(body.signature),
            ...evidence,
          })
          return { wallet: linked, grantsTradingPermission: false }
        } catch (error) {
          if (!(error instanceof WalletLinkError)) {
            throw error
          }
          await tx.audit(actor.userId, 'wallet_ownership_rejected', {
            challengeId: challenge.id,
            status: error.status,
          })
          return { error }
        }
      })
      if (result.error) {
        throw result.error
      }
      return result
    },
  }
}
