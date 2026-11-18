// simulated sdk UI tests; no email, production session or real signature is used.
import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { id } from 'ethers'
import { walletLinkTypes } from '../../../packages/domain/src/walletLinkProtocol.js'
const state = vi.hoisted(() => ({ user: null, auth: null, ready: true, sign: vi.fn(), signOut: vi.fn(), projectCheck: vi.fn(), configs: [] }))
vi.mock('@coinbase/cdp-react', () => ({ CDPReactProvider: ({ children, config }) => { state.configs.push(config); return <>{children}</> }, AuthButton: () => <button>CDP email sign in</button> }))
vi.mock('@coinbase/cdp-hooks', () => ({ useCurrentUser: () => ({ currentUser: state.user }),
  useIsInitialized: () => ({ isInitialized: state.ready }), useSignOut: () => ({ signOut: state.signOut }),
  useSignEvmTypedData: () => ({ signEvmTypedData: state.sign }) }))
vi.mock('@coinbase/cdp-core', () => ({ getCurrentUser: async () => state.user }))
vi.mock('../auth/authContext.js', () => ({ useAuth: () => state.auth }))
vi.mock('../components/AuthModal.jsx', () => ({ default: () => <p>Existing KhmerFP login</p> }))
vi.mock('../services/walletLinkApi.js', () => ({ listLinkedWallets: vi.fn(), requestWalletLink: vi.fn(), verifyWalletLink: vi.fn() }))
vi.mock('../services/cdpEmbeddedWallet.js', async () => ({ ...await vi.importActual('../services/cdpEmbeddedWallet.js'), checkEmbeddedWalletProject: state.projectCheck }))
import CdpWalletLinkPage, { EmbeddedWalletPanel, WALLET_INITIALIZATION_TIMEOUT_MS } from './CdpWalletLinkPage.jsx'
import { listLinkedWallets, requestWalletLink, verifyWalletLink } from '../services/walletLinkApi.js'
const address = '0x1111111111111111111111111111111111111111'
const linked = { id: '1', wallet_address: address, chain_id: '84532', wallet_type: 'EOA', ownership_verification_status: 'VERIFIED', wallet_status: 'ACTIVE' }
function challenge(action = 'LINK') {
  const challengeId = '11111111-1111-4111-8111-111111111111', now = Math.floor(Date.now() / 1000)
  return { challengeId, typedData: { domain: { name: 'KhmerFP Wallet Ownership', version: '1', chainId: 84532, salt: id(location.origin) },
    primaryType: 'WalletLink', types: walletLinkTypes, message: { challengeId, action, userId: '1', wallet: address,
      sessionBinding: id('session'), appOrigin: location.origin, nonce: id('nonce'), issuedAt: now, expiresAt: now + 120 } } }
}
beforeEach(() => {
  vi.clearAllMocks(); state.configs = []; state.projectCheck.mockReset().mockResolvedValue(true); vi.stubEnv('DEV', true); vi.stubEnv('VITE_CDP_EMBEDDED_WALLET_ENABLED', 'true')
  vi.stubEnv('VITE_CDP_PROJECT_ID', '11111111-1111-4111-8111-111111111111')
  state.auth = { user: { id: '1' }, status: 'authenticated' }; state.user = { userId: 'cdp-1', evmAccountObjects: [{ address }] }; state.ready = true
  state.sign.mockResolvedValue({ signature: '0x' + '11'.repeat(65) }); state.signOut.mockResolvedValue()
  listLinkedWallets.mockResolvedValue({ wallets: [] })
  requestWalletLink.mockImplementation(async ({ action }) => challenge(action))
  verifyWalletLink.mockResolvedValue({ wallet: linked, grantsTradingPermission: false })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.useRealTimers() })
it('does not initialize onboarding before KhmerFP login or missing project configuration', () => {
  state.auth = { user: null, status: 'unauthenticated' }
  const view = render(<CdpWalletLinkPage />)
  expect(screen.queryByText('CDP email sign in')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Sign in to KhmerFP')); expect(screen.getByText('Existing KhmerFP login')).toBeInTheDocument()
  state.auth = { user: { id: '1' }, status: 'authenticated' }; vi.stubEnv('VITE_CDP_PROJECT_ID', '')
  view.rerender(<CdpWalletLinkPage />); expect(screen.getByRole('alert')).toHaveTextContent('PROJECT_ID')
})
it('offers SDK email onboarding and shows a recovered EOA without claiming a link', async () => {
  state.user = null; const view = render(<CdpWalletLinkPage />)
  expect(await screen.findByText('CDP email sign in')).toBeInTheDocument()
  state.user = { userId: 'cdp-1', evmAccountObjects: [{ address }] }; view.rerender(<CdpWalletLinkPage />)
  expect(await screen.findByText(address)).toBeInTheDocument()
  expect(state.sign).not.toHaveBeenCalled(); expect(verifyWalletLink).not.toHaveBeenCalled()
})
it('requires message review, verifies through the backend, then displays persisted ownership', async () => {
  render(<CdpWalletLinkPage />)
  await waitFor(() => expect(screen.getByText('Prepare ownership verification')).not.toBeDisabled()); fireEvent.click(screen.getByText('Prepare ownership verification'))
  await screen.findByText('Review ownership message')
  expect(screen.getByText('Sign and verify ownership')).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  listLinkedWallets.mockResolvedValue({ wallets: [linked] })
  fireEvent.click(screen.getByText('Sign and verify ownership'))
  await screen.findByText(/ownership verified and saved/)
  expect(verifyWalletLink).toHaveBeenCalledTimes(1)
  expect(screen.getByText('EOA / VERIFIED / ACTIVE')).toBeInTheDocument()
})
it('reports signature rejection and expired session without claiming successful ownership', async () => {
  state.sign.mockRejectedValueOnce(new Error('Signature rejected'))
  render(<CdpWalletLinkPage />)
  await waitFor(() => expect(screen.getByText('Prepare ownership verification')).not.toBeDisabled()); fireEvent.click(screen.getByText('Prepare ownership verification')); await screen.findByText('Review ownership message')
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByText('Sign and verify ownership'))
  await screen.findByText('Wallet request cancelled. No new ownership proof was submitted.'); expect(verifyWalletLink).not.toHaveBeenCalled()
  requestWalletLink.mockRejectedValueOnce(Object.assign(new Error('Authentication required'), { status: 401 }))
  await waitFor(() => expect(screen.getByText('Prepare ownership verification')).not.toBeDisabled()); fireEvent.click(screen.getByText('Prepare ownership verification')); await screen.findByText(/Session or proof rejected/)
})
it('clears prepared proof on CDP account switching and supports explicit logout', async () => {
  const view = render(<CdpWalletLinkPage />)
  await waitFor(() => expect(screen.getByText('Prepare ownership verification')).not.toBeDisabled()); fireEvent.click(screen.getByText('Prepare ownership verification')); await screen.findByText('Review ownership message')
  state.user = { userId: 'cdp-2', evmAccounts: ['0x2222222222222222222222222222222222222222'] }
  view.rerender(<CdpWalletLinkPage />)
  await waitFor(() => expect(screen.queryByText('Review ownership message')).not.toBeInTheDocument())
  fireEvent.click(screen.getByText('Sign out of CDP / Switch wallet')); await waitFor(() => expect(state.signOut).toHaveBeenCalled())
})

it('shows loading, stops stalled initialization, and exposes an explicit retry', async () => {
  vi.useFakeTimers(); state.ready = false
  const retry = vi.fn()
  render(<EmbeddedWalletPanel onRetryInitialization={retry} />)
  expect(screen.getByRole('status', { name: 'Loading embedded wallet' })).toBeInTheDocument()
  await act(async () => { await vi.advanceTimersByTimeAsync(WALLET_INITIALIZATION_TIMEOUT_MS) })
  expect(screen.getByRole('alert')).toHaveTextContent('taking too long')
  fireEvent.click(screen.getByText('Retry wallet setup')); expect(retry).toHaveBeenCalledTimes(1)
  expect(state.signOut).not.toHaveBeenCalled(); expect(state.sign).not.toHaveBeenCalled()
})
it('does not time out or reset an available CDP email authentication flow', async () => {
  vi.useFakeTimers(); state.user = null
  render(<EmbeddedWalletPanel />)
  await act(async () => { await vi.advanceTimersByTimeAsync(WALLET_INITIALIZATION_TIMEOUT_MS * 3) })
  expect(screen.getByText('CDP email sign in')).toBeInTheDocument()
  expect(screen.queryByText('Retry wallet setup')).not.toBeInTheDocument()
  expect(state.signOut).not.toHaveBeenCalled()
})
it('configuration failure blocks SDK mounting and retry performs one readiness read', async () => {
  state.projectCheck.mockRejectedValueOnce(new Error('Project configuration unavailable'))
  render(<CdpWalletLinkPage />)
  await screen.findByText('Project configuration unavailable')
  expect(state.configs).toHaveLength(0)
  let finish
  state.projectCheck.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  fireEvent.click(screen.getByText('Try again'))
  expect(screen.queryByText('CDP email sign in')).not.toBeInTheDocument()
  await waitFor(() => expect(state.projectCheck).toHaveBeenCalledTimes(2))
  await act(async () => finish(true))
  await screen.findByText(address)
  expect(state.sign).not.toHaveBeenCalled(); expect(requestWalletLink).not.toHaveBeenCalled()
})
it('keeps SDK configuration stable across ordinary parent rerenders', async () => {
  const page = render(<CdpWalletLinkPage />); await screen.findByText(address)
  const original = state.configs[0]
  page.rerender(<CdpWalletLinkPage />)
  expect(state.configs.at(-1)).toBe(original)
  expect(state.projectCheck).toHaveBeenCalledTimes(1)
})
it('cancellation discards a late challenge and prevents duplicate pending requests', async () => {
  let finish
  requestWalletLink.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  render(<CdpWalletLinkPage />)
  await waitFor(() => expect(screen.getByText('Prepare ownership verification')).not.toBeDisabled())
  fireEvent.click(screen.getByText('Prepare ownership verification')); fireEvent.click(screen.getByText('Prepare ownership verification'))
  expect(requestWalletLink).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByText('Cancel pending action'))
  await act(async () => finish(challenge()))
  expect(screen.queryByText('Review ownership message')).not.toBeInTheDocument()
  expect(state.sign).not.toHaveBeenCalled()
})
it('retry after a request timeout refreshes status without repeating a challenge or signing', async () => {
  requestWalletLink.mockRejectedValueOnce(Object.assign(new Error('Wallet request timed out.'), { code: 'WALLET_REQUEST_TIMEOUT', status: 408 }))
  render(<CdpWalletLinkPage />)
  await waitFor(() => expect(screen.getByText('Prepare ownership verification')).not.toBeDisabled())
  fireEvent.click(screen.getByText('Prepare ownership verification'))
  await screen.findByText(/Wallet request timed out/)
  fireEvent.click(screen.getByText('Retry status check'))
  await screen.findByText(/Wallet records refreshed/)
  expect(requestWalletLink).toHaveBeenCalledTimes(1); expect(state.sign).not.toHaveBeenCalled()
})
it('holds the SDK signing lock after cancellation until its existing prompt settles', async () => {
  let finish
  state.sign.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  render(<CdpWalletLinkPage />)
  await waitFor(() => expect(screen.getByText('Prepare ownership verification')).not.toBeDisabled())
  fireEvent.click(screen.getByText('Prepare ownership verification')); await screen.findByText('Review ownership message')
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByText('Sign and verify ownership'))
  await waitFor(() => expect(state.sign).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByText('Cancel pending action'))
  expect(screen.getByText('Prepare ownership verification')).toBeDisabled()
  await act(async () => finish({ signature: '0x' + '11'.repeat(65) }))
  expect(verifyWalletLink).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByText('Prepare ownership verification')).not.toBeDisabled())
})
it('does not replay an uncertain verification and reconciles through a read only', async () => {
  verifyWalletLink.mockRejectedValueOnce(Object.assign(new Error('Verification timed out'), { status: 408 }))
  render(<CdpWalletLinkPage />)
  await waitFor(() => expect(screen.getByText('Prepare ownership verification')).not.toBeDisabled())
  fireEvent.click(screen.getByText('Prepare ownership verification')); await screen.findByText('Review ownership message')
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByText('Sign and verify ownership'))
  await screen.findByText(/Verification outcome is uncertain/)
  expect(screen.getByText('Prepare ownership verification')).toBeDisabled()
  listLinkedWallets.mockResolvedValue({ wallets: [linked] })
  fireEvent.click(screen.getByText('Retry status check'))
  await screen.findByText('EOA / VERIFIED / ACTIVE')
  expect(verifyWalletLink).toHaveBeenCalledTimes(1)
  expect(state.sign).toHaveBeenCalledTimes(1)
})
it('an older wallet-list response cannot overwrite a newer status refresh', async () => {
  let finish
  listLinkedWallets.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce({ wallets: [linked] })
  render(<CdpWalletLinkPage />)
  await screen.findByText(address)
  fireEvent.click(screen.getByText('Refresh wallets'))
  await screen.findByText('EOA / VERIFIED / ACTIVE')
  await act(async () => finish({ wallets: [] }))
  expect(screen.getByText('EOA / VERIFIED / ACTIVE')).toBeInTheDocument()
})

it('fresh KhmerFP authentication clears an expired-session block without resetting the SDK', async () => {
  listLinkedWallets.mockRejectedValueOnce(Object.assign(new Error('Authentication required'), { status: 401 }))
  const page = render(<CdpWalletLinkPage />)
  await screen.findByText(/Session or proof rejected/)
  const config = state.configs.at(-1)
  state.auth = { ...state.auth, user: { ...state.auth.user } }
  listLinkedWallets.mockResolvedValue({ wallets: [] })
  page.rerender(<CdpWalletLinkPage />)
  await waitFor(() => expect(screen.getByText('Prepare ownership verification')).not.toBeDisabled())
  expect(screen.queryByText(/Session or proof rejected/)).not.toBeInTheDocument()
  expect(state.configs.at(-1)).toBe(config)
})
it('a project readiness response from an old configuration cannot mount the SDK', async () => {
  let finish
  state.projectCheck.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockRejectedValueOnce(new Error('New project unavailable'))
  const page = render(<CdpWalletLinkPage />)
  await waitFor(() => expect(state.projectCheck).toHaveBeenCalledTimes(1))
  vi.stubEnv('VITE_CDP_PROJECT_ID', '22222222-2222-4222-8222-222222222222')
  page.rerender(<CdpWalletLinkPage />)
  await screen.findByText('New project unavailable')
  await act(async () => finish(true))
  expect(state.configs).toHaveLength(0)
  expect(screen.getByText('New project unavailable')).toBeInTheDocument()
})

it('a successful authorized status retry clears a transient session error', async () => {
  listLinkedWallets.mockRejectedValueOnce(Object.assign(new Error('Authentication required'), { status: 401 }))
  render(<CdpWalletLinkPage />)
  await screen.findByText(/Session or proof rejected/)
  expect(screen.getByText('Prepare ownership verification')).toBeDisabled()
  fireEvent.click(screen.getByText('Retry status check'))
  await screen.findByText(/Wallet records refreshed/)
  expect(screen.getByText('Prepare ownership verification')).not.toBeDisabled()
  expect(requestWalletLink).not.toHaveBeenCalled()
})

it('rejects another KhmerFP account challenge before it is displayed or signed', async () => {
  const wrong = challenge(); wrong.typedData.message.userId = '2'
  requestWalletLink.mockResolvedValueOnce(wrong)
  render(<CdpWalletLinkPage />)
  await waitFor(() => expect(screen.getByText('Prepare ownership verification')).not.toBeDisabled())
  fireEvent.click(screen.getByText('Prepare ownership verification'))
  await screen.findByText(/Ownership request no longer matches/)
  expect(screen.queryByText('Review ownership message')).not.toBeInTheDocument()
  expect(state.sign).not.toHaveBeenCalled(); expect(verifyWalletLink).not.toHaveBeenCalled()
})
it('late challenge responses cannot follow a changed CDP identity', async () => {
  let finish
  requestWalletLink.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const page = render(<CdpWalletLinkPage />)
  await waitFor(() => expect(screen.getByText('Prepare ownership verification')).not.toBeDisabled())
  fireEvent.click(screen.getByText('Prepare ownership verification'))
  state.user = { userId: 'different-cdp-user', evmAccounts: ['0x2222222222222222222222222222222222222222'] }
  page.rerender(<CdpWalletLinkPage />)
  await act(async () => finish(challenge()))
  expect(screen.queryByText('Review ownership message')).not.toBeInTheDocument()
  expect(state.sign).not.toHaveBeenCalled(); expect(verifyWalletLink).not.toHaveBeenCalled()
  expect(state.auth.user.id).toBe('1')
})
it('raw SDK errors are not rendered as account or wallet diagnostics', async () => {
  state.sign.mockRejectedValueOnce(Object.assign(new Error('sensitive-upstream-marker'), { status: 500 }))
  render(<CdpWalletLinkPage />)
  await waitFor(() => expect(screen.getByText('Prepare ownership verification')).not.toBeDisabled())
  fireEvent.click(screen.getByText('Prepare ownership verification')); await screen.findByText('Review ownership message')
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByText('Sign and verify ownership'))
  await screen.findByText(/Wallet request could not be completed/)
  expect(screen.queryByText(/sensitive-upstream-marker/)).not.toBeInTheDocument()
})
