// keep cdp configuration and ownership signing separate from khmerfp login.
import { getAddress, id } from 'ethers'
import { walletRequest } from './walletRequest.js'
import { assertWalletLinkChallenge, WALLET_LINK_CHAIN } from '../../../packages/domain/src/walletLinkProtocol.js'

export function embeddedWalletConfig(env = import.meta.env) {
  if (!env.DEV || env.VITE_CDP_EMBEDDED_WALLET_ENABLED !== 'true') throw new Error('Embedded wallets are disabled outside opted-in development.')
  const projectId = env.VITE_CDP_PROJECT_ID?.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId || '')) {
    throw new Error('Set the public VITE_CDP_PROJECT_ID and allow this origin in CDP Embedded Wallet configuration.')
  }
  return { projectId, appName: 'KhmerFP', authMethods: ['email'], disableAnalytics: true,
    ethereum: { createOnLogin: 'eoa' } }
}

// select the embedded EOA explicitly; never silently substitute a smart account.
export function embeddedEoa(user) {
  const raw = user?.evmAccountObjects?.[0]?.address || user?.evmAccounts?.[0]
  if (!raw) return null
  const address = getAddress(raw)
  if (/^0x0{40}$/i.test(address)) throw new Error('Invalid embedded wallet address.')
  return address
}

export async function signEmbeddedOwnership({ challenge, userId, address, cdpUserId, action, origin,
  getUser, signTypedData, isCurrent = () => true }) {
  const check = async () => {
    const user = await getUser()
    if (!isCurrent() || !cdpUserId || user?.userId !== cdpUserId || embeddedEoa(user) !== address) {
      throw new Error('Wallet or application account changed. Request a fresh challenge.')
    }
    return assertWalletLinkChallenge(challenge, { origin, wallet: address, userId, action, domainSalt: id(origin) })
  }
  const typedData = await check()
  if (!isCurrent()) throw new Error('Wallet or application account changed. Request a fresh challenge.')
  if (Number(typedData.domain.chainId) !== WALLET_LINK_CHAIN) throw new Error('Base Sepolia is required.')
  const result = await signTypedData({ evmAccount: address, typedData })
  await check()
  if (!/^0x[0-9a-f]{130}$/i.test(result?.signature || '')) throw new Error('Unsupported embedded EOA signature.')
  return result.signature
}

// this is the same public project-config endpoint used by the installed CDP SDK.
// no CDP login, code, token or user credentials are sent by this readiness read.
export async function checkEmbeddedWalletProject(projectId, options = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId || '')) {
    throw new Error('A valid public CDP Project ID is required.')
  }
  try {
    return await walletRequest(async signal => {
      const response = await fetch(`https://api.cdp.coinbase.com/platform/v2/embedded-wallet-api/projects/${projectId}/config`, {
        signal, credentials: 'omit', referrerPolicy: 'no-referrer',
      })
      if (!response.ok) {
        const error = new Error(response.status === 404
          ? 'Embedded Wallets is not configured for this project. Ask your administrator to save the CDP project settings and allowed origin.'
          : 'Coinbase wallet configuration is unavailable. Check the project settings and allowed origin, then retry.')
        error.code = 'CDP_PROJECT_UNAVAILABLE'
        throw error
      }
      return true
    }, options)
  } catch (error) {
    if (error.name === 'AbortError' || ['WALLET_REQUEST_TIMEOUT', 'CDP_PROJECT_UNAVAILABLE'].includes(error.code)) throw error
    throw new Error('Cannot reach Coinbase wallet configuration. Check your connection, CDP project settings and allowed origin.')
  }
}

// display fixed messages instead of raw SDK/server exception text or request details.
export function walletFailureMessage(error) {
  if (error?.status === 401) return 'Session or proof rejected. Sign in again if your KhmerFP session expired.'
  if (error?.name === 'AbortError' || error?.code === 4001 || error?.code === 'ACTION_REJECTED' || /^(Signature rejected|Signature cancelled)$/.test(error?.message || '')) {
    return 'Wallet request cancelled. No new ownership proof was submitted.'
  }
  if (error?.code === 'WALLET_REQUEST_TIMEOUT' || error?.status === 408) return 'Wallet request timed out. Refresh wallet records before trying again.'
  if (error?.status === 403) return 'Wallet action is not authorized. Fresh KhmerFP authentication may be required.'
  if (error?.status === 409) return 'Wallet link conflicts with its current state. Refresh wallet records.'
  if (error?.status === 410) return 'Ownership request expired. Prepare a fresh proof.'
  if (error?.status === 422) return 'This wallet or signature format is not supported.'
  if (error?.status === 429) return 'Too many wallet requests. Wait a moment before trying again.'
  if (/^Wallet or application account changed/.test(error?.message || '')) return 'Wallet or application account changed. Request a fresh challenge.'
  if (/^Wallet-link challenge does not match/.test(error?.message || '')) return 'Ownership request no longer matches this account. Prepare a fresh proof.'
  return 'Wallet request could not be completed. Check your connection and try again.'
}
