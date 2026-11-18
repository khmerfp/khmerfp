// connect the coinbase wallet and sign ownership proofs only after user action.
import { BrowserProvider, getAddress } from 'ethers'
import { inspectCoinbaseWalletSetup } from './coinbaseWalletSetup.js'
import { WALLET_LINK_CHAIN } from '../../../packages/domain/src/walletLinkProtocol.js'

export async function connectUserCoinbaseWallet({ signal } = {}) {
  const active = () => {
    if (signal?.aborted) throw new DOMException('Wallet connection cancelled.', 'AbortError')
  }
  active()
  const { createBaseAccountSDK } = await import('@base-org/account')
  active()
  const provider = createBaseAccountSDK({
    appName: 'KhmerFP Account Ownership',
    appChainIds: [WALLET_LINK_CHAIN],
    preference: { telemetry: false },
    subAccounts: { creation: 'manual', defaultAccount: 'universal', funding: 'manual' },
  }).getProvider()
  try {
    if (provider === window.ethereum) {
      throw new Error('Use the Coinbase passkey wallet, not an injected extension.')
    }
    // coinbase owns sign-in, account creation and account selection in its hosted flow.
    const accounts = await provider.request({ method: 'eth_requestAccounts' })
    active()
    if (!Array.isArray(accounts) || !accounts[0]) throw new Error('No Coinbase wallet account was selected.')
    if (BigInt(await provider.request({ method: 'eth_chainId' })) !== BigInt(WALLET_LINK_CHAIN)) {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x14a34' }],
      })
    }
    if (BigInt(await provider.request({ method: 'eth_chainId' })) !== BigInt(WALLET_LINK_CHAIN)) {
      throw new Error('Base Sepolia is required.')
    }
    const address = getAddress(accounts[0])
    if (/^0x0{40}$/i.test(address)) throw new Error('A valid nonzero wallet address is required.')
    const setup = await inspectCoinbaseWalletSetup({ provider, address }, { signal })
    active()
    const deployed = setup.deployed
    const currentAccounts = await provider.request({ method: 'eth_accounts' })
    const currentChain = await provider.request({ method: 'eth_chainId' })
    active()
    if (!currentAccounts?.[0] || getAddress(currentAccounts[0]) !== address || BigInt(currentChain) !== BigInt(WALLET_LINK_CHAIN)) {
      throw new Error('Wallet account or network changed. Connect again.')
    }
    return { provider, address, deployed, chainId: WALLET_LINK_CHAIN, setup }
  } catch (error) {
    try { await provider.disconnect?.() } catch { /* preserve the original connection error. */ }
    throw error
  }
}

// signing ownership does not approve tokens or authorize trades.
export async function signWalletOwnership(connection, typedData) {
  if (!connection?.deployed) throw new Error('A deployed smart wallet is required before ownership signing.')
  const check = async () => {
    const accounts = await connection.provider.request({ method: 'eth_accounts' })
    const chain = await connection.provider.request({ method: 'eth_chainId' })
    if (
      getAddress(accounts[0]) !== connection.address ||
      BigInt(chain) !== BigInt(WALLET_LINK_CHAIN)
    ) {
      throw new Error('Wallet account or network changed. Request a new challenge.')
    }
  }
  await check()
  const provider = new BrowserProvider(connection.provider)
  try {
    const signature = await (
      await provider.getSigner(connection.address)
    ).signTypedData(typedData.domain, typedData.types, typedData.message)
    await check()
    return signature
  } finally {
    provider.destroy()
  }
}
