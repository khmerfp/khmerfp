import { describe, it, expect } from 'vitest';
import { marketView, visiblePositions, claimLabel, effectiveTradingStatus } from './marketView.js';
import { tradingLabels } from '../lib/tradingText.js';
import { SEED_MARKETS } from '../data/markets.js';
describe('original platform registry presentation', () => {
  it('does not fabricate quotes charts or volume', () => {
    const view = marketView({
      id: 'm',
      market_type: 'BINARY',
      title: 'A'
    });
    expect(view.yes).toBeNull();
    expect(view.no).toBeNull();
    expect(view.vol).toBeNull();
    expect(view.series).toEqual([]);
  });
  it('does not infer NO prices from YES last trades', () => {
    const v = marketView({
      outcomes: [{
        id: '1',
        label: 'A',
        yesPriceCents: '65'
      }]
    });
    expect(v.yes).toBe('65');
    expect(v.no).toBeNull();
  });
  it('keeps categorical and range outcome identities', () => {
    for (const type of ['CATEGORICAL', 'PRICE_RANGE']) {
      const view = marketView({
        market_type: type,
        outcomes: [{
          id: '3',
          label: 'Range A'
        }, {
          id: '4',
          label: 'OTHER'
        }]
      });
      expect(view.type).toBe('multi');
      expect(view.options.map(o => o.id)).toEqual(['3', '4']);
      expect(view.options.every(o => o.yes === null)).toBe(true);
    }
  });
  it('presents the required OTHER registry outcome using the original club label', () => {
    const original = SEED_MARKETS.find(market => market.id === 'cpl-champion-27');
    const view = marketView({
      template_key: 'khmerfp-cpl-champion-27',
      title: original.title,
      market_type: 'CATEGORICAL',
      outcomes: original.options.map((option, index) => ({
        id: String(index + 1), index, label: index === original.options.length - 1 ? 'OTHER' : option.label,
      })),
    });
    expect(view.options.at(-1).label).toBe('Any other club');
    expect(view.options.at(-1).labelKm).toBe(original.options.at(-1).labelKm);
  });
  it('deduplicates binary aliases without duplicating outcomes', () => expect(marketView({
    claims: [{
      outcome_id: '3',
      outcome_label: 'YES',
      polarity: 'YES'
    }, {
      outcome_id: '3',
      outcome_label: 'YES',
      polarity: 'NO'
    }]
  }).options).toHaveLength(1));
  it('hides zero-only positions but preserves reserved and held positions', () => expect(visiblePositions([{
    posted: '0',
    reserved: '0'
  }, {
    posted: '1000000',
    reserved: '0'
  }, {
    posted: '1000000',
    reserved: '1000000'
  }])).toHaveLength(2));
  it('keeps large quantities exact when filtering', () => expect(visiblePositions([{
    posted: '9007199254740993000000',
    reserved: '0'
  }])).toHaveLength(1));
  it('shows a user-facing claim rather than database identifiers', () => expect(claimLabel({
    token_id: '999',
    claims: [{
      polarity: 'YES',
      outcome: 'Team A'
    }]
  }, {
    yes: 'Yes',
    no: 'No'
  })).toBe('Yes Team A'));
  it('provides both languages for every added control', () => {
    expect(Object.keys(tradingLabels('km')).sort()).toEqual(Object.keys(tradingLabels('en')).sort());
    expect(tradingLabels('km').buy).not.toEqual(tradingLabels('en').buy);
  });
});

it('cannot use a client countdown to open a database-closed market', () => {
  const m={trading_status:'PAUSED',trading_starts_at:'2026-01-01T00:00:00Z',trading_ends_at:'2026-01-01T00:05:00Z'};
  expect(effectiveTradingStatus(m,Date.parse('2026-01-01T00:02:00Z'))).toBe('PAUSED');
  expect(effectiveTradingStatus(m,Date.parse(m.trading_ends_at))).toBe('CLOSED');
  expect(effectiveTradingStatus(m,Date.parse(m.trading_starts_at)-1)).toBe('NOT_STARTED');
});
