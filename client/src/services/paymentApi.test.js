import { afterEach, describe, expect, it, vi } from 'vitest'

import { getBakongPaymentStatus } from './paymentApi.js'

function statusResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => headers[name] ?? null,
    },
    json: async () => body,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getBakongPaymentStatus error handling', () => {
  it('returns the payment on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        statusResponse(200, {
          payment: {
            tranId: 'FP123',
            amount: 25,
            currency: 'USD',
            status: 'PENDING',
          },
        }),
      ),
    )

    await expect(
      getBakongPaymentStatus('FP123', 'T'.repeat(43)),
    ).resolves.toEqual({
      tranId: 'FP123',
      amount: 25,
      currency: 'USD',
      status: 'PENDING',
    })
  })

  it('carries the status and retry hint when verification is throttled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        statusResponse(
          503,
          { message: 'Payment status verification is temporarily unavailable.' },
          { 'Retry-After': '60' },
        ),
      ),
    )

    const error = await getBakongPaymentStatus(
      'FP123',
      'T'.repeat(43),
    ).catch((thrown) => thrown)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe(
      'Payment status verification is temporarily unavailable.',
    )
    expect(error.status).toBe(503)
    expect(error.retryAfterMs).toBe(60000)
  })

  it('leaves the retry hint unset when the server sends none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        statusResponse(503, { message: 'Payment status lookup failed.' }),
      ),
    )

    const error = await getBakongPaymentStatus(
      'FP123',
      'T'.repeat(43),
    ).catch((thrown) => thrown)

    expect(error.status).toBe(503)
    expect(error.retryAfterMs).toBeUndefined()
  })
})
