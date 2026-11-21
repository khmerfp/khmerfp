import { SEED_MARKETS } from '../data/markets.js';
import { usd } from './custodialTrading.js';
// Adapt public registry fields to the existing presentation model; never invent quotes.
export function marketView(raw) {
  const outcomes = raw.outcomes || [...new Map((raw.claims || []).map(c => [c.outcome_id, {
    id: c.outcome_id,
    label: c.outcome_label,
    index: c.outcome_index,
    yesPriceCents: raw.claims.find(x => x.outcome_id === c.outcome_id && x.polarity === 'YES')?.last_price_cents ?? null,
    noPriceCents: raw.claims.find(x => x.outcome_id === c.outcome_id && x.polarity === 'NO')?.last_price_cents ?? null
  }])).values()];
  // Original copy/translations are presentation metadata, never a source of prices or balances.
  const original = SEED_MARKETS.find(m => raw.template_key === 'khmerfp-' + m.id && raw.title === m.title);
  const categories = {
    economy: 'econ',
    economic: 'econ',
    crypto: 'crypto',
    sports: 'sports',
    weather: 'weather',
    social: 'social'
  };
  return {
    ...raw,
    raw,
    authoritative: true,
    type: raw.market_type === 'BINARY' ? 'binary' : 'multi',
    titleKm: original?.titleKm || raw.title,
    sub: raw.description,
    subKm: original?.subKm || raw.description,
    cat: categories[raw.category_slug] || raw.category_slug || 'unclassified',
    featured: true,
    presentationKey: original?.id,
    presentationOrder: original ? SEED_MARKETS.indexOf(original) : 1000,
    live: original?.live || false,
    schedule: original?.schedule || null,
    yes: outcomes[0]?.yesPriceCents ?? null,
    no: outcomes[0]?.noPriceCents ?? null,
    vol: raw.volume_cents == null ? null : usd(raw.volume_cents),
    series: [],
    options: outcomes.map(o => ({
      id: String(o.id),
      label: o.label,
      labelKm: original?.options?.find(option => option.label === o.label)?.labelKm || o.label,
      yes: o.yesPriceCents ?? null,
      no: o.noPriceCents ?? null
    })),
    startsAt: raw.trading_starts_at,
    endsAt: raw.trading_ends_at
  };
}
export function visiblePositions(positions = []) {
  return positions.filter(p => BigInt(p.posted) !== 0n || BigInt(p.reserved) !== 0n);
}
// Time-based eligibility may close before the scheduler's next status delivery.
// It cannot open a market that the database has not opened.
export function effectiveTradingStatus(market, serverTime) {
  if (serverTime >= Date.parse(market.endsAt || market.trading_ends_at)) return 'CLOSED';
  if (serverTime < Date.parse(market.startsAt || market.trading_starts_at)) return 'NOT_STARTED';
  return market.trading_status;
}
export function claimLabel(record, labels) {
  const claim = record.claims?.find(c => c.polarity === 'YES') || record.claims?.[0];
  if (!claim) return labels.unavailable;
  return `${claim.polarity === 'YES' ? labels.yes : labels.no} ${claim.outcome}`;
}
