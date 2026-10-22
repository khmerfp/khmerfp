import { walkAsks, takerFeeForFills } from './orderbook.js';

/**
 * Given a market, side, qty, optionId (null for binary), returns:
 *   { cost, fees, potentialWin, potentialLoss, avgPrice, filledQty }
 * - potentialWin = filledQty * 1.00 (each winning contract pays $1)
 * - potentialLoss = cost + fees (what you lose if the market resolves against you)
 */
export function computeTicket(sideBook, qty) {
  const { fills, filledQty, avgPrice } = walkAsks(sideBook.asks, qty);
  const cost = (avgPrice * filledQty) / 100;
  const fees = takerFeeForFills(fills);
  const potentialWin = filledQty * 1.0;      // $1 per winning contract
  const potentialLoss = cost + fees;
  return { cost, fees, potentialWin, potentialLoss, avgPrice, filledQty };
}