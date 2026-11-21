import API_BASE_URL, { apiRequest } from '../lib/api.js';
export const custodialEnabled = import.meta.env.DEV && import.meta.env.VITE_CUSTODIAL_TRADING_LOCAL === 'true';
export const simulationEnabled = import.meta.env.DEV && import.meta.env.VITE_SIMULATED_TRADING === 'true' && !custodialEnabled;
export function exactDecimal(value, decimals = 2) {
  if (value === null || value === undefined) return 'Unavailable';
  const n = BigInt(value),
    scale = 10n ** BigInt(decimals),
    sign = n < 0n ? '-' : '',
    abs = n < 0n ? -n : n;
  return `${sign}${abs / scale}.${String(abs % scale).padStart(decimals, '0')}`;
}
export const shares = value => value == null ? 'Unavailable' : `${BigInt(value) / 1000000n}`;
export function orderTerms({
  marketId,
  tokenId,
  side,
  quantity,
  priceCents,
  maxSpendCents,
  orderType
}) {
  if (!/^[1-9][0-9]*$/.test(quantity) || !/^[1-9][0-9]?$/.test(priceCents) || BigInt(priceCents) > 99n) throw new Error('Use whole shares and a price between 1 and 99 cents.');
  const result = {
    marketId,
    tokenId,
    side,
    quantity: (BigInt(quantity) * 1000000n).toString(),
    priceCents,
    orderType
  };
  if (orderType === 'MARKET' && side === 'BUY') {
    if (!/^[1-9][0-9]*$/.test(maxSpendCents)) throw new Error('Enter an explicit maximum spending amount in cents.');
    result.maxSpendCents = maxSpendCents;
  }
  return result;
}
export function tradingRequest(path, options = {}) {
  const timeout = AbortSignal.timeout(15000);
  return apiRequest(`/api/trading${path}`, { ...options, signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
}
export function subscribeTrading(privateStream, onRefresh, onStatus) {
  const stream = new EventSource(`${API_BASE_URL}/api/trading/${privateStream ? 'me/' : ''}events`, {
    withCredentials: true
  });
  stream.addEventListener('snapshot-required', () => {
    onStatus('Connected');
    onRefresh();
  });
  stream.addEventListener('session-expired', () => {
    onStatus('Session expired. Sign in again.');
    stream.close();
    onRefresh();
  });
  stream.onerror = () => {
    onStatus('Reconnecting - refreshing the latest snapshot');
    onRefresh();
  };
  return () => stream.close();
}

export const usd = value => value == null ? 'Unavailable' : `$${exactDecimal(value)}`;
