import { PaymentStatusUnavailableError } from './api.js'

export const STATUS_POLL_INTERVAL_MS = 3_000
export const STATUS_POLL_TIMEOUT_MS = 60_000
export const TERMINAL_PAYMENT_STATUSES = new Set(['PAID', 'FAILED', 'CANCELLED'])

// create one non-overlapping status poller
export function createPaymentStatusPoller({
  requestStatus,
  onState,
  intervalMs = STATUS_POLL_INTERVAL_MS,
  timeoutMs = STATUS_POLL_TIMEOUT_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let active = false
  let inFlight = false
  let timer = null
  let startedAt = 0

  // clear the scheduled status request
  function clearScheduledRequest() {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  // stop all future polling updates
  function stop() {
    active = false
    clearScheduledRequest()
  }

  // schedule the next status request
  function scheduleNext() {
    if (!active) return
    timer = setTimer(() => {
      timer = null
      void check()
    }, intervalMs)
  }

  // perform one non-overlapping status request
  async function check() {
    if (!active || inFlight) return false

    if (now() - startedAt >= timeoutMs) {
      onState({ kind: 'timeout' })
      stop()
      return false
    }

    inFlight = true
    try {
      const payment = await requestStatus()
      if (!active) return false

      onState({ kind: 'status', payment })
      if (TERMINAL_PAYMENT_STATUSES.has(payment.status)) stop()
      else scheduleNext()
    } catch (error) {
      if (!active) return false
      if (error instanceof PaymentStatusUnavailableError) {
        onState({ kind: 'unavailable' })
        stop()
        return false
      }
      onState({ kind: 'network_error' })
      scheduleNext()
    } finally {
      inFlight = false
    }

    return true
  }

  // start a bounded polling window
  function start() {
    if (active) return
    active = true
    startedAt = now()
    void check()
  }

  // request one manual refresh safely
  function refresh() {
    clearScheduledRequest()
    if (!active) {
      active = true
      startedAt = now()
    }
    return check()
  }

  return { start, stop, refresh }
}
