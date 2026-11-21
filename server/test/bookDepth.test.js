import test from 'node:test';
import assert from 'node:assert/strict';
import { executionDepth } from '../src/trading/bookDepth.js';
test('indicative depth aggregates FIFO quantities without exposing maker identities', () => {
  const result = executionDepth([
    { side: 'SELL', price_cents: '53', quantity: '1000000', user_id: 'private' },
    { side: 'SELL', price_cents: '53', quantity: '2000000', user_id: 'another-private' },
    { side: 'BUY', price_cents: '48', quantity: '9000000' },
  ]);
  assert.deepEqual(result, { BUY: [{ price_cents: '53', quantity: '3000000' }], SELL: [{ price_cents: '48', quantity: '9000000' }] });
  assert.ok(!JSON.stringify(result).includes('private'));
});
test('own orders stop depth at their exact price/FIFO position', () => {
  const result = executionDepth([
    { side: 'SELL', price_cents: '53', quantity: '1000000' },
    { side: 'SELL', price_cents: '53', quantity: '2000000', own: true },
    { side: 'SELL', price_cents: '53', quantity: '7000000' },
  ]);
  assert.deepEqual(result.BUY, [{ price_cents: '53', quantity: '1000000' }, { price_cents: '53', quantity: '0', own: true }]);
});
