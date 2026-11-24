import { describe, expect, it } from 'vitest';
import { referenceView, referenceNumber, referencePoints } from './referencePrice.js';

// Isolated normalized API fixtures only. They do not enable a provider or claim
// that any current PostgreSQL mock observation is verified real-world data.
const start = '2026-11-21T10:00:00Z', latestAt = '2026-11-21T10:02:00Z', asOf = '2026-11-21T10:02:01Z';
const sample = (id, value, observedAt) => ({ id, value, observedAt, recordedAt: observedAt, marketId: 'market', roundKey: 'round', sourceId: 'reviewed-fixture-source', unit: 'USD_PER_METRIC_TON', decimals: 2, verification: 'VERIFIED', purpose: 'REFERENCE' });
function fixture() {
  const opening = sample('open', '100000', start), latest = sample('latest', '101025', latestAt);
  return { id: 'market', round_key: 'round', trading_starts_at: start, trading_ends_at: '2026-11-21T11:00:00Z', referenceAsOf: asOf,
    referencePrice: { kind: 'NUMERIC', marketId: 'market', roundKey: 'round', status: 'AVAILABLE', verification: 'VERIFIED', sourceId: 'reviewed-fixture-source', unit: 'USD_PER_METRIC_TON', decimals: 2, maxAgeMs: 60000, opening, latest, history: [latest, opening] } };
}
const view = market => referenceView(market, Date.parse(asOf));
describe('independent reference price read model', () => {
  it('uses exact scaled values and a rounded percentage from the same round opening', () => {
    const result = view(fixture());
    expect(result.change).toBe(1025n);
    expect(result.percentage).toBe('1.03%');
    expect(referenceNumber(result.latest.value, 2)).toBe('1010.25');
    expect(result.history.map(o => o.id)).toEqual(['open', 'latest']);
  });
  it('ignores all prediction fills and token quote fields', () => {
    const market = fixture(), before = view(market);
    market.trades = [{ price_cents: '99' }]; market.claims = [{ last_price_cents: '1' }];
    expect(view(market)).toEqual(before);
  });
  it('rejects mock, missing or merely final observations without verification', () => {
    for (const patch of [{ verification: 'NOT_CONFIGURED' }, { verification: 'MOCK_ONLY' }, { maxAgeMs: null }]) {
      const market = fixture(); Object.assign(market.referencePrice, patch); expect(view(market).latest).toBeNull();
    }
    const market = fixture(); market.referencePrice.latest = { ...market.referencePrice.latest, verification: undefined, is_final: true };
    expect(view(market).status).toBe('UNAVAILABLE');
    expect(view({ ...market, referencePrice: null }).latest).toBeNull();
  });
  it('marks stale values unavailable using authoritative server time and the reviewed age bound', () => {
    const market = fixture();
    const result = referenceView(market, Date.parse(asOf) + 60001);
    expect(result.status).toBe('STALE'); expect(result.latest).toBeNull(); expect(result.history).toHaveLength(2);
  });
  it('rejects other rounds, markets, sources, units and precision', () => {
    for (const patch of [{ marketId: 'other' }, { roundKey: 'other' }, { sourceId: 'other' }, { unit: 'KHR_PER_LITRE' }, { decimals: 0 }]) {
      const market = fixture(); Object.assign(market.referencePrice.latest, patch); expect(view(market).latest).toBeNull();
    }
    const market = fixture(); market.referencePrice.marketId = 'other'; expect(view(market).latest).toBeNull();
  });
  it('requires an exact opening observation and handles zero openings safely', () => {
    const market = fixture(); market.referencePrice.opening.observedAt = '2026-11-21T10:00:01Z';
    expect(view(market).opening).toBeNull(); expect(view(market).percentage).toBeNull();
    const zero = fixture(); zero.referencePrice.opening.value = '0';
    expect(view(zero).percentage).toBeNull(); expect(view(zero).change).toBe(101025n);
  });
  it('rejects future observations, delayed records after the snapshot, and conflicting revisions', () => {
    for (const patch of [{ observedAt: '2026-11-21T10:03:00Z' }, { recordedAt: '2026-11-21T10:03:00Z' }, { value: 123.4 }]) {
      const market = fixture(); Object.assign(market.referencePrice.latest, patch); expect(view(market).latest).toBeNull();
    }
    const market = fixture(); market.referencePrice.history.push({ ...market.referencePrice.opening, id: 'conflict', value: '2' });
    expect(view(market).status).toBe('UNAVAILABLE');
  });
  it('preserves large integers and negative changes without Number conversion', () => {
    const market = fixture(); market.referencePrice.opening.value = '900719925474099312345'; market.referencePrice.latest.value = '900719925474099312344';
    const result = view(market); expect(result.change).toBe(-1n); expect(referenceNumber(result.latest.value, 2)).toBe('9007199254740993123.44');
    expect(referencePoints(result.history).every(p => p.y >= 8 && p.y <= 72)).toBe(true);
  });
  it('does not turn an event result or resolution evidence into a live price', () => {
    const market = fixture(); market.referencePrice.kind = 'EVENT'; expect(view(market).status).toBe('EVENT'); expect(view(market).latest).toBeNull();
    const numeric = fixture(); numeric.referencePrice.latest.purpose = 'RESOLUTION'; expect(view(numeric).latest).toBeNull();
  });
  it('does not create chart points without observations or duplicate a single sample', () => {
    expect(referencePoints([])).toEqual([]);
    expect(referencePoints([sample('one', '1000', start)])).toHaveLength(1);
  });
  it('keeps verified opening and history when a latest sample is missing without inventing one', () => {
    const market = fixture(); market.referencePrice.latest = null;
    expect(view(market).latest).toBeNull();
    expect(view(market).opening.id).toBe('open');
    expect(view(market).history).toHaveLength(2);
    expect(view(market).change).toBeNull();
  });
});
