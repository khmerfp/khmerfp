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

it('labels each range price as historical and follows the exact YES/NO registry mapping', () => {
  const claims = Array.from({ length: 6 }, (_, i) => ['YES', 'NO'].map((polarity, j) => ({
    outcome_id: String(i), outcome_label: `Range ${i}`, polarity, token_id: String(i * 2 + j + 1),
    last_price_cents: String(j ? 71 + i : 11 + i), book_id: 'book',
  }))).flat();
  const categorical = { ...market, market_type: 'PRICE_RANGE', claims };
  const { rerender } = render(<TradingTicket market={categorical} claim={claims[0]} userId={null} onCommitted={vi.fn()} />);
  expect(screen.getByText(/Historical prices, not executable quotes/)).toBeVisible();
  expect(screen.getAllByText('Last trade')).toHaveLength(6);
  expect(screen.getByText('11 cents')).toBeVisible();
  expect(screen.queryByText('71 cents')).toBeNull();
  rerender(<TradingTicket market={categorical} claim={claims[1]} userId={null} onCommitted={vi.fn()} />);
  expect(screen.getByText('71 cents')).toBeVisible();
  expect(screen.queryByText('11 cents')).toBeNull();
  expect(document.querySelector('[data-price-token-id="2"]')).toHaveTextContent('71 cents');
});

it('preserves ticket terms across token changes but blocks execution until the matching snapshot arrives', () => {
  const claims = [{ ...claim, outcome_label: 'Range', last_price_cents: '51' }, { ...claim, polarity: 'NO', token_id: 'other', outcome_label: 'Range', last_price_cents: '49' }];
  const categorical = { ...market, market_type: 'PRICE_RANGE', claims };
  state.value.trading.book.viewerUserId = '7';
  const { rerender } = render(<TradingTicket market={categorical} claim={claims[0]} userId="7" onCommitted={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sell', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Market', exact: true }));
  state.value.trading.book = undefined;
  rerender(<TradingTicket market={categorical} claim={claims[1]} userId="7" onCommitted={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Sell', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Market', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Submit order', exact: true })).toBeDisabled();
  expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
});

it('blocks a previously valid ticket at its real cutoff without pending work, then accepts a fresh round snapshot', () => {
  state.value.trading.book.viewerUserId = '7';
  const { rerender } = render(<TradingTicket market={market} claim={claim} userId="7" onCommitted={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Submit order', exact: true })).toBeEnabled();
  // A long browser sequence must not bypass the market deadline just because
  // authentication, funds and the old snapshot were valid before the cutoff.
  state.value.trading.clock = Date.parse(market.trading_ends_at);
  rerender(<TradingTicket market={market} claim={claim} userId="7" onCommitted={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Submit order', exact: true })).toBeDisabled();
  expect(screen.getByText('Trading is closed for this round.')).toBeVisible();
  expect(screen.queryByText('An earlier request is awaiting confirmation.')).toBeNull();
  expect(sessionStorage.length).toBe(0);

  const next = { ...market, id: 'next-round', trading_starts_at: market.trading_ends_at, trading_ends_at: '2026-01-01T00:10:00Z' };
  rerender(<TradingTicket key={next.id} market={next} claim={claim} userId="7" onCommitted={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Submit order', exact: true })).toBeDisabled();
  state.value.trading.book = { ...state.value.trading.book, marketId: next.id, marketState: next,
    book: { ...state.value.trading.book.book, market_id: next.id }, serverTime: next.trading_starts_at, snapshotId: '8:8:' };
  rerender(<TradingTicket key={next.id} market={next} claim={claim} userId="7" onCommitted={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Submit order', exact: true })).toBeEnabled();
  expect(screen.queryByText('Trading is closed for this round.')).toBeNull();
});
