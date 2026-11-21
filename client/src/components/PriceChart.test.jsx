import React from 'react';
import { render, screen } from '@testing-library/react';
import { it, expect } from 'vitest';
import PriceChart from './PriceChart.jsx';
const fills = [
  { id: '10', price_cents: '50', created_at: '2026-01-01T00:00:00Z' },
  { id: '11', price_cents: '51', created_at: '2026-01-01T00:00:01Z' },
];
it('shows no invented trend when persisted fills are absent', () => {
  const { container } = render(<PriceChart tradeSamples={[]} emptyLabel="No fills" />);
  expect(screen.getByText('No fills')).toBeVisible(); expect(container.querySelector('svg')).toBeNull();
});
it('plots only persisted fill IDs and step changes on a fixed 0–100-cent scale', () => {
  const { container } = render(<PriceChart tradeSamples={fills} />);
  expect(container.querySelector('svg')).toHaveAttribute('data-trade-ids', '10,11');
  expect(container.querySelectorAll('circle')).toHaveLength(2);
  const dots = [...container.querySelectorAll('circle')];
  expect(Math.abs(Number(dots[0].getAttribute('cy')) - Number(dots[1].getAttribute('cy')))).toBeLessThan(1);
  expect(container.querySelector('path').getAttribute('d')).not.toContain('L');
  expect(container.querySelector('linearGradient')).toBeNull();
});
it('renders one actual fill as a point rather than inventing a second observation', () => {
  const { container } = render(<PriceChart tradeSamples={fills.slice(0, 1)} />);
  expect(container.querySelectorAll('circle')).toHaveLength(1); expect(container.querySelector('path')).toBeNull();
});
