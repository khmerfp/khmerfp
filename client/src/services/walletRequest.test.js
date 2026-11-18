// test request deadlines without touching CDP authentication or wallet secrets.
import { afterEach, expect, it, vi } from 'vitest'
import { walletRequest } from './walletRequest.js'
import { listLinkedWallets } from './walletLinkApi.js'
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('aborts a stalled request, ignores late success and allows a new explicit request', async () => {
  vi.useFakeTimers()
  let finish, requestSignal
  const pending = walletRequest(signal => { requestSignal = signal; return new Promise(resolve => { finish = resolve }) }, { timeoutMs: 20 })
  const rejected = expect(pending).rejects.toMatchObject({ code: 'WALLET_REQUEST_TIMEOUT' })
  await vi.advanceTimersByTimeAsync(20); await rejected
  expect(requestSignal.aborted).toBe(true)
  finish('late success')
  await expect(walletRequest(async () => 'fresh request')).resolves.toBe('fresh request')
})
it('caller cancellation settles a request once and does not execute an already cancelled task', async () => {
  const controller = new AbortController(), task = vi.fn()
  controller.abort()
  await expect(walletRequest(task, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(task).not.toHaveBeenCalled()
  const active = new AbortController()
  const pending = walletRequest(() => new Promise(() => {}), { signal: active.signal })
  active.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
})
it('covers response-body parsing in the API deadline and passes a real abort signal', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) }))
  vi.stubGlobal('fetch', fetch)
  const pending = listLinkedWallets({ timeoutMs: 20 })
  const rejected = expect(pending).rejects.toMatchObject({ code: 'WALLET_REQUEST_TIMEOUT' })
  await vi.advanceTimersByTimeAsync(20); await rejected
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
})
