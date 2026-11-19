import test from 'node:test'
import assert from 'node:assert/strict'
import { parseObservation, claimIndexSet, selectRangeOutcome } from './marketRegistry.js'

test('HDPE cents and gasoline whole-KHR observations stay exact and separate from trading', () => {
  assert.equal(parseObservation('1100.25', 2), 110025n)
  assert.equal(parseObservation('4100', 0), 4100n)
  assert.equal(parseObservation('-0.25', 2), -25n)
  assert.equal(parseObservation('9007199254740993.12', 2), 900719925474099312n)
  for (const value of [1100.25, NaN, '1e3', 'Infinity', '01', '1.001']) {
    assert.throws(() => parseObservation(value, 2))
  }
  assert.throws(() => parseObservation('4100.1', 0))
  assert.throws(() => parseObservation('1'.repeat(79), 0))
})

test('six-category singleton and complement claims use exact CTF masks', () => {
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => claimIndexSet(6, i, 'YES')), [1n, 2n, 4n, 8n, 16n, 32n])
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => claimIndexSet(6, i, 'NO')), [62n, 61n, 59n, 55n, 47n, 31n])
  assert.equal(claimIndexSet(2, 0, 'NO'), claimIndexSet(2, 1, 'YES'))
  assert.equal(claimIndexSet(256, 255, 'YES'), 1n << 255n)
  for (const args of [[1, 0, 'YES'], [257, 0, 'YES'], [6, 6, 'YES'], [6, 0, 'BUY']]) {
    assert.throws(() => claimIndexSet(...args))
  }
})

test('half-open ranges handle exact decimal boundaries and never invent a winner', () => {
  const outcomes = [{ id: 'low', lower: 0n, upper: 100025n }, { id: 'high', lower: 100025n, upper: null }]
  assert.equal(selectRangeOutcome(outcomes, 100024n), 'low')
  assert.equal(selectRangeOutcome(outcomes, parseObservation('1000.25', 2)), 'high')
  assert.throws(() => selectRangeOutcome(outcomes, -1n))
  assert.throws(() => selectRangeOutcome([...outcomes, outcomes[0]], 1n))
  assert.throws(() => selectRangeOutcome(outcomes, 1000.25))
  assert.throws(() => selectRangeOutcome([{ id: 'unsafe', lower: 0, upper: null }], 1n))
  assert.throws(() => selectRangeOutcome([{ id: 'reversed', lower: 2n, upper: 1n }], 1n))
})

test('every gasoline and HDPE interval boundary selects exactly one atomic outcome', () => {
  for (const [decimals, edges] of [[0, ['0','4000','4100','4200','4300','4400']], [2, ['0','600','630','660','690','720']]]) {
    const bounds = edges.map(value => parseObservation(value, decimals))
    const rows = bounds.map((lower, i) => ({ id: i, lower, upper: bounds[i + 1] ?? null }))
    for (let i = 1; i < bounds.length; i++) {
      assert.equal(selectRangeOutcome(rows, bounds[i] - 1n), i - 1)
      assert.equal(selectRangeOutcome(rows, bounds[i]), i)
      assert.equal(selectRangeOutcome(rows, bounds[i] + 1n), i)
    }
  }
})
