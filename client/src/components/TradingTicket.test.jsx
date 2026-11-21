import React from 'react';
import { beforeEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TradingTicket from './TradingTicket.jsx';
const state = vi.hoisted(() => ({ value: null }));
vi.mock('../state/AppContext.jsx', () => ({ useApp: () => state.value }));
const market = { id: 'market', market_type: 'BINARY', lifecycle_status: 'ACTIVE', trading_status: 'OPEN', resolution_status: 'UNRESOLVED', terms_frozen_at: '2026-01-01T00:00:00Z', trading_starts_at: '2026-01-01T00:00:00Z', trading_ends_at: '2026-01-01T00:05:00Z', claims: [{ outcome_id: '1', outcome_label: 'YES' }] };
const claim = { outcome_id: '1', polarity: 'YES', token_id: 'token', book_id: 'book' };
beforeEach(() => {
  sessionStorage.clear();
  state.value = { lang: 'en', trading: {
    clock: Date.parse('2026-01-01T00:02:00Z'), markets: [], refresh: vi.fn(), setClaim: vi.fn(),
    book: { marketId: 'market', tokenId: 'token', viewerUserId: null, snapshotId: '7:7:', serverTime: '2026-01-01T00:02:00Z', marketState: market,
      book: { market_id: 'market', token_id: 'token', command_sequence: '1' }, executionDepth: { BUY: [{ price_cents: '53', quantity: '10000000' }], SELL: [{ price_cents: '48', quantity: '10000000' }] } },
  } };
});
it('signed-out users see an automatic read-only estimate while submission stays disabled', () => {
  render(<TradingTicket market={market} claim={claim} userId={null} onCommitted={vi.fn()} />);
  expect(screen.getByText('$0.53')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Sign in to trade' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Estimate execution' }));
  expect(state.value.trading.refresh).toHaveBeenCalledTimes(1);
  expect(sessionStorage.length).toBe(0);
  expect(screen.getByText('Not determined')).toBeVisible();
});
it('never displays a previous canonical token estimate after selection changes', () => {
  state.value.trading.book.tokenId = 'other';
  render(<TradingTicket market={market} claim={claim} userId={null} onCommitted={vi.fn()} />);
  expect(screen.queryByText('$0.53')).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign in to trade' })).toBeDisabled();
});
it('preserves signed-in self-trade prevention in the preview', () => {
  state.value.trading.book.viewerUserId = '7';
  state.value.trading.book.executionDepth.BUY = [{ price_cents: '53', quantity: '0', own: true }];
  render(<TradingTicket market={market} claim={claim} userId="7" onCommitted={vi.fn()} />);
  expect(screen.getByText('Your own resting order prevents this match.')).toBeVisible();
  expect(screen.queryByText('$0.53')).toBeNull();
});
