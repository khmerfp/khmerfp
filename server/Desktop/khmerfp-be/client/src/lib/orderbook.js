import { TAKER_FEE_RATE } from './constants.js';

function rawFee(qty, priceCents, rate) {
  const P = priceCents / 100;
  return rate * qty * P * (1 - P);
}

function roundUpToCent(d) {
  return Math.ceil(d * 100 - 1e-7) / 100;
}

export function takerFeeForFills(fills) {
  const raw = fills.reduce((s, f) => s + rawFee(f.qty, f.price, TAKER_FEE_RATE), 0);
  return roundUpToCent(raw);
}

function genSideBook(mid) {
  const bids = [], asks = [];
  for (let i = 1; i <= 6; i++) {
    const qtyAt = () => Math.max(1, Math.round((45 / i) * (0.6 + Math.random() * 0.9)));
    if (mid - i >= 1) bids.push({ price: mid - i, qty: qtyAt(), isUser: false });
    if (mid + i <= 99) asks.push({ price: mid + i, qty: qtyAt(), isUser: false });
  }
  return {
    bids: bids.sort((a, b) => b.price - a.price),
    asks: asks.sort((a, b) => a.price - b.price),
  };
}

export function genMarketBook(yesPrice) {
  return { yes: genSideBook(yesPrice), no: genSideBook(100 - yesPrice) };
}

export function walkAsks(asks, qty) {
  let remaining = qty;
  const fills = [], newAsks = [];
  for (const lvl of asks) {
    if (remaining <= 0 || lvl.isUser) { newAsks.push(lvl); continue; }
    const take = Math.min(remaining, lvl.qty);
    fills.push({ price: lvl.price, qty: take });
    remaining -= take;
    const leftover = lvl.qty - take;
    if (leftover > 0) newAsks.push({ ...lvl, qty: leftover });
  }
  const filledQty = qty - remaining;
  const totalCents = fills.reduce((s, f) => s + f.price * f.qty, 0);
  const avgPrice = filledQty > 0 ? totalCents / filledQty : 0;
  return { fills, filledQty, remainingQty: remaining, avgPrice, newAsks };
}