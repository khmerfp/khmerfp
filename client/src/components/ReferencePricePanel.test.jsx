import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ReferencePricePanel from './ReferencePricePanel.jsx';
const state = vi.hoisted(() => ({ lang: 'en', trading: { clock: Date.parse('2026-11-21T10:02:01Z') } }));
vi.mock('../state/AppContext.jsx', () => ({ useApp: () => state }));
beforeEach(() => { state.lang = 'en'; });
const market = { id: 'market', round_key: 'round', referenceAsOf: '2026-11-21T10:02:01Z', trading_starts_at: '2026-11-21T10:00:00Z', trading_ends_at: '2026-11-21T11:00:00Z', referencePrice: { marketId: 'market', roundKey: 'round', kind: 'NUMERIC', status: 'UNAVAILABLE', verification: 'NOT_CONFIGURED', configuredSource: 'LOCAL_MOCK_HDPE', unit: 'USD_PER_METRIC_TON' } };
it('preserves LIVE PRICE while keeping mock observations and token prices unavailable as real reference data', () => {
  render(<ReferencePricePanel market={{ ...market, observations: [{ value: '999999', is_final: true }], trades: [{ price_cents: '53' }] }} />);
  expect(screen.getByRole('heading', { name: 'Live price' })).toBeVisible();
  expect(screen.getByText('Reference price unavailable.')).toBeVisible();
  expect(screen.getByText('USD / metric ton')).toBeVisible();
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByText(/999999|53 cents/)).toBeNull();
});
it('renders an isolated verified API fixture with exact comparison and only its supplied historical points', () => {
  const opening = { id: 'a', value: '100000', observedAt: market.trading_starts_at, recordedAt: market.trading_starts_at, marketId: market.id, roundKey: market.round_key, sourceId: 'fixture-only', unit: 'USD_PER_METRIC_TON', decimals: 2, verification: 'VERIFIED', purpose: 'REFERENCE' };
  const latest = { ...opening, id: 'b', value: '101000', observedAt: '2026-11-21T10:02:00Z', recordedAt: '2026-11-21T10:02:00Z' };
  render(<ReferencePricePanel market={{ ...market, referencePrice: { ...market.referencePrice, verification: 'VERIFIED', status: 'AVAILABLE', sourceId: 'fixture-only', decimals: 2, maxAgeMs: 60000, opening, latest, history: [opening, latest] } }} />);
  expect(screen.getByText('1010.00')).toBeVisible();
  expect(screen.getByText('1000.00')).toBeVisible();
  expect(screen.getByText('(1.00%)')).toBeVisible();
  expect(screen.getByRole('img')).toHaveAttribute('data-reference-observation-ids', 'a,b');
});
it('uses stored event information instead of inventing a numeric categorical reference', () => {
  render(<ReferencePricePanel market={{ ...market, referencePrice: { ...market.referencePrice, kind: 'EVENT', event: { question: 'Which team wins?', rules: 'Official final result.' } } }} />);
  expect(screen.getByRole('region', { name: 'Event information' })).toBeVisible();
  expect(screen.getByText('Which team wins?')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Live price' })).toBeNull();
});
it('provides Khmer unavailable and source labels', () => {
  state.lang = 'km';
  render(<ReferencePricePanel market={market} />);
  expect(screen.getByText('មិនមានតម្លៃយោងដែលបានផ្ទៀងផ្ទាត់ទេ។')).toBeVisible();
});
