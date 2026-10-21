// Gold + silver + platinum markets.
// priceUsdPerOz is a fallback; live price is polled from a public endpoint.
export const METAL_MARKETS = [
  {
    id: 'gold-5m', cat: 'crypto', type: 'binary', kind: 'metal', metal: 'gold',
    roundKind: '5m', roundMs: 5 * 60 * 1000, featured: true,
    basePriceUsdPerOz: 2650,
    title: 'Will gold be up in the next 5 minutes?',
    titleKm: 'តើតម្លៃមាសនឹងឡើងក្នុងរយៈពេល ៥ នាទីខាងមុខដែរឬទេ?',
    sub: 'Gold (XAU/USD spot) in damlung. A new round starts every 5 minutes during CME Globex hours (Sun 18:00 ET – Fri 17:00 ET).',
    subKm: 'មាស (XAU/USD) គិតជាដំឡឹង។ ជុំថ្មីចាប់ផ្តើមរៀងរាល់ ៥ នាទី ក្នុងម៉ោងពាណិជ្ជកម្ម CME ។',
    closes: '—', closesKm: '—',
  },
  {
    id: 'gold-60m', cat: 'crypto', type: 'binary', kind: 'metal', metal: 'gold',
    roundKind: '60m', roundMs: 60 * 60 * 1000,
    basePriceUsdPerOz: 2650,
    title: 'Will gold be up in the next 60 minutes?',
    titleKm: 'តើតម្លៃមាសនឹងឡើងក្នុងរយៈពេល ៦០ នាទីខាងមុខដែរឬទេ?',
    sub: 'Gold (XAU/USD spot) in damlung. A new round starts every hour during CME Globex hours.',
    subKm: 'មាស (XAU/USD) គិតជាដំឡឹង។ ជុំថ្មីចាប់ផ្តើមរៀងរាល់ម៉ោង ក្នុងម៉ោងពាណិជ្ជកម្ម CME ។',
    closes: '—', closesKm: '—',
  },
  {
    id: 'gold-daily', cat: 'crypto', type: 'binary', kind: 'metal', metal: 'gold',
    roundKind: 'daily',
    basePriceUsdPerOz: 2650,
    title: 'Will gold close higher at the end of today\u2019s trading day?',
    titleKm: 'តើតម្លៃមាសនឹងបិទខ្ពស់ជាងនៅចុងថ្ងៃពាណិជ្ជកម្មនេះដែរឬទេ?',
    sub: 'Resolves YES if the XAU/USD price at 17:00 ET (the CME Globex daily close) is above the opening price at 18:00 ET of the prior session. All times shown in Phnom Penh.',
    subKm: 'សម្រេចថា «បាទ/ចាស» ប្រសិនបើតម្លៃ XAU/USD នៅម៉ោង ១៧:០០ ម៉ោង ET ខ្ពស់ជាងតម្លៃបើកម៉ោង ១៨:០០ ET នៃសម័យមុន។ ពេលវេលាទាំងអស់បង្ហាញជាម៉ោងភ្នំពេញ។',
    closes: '17:00 ET', closesKm: '១៧:០០ ET',
  },
  {
    id: 'gold-monthly', cat: 'crypto', type: 'binary', kind: 'metal', metal: 'gold',
    roundKind: 'monthly',
    basePriceUsdPerOz: 2650,
    title: 'Will gold close higher at the end of this month\u2019s last trading day?',
    titleKm: 'តើតម្លៃមាសនឹងបិទខ្ពស់ជាងនៅចុងថ្ងៃពាណិជ្ជកម្មចុងក្រោយនៃខែនេះដែរឬទេ?',
    sub: 'Resolves YES if XAU/USD at 17:00 ET on the last trading day of the month is above the price at 18:00 ET on the first trading day of the month.',
    subKm: 'សម្រេចថា «បាទ/ចាស» ប្រសិនបើ XAU/USD នៅម៉ោង ១៧:០០ ET ថ្ងៃពាណិជ្ជកម្មចុងក្រោយនៃខែ ខ្ពស់ជាងតម្លៃបើកដំបូង។',
    closes: 'Last trading day', closesKm: 'ថ្ងៃពាណិជ្ជកម្មចុងក្រោយ',
  },
  {
    id: 'gold-12mo', cat: 'crypto', type: 'binary', kind: 'metal', metal: 'gold',
    roundKind: '12mo',
    basePriceUsdPerOz: 2650,
    title: 'Will gold be higher in 12 months?',
    titleKm: 'តើតម្លៃមាសនឹងខ្ពស់ជាងក្នុងរយៈពេល ១២ ខែទៀតដែរឬទេ?',
    sub: 'Resolves YES if XAU/USD at 17:00 ET on the last trading day of the current year is above the price at the start of the year.',
    subKm: 'សម្រេចថា «បាទ/ចាស» ប្រសិនបើ XAU/USD នៅចុងឆ្នាំ ខ្ពស់ជាងតម្លៃដើមឆ្នាំ។',
    closes: 'Dec 31', closesKm: '៣១ ធ្នូ',
  },
  {
    id: 'gold-60mo', cat: 'crypto', type: 'binary', kind: 'metal', metal: 'gold',
    roundKind: '60mo',
    basePriceUsdPerOz: 2650,
    title: 'Will gold be higher in 5 years?',
    titleKm: 'តើតម្លៃមាសនឹងខ្ពស់ជាងក្នុងរយៈពេល ៥ ឆ្នាំទៀតដែរឬទេ?',
    sub: 'Resolves YES if XAU/USD at the end of the 5th calendar year from now is above the current price.',
    subKm: 'សម្រេចថា «បាទ/ចាស» ប្រសិនបើ XAU/USD នៅចុងឆ្នាំទី៥ ខ្ពស់ជាងតម្លៃបច្ចុប្បន្ន។',
    closes: '5 years', closesKm: '៥ ឆ្នាំ',
  },
  {
    id: 'silver-daily', cat: 'crypto', type: 'binary', kind: 'metal', metal: 'silver',
    roundKind: 'daily',
    basePriceUsdPerOz: 31,
    title: 'Will silver close higher at the end of today\u2019s trading day?',
    titleKm: 'តើតម្លៃប្រាក់នឹងបិទខ្ពស់ជាងនៅចុងថ្ងៃពាណិជ្ជកម្មនេះដែរឬទេ?',
    sub: 'Resolves YES if XAG/USD at 17:00 ET is above the opening price at 18:00 ET of the prior session.',
    subKm: 'សម្រេចថា «បាទ/ចាស» ប្រសិនបើ XAG/USD នៅម៉ោង ១៧:០០ ET ខ្ពស់ជាងតម្លៃបើក។',
    closes: '17:00 ET', closesKm: '១៧:០០ ET',
  },
  {
    id: 'platinum-daily', cat: 'crypto', type: 'binary', kind: 'metal', metal: 'platinum',
    roundKind: 'daily',
    basePriceUsdPerOz: 950,
    title: 'Will platinum close higher at the end of today\u2019s trading day?',
    titleKm: 'តើតម្លៃផ្លាទីននឹងបិទខ្ពស់ជាងនៅចុងថ្ងៃពាណិជ្ជកម្មនេះដែរឬទេ?',
    sub: 'Resolves YES if XPT/USD at 17:00 ET is above the opening price at 18:00 ET of the prior session.',
    subKm: 'សម្រេចថា «បាទ/ចាស» ប្រសិនបើ XPT/USD នៅម៉ោង ១៧:០០ ET ខ្ពស់ជាងតម្លៃបើក។',
    closes: '17:00 ET', closesKm: '១៧:០០ ET',
  },
];

// Poll price in USD per troy oz from a free public endpoint.
// Falls back to basePriceUsdPerOz if fetch fails.
export async function fetchMetalPriceOz(metal, fallback) {
  const pair = { gold: 'XAU', silver: 'XAG', platinum: 'XPT' }[metal];
  try {
    // gold-api.com is free, no key, CORS-enabled
    const res = await fetch(`https://api.gold-api.com/price/${pair}`, { cache: 'no-store' });
    const data = await res.json();
    const price = parseFloat(data?.price);
    if (Number.isFinite(price) && price > 0) return price;
  } catch {}
  return fallback;
}