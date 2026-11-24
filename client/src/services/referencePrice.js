// This read model accepts only a server-normalized, verified reference series.
// The current backend emits UNAVAILABLE: no approved real-source adapter exists.
// No token prices, fills, is_final flags or raw mock observations enter this path.
import { exactDecimal } from './custodialTrading.js';

const integer = value => typeof value === 'string' && /^\d{1,78}$/.test(value);
export function referenceView(market, now) {
  const reference = market?.referencePrice;
  const empty = { status: 'UNAVAILABLE', latest: null, opening: null, change: null, percentage: null, history: [], reference };
  if (!reference || reference.marketId !== market.id || reference.roundKey !== market.round_key) return { ...empty, reference: null };
  if (market.market_type === 'CATEGORICAL' || reference.kind === 'EVENT') return { ...empty, status: 'EVENT' };
  const asOf = Date.parse(market.referenceAsOf), starts = Date.parse(market.trading_starts_at), ends = Date.parse(market.trading_ends_at);
  if (reference.verification !== 'VERIFIED' || reference.status !== 'AVAILABLE' ||
      !Number.isInteger(reference.decimals) || reference.decimals < 0 || reference.decimals > 18 ||
      !reference.sourceId || !reference.unit || !Number.isSafeInteger(reference.maxAgeMs) || reference.maxAgeMs <= 0 ||
      ![asOf, starts, ends, now].every(Number.isFinite) || now < asOf || asOf < starts || ends <= starts) return empty;
  const valid = observation => observation && integer(observation.value) && observation.id &&
    observation.verification === 'VERIFIED' && observation.purpose === 'REFERENCE' &&
    observation.marketId === market.id && observation.roundKey === market.round_key &&
    observation.sourceId === reference.sourceId && observation.unit === reference.unit && observation.decimals === reference.decimals &&
    Number.isFinite(Date.parse(observation.observedAt)) && Number.isFinite(Date.parse(observation.recordedAt)) &&
    Date.parse(observation.observedAt) >= starts && Date.parse(observation.observedAt) <= Math.min(asOf, ends) &&
    Date.parse(observation.recordedAt) >= Date.parse(observation.observedAt) && Date.parse(observation.recordedAt) <= asOf;
  const history = (Array.isArray(reference.history) ? reference.history : []).filter(valid).slice().sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  // Conflicting revisions require a reviewed source policy, never an arbitrary
  // frontend choice of which observation is the truth.
  const values = new Map();
  for (const item of history) {
    const previous = values.get(Date.parse(item.observedAt));
    if (previous !== undefined && previous !== item.value) return empty;
    values.set(Date.parse(item.observedAt), item.value);
  }
  const opening = valid(reference.opening) && Date.parse(reference.opening.observedAt) === starts ? reference.opening : null;
  if (opening && values.has(starts) && values.get(starts) !== opening.value) return empty;
  const latest = valid(reference.latest) ? reference.latest : null;
  if (!latest) return { ...empty, opening, history };
  if (history.some(item => Date.parse(item.observedAt) > Date.parse(latest.observedAt)) ||
      values.has(Date.parse(latest.observedAt)) && values.get(Date.parse(latest.observedAt)) !== latest.value) return empty;
  if (now - Date.parse(latest.observedAt) > reference.maxAgeMs || now - asOf > reference.maxAgeMs) return { ...empty, status: 'STALE', lastObservation: latest, opening, history };
  const change = opening ? BigInt(latest.value) - BigInt(opening.value) : null;
  const percentage = opening && BigInt(opening.value) !== 0n ? roundedPercentage(change, BigInt(opening.value)) : null;
  return { status: 'AVAILABLE', latest, opening, change, percentage, history, reference };
}

// Percentage rounded half away from zero to two decimals, using integer ratios.
function roundedPercentage(change, opening) {
  const numerator = change * 10000n, absolute = numerator < 0n ? -numerator : numerator;
  const rounded = (absolute + opening / 2n) / opening;
  return `${numerator < 0n ? '-' : ''}${exactDecimal(rounded.toString())}%`;
}

export const referenceNumber = (value, decimals) => exactDecimal(value, decimals);
export function referenceUnit(unit) {
  return { USD_PER_BTC: 'USD / BTC', USD_PER_METRIC_TON: 'USD / metric ton', KHR_PER_LITRE: 'KHR / litre' }[unit] || unit;
}

export function referencePoints(history, width = 320, height = 80) {
  if (!history.length) return [];
  const values = history.map(item => BigInt(item.value)), min = values.reduce((a, b) => a < b ? a : b), max = values.reduce((a, b) => a > b ? a : b);
  const first = Date.parse(history[0].observedAt), last = Date.parse(history.at(-1).observedAt);
  return history.map((item, i) => ({
    x: first === last ? width / 2 : 8 + (Date.parse(item.observedAt) - first) / (last - first) * (width - 16),
    // Conversion to Number is only for bounded SVG coordinates, never prices.
    y: min === max ? height / 2 : 8 + Number((max - values[i]) * 1000000n / (max - min)) / 1000000 * (height - 16),
  }));
}
