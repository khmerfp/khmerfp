// send wallet-link requests using the existing application session.
import { walletRequest } from './walletRequest.js'

const base = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '')

function request(path, body, options) {
  return walletRequest(async signal => {
    const response = await fetch(`${base}/api/wallet-links${path}`, {
      credentials: 'include',
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const error = new Error(data?.message || 'Wallet linking unavailable.')
      error.status = response.status
      throw error
    }
    return data
  }, options)
}
export async function listLinkedWallets({ expectedUserId, ...options } = {}) {
  const data = await request('', undefined, options)
  if (expectedUserId !== undefined && String(data?.userId) !== String(expectedUserId)) {
    const error = new Error('Application session changed. Sign in again before managing wallets.')
    error.status = 401
    throw error
  }
  return data
}
export const requestWalletLink = (body, options) => request('/challenges', body, options)
export const verifyWalletLink = (body, options) => request('/verify', body, options)
