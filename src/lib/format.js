export function fmtUsd(n) {
  if (!Number.isFinite(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return mm + ':' + String(ss).padStart(2, '0');
}

export function fmtScheduleCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

export function fmtHHMM(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function fmtRange(a, b) {
  return fmtHHMM(a) + '–' + fmtHHMM(b);
}

export function fmtDate(ms) {
  const d = new Date(ms);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

export function fmtRangeLabel(startAt, endAt, schedule) {
  if (schedule === 'monthly-end') {
    const d = new Date(startAt);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getFullYear();
  }
  if (schedule === 'weekly-friday') {
    const d1 = new Date(startAt);
    const d2 = new Date(endAt);
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${mon[d1.getMonth()]} ${d1.getDate()} – ${mon[d2.getMonth()]} ${d2.getDate()}`;
  }
  return fmtRange(startAt, endAt);
}

export function fmtPrice(market) {
  if (!Number.isFinite(market.currentPrice)) return '—';
  const digits = market.priceDecimals ?? 2;
  const rounded = digits === 0 ? Math.round(market.currentPrice) : market.currentPrice;
  return (market.currency || '$')
    + rounded.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    + (market.unitSuffix || '');
}