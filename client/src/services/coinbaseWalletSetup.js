// check account readiness without signing, deployment or permission requests.
import { FetchRequest, JsonRpcProvider, getAddress } from 'ethers'
import { WALLET_LINK_CHAIN } from '../../../packages/domain/src/walletLinkProtocol.js'

// review and pending states stay reserved until an account-specific setup path is verified.
export const WALLET_SETUP_STATES = Object.freeze({
  DISCONNECTED: 'DISCONNECTED',
  SETUP_REQUIRED: 'SETUP_REQUIRED',
  SETUP_UNAVAILABLE: 'SETUP_UNAVAILABLE',
  SETUP_READY_FOR_REVIEW: 'SETUP_READY_FOR_REVIEW',
  SETUP_PENDING_CONFIRMATION: 'SETUP_PENDING_CONFIRMATION',
  CODE_DETECTED: 'CODE_DETECTED',
  DEPLOYED_AND_VERIFIED: 'DEPLOYED_AND_VERIFIED',
  OWNERSHIP_VERIFIED: 'OWNERSHIP_VERIFIED',
  LINKED: 'LINKED',
})

export async function inspectCoinbaseWalletSetup(connection, {
  rpcFactory = request => new JsonRpcProvider(request, WALLET_LINK_CHAIN, {
    cacheTimeout: -1, batchMaxCount: 1,
  }),
  signal,
  timeoutMs = 10000,
} = {}) {
  if (!connection) return { state: WALLET_SETUP_STATES.DISCONNECTED, deployed: false }
  const address = getAddress(connection.address)
  if (/^0x0{40}$/i.test(address)) throw new Error('A valid nonzero wallet address is required.')
  const result = {
    address, chainId: WALLET_LINK_CHAIN, deployed: false,
    state: WALLET_SETUP_STATES.SETUP_UNAVAILABLE,
    setupMechanism: null, feePayer: null, maximumCostWei: null, setupEffects: null,
    submissionEnabled: false, ownershipVerified: false,
  }
  let rpc, timer
  let finished = false
  const active = () => {
    if (finished || signal?.aborted) throw new DOMException('Setup check cancelled.', 'AbortError')
  }
  const checkWallet = async () => {
    active()
    const accounts = await connection.provider.request({ method: 'eth_accounts' })
    const chain = await connection.provider.request({ method: 'eth_chainId' })
    active()
    if (BigInt(chain) !== BigInt(WALLET_LINK_CHAIN)) throw new Error('Base Sepolia is required.')
    if (!accounts?.[0] || getAddress(accounts[0]) !== address) {
      throw new Error('Wallet account or network changed. Connect again.')
    }
  }
  try {
    return await Promise.race([
      (async () => {
        await checkWallet()
        const request = new FetchRequest('https://sepolia.base.org')
        request.timeout = 4000
        rpc = rpcFactory(request)
        const network = await rpc.getNetwork()
        active()
        if (network.chainId !== BigInt(WALLET_LINK_CHAIN)) {
          throw new Error('Wallet read network mismatch.')
        }
        const block = await rpc.getBlock('latest')
        if (!block || !Number.isSafeInteger(block.number) || !/^0x[0-9a-f]{64}$/i.test(block.hash)) {
          throw new Error('Setup block evidence unavailable.')
        }
        active()
        const code = await rpc.getCode(address, block.number)
        active()
        if (!/^0x(?:[0-9a-f]{2})*$/i.test(code)) throw new Error('Invalid deployment code response.')
        if ((await rpc.getBlock(block.number))?.hash !== block.hash) throw new Error('Setup block changed. Retry the check.')
        await checkWallet()
        return {
          ...result, deployed: code !== '0x',
          state: code === '0x' ? WALLET_SETUP_STATES.SETUP_UNAVAILABLE : WALLET_SETUP_STATES.CODE_DETECTED,
          setupRequired: code === '0x', blockNumber: block.number, blockHash: block.hash,
          message: code === '0x'
            ? 'Wallet is undeployed. Setup unavailable: a supported setup operation and fee quote for this account have not been verified. No deployment or funds will be requested.'
            : 'Contract code detected on Base Sepolia. Wallet ownership and compatibility still require backend verification.',
        }
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Setup check timed out.')), timeoutMs) }),
    ])
  } catch (error) {
    if (error.name === 'AbortError' || /network mismatch|Base Sepolia is required|account or network changed/.test(error.message)) throw error
    return { ...result, message: 'Setup unavailable: deployment status could not be checked. Retry the read-only check; ownership signing remains blocked.' }
  } finally {
    finished = true
    clearTimeout(timer)
    rpc?.destroy()
  }
}
