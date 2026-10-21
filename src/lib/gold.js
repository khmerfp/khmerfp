import { CATS } from './constants.js';

// 1 damlung = 37.5 grams; 1 troy oz = 31.1035 grams
const GRAMS_PER_DAMLUNG = 37.5;
const GRAMS_PER_OZ = 31.1035;

export function ozToDamlung(usdPerOz) {
  return (usdPerOz / GRAMS_PER_OZ) * GRAMS_PER_DAMLUNG;
}

// CME Globex hours in ET: open Sunday 18:00, close Friday 17:00.
// Returns whether the market is currently open, plus next open/close times.
export function goldMarketStatus(fromMs) {
  const now = new Date(fromMs || Date.now());
  // Convert to ET using Intl — handles DST automatically
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekday = get('weekday'); // Sun, Mon, ..., Sat
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const hhmm = hour * 60 + minute;

  const D = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = D[weekday];
  const OPEN_MIN = 18 * 60;   // 18:00
  const CLOSE_MIN = 17 * 60;  // 17:00

  let open = false;
  if (dow === 6) open = false;                             // Saturday: closed all day
  else if (dow === 0) open = hhmm >= OPEN_MIN;             // Sunday: opens 18:00
  else if (dow === 5) open = hhmm < CLOSE_MIN;             // Friday: closes 17:00
  else open = true;                                        // Mon-Thu: always open

  // Find next open and next close in ms (rough — good enough for countdown)
  const msPerMin = 60 * 1000;
  const nowMin = now.getMinutes();
  const secMs = now.getSeconds() * 1000;

  let nextOpenMs = null;
  let nextCloseMs = null;

  if (open) {
    // Next close is the upcoming Friday 17:00 ET
    const daysToFri = (5 - dow + 7) % 7;
    const closeOffsetMin = daysToFri * 24 * 60 + (CLOSE_MIN - hhmm);
    nextCloseMs = now.getTime() + closeOffsetMin * msPerMin - secMs;
  } else {
    // Next open is the upcoming Sunday 18:00 ET
    const daysToSun = (0 - dow + 7) % 7;
    const openOffsetMin = daysToSun * 24 * 60 + (OPEN_MIN - hhmm);
    nextOpenMs = now.getTime() + (openOffsetMin > 0 ? openOffsetMin : openOffsetMin + 7 * 24 * 60) * msPerMin - secMs;
  }

  return { open, nextOpenMs, nextCloseMs };
}

// Format a UTC ms timestamp as Cambodian time (UTC+7)
export function fmtPhnomPenh(ms) {
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: 'Asia/Phnom_Penh',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// The next "trading day" open (18:00 ET) and close (17:00 ET next day),
// used by daily markets. Returns { startAt, endAt } in ms UTC.
export function dailyRoundBounds(fromMs) {
  const nowMs = fromMs || Date.now();
  const now = new Date(nowMs);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekday = get('weekday');
  const hour = parseInt(get('hour'), 10);
  const hhmm = hour * 60 + parseInt(get('minute'), 10);

  const D = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = D[weekday];
  const OPEN_MIN = 18 * 60;
  const CLOSE_MIN = 17 * 60;

  // Find the most recent 18:00 ET boundary that has already passed
  let daysBackToOpen;
  if (dow === 0) daysBackToOpen = hhmm >= OPEN_MIN ? 0 : 2;   // Sun before 18:00 → last open was Fri
  else if (dow === 6) daysBackToOpen = 1;                      // Sat → last open was Fri
  else if (dow === 5) daysBackToOpen = hhmm >= OPEN_MIN ? 0 : 4; // Fri before 18:00 → Mon open; after → Fri open
  else daysBackToOpen = hhmm >= OPEN_MIN ? 0 : 1;             // Mon-Thu

  const startAt = nowMs - daysBackToOpen * 24 * 60 * 60 * 1000;
  const startParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date(startAt));
  const startHour = parseInt(startParts.find((p) => p.type === 'hour').value, 10);
  const startMin = parseInt(startParts.find((p) => p.type === 'minute').value, 10);
  const startAtClean = startAt - (startHour * 60 + startMin - OPEN_MIN) * 60 * 1000;

  // Close is 17:00 ET the next trading day (23h later)
  const endAt = startAtClean + 23 * 60 * 60 * 1000;

  return { startAt: startAtClean, endAt };
}

// Monthly round: last trading day of the month, 17:00 ET.
export function monthlyRoundBounds(fromMs) {
  const now = new Date(fromMs || Date.now());
  const year = now.getFullYear();
  const month = now.getMonth();
  const end = new Date(year, month + 1, 0, 17, 0, 0, 0);
  const start = new Date(year, month, 1, 18, 0, 0, 0);
  return { startAt: start.getTime(), endAt: end.getTime() };
}

// Annual (12mo) round: Dec 31 17:00 ET.
export function annualRoundBounds(fromMs) {
  const now = new Date(fromMs || Date.now());
  const year = now.getFullYear();
  const end = new Date(year + 1, 0, 0, 17, 0, 0, 0);
  const start = new Date(year, 0, 1, 18, 0, 0, 0);
  return { startAt: start.getTime(), endAt: end.getTime() };
}

// 5-year (60mo) round: end of current year + 5.
export function fiveYearRoundBounds(fromMs) {
  const now = new Date(fromMs || Date.now());
  const year = now.getFullYear();
  const end = new Date(year + 5, 11, 31, 17, 0, 0, 0);
  const start = new Date(year, 0, 1, 18, 0, 0, 0);
  return { startAt: start.getTime(), endAt: end.getTime() };
}