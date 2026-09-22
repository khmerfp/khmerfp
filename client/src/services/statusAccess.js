const STORAGE_PREFIX = 'payway-status-access:'

// read a safe transaction id from the return url
export function getReturnTransactionId(search) {
  const transactionId = new URLSearchParams(search).get('tran_id')
  return typeof transactionId === 'string'
    && transactionId.length > 0
    && transactionId.length <= 20
    && transactionId.trim() === transactionId
    ? transactionId
    : null
}

// save browser-only checkout status access
export function saveCheckoutStatusAccess(checkout, storage = window.sessionStorage) {
  const transactionId = checkout?.statusAccess?.tranId
  const token = checkout?.statusAccess?.token

  if (
    typeof transactionId !== 'string'
    || typeof token !== 'string'
    || transactionId !== checkout?.transaction?.tranId
  ) {
    throw new Error('The server returned invalid payment status access.')
  }

  storage.setItem(`${STORAGE_PREFIX}${transactionId}`, token)
}

// load browser-only checkout status access
export function loadStatusAccessToken(transactionId, storage = window.sessionStorage) {
  if (!transactionId) return null
  const token = storage.getItem(`${STORAGE_PREFIX}${transactionId}`)
  return typeof token === 'string' && token.length > 0 ? token : null
}
