import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localMarketDefinitions } from './localMarketDefinitions.js';

const definitions = localMarketDefinitions(new Date('2026-11-20T16:00:00.123Z'));
test('local catalog keeps four original market identities and explicit calendar bootstrap versions', () => {
  assert.equal(definitions.length, 7);
  assert.equal(new Set(definitions.map(t => t.key)).size, 4);
  assert.ok(definitions.every(t => t.definition.scope === 'MOCK_ONLY'));
  assert.ok(definitions.every(t => !JSON.stringify(t.definition).includes('yesPrice')));
  assert.ok(definitions.every(t => t.definition.outcomes.every(o => o.yes === undefined)));
});
test('Bitcoin uses real five-minute consecutive schedules, not accelerated demo time', () => {
  const { definition: d } = definitions.find(t => t.id === 'btc5m');
  assert.equal(d.schedule.mode, 'FIXED');
  assert.equal(d.schedule.stepSeconds, '300');
  assert.equal(d.schedule.tradingSeconds, '300');
  assert.deepEqual(d.outcomes.map(o => o.label), ['YES', 'NO']);
});
test('calendar bootstraps end exactly at the next Phnom Penh month/week boundary', () => {
  for (const id of ['steel-monthly', 'hdpe-monthly', 'petrol-weekly']) {
    const a = definitions.find(t => t.id === id && t.version === 1n).definition;
    const b = definitions.find(t => t.id === id && t.version === 2n).definition;
    const start = Date.parse(a.schedule.anchorLocal + '+07:00');
    assert.equal(start + Number(a.schedule.tradingSeconds) * 1000, Date.parse(b.schedule.anchorLocal + '+07:00'));
    assert.equal(b.schedule.durationMode, 'NEXT_OCCURRENCE');
    assert.equal(b.schedule.timezone, 'Asia/Phnom_Penh');
    assert.equal(b.schedule.mode, id === 'petrol-weekly' ? 'WEEKLY' : 'MONTHLY');
  }
});
test('six original range labels keep exact contiguous scaled integer boundaries', () => {
  for (const t of definitions.filter(t => t.id !== 'btc5m')) {
    const { outcomes, observation } = t.definition;
    assert.equal(outcomes.length, 6);
    assert.equal(outcomes[0].lower, '0');
    assert.equal(outcomes.at(-1).upper, null);
    for (let i = 1; i < outcomes.length; i++) assert.equal(outcomes[i - 1].upper, outcomes[i].lower);
    assert.equal(observation.decimals, t.id === 'petrol-weekly' ? '0' : '2');
  }
});

test('startup across midnight/month-end never creates a negative bootstrap duration', () => {
  for (const date of ['2026-11-30T16:59:55.100Z','2026-11-20T16:59:55.100Z']) {
    for (const spec of localMarketDefinitions(new Date(date))) assert.ok(BigInt(spec.definition.schedule.tradingSeconds) > 0n);
  }
});
