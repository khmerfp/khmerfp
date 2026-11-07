import { afterEach, describe, expect, it, vi } from 'vitest'

import { loginWithGoogle } from './authApi.js'

const GOOGLE_USER = {
  id: '42',
  email: 'person@example.com',
  display_name: 'Person',
  avatar_url: null,
  language: 'en',
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

function textResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('loginWithGoogle response handling', () => {
  it('returns the user when the API responds with a valid session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { user: GOOGLE_USER })))

    await expect(loginWithGoogle('credential', 'en')).resolves.toEqual(GOOGLE_USER)
  })

  it('surfaces the backend message from a JSON error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(503, {
          message: 'Service temporarily unavailable. Please try again shortly.',
        }),
      ),
    )

    await expect(loginWithGoogle('credential', 'en')).rejects.toThrow(
      'Service temporarily unavailable. Please try again shortly.',
    )
  })

  it('reports the HTTP status instead of a generic error for an HTML response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => textResponse(502, '<html>Bad Gateway</html>')),
    )

    await expect(loginWithGoogle('credential', 'en')).rejects.toThrow(
      /temporarily unavailable \(HTTP 502\)/,
    )
  })

  it('reports an unreachable API when the request fails at the network layer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    await expect(loginWithGoogle('credential', 'en')).rejects.toThrow(
      /Unable to reach the sign-in service/,
    )
  })
})
