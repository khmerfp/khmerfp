const UNIT = 1000000n;
const MAX = 9223372036854775807n;
const positive = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && BigInt(value) <= MAX;

// Indicative arithmetic only. The backend still authorizes, reserves and executes
// every order. Book, trade samples and this estimate share one database snapshot.
export function estimateBook({ snapshot, marketId, tokenId, userId = null, side, quantity, priceCents, maxSpendCents, now }) {
  if (!snapshot?.book || snapshot.marketId !== marketId || snapshot.tokenId !== String(tokenId) ||
      String(snapshot.book.market_id) !== marketId || String(snapshot.book.token_id) !== String(tokenId) ||
      snapshot.viewerUserId !== (userId == null ? null : String(userId)) || !snapshot.snapshotId) return null;
  if (!['BUY', 'SELL'].includes(side) || !positive(quantity) || !positive(priceCents) || BigInt(priceCents) > 99n) return null;
  const requested = BigInt(quantity), limit = BigInt(priceCents);
  if (requested % UNIT !== 0n) return null;
  const cap = side === 'BUY' ? maxSpendCents ?? (requested / UNIT * limit).toString() : null;
  if (side === 'BUY' && (!positive(cap) || BigInt(cap) > requested / UNIT * limit)) return null;
  const time = now ?? Date.parse(snapshot.serverTime);
  if (!Number.isFinite(time) || time - Date.parse(snapshot.serverTime) > 30000) return null;
  const market = snapshot.marketState;
  let remaining = requested, total = 0n, best = null, worst = null, reason;
  if (!market || market.trading_status !== 'OPEN' || market.lifecycle_status !== 'ACTIVE' ||
      market.resolution_status !== 'UNRESOLVED' || !market.terms_frozen_at ||
      time < Date.parse(market.trading_starts_at) || time >= Date.parse(market.trading_ends_at)) reason = 'MARKET_CLOSED';
  else for (const maker of snapshot.executionDepth?.[side] || []) {
    const price = BigInt(maker.price_cents);
    best ??= maker.price_cents;
    if (side === 'BUY' ? price > limit : price < limit) { reason = 'PRICE_PROTECTION'; break; }
    if (maker.own) { reason = 'SELF_TRADE_PREVENTION'; break; }
    let take = remaining < BigInt(maker.quantity) ? remaining : BigInt(maker.quantity);
    if (side === 'BUY') {
      const affordable = (BigInt(cap) - total) / price * UNIT;
      if (take > affordable) take = affordable;
    }
    if (take <= 0n) { reason = 'SPENDING_CAP'; break; }
    total += take / UNIT * price;
    remaining -= take;
    worst = maker.price_cents;
    if (remaining === 0n) break;
  }
  const filled = requested - remaining;
  return {
    marketId, tokenId: String(tokenId), snapshotId: snapshot.snapshotId,
    bookVersion: snapshot.book.command_sequence, generatedAt: snapshot.serverTime, indicative: true,
    requestedQuantity: requested.toString(), estimatedExecutableQuantity: filled.toString(),
    estimatedUnfilledQuantity: remaining.toString(), estimatedTotalCents: total.toString(),
    estimatedAverageExecutionPriceCents: filled ? { numerator: total.toString(), denominator: (filled / UNIT).toString() } : null,
    bestAvailablePriceCents: best, estimatedWorstExecutionPriceCents: worst,
    stoppedReason: remaining === 0n ? 'FILLED_ESTIMATE' : reason || 'INSUFFICIENT_LIQUIDITY',
  };
}
