const UNEXPECTED_RESPONSE_MESSAGE = 'The server returned an unexpected response.'

const API_BASE_URL =
  typeof import.meta.env?.VITE_API_URL === 'string'
    ? import.meta.env.VITE_API_URL.trim().replace(/\/+$/, '')
    : ''

function apiUrl(path) {
  return `${API_BASE_URL}${path}`
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// Read the signed-in user's wallet balances.
export async function getWallet() {
  const response = await fetch(apiUrl('/api/wallet'), {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })

  let body

  try {
    body = await response.json()
  } catch {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }

  if (!response.ok || typeof body?.wallet !== 'object' || body.wallet === null) {
    throw new Error(
      typeof body?.message === 'string' && body.message
        ? body.message
        : UNEXPECTED_RESPONSE_MESSAGE,
    )
  }
  return {
    KHR: toNumber(body.wallet.khrBalanceMinor),
    USD: toNumber(body.wallet.usdBalanceMinor) / 100,
  }
}
