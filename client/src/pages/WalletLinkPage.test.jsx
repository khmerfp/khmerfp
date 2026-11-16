import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { id } from 'ethers'
import WalletLinkPage from './WalletLinkPage.jsx'
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
