// allow wallet connection and public capability reads during deployment preparation.
﻿import { getAddress } from 'ethers'

// preparation mode cannot sign, send calls, grant permissions or create subaccounts.
export function guardPreparationProvider(provider) {
  return {
    request(request) {
      if (!['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'wallet_getCapabilities'].includes(request.method)) {
        throw new Error('Deployment submission and signing are disabled in preparation mode.')
      }
      return provider.request(request)
    },
  }
}

// retain only documented flags, never opaque SDK payloads or session data.
export function summarizeCapabilities(value) {
  const present = value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.hasOwn(value, '0x14a34')
  const chain = present ? value['0x14a34'] : undefined
  const flag = input => typeof input === 'boolean' ? input : null
  const atomic = chain?.atomic?.status
  return {
    baseSepoliaEntryPresent: present,
    atomicStatus: ['supported', 'ready', 'unsupported'].includes(atomic) ? atomic : 'UNKNOWN',
    legacyAtomicBatchSupported: flag(chain?.atomicBatch?.supported),
    paymasterServiceSupported: flag(chain?.paymasterService?.supported),
    auxiliaryFundsSupported: flag(chain?.auxiliaryFunds?.supported),
    dataSuffixSupported: flag(chain?.dataSuffix?.supported),
    firstUseDeploymentVerified: false,
    feeQuoteAvailable: false,
    sponsorshipConfirmed: false,
  }
}

export async function connectPreparation(provider) {
  const guarded = guardPreparationProvider(provider)
  const accounts = await guarded.request({ method: 'eth_requestAccounts' })
  const chainId = BigInt(await guarded.request({ method: 'eth_chainId' }))
  if (chainId !== 84532n) {
    throw Object.assign(new Error('Select Base Sepolia in the wallet and reconnect.'), {
      code: 'PREVIEW_WRONG_CHAIN', actualChainId: chainId.toString(),
    })
  }
  const wallet = getAddress(accounts[0])
  let capabilities = summarizeCapabilities(null)
  let capabilityReadStatus = 'UNAVAILABLE'
  let timer
  try {
    const value = await Promise.race([
      guarded.request({ method: 'wallet_getCapabilities', params: [wallet, ['0x14a34']] }),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Capability read timed out.')), 5000) }),
    ])
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      capabilities = summarizeCapabilities(value)
      capabilityReadStatus = 'AVAILABLE'
    }
  } catch { /* an unavailable read cannot promise deployment or sponsorship. */ }
  finally { clearTimeout(timer) }
  const current = await guarded.request({ method: 'eth_accounts' })
  if (getAddress(current[0]) !== wallet || BigInt(await guarded.request({ method: 'eth_chainId' })) !== 84532n) {
    throw new Error('Wallet changed during connection.')
  }
  return {
    wallet, chainId: 84532, capabilities, capabilityReadStatus,
    sponsorshipCapability: capabilities.paymasterServiceSupported === true ? 'SUPPORTED_NOT_QUOTED' : 'UNKNOWN',
    metadataAvailable: false, submissionEnabled: false,
  }
}
