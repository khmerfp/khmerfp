// test wallet-link api responses and request failures.
import { afterEach, expect, it, vi } from 'vitest'
import { listLinkedWallets, requestWalletLink, verifyWalletLink } from './walletLinkApi.js'
import { signWalletOwnership } from './coinbaseWallet.js'

afterEach(() => vi.unstubAllGlobals())
it('uses the existing application cookie channel, never demo authentication', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ wallets: [] }) })
  vi.stubGlobal('fetch', fetch)
  await listLinkedWallets()
  await requestWalletLink({ walletAddress: 'wallet', chainId: 84532, action: 'LINK' })
  await verifyWalletLink({ challengeId: 'challenge', signature: '0x1234' })
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    '/api/wallet-links',
    '/api/wallet-links/challenges',
    '/api/wallet-links/verify',
  ])
  for (const [, options] of fetch.mock.calls) {
    expect(options.credentials).toBe('include')
  }
  expect(fetch.mock.calls[2][1].body).toBe(
    JSON.stringify({ challengeId: 'challenge', signature: '0x1234' }),
  )
})
it('surfaces server refusal rather than marking an address as linked', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: 'Wallet is not deployed.' }),
    }),
  )
  await expect(
    verifyWalletLink({ challengeId: 'challenge', signature: '0x1234' }),
  ).rejects.toMatchObject({ status: 422, message: 'Wallet is not deployed.' })
})
it('checks the wallet account and network before any ownership signature', async () => {
  const address = `0x${'11'.repeat(20)}`
  const request = vi.fn(async ({ method }) => (method === 'eth_accounts' ? [address] : '0x2105'))
  await expect(signWalletOwnership({ address, deployed: true, provider: { request } }, {})).rejects.toThrow(
    /network changed/,
  )
  expect(request.mock.calls.some(([call]) => call.method.includes('signTypedData'))).toBe(false)
})

it('rejects wallet-list responses from another or unbound KhmerFP session', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  for (const data of [{ userId: '2', wallets: [] }, { wallets: [] }]) {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => data })
    await expect(listLinkedWallets({ expectedUserId: '1' })).rejects.toMatchObject({ status: 401 })
  }
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ userId: '1', wallets: [] }) })
  await expect(listLinkedWallets({ expectedUserId: '1' })).resolves.toEqual({ userId: '1', wallets: [] })
})
