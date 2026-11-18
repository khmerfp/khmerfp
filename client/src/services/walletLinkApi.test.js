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
