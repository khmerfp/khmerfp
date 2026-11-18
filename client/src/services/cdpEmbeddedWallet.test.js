// simulate the browser sdk boundary; these tests do not prove live cdp onboarding.
import { afterEach, expect, it, vi } from 'vitest'
import { id } from 'ethers'
import { embeddedWalletConfig, embeddedEoa, signEmbeddedOwnership, checkEmbeddedWalletProject, walletFailureMessage } from './cdpEmbeddedWallet.js'
import { walletLinkTypes } from '../../../packages/domain/src/walletLinkProtocol.js'
const address = '0x1111111111111111111111111111111111111111'
const user = { userId: 'cdp-user', evmAccountObjects: [{ address }] }
const origin = 'http://127.0.0.1:5173'
const fixture = () => {
  const challengeId = '11111111-1111-4111-8111-111111111111', now = Math.floor(Date.now() / 1000)
  const challenge = { challengeId, typedData: { domain: { name: 'KhmerFP Wallet Ownership', version: '1', chainId: 84532, salt: id(origin) },
    primaryType: 'WalletLink', types: walletLinkTypes, message: { challengeId, action: 'LINK', userId: '1', wallet: address,
      sessionBinding: id('session'), appOrigin: origin, nonce: id('nonce'), issuedAt: now, expiresAt: now + 120 } } }
  return { challenge, address, userId: '1', cdpUserId: 'cdp-user', action: 'LINK', origin,
    getUser: vi.fn(async () => user), signTypedData: vi.fn(async () => ({ signature: '0x' + '11'.repeat(65) })) }
}
it('requires development opt-in and a public project id', () => {
  expect(() => embeddedWalletConfig({ DEV: false, VITE_CDP_EMBEDDED_WALLET_ENABLED: 'true' })).toThrow(/disabled/)
  expect(() => embeddedWalletConfig({ DEV: true, VITE_CDP_EMBEDDED_WALLET_ENABLED: 'true' })).toThrow(/PROJECT_ID/)
  expect(embeddedWalletConfig({ DEV: true, VITE_CDP_EMBEDDED_WALLET_ENABLED: 'true', VITE_CDP_PROJECT_ID: '11111111-1111-4111-8111-111111111111' })).toMatchObject({ ethereum: { createOnLogin: 'eoa' }, authMethods: ['email'] })
})
it('selects an EOA, supports recovered SDK accounts, and never substitutes smart accounts', () => {
  expect(embeddedEoa(user)).toBe(address)
  expect(embeddedEoa({ userId: 'cdp-user', evmAccounts: [address] })).toBe(address)
  expect(embeddedEoa({ evmSmartAccounts: [address] })).toBe(null)
})
it('signs only the validated shared ownership payload with the selected EOA', async () => {
  const input = fixture()
  await expect(signEmbeddedOwnership(input)).resolves.toMatch(/^0x/)
  expect(input.signTypedData).toHaveBeenCalledWith({ evmAccount: address, typedData: input.challenge.typedData })
})
it('rejects wrong chain, wrong KhmerFP account and expired challenges before signing', async () => {
  for (const change of [x => { x.challenge.typedData.domain.chainId = 8453 }, x => { x.userId = '2' },
    x => { x.challenge.typedData.message.expiresAt = 1 }]) {
    const input = fixture(); change(input)
    await expect(signEmbeddedOwnership(input)).rejects.toThrow()
    expect(input.signTypedData).not.toHaveBeenCalled()
  }
})
it('rejects CDP account switching and local cancellation', async () => {
  for (const change of [x => { x.getUser = async () => ({ ...user, userId: 'other' }) }, x => { x.isCurrent = () => false }]) {
    const input = fixture(); change(input)
    await expect(signEmbeddedOwnership(input)).rejects.toThrow(/changed/)
    expect(input.signTypedData).not.toHaveBeenCalled()
  }
})
it('rejects account changes during signing and propagates rejection without linking', async () => {
  const input = fixture()
  input.getUser.mockResolvedValueOnce(user).mockResolvedValueOnce(null)
  await expect(signEmbeddedOwnership(input)).rejects.toThrow(/changed/)
  const rejected = fixture(); rejected.signTypedData.mockRejectedValueOnce(new Error('Signature cancelled'))
  await expect(signEmbeddedOwnership(rejected)).rejects.toThrow(/cancelled/)
})

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('checks public project readiness without credentials or wallet authentication', async () => {
  const fetch = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('fetch', fetch)
  await expect(checkEmbeddedWalletProject('11111111-1111-4111-8111-111111111111')).resolves.toBe(true)
  expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' })
  await expect(checkEmbeddedWalletProject('not-a-project')).rejects.toThrow(/valid public/)
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('shows useful project, origin and network errors without exposing response contents', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
  await expect(checkEmbeddedWalletProject('11111111-1111-4111-8111-111111111111')).rejects.toThrow(/not configured/)
  globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 403 })
  await expect(checkEmbeddedWalletProject('11111111-1111-4111-8111-111111111111')).rejects.toThrow(/allowed origin/)
  globalThis.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await expect(checkEmbeddedWalletProject('11111111-1111-4111-8111-111111111111')).rejects.toThrow(/Cannot reach/)
})
it('bounds project availability checks without starting or cancelling an authentication flow', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn(() => new Promise(() => {}))
  vi.stubGlobal('fetch', fetch)
  const pending = checkEmbeddedWalletProject('11111111-1111-4111-8111-111111111111', { timeoutMs: 20 })
  const rejected = expect(pending).rejects.toMatchObject({ code: 'WALLET_REQUEST_TIMEOUT' })
  await vi.advanceTimersByTimeAsync(20); await rejected
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
})

it('rechecks cancellation immediately before invoking SDK signing', async () => {
  const input = fixture()
  input.isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
  await expect(signEmbeddedOwnership(input)).rejects.toThrow(/changed/)
  expect(input.signTypedData).not.toHaveBeenCalled()
})
it('does not reflect arbitrary SDK errors or request details into user messages', async () => {
  for (const error of [new Error('Bearer sensitive-upstream-marker'), { status: 500, message: 'sensitive-upstream-marker' }, null]) {
    expect(walletFailureMessage(error)).not.toContain('sensitive-upstream-marker')
    expect(walletFailureMessage(error)).toMatch(/could not be completed/)
  }
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('sensitive-upstream-marker'), { code: 'UNKNOWN_UPSTREAM_CODE' })))
  await expect(checkEmbeddedWalletProject('11111111-1111-4111-8111-111111111111')).rejects.toThrow(/Cannot reach/)
})
