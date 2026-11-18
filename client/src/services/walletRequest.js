// bound application requests without timing out SDK authentication or signing prompts.
export const WALLET_REQUEST_TIMEOUT_MS = 20000

export function walletRequest(task, { signal, timeoutMs = WALLET_REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  return new Promise((resolve, reject) => {
    let settled = false
    let timer
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      callback(value)
    }
    const cancel = () => {
      controller.abort()
      finish(reject, new DOMException('Wallet request cancelled.', 'AbortError'))
    }
    if (signal?.aborted) { cancel(); return }
    signal?.addEventListener('abort', cancel, { once: true })
    timer = setTimeout(() => {
      const error = new Error('Wallet request timed out. Retry the status check before continuing.')
      error.code = 'WALLET_REQUEST_TIMEOUT'
      error.status = 408
      controller.abort()
      finish(reject, error)
    }, timeoutMs)
    Promise.resolve().then(() => {
      if (settled) return
      return task(controller.signal)
    }).then(value => finish(resolve, value), error => finish(reject, error))
  })
}
