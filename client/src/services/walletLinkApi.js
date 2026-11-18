// send wallet-link requests using the existing application session.
const base = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '')

async function request(path, body) {
  const response = await fetch(`${base}/api/wallet-links${path}`, {
    credentials: 'include',
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(data?.message || 'Wallet linking unavailable.')
    error.status = response.status
    throw error
  }
  return data
}
export const listLinkedWallets = () => request('')
export const requestWalletLink = (body) => request('/challenges', body)
export const verifyWalletLink = (body) => request('/verify', body)
