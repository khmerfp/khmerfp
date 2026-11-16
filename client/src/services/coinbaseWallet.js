import { BrowserProvider, JsonRpcProvider, getAddress } from 'ethers'
import { WALLET_LINK_CHAIN } from '../../../packages/domain/src/walletLinkProtocol.js'

export async function connectUserCoinbaseWallet() {
  const { createBaseAccountSDK } = await import('@base-org/account')
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
    const accounts = await provider.request({ method: 'eth_requestAccounts' })
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
    const rpc = new JsonRpcProvider('https://sepolia.base.org', WALLET_LINK_CHAIN, {
      cacheTimeout: -1,
    })
    let deployed
    try {
      if ((await rpc.getNetwork()).chainId !== BigInt(WALLET_LINK_CHAIN)) {
        throw new Error('Wallet read network mismatch.')
      }
      deployed = (await rpc.getCode(address)) !== '0x'
    } finally {
      rpc.destroy()
    }
    return { provider, address, deployed }
  } catch (error) {
    await provider.disconnect?.()
    throw error
  }
}

export async function signWalletOwnership(connection, typedData) {
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
