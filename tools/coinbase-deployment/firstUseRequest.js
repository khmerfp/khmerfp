// build a review-only first-use draft without sending it to a wallet.
﻿import { getAddress } from 'ethers'

const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

// pure draft only: this module has no provider, signature, RPC or submission call.
export function prepareWalletManagedFirstUse(input) {
  if (!input || Object.keys(input).sort().join() !== 'chainId,expectedWallet,wallet') {
    throw new Error('Only the expected account and explicit chain may be supplied.')
  }
  if (input.chainId !== 84532) throw new Error('Only Base Sepolia is allowed.')
  const wallet = getAddress(input.wallet)
  const expectedWallet = getAddress(input.expectedWallet)
  if (/^0x0{40}$/i.test(wallet) || wallet !== expectedWallet) {
    throw new Error('SDK account differs from the reviewed tester account.')
  }
  return freeze({
    executionEnabled: false,
    deploymentSupport: 'UNVERIFIED_FOR_THIS_ACCOUNT',
    feeQuote: null,
    sponsorship: 'UNKNOWN',
    request: {
      method: 'wallet_sendCalls',
      params: [{
        version: '1.0',
        chainId: '0x14a34',
        from: wallet,
        atomicRequired: true,
        calls: [{ to: wallet, value: '0x0', data: '0x' }],
      }],
    },
    effects: {
      explicitEthValueWei: '0',
      explicitTokenTransfers: 0,
      explicitApprovals: 0,
      arbitraryRecipient: false,
      accountDeployment: 'Wallet-managed if supported; not guaranteed by this request.',
      gasCharge: 'Nonzero cost is possible, including on failure; quote required.',
      accountUpgrade: 'If proposed, stop for separate approval.',
    },
  })
}
