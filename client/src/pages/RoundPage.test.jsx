import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import RoundPage from './RoundPage.jsx';
vi.mock('react-router-dom', async () => ({ ...await vi.importActual('react-router-dom'), useParams: () => ({ marketId: 'old-round' }) }));
vi.mock('../state/AppContext.jsx', () => ({ useApp: () => ({
  authoritative: true, lang: 'en', markets: [], dispatch: vi.fn(), user: null,
  trading: { market: { id: 'old-round', title: 'Historical Bitcoin round', market_type: 'BINARY', outcomes: [] } },
}) }));
vi.mock('../components/DetailPanel.jsx', () => ({ AuthoritativeMarketHeader: () => <div>Persisted round history</div>, AuthoritativeBook: () => null }));
vi.mock('../components/TradingTicket.jsx', () => ({ default: () => null }));
it('loads a persisted historical round without putting it back in the current homepage catalog', () => {
  render(<MemoryRouter><RoundPage /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Historical Bitcoin round' })).toBeVisible();
  expect(screen.getByText('Persisted round history')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Submit order' })).toBeNull();
});
