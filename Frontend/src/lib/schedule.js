export function scheduleBounds(schedule, fromMs) {
  const now = new Date(fromMs || Date.now());
  if (schedule === 'weekly-friday') {
    const end = new Date(now);
    const day = end.getDay();
    let daysUntilFri = (5 - day + 7) % 7;
    if (daysUntilFri === 0 && end.getHours() >= 18) daysUntilFri = 7;
    end.setDate(end.getDate() + daysUntilFri);
    end.setHours(18, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return { startAt: start.getTime(), endAt: end.getTime() };
  }
  if (schedule === 'monthly-end') {
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { startAt: start.getTime(), endAt: end.getTime() };
  }
  return { startAt: now.getTime(), endAt: now.getTime() + 86400000 };
}

export function findWinningOption(market, price) {
  for (const o of market.options) {
    const lo = o.lo ?? -Infinity;
    const hi = o.hi ?? Infinity;
    if (price >= lo && price < hi) return o.id;
  }
  return market.options[market.options.length - 1].id;
}