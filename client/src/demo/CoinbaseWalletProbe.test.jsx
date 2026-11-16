import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoinbaseWalletProbe from './CoinbaseWalletProbe.jsx'
import * as compatibility from './coinbaseCompatibility.js'
import { createBaseAccountSDK } from '@base-org/account'
vi.mock('@base-org/account', () => ({ createBaseAccountSDK: vi.fn() }))
vi.mock('./coinbaseCompatibility.js', async () => {
  const actual = await vi.importActual('./coinbaseCompatibility.js')
  return {
    ...actual,
    assertPocEnvironment: vi.fn(),
    connectCoinbaseProvider: vi.fn(),
    createPocRpc: vi.fn(),
    inspectCoinbaseAccount: vi.fn(),
  }
})
let provider, listeners
beforeEach(() => {
  vi.clearAllMocks()
  listeners = {}
  window.ethereum = { request: vi.fn() }
  provider = {
    request: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn((event, fn) => {
      listeners[event] = fn
    }),
    removeListener: vi.fn(),
  }
  createBaseAccountSDK.mockReturnValue({ getProvider: () => provider })
  compatibility.connectCoinbaseProvider.mockResolvedValue(`0x${'11'.repeat(20)}`)
  compatibility.createPocRpc.mockReturnValue({ destroy: vi.fn() })
  compatibility.inspectCoinbaseAccount.mockResolvedValue({
    address: `0x${'11'.repeat(20)}`,
    deploymentState: 'UNDEPLOYED',
    ownershipVerified: false,
  })
})
afterEach(cleanup)
describe('Coinbase compatibility screen - mocked SDK, not real Coinbase evidence', () => {
  it('does nothing until explicit testnet connection and keeps signing blocked', () => {
    render(<CoinbaseWalletProbe />)
    expect(createBaseAccountSDK).not.toHaveBeenCalled()
    expect(screen.getByText('Sign and verify test order')).toBeDisabled()
  })
  it('selects the passkey SDK testnet path and reports account state without claiming a trade', async () => {
    render(<CoinbaseWalletProbe />)
    fireEvent.click(screen.getByText('Connect Coinbase passkey wallet on Base Sepolia'))
    await screen.findByText(/"deploymentState": "UNDEPLOYED"/)
    expect(createBaseAccountSDK).toHaveBeenCalledWith(
      expect.objectContaining({ appChainIds: [84532], preference: { telemetry: false } }),
    )
    expect(window.ethereum.request).not.toHaveBeenCalled()
    expect(screen.getByText('Sign and verify test order')).toBeDisabled()
    expect(screen.getByText(/not a backend login or a successful trade/)).toBeInTheDocument()
  })
  it('rejects injected extension substitution', async () => {
    createBaseAccountSDK.mockReturnValue({ getProvider: () => window.ethereum })
    render(<CoinbaseWalletProbe />)
    fireEvent.click(screen.getByText('Connect Coinbase passkey wallet on Base Sepolia'))
    await screen.findByText(/not an injected extension/)
    expect(compatibility.connectCoinbaseProvider).not.toHaveBeenCalled()
  })
  it('clears proof and disconnects on account or network changes', async () => {
    render(<CoinbaseWalletProbe />)
    fireEvent.click(screen.getByText('Connect Coinbase passkey wallet on Base Sepolia'))
    await screen.findByText(/"deploymentState": "UNDEPLOYED"/)
    act(() => listeners.chainChanged('0x2105'))
    await waitFor(() => expect(screen.queryByText(/"deploymentState"/)).not.toBeInTheDocument())
    expect(provider.disconnect).toHaveBeenCalled()
  })
})
