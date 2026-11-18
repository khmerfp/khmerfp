// verify menu labels follow server ownership state and never another user.
import React from 'react'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ user: { id: '1', display_name: 'Trader', email: 'test@example.test' } }))
vi.mock('../state/AppContext.jsx', () => ({ useApp: () => ({ lang: 'en', themeMode: 'dark', balances: {}, positions: {}, setLang() {}, setThemeMode() {} }) }))
vi.mock('../auth/authContext.js', () => ({ useAuth: () => ({ user: state.user, logout: vi.fn() }) }))
vi.mock('../services/walletLinkApi.js', () => ({ listLinkedWallets: vi.fn() }))
import { listLinkedWallets } from '../services/walletLinkApi.js'
import Header from './Header.jsx'
const view = () => <MemoryRouter><Header accountMenuOpen setAccountMenuOpen={() => {}} /></MemoryRouter>
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('DEV', true); vi.stubEnv('VITE_CDP_EMBEDDED_WALLET_ENABLED', 'true'); vi.stubEnv('VITE_WALLET_LINK_ENABLED', 'false')
  state.user = { id: '1', display_name: 'Trader', email: 'test@example.test' }
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })
it('offers connection when no verified active wallet exists, including unverified connections', async () => {
  listLinkedWallets.mockResolvedValue({ wallets: [{ chain_id: '84532', wallet_status: 'ACTIVE', ownership_verification_status: 'UNVERIFIED' }] })
  render(view())
  expect(await screen.findByRole('link', { name: 'Connect wallet' })).toHaveAttribute('href', '/account/wallets')
})
it('offers management only for a verified active link on the supported chain', async () => {
  listLinkedWallets.mockResolvedValue({ wallets: [{ chain_id: '84532', wallet_status: 'ACTIVE', ownership_verification_status: 'VERIFIED' }] })
  render(view()); expect(await screen.findByRole('link', { name: 'Manage wallets' })).toBeInTheDocument()
})
it('does not show a connection state when fetching it fails', async () => {
  listLinkedWallets.mockRejectedValue(new Error('Network unavailable'))
  render(view()); await waitFor(() => expect(listLinkedWallets).toHaveBeenCalled())
  expect(screen.getByRole('link', { name: 'Wallets' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Manage wallets' })).not.toBeInTheDocument()
})
it('ignores another account response that arrives after switching users', async () => {
  let resolve
  listLinkedWallets.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    .mockResolvedValueOnce({ wallets: [] })
  const page = render(view())
  state.user = { ...state.user, id: '2' }; page.rerender(view())
  await screen.findByRole('link', { name: 'Connect wallet' })
  await act(async () => resolve({ wallets: [{ chain_id: '84532', wallet_status: 'ACTIVE', ownership_verification_status: 'VERIFIED' }] }))
  expect(screen.getByRole('link', { name: 'Connect wallet' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Manage wallets' })).not.toBeInTheDocument()
})
