import { describe, it, expect } from 'vitest';
import { estimateBook } from './bookEstimate.js';
const time = '2026-01-01T00:02:00Z';
const snapshot = () => ({
  marketId: 'market', tokenId: '1', viewerUserId: null, snapshotId: '20:20:', serverTime: time,
  book: { market_id: 'market', token_id: '1', command_sequence: '8' },
  marketState: { lifecycle_status: 'ACTIVE', trading_status: 'OPEN', resolution_status: 'UNRESOLVED', terms_frozen_at: time, trading_starts_at: '2026-01-01T00:00:00Z', trading_ends_at: '2026-01-01T00:05:00Z' },
  executionDepth: { BUY: [{ price_cents: '53', quantity: '2000000' }, { price_cents: '55', quantity: '10000000' }], SELL: [{ price_cents: '48', quantity: '10000000' }] },
});
const quote = overrides => estimateBook({ snapshot: snapshot(), marketId: 'market', tokenId: '1', side: 'BUY', quantity: '1000000', priceCents: '60', ...overrides });
describe('snapshot-bound indicative execution', () => {
  it('estimates the visible 53-cent ask at a 60-cent BUY limit without login', () => {
    expect(quote()).toMatchObject({ estimatedTotalCents: '53', estimatedExecutableQuantity: '1000000', snapshotId: '20:20:', estimatedAverageExecutionPriceCents: { numerator: '53', denominator: '1' } });
  });
  it('walks multiple prices with exact integer weighted consideration', () => expect(quote({ quantity: '3000000' })).toMatchObject({ estimatedTotalCents: '161', estimatedWorstExecutionPriceCents: '55' }));
  it('uses bids for SELL and respects minimum proceeds protection', () => {
    expect(quote({ side: 'SELL', priceCents: '40' }).estimatedTotalCents).toBe('48');
    expect(quote({ side: 'SELL', priceCents: '49' }).estimatedExecutableQuantity).toBe('0');
  });
  it('bounds a market BUY by its explicit spending cap', () => expect(quote({ quantity: '3000000', maxSpendCents: '106' })).toMatchObject({ estimatedExecutableQuantity: '2000000', estimatedUnfilledQuantity: '1000000', estimatedTotalCents: '106', stoppedReason: 'SPENDING_CAP' }));
  it('does not cross a signed-in self-trade barrier', () => {
    const book = snapshot(); book.viewerUserId = '7'; book.executionDepth.BUY = [{ price_cents: '53', quantity: '1000000' }, { price_cents: '53', quantity: '0', own: true }];
    expect(quote({ snapshot: book, userId: '7', quantity: '2000000' })).toMatchObject({ estimatedExecutableQuantity: '1000000', stoppedReason: 'SELF_TRADE_PREVENTION' });
  });
  it('rejects mismatched market, canonical token, session and expired snapshots', () => {
    for (const terms of [{ marketId: 'other' }, { tokenId: '2' }, { userId: '7' }, { now: Date.parse(time) + 30001 }]) expect(quote(terms)).toBeNull();
  });
  it('does not reuse an opposite-token estimate after a selection change', () => {
    const book = snapshot(); book.book.token_id = '2'; expect(quote({ snapshot: book })).toBeNull();
  });
  it('returns no executable quantity at the exact cutoff or on a paused market', () => {
    expect(quote({ now: Date.parse('2026-01-01T00:05:00Z'), snapshot: { ...snapshot(), serverTime: '2026-01-01T00:05:00Z' } }).stoppedReason).toBe('MARKET_CLOSED');
    const book = snapshot(); book.marketState.trading_status = 'PAUSED'; expect(quote({ snapshot: book }).estimatedExecutableQuantity).toBe('0');
  });
  it('rejects floating-point, fractional-share and overflow inputs', () => {
    for (const quantity of [1, '1.5', '1', '9223372036854775808']) expect(quote({ quantity })).toBeNull();
    for (const priceCents of [60, '0', '100', '53.5']) expect(quote({ priceCents })).toBeNull();
  });
  it('preserves quantities beyond the safe JavaScript Number range', () => {
    const book = snapshot(); book.executionDepth.BUY = [{ price_cents: '1', quantity: '9007199254000000' }];
    expect(quote({ snapshot: book, quantity: '9007199254000000', priceCents: '1' }).estimatedTotalCents).toBe('9007199254');
  });
});
