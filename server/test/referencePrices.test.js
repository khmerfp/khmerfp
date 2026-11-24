import test from 'node:test';
import assert from 'node:assert/strict';
import { referencePriceState } from '../src/trading/referencePrices.js';
const market = { id: 'market', round_key: 'round', market_type: 'PRICE_RANGE', observation_spec: { referenceAsset: 'HDPE' } };
const spec = { reference_asset: 'HDPE', decimals: 2, unit: 'USD_PER_METRIC_TON' };
test('mock-only infrastructure never emits a verified reference or a freshness policy', () => {
  const result = referencePriceState(market, spec, [{ kind: 'CLOSE', source_id: 'LOCAL_MOCK_HDPE', is_final: true, value: '120000' }]);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.verification, 'NOT_CONFIGURED');
  assert.equal(result.maxAgeMs, null);
  assert.deepEqual(result.history, []);
  assert.equal(result.latest, null);
  assert.equal(result.opening, null);
  assert.equal(result.unit, 'USD_PER_METRIC_TON');
  assert.equal(result.decimals, 2);
});
test('fill prices cannot change a reference read model', () => {
  const plain = referencePriceState(market, spec, []);
  assert.deepEqual(referencePriceState({ ...market, last_price_cents: '99', trades: [{ price_cents: '1' }] }, spec, []), plain);
});
test('event markets return stored event terms rather than a numeric reference', () => {
  const result = referencePriceState({ ...market, market_type: 'CATEGORICAL' }, null, [], { question_text: 'Who wins?', resolution_rules: 'Official final result', resolution_source: 'Approved event source pending' });
  assert.equal(result.kind, 'EVENT');
  assert.equal(result.event.question, 'Who wins?');
  assert.equal(result.latest, null);
});
test('reference metadata is pinned to each exact market and recurring round', () => {
  const first = referencePriceState(market, spec, []);
  const second = referencePriceState({ ...market, id: 'next', round_key: 'next-round' }, spec, []);
  assert.equal(first.marketId, 'market');
  assert.equal(second.marketId, 'next');
  assert.notEqual(first.roundKey, second.roundKey);
});
