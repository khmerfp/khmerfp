import { describe, expect, test, vi } from 'vitest'
import { getPaymentResultPresentation } from '../presentation/paymentResult.js'
import { createPaymentStatusPoller } from './paymentStatusPoller.js'
import {
  getReturnTransactionId,
  loadStatusAccessToken,
  saveCheckoutStatusAccess,
} from './statusAccess.js'

// create one small session storage stand-in
function createStorage() {
  const values = new Map()
  return {
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key) ?? null,
  }
}

describe('protected payment result', () => {
  test('stores browser access separately and trusts only the transaction id', () => {
    const storage = createStorage()
    const checkout = {
      transaction: { tranId: '123' },
      statusAccess: { tranId: '123', token: 'secret-browser-token' },
    }

    saveCheckoutStatusAccess(checkout, storage)

    expect(loadStatusAccessToken('123', storage)).toBe('secret-browser-token')
    expect(getReturnTransactionId('?tran_id=123&status=PAID&success=true')).toBe('123')
  })

  test('shows success only for backend PAID status', () => {
    expect(getPaymentResultPresentation({ kind: 'status', payment: { status: 'PAID' } }).title).toBe('Payment confirmed')
    expect(getPaymentResultPresentation({ kind: 'status', payment: { status: 'PENDING' } }).message).toBe('Payment confirmation is still pending')
    expect(getPaymentResultPresentation({ kind: 'status', payment: { status: 'FAILED' } }).title).toBe('Payment failed')
    expect(getPaymentResultPresentation({ kind: 'status', payment: { status: 'CANCELLED' } }).title).toBe('Payment cancelled')
    expect(getPaymentResultPresentation({ kind: 'checking' }).title).not.toBe('Payment confirmed')
  })

  test('does not overlap requests or update after cleanup', async () => {
    let resolveRequest
    const requestStatus = vi.fn(() => new Promise((resolve) => {
      resolveRequest = resolve
    }))
    const onState = vi.fn()
    const poller = createPaymentStatusPoller({
      requestStatus,
      onState,
      setTimer: () => 1,
      clearTimer: () => {},
    })

    poller.start()
    await poller.refresh()
    expect(requestStatus).toHaveBeenCalledTimes(1)
    poller.stop()
    resolveRequest({ status: 'PAID' })
    await Promise.resolve()
    expect(onState).not.toHaveBeenCalled()
  })

  test('reports timeout and network errors without reporting failure', async () => {
    const timeoutState = vi.fn()
    const timedOut = createPaymentStatusPoller({
      requestStatus: async () => ({ status: 'PENDING' }),
      onState: timeoutState,
      timeoutMs: 0,
      now: () => 10,
      setTimer: () => 1,
      clearTimer: () => {},
    })
    timedOut.start()
    await Promise.resolve()
    expect(timeoutState).toHaveBeenCalledWith({ kind: 'timeout' })

    const networkState = vi.fn()
    const network = createPaymentStatusPoller({
      requestStatus: async () => { throw new Error('offline') },
      onState: networkState,
      setTimer: () => 1,
      clearTimer: () => {},
    })
    network.start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(networkState).toHaveBeenCalledWith({ kind: 'network_error' })
    network.stop()
  })
})
