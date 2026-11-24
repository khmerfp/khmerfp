import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useTradingWorkspace } from './useTradingWorkspace.js';

const mock = vi.hoisted(() => ({ request: vi.fn(), subscriptions: [] }));
vi.mock('../services/custodialTrading.js', () => ({
  custodialEnabled: true,
  tradingRequest: (...args) => mock.request(...args),
  subscribeTrading: (privateStream, refresh) => {
    const subscription = { privateStream, refresh, closed: false };
    mock.subscriptions.push(subscription);
    return () => { subscription.closed = true; };
  },
}));
let posted;
beforeEach(() => {
  posted = '10000';
  mock.subscriptions.length = 0;
  mock.request.mockReset().mockImplementation(async path => {
    if (path.startsWith('/markets?')) return { serverTime: new Date().toISOString(), markets: [{ id: 'market' }] };
    if (path === '/me/portfolio') return { cash: { posted, available: posted, reserved: '0' }, positions: [] };
    if (path.startsWith('/me/orders')) return { orders: [{ id: 'order' }] };
    if (path === '/me/trades') return { trades: [] };
    throw new Error('Unexpected test request');
  });
});
it('recovers an SSE outage from an authoritative snapshot without financial mutations', async () => {
  const dispatch = vi.fn();
  const { result } = renderHook(() => useTradingWorkspace('1', dispatch));
  await waitFor(() => expect(result.current.portfolio.cash.posted).toBe('10000'));
  posted = '9000';
  act(() => mock.subscriptions[0].refresh());
  await waitFor(() => expect(result.current.portfolio.cash.posted).toBe('9000'));
  expect(mock.request.mock.calls.every(([, options]) => !options.method)).toBe(true);
});
it('clears financial data on failed recovery and safely reloads it', async () => {
  const dispatch = vi.fn();
  const { result } = renderHook(() => useTradingWorkspace('1', dispatch));
  await waitFor(() => expect(result.current.portfolio.cash.posted).toBe('10000'));
  const normal = mock.request.getMockImplementation();
  mock.request.mockRejectedValue(new Error('sensitive internal connection details'));
  await act(async () => { await result.current.refresh(); });
  await waitFor(() => expect(result.current.error).toBe('connectionError'));
  expect(result.current.portfolio).toBeUndefined();
  expect(result.current.orders).toEqual([]);
  expect(result.current.book).toBeUndefined();
  expect(dispatch).toHaveBeenLastCalledWith({ type: 'SET_TRADING_BALANCE', value: null });
  mock.request.mockImplementation(normal);
  posted = '8000';
  await act(async () => { await result.current.refresh(); });
  await waitFor(() => expect(result.current.portfolio.cash.posted).toBe('8000'));
  expect(result.current.error).toBe('');
});
it('discards an old in-flight session response after account switching', async () => {
  const dispatch = vi.fn(), normal = mock.request.getMockImplementation();
  let finish;
  mock.request.mockImplementation(path => path === '/me/portfolio' ? new Promise(resolve => { finish = resolve; }) : normal(path));
  const { result, rerender } = renderHook(({ user }) => useTradingWorkspace(user, dispatch), { initialProps: { user: '1' } });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  mock.request.mockImplementation(normal);
  posted = '20000';
  rerender({ user: '2' });
  await waitFor(() => expect(result.current.portfolio.cash.posted).toBe('20000'));
  const currentClock = result.current.clock;
  await act(async () => finish({ cash: { posted: 'old-private-data', available: '1' } }));
  expect(result.current.portfolio.cash.posted).toBe('20000');
  expect(result.current.clock).toBe(currentClock);
  expect(mock.subscriptions.slice(0, 2).every(s => s.closed)).toBe(true);
});

it('keeps immutable range terms while discarding old books and delayed token responses', async () => {
  const dispatch = vi.fn(), normal = mock.request.getMockImplementation();
  const market = { id: 'market', claims: [
    { outcome_id: '10', polarity: 'YES', token_id: '1' },
    { outcome_id: '10', polarity: 'NO', token_id: '2' },
    { outcome_id: '20', polarity: 'YES', token_id: '3' },
  ] };
  let finish;
  mock.request.mockImplementation(async path => {
    if (path === '/markets/market') return { market };
    if (path === '/markets/market/rounds') return { rounds: [] };
    if (path.endsWith('/book/2')) return new Promise(resolve => { finish = resolve; });
    if (path.includes('/book/')) return { serverTime: new Date().toISOString(), tokenId: path.split('/').at(-1) };
    return normal(path);
  });
  const { result } = renderHook(() => useTradingWorkspace('1', dispatch));
  act(() => result.current.setMarket('market'));
  await waitFor(() => expect(result.current.book.tokenId).toBe('1'));
  act(() => result.current.setClaim('10:NO'));
  expect(result.current.market.id).toBe('market');
  expect(result.current.claim.token_id).toBe('2');
  expect(result.current.book).toBeUndefined();
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  act(() => result.current.setClaim('20:YES'));
  await waitFor(() => expect(result.current.book.tokenId).toBe('3'));
  await act(async () => { finish({ serverTime: new Date().toISOString(), tokenId: '2' }); });
  expect(result.current.book.tokenId).toBe('3');
  expect(result.current.claim.token_id).toBe('3');
});

it('drops the old round immediately and ignores its late snapshot after opening the next round', async () => {
  const dispatch = vi.fn(), normal = mock.request.getMockImplementation();
  let delayOldRound = false, finishOldRound;
  mock.request.mockImplementation(async path => {
    for (const id of ['first', 'second']) {
      if (path === `/markets/${id}`) return { market: { id, round_key: id, claims: [{ outcome_id: id, polarity: 'YES', token_id: id }] } };
      if (path === `/markets/${id}/rounds`) return { rounds: [] };
      if (path === `/markets/${id}/book/${id}`) {
        if (id === 'first' && delayOldRound) return new Promise(resolve => { finishOldRound = resolve; });
        return { marketId: id, tokenId: id, serverTime: new Date().toISOString() };
      }
    }
    return normal(path);
  });
  const { result } = renderHook(() => useTradingWorkspace('1', dispatch));
  act(() => result.current.setMarket('first'));
  await waitFor(() => expect(result.current.book?.marketId).toBe('first'));
  delayOldRound = true;
  act(() => { void result.current.refresh(); });
  await waitFor(() => expect(finishOldRound).toBeTypeOf('function'));
  act(() => result.current.setMarket('second'));
  expect(result.current.market).toBeNull();
  expect(result.current.book).toBeUndefined();
  await waitFor(() => expect(result.current.book?.marketId).toBe('second'));
  await act(async () => { finishOldRound({ marketId: 'first', tokenId: 'first', serverTime: new Date().toISOString() }); });
  expect(result.current.market.id).toBe('second');
  expect(result.current.market.round_key).toBe('second');
  expect(result.current.book.tokenId).toBe('second');
});
