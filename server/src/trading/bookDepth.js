// Preserve price/FIFO priority up to the viewer's first own order. Return only
// aggregate public quantities and that viewer's self-trade barrier, never identities.
export function executionDepth(rows) {
  const result = { BUY: [], SELL: [] };
  for (const side of ['BUY', 'SELL']) {
    const levels = result[side];
    for (const row of rows.filter(row => row.side !== side)) {
      if (row.own) {
        levels.push({ price_cents: row.price_cents, quantity: '0', own: true });
        break;
      }
      const previous = levels.at(-1);
      if (previous?.price_cents === row.price_cents) previous.quantity = (BigInt(previous.quantity) + BigInt(row.quantity)).toString();
      else levels.push({ price_cents: row.price_cents, quantity: row.quantity });
    }
  }
  return result;
}
