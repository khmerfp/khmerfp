// test wallet page states without requesting real wallet signatures.
import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { id } from 'ethers'
import WalletLinkPage from './WalletLinkPage.jsx'
import { inspectCoinbaseWalletSetup } from '../services/coinbaseWalletSetup.js'
vi.mock('../services/coinbaseWalletSetup.js', () => ({ inspectCoinbaseWalletSetup: vi.fn() }))
import { useAuth } from '../auth/authContext.js'
import { connectUserCoinbaseWallet, signWalletOwnership } from '../services/coinbaseWallet.js'
import {
  listLinkedWallets,
  requestWalletLink,
  verifyWalletLink,
} from '../services/walletLinkApi.js'
import { walletLinkTypes } from '../../../packages/domain/src/walletLinkProtocol.js'
vi.mock('../auth/authContext.js', () => ({ useAuth: vi.fn() }))
vi.mock('../components/AuthModal.jsx', () => ({ default: () => <p>Existing KhmerFP sign-in</p> }))
vi.mock('../services/coinbaseWallet.js', () => ({
  connectUserCoinbaseWallet: vi.fn(),
  signWalletOwnership: vi.fn(),
}))
vi.mock('../services/walletLinkApi.js', () => ({
  listLinkedWallets: vi.fn(),
  requestWalletLink: vi.fn(),
  verifyWalletLink: vi.fn(),
}))
const address = `0x${'11'.repeat(20)}`
let auth, connection, events
function challenge(action = 'LINK') {
  const challengeId = '11111111-1111-4111-8111-111111111111',
    issuedAt = Math.floor(Date.now() / 1000)
  return {
    challengeId,
    typedData: {
      domain: {
        name: 'KhmerFP Wallet Ownership',
        version: '1',
        chainId: 84532,
        salt: id(location.origin),
      },
      types: walletLinkTypes,
      primaryType: 'WalletLink',
      message: {
        challengeId,
        action,
        userId: '1',
        wallet: address,
        sessionBinding: id('session'),
        appOrigin: location.origin,
        nonce: id('nonce'),
        issuedAt,
        expiresAt: issuedAt + 120,
      },
    },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  events = {}
  auth = { user: { id: '1', display_name: 'Trader' }, status: 'authenticated' }
  useAuth.mockImplementation(() => auth)
  connection = {
    address,
    deployed: true,
    provider: {
      on: vi.fn((event, fn) => {
        events[event] = fn
      }),
      removeListener: vi.fn(),
      disconnect: vi.fn(),
    },
  }
  connectUserCoinbaseWallet.mockResolvedValue(connection)
  signWalletOwnership.mockResolvedValue('0x1234')
  listLinkedWallets.mockResolvedValue({ wallets: [] })
  requestWalletLink.mockImplementation(async ({ action }) => challenge(action))
  verifyWalletLink.mockResolvedValue({ grantsTradingPermission: false })
})
afterEach(cleanup)
async function connect() {
  render(<WalletLinkPage />)
  fireEvent.click(screen.getByText('Connect Coinbase wallet on Base Sepolia'))
  await screen.findByText(address)
  await waitFor(() => expect(screen.getByText('Sign ownership link')).not.toBeDisabled())
}
it('requires the existing KhmerFP login before wallet connection', async () => {
  auth = { user: null, status: 'unauthenticated' }
  render(<WalletLinkPage />)
  fireEvent.click(screen.getByText('Sign in to KhmerFP first'))
  expect(screen.getByText('Existing KhmerFP sign-in')).toBeInTheDocument()
  expect(connectUserCoinbaseWallet).not.toHaveBeenCalled()
  expect(requestWalletLink).not.toHaveBeenCalled()
})
it('signs only the server ownership challenge and prevents duplicate submissions', async () => {
  await connect()
  fireEvent.click(screen.getByText('Sign ownership link'))
  fireEvent.click(screen.getByText('Sign ownership link'))
  await screen.findByText(/No trading or transfer permission was granted/)
  expect(requestWalletLink).toHaveBeenCalledTimes(1)
  expect(requestWalletLink).toHaveBeenCalledWith({
    walletAddress: address,
    chainId: 84532,
    action: 'LINK',
  })
  expect(verifyWalletLink).toHaveBeenCalledWith({
    challengeId: '11111111-1111-4111-8111-111111111111',
    signature: '0x1234',
  })
  expect(signWalletOwnership.mock.calls[0][1].domain.name).toBe('KhmerFP Wallet Ownership')
})
it('blocks replacement trading domains and mismatched application users before signing', async () => {
  await connect()
  const wrong = challenge()
  wrong.typedData.domain.name = 'KhmerFP Exchange'
  requestWalletLink.mockResolvedValueOnce(wrong)
  fireEvent.click(screen.getByText('Sign ownership link'))
  await screen.findByText(/does not match this user/)
  expect(signWalletOwnership).not.toHaveBeenCalled()
  expect(verifyWalletLink).not.toHaveBeenCalled()
})
it('does not treat an undeployed SDK account as verified ownership', async () => {
  connection.deployed = false
  render(<WalletLinkPage />)
  fireEvent.click(screen.getByText('Connect Coinbase wallet on Base Sepolia'))
  await screen.findByText(/Wallet is undeployed/)
  expect(screen.getByText('Sign ownership link')).toBeDisabled()
  expect(requestWalletLink).not.toHaveBeenCalled()
})
it('discards in-flight signatures when the application account switches', async () => {
  let finish
  signWalletOwnership.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const view = render(<WalletLinkPage />)
  fireEvent.click(screen.getByText('Connect Coinbase wallet on Base Sepolia'))
  await screen.findByText(address)
  await waitFor(() => expect(screen.getByText('Sign ownership link')).not.toBeDisabled())
  fireEvent.click(screen.getByText('Sign ownership link'))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  auth = { user: { id: '2', display_name: 'Other trader' }, status: 'authenticated' }
  view.rerender(<WalletLinkPage />)
  await act(async () => finish('0x1234'))
  expect(verifyWalletLink).not.toHaveBeenCalled()
  expect(connection.provider.disconnect).toHaveBeenCalled()
})
it('clears connected wallet state on a wallet/network event', async () => {
  await connect()
  act(() => events.chainChanged('0x2105'))
  await screen.findByText(/Wallet changed. Connect again/)
  expect(screen.queryByText('Sign ownership link')).not.toBeInTheDocument()
})
it('surfaces the existing application step-up requirement without signing a relink', async () => {
  await connect()
  requestWalletLink.mockRejectedValueOnce(
    new Error('Fresh application step-up authentication is required.'),
  )
  fireEvent.click(screen.getByText('Sign relink proof'))
  await screen.findByText(/Fresh application step-up/)
  expect(signWalletOwnership).not.toHaveBeenCalled()
  expect(verifyWalletLink).not.toHaveBeenCalled()
})

it('shows connection rejection and permits a clean retry', async () => {
  connectUserCoinbaseWallet.mockRejectedValueOnce(Object.assign(new Error('rejected'), { code: 4001 }))
  render(<WalletLinkPage />)
  fireEvent.click(screen.getByText('Connect Coinbase wallet on Base Sepolia'))
  await screen.findByText(/Wallet request cancelled/)
  expect(requestWalletLink).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Connect Coinbase wallet on Base Sepolia'))
  await screen.findByText(address)
  expect(screen.getByText('Network: Base Sepolia (84532)')).toBeInTheDocument()
})

it('shows wrong-network errors without requesting a challenge', async () => {
  connectUserCoinbaseWallet.mockRejectedValueOnce(new Error('Base Sepolia is required.'))
  render(<WalletLinkPage />)
  fireEvent.click(screen.getByText('Connect Coinbase wallet on Base Sepolia'))
  await screen.findByText('Base Sepolia is required.')
  expect(requestWalletLink).not.toHaveBeenCalled()
})

it('handles signature rejection without verification or a false success', async () => {
  await connect()
  signWalletOwnership.mockRejectedValueOnce(Object.assign(new Error('rejected'), { code: 'ACTION_REJECTED' }))
  fireEvent.click(screen.getByText('Sign ownership link'))
  await screen.findByText(/Wallet request cancelled/)
  expect(verifyWalletLink).not.toHaveBeenCalled()
  expect(screen.getByText('Sign ownership link')).not.toBeDisabled()
})

it('rejects an expired server challenge before requesting a signature', async () => {
  await connect()
  const expired = challenge()
  expired.typedData.message.issuedAt -= 300
  expired.typedData.message.expiresAt -= 300
  requestWalletLink.mockResolvedValueOnce(expired)
  fireEvent.click(screen.getByText('Sign ownership link'))
  await waitFor(() => expect(screen.getByText('Sign ownership link')).not.toBeDisabled())
  expect(signWalletOwnership).not.toHaveBeenCalled()
  expect(verifyWalletLink).not.toHaveBeenCalled()
})

it.each(['Invalid wallet signature.', 'Challenge already consumed.', 'Wallet RPC unavailable.'])(
  'surfaces verification failure: %s', async (message) => {
    await connect()
    verifyWalletLink.mockRejectedValueOnce(new Error(message))
    fireEvent.click(screen.getByText('Sign ownership link'))
    await screen.findByText(message)
    expect(screen.queryByText(/Wallet ownership linked/)).not.toBeInTheDocument()
  },
)

it('discards a signature after the wallet address changes', async () => {
  let finish
  signWalletOwnership.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await connect()
  fireEvent.click(screen.getByText('Sign ownership link'))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  act(() => events.accountsChanged([`0x${'22'.repeat(20)}`]))
  await act(async () => finish('0x1234'))
  expect(verifyWalletLink).not.toHaveBeenCalled()
})

it('clears ownership records and connection when the session expires during verification', async () => {
  await connect()
  verifyWalletLink.mockRejectedValueOnce(Object.assign(new Error('Session expired'), { status: 401 }))
  fireEvent.click(screen.getByText('Sign ownership link'))
  await screen.findByText(/Your KhmerFP session expired/)
  expect(connection.provider.disconnect).toHaveBeenCalled()
  expect(screen.queryByText('Sign ownership link')).not.toBeInTheDocument()
})

it('reloads persisted ownership records on refresh without automatically connecting or signing', async () => {
  listLinkedWallets.mockResolvedValue({ wallets: [{ id: '1', wallet_address: address, chain_id: 84532, wallet_status: 'ACTIVE' }] })
  const page = render(<WalletLinkPage />)
  await screen.findByText(address)
  page.unmount()
  render(<WalletLinkPage />)
  await screen.findByText(address)
  expect(connectUserCoinbaseWallet).not.toHaveBeenCalled()
  expect(signWalletOwnership).not.toHaveBeenCalled()
})

it('unlink and relink use separate fresh signed challenges and refresh server records', async () => {
  await connect()
  fireEvent.click(screen.getByText('Sign unlink proof'))
  await screen.findByText(/Wallet link revoked/)
  fireEvent.click(screen.getByText('Sign relink proof'))
  await screen.findByText(/Wallet ownership linked/)
  expect(requestWalletLink.mock.calls.map(([body]) => body.action)).toEqual(['UNLINK', 'RELINK'])
  expect(signWalletOwnership).toHaveBeenCalledTimes(2)
  expect(verifyWalletLink).toHaveBeenCalledTimes(2)
})

it('distinguishes a signature-specific 401 from session expiry', async () => {
  await connect()
  verifyWalletLink.mockRejectedValueOnce(Object.assign(new Error('Wallet ownership signature was rejected.'), { status: 401 }))
  fireEvent.click(screen.getByText('Sign ownership link'))
  await screen.findByText('Wallet ownership signature was rejected.')
  expect(screen.getByText('Verification failed')).toBeInTheDocument()
  expect(screen.getByText(address)).toBeInTheDocument()
  expect(screen.queryByText(/Your KhmerFP session expired/)).not.toBeInTheDocument()
})
it('cancels a pending local signature and discards its eventual result', async () => {
  let finish
  signWalletOwnership.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await connect()
  fireEvent.click(screen.getByText('Sign ownership link'))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  fireEvent.click(screen.getByText('Cancel request'))
  await act(async () => finish('0x1234'))
  expect(verifyWalletLink).not.toHaveBeenCalled()
})

it('setup recheck failures block signing without starting an ownership request', async () => {
  await connect()
  inspectCoinbaseWalletSetup.mockResolvedValueOnce({ deployed: false, state: 'SETUP_UNAVAILABLE', message: 'Setup unavailable: read failed.' })
  fireEvent.click(screen.getByText('Check setup again'))
  await screen.findByText('Setup unavailable: read failed.')
  expect(screen.getByText('Sign ownership link')).toBeDisabled()
  expect(requestWalletLink).not.toHaveBeenCalled()
  expect(signWalletOwnership).not.toHaveBeenCalled()
})
it('a positive setup recheck does not automatically request ownership signing', async () => {
  await connect()
  inspectCoinbaseWalletSetup.mockResolvedValueOnce({ deployed: true, state: 'CODE_DETECTED', message: 'Public contract code detected.' })
  fireEvent.click(screen.getByText('Check setup again'))
  await screen.findByText('Public contract code detected.')
  expect(requestWalletLink).not.toHaveBeenCalled()
  expect(signWalletOwnership).not.toHaveBeenCalled()
  expect(verifyWalletLink).not.toHaveBeenCalled()
})
it('discards setup results after the wallet account changes', async () => {
  await connect()
  let finish
  inspectCoinbaseWalletSetup.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  fireEvent.click(screen.getByText('Check setup again'))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  await act(async () => { events.accountsChanged() })
  await act(async () => { finish({ deployed: true, message: 'Stale setup result.' }) })
  expect(screen.queryByText('Stale setup result.')).not.toBeInTheDocument()
  expect(screen.queryByText(address)).not.toBeInTheDocument()
  expect(signWalletOwnership).not.toHaveBeenCalled()
})

it('a rejected network recheck cannot retain a previous ready state', async () => {
  await connect()
  inspectCoinbaseWalletSetup.mockRejectedValueOnce(new Error('Wallet read network mismatch.'))
  fireEvent.click(screen.getByText('Check setup again'))
  await screen.findByText('Wallet read network mismatch.')
  expect(screen.getByText('Sign ownership link')).toBeDisabled()
  expect(signWalletOwnership).not.toHaveBeenCalled()
})

it('new-account onboarding opens the same official coinbase connection without signing', async () => {
  render(<WalletLinkPage />)
  expect(screen.getByText(/account creation option in its hosted window/)).toBeInTheDocument()
  fireEvent.click(screen.getByText('New to Coinbase? Continue with Coinbase'))
  await screen.findByText(address)
  expect(connectUserCoinbaseWallet).toHaveBeenCalledOnce()
  expect(connectUserCoinbaseWallet.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
  expect(requestWalletLink).not.toHaveBeenCalled()
  expect(signWalletOwnership).not.toHaveBeenCalled()
})
it('a cancelled hosted onboarding error cannot replace the cancellation message', async () => {
  let reject
  connectUserCoinbaseWallet.mockImplementationOnce(() => new Promise((_, failure) => { reject = failure }))
  render(<WalletLinkPage />)
  fireEvent.click(screen.getByText('New to Coinbase? Continue with Coinbase'))
  await screen.findByText(/Continue in Coinbase to sign in or create a wallet/)
  fireEvent.click(screen.getByText('Cancel request'))
  await act(async () => { reject(new Error('Late popup failure')) })
  expect(screen.queryByText('Late popup failure')).not.toBeInTheDocument()
  expect(screen.getByText(/Request cancelled locally/)).toBeInTheDocument()
  expect(signWalletOwnership).not.toHaveBeenCalled()
})
it('duplicate link errors do not display a successful link', async () => {
  await connect()
  requestWalletLink.mockRejectedValueOnce(Object.assign(new Error('Wallet cannot be linked to this account.'), { status: 409 }))
  fireEvent.click(screen.getByText('Sign ownership link'))
  await screen.findByText('Wallet cannot be linked to this account.')
  expect(screen.queryByText('Successfully linked')).not.toBeInTheDocument()
  expect(signWalletOwnership).not.toHaveBeenCalled()
})
it('backend persistence failures never become a linked success', async () => {
  await connect()
  verifyWalletLink.mockRejectedValueOnce(Object.assign(new Error('Wallet persistence unavailable.'), { status: 503 }))
  fireEvent.click(screen.getByText('Sign ownership link'))
  await screen.findByText('Wallet persistence unavailable.')
  expect(screen.queryByText('Successfully linked')).not.toBeInTheDocument()
})
it('identifies the connected wallet among verified account records', async () => {
  listLinkedWallets.mockResolvedValue({ wallets: [{ id: '7', wallet_address: address, chain_id: '84532', wallet_status: 'ACTIVE', ownership_verification_status: 'VERIFIED' }] })
  render(<WalletLinkPage />)
  await screen.findByText('Ownership: VERIFIED')
  fireEvent.click(screen.getByText('Connect Coinbase wallet on Base Sepolia'))
  await screen.findByText('Currently connected wallet')
  expect(screen.getByText('Verified link')).toBeInTheDocument()
})
