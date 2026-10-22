// Social media / celebrity baby-gender markets.
// These are single-shot markets (no repeating rounds, no live price).
// Expiration is a window because due dates are approximate.
export const SOCIAL_MARKETS = [
  {
    id: 'baby-somawatee-vahed',
    cat: 'social',
    type: 'multi',
    vol: '$0',
    featured: true,
    // Due window — used by the card and the detail panel
    dueWindow: { startAt: '2026-12-15', endAt: '2027-01-15' },
    title: 'Sok Somawatee & Ly Vahed — Baby gender',
    titleKm: 'សុខ សុមាវតី និង លី វ៉ាហេដ — ភេទទារក',
    sub: 'Resolves to the announced gender of the baby of Sok Somawatee and Ly Vahed. Expected between mid-December 2026 and mid-January 2027. Resolution source: official public announcement from the couple or a verified news report. If the couple does not publicly announce, the market resolves to "Not announced".',
    subKm: 'សម្រេចទៅលើភេទទារករបស់ សុខ សុមាវតី និង លី វ៉ាហេដ ដែលបានប្រកាសជាផ្លូវការ។ រំពឹងថានឹងសម្រាលនៅចន្លោះពាក់កណ្តាលខែធ្នូ ២០២៦ ដល់ពាក់កណ្តាលខែមករា ២០២៧។',
    closes: 'Late Dec 2026 – mid Jan 2027',
    closesKm: 'ចុងធ្នូ ២០២៦ – ពាក់កណ្តាលមករា ២០២៧',
    options: [
      { id: 'baby1-boy',  label: 'Boy',           labelKm: 'ប្រុស',         yes: 51 },
      { id: 'baby1-girl', label: 'Girl',          labelKm: 'ស្រី',           yes: 46 },
      { id: 'baby1-none', label: 'Not announced', labelKm: 'មិនបានប្រកាស', yes: 3 },
    ],
  },
  {
    id: 'baby-sreyneang',
    cat: 'social',
    type: 'multi',
    vol: '$0',
    featured: true,
    dueWindow: { startAt: '2026-11-01', endAt: '2026-12-10' },
    title: 'Keo Sreyneang — Baby gender',
    titleKm: 'កែវ ស្រីនាង — ភេទទារក',
    sub: 'Resolves to the announced gender of Keo Sreyneang\u2019s baby. Expected between early November and mid-December 2026. Resolution source: official public announcement or a verified news report. If not announced, resolves to "Not announced".',
    subKm: 'សម្រេចទៅលើភេទទារករបស់ កែវ ស្រីនាង ដែលបានប្រកាសជាផ្លូវការ។ រំពឹងថានឹងសម្រាលនៅចន្លោះដើមខែវិច្ឆិកា ដល់ពាក់កណ្តាលខែធ្នូ ២០២៦។',
    closes: 'Nov – mid Dec 2026',
    closesKm: 'វិច្ឆិកា – ពាក់កណ្តាលធ្នូ ២០២៦',
    options: [
      { id: 'baby2-boy',  label: 'Boy',           labelKm: 'ប្រុស',         yes: 49 },
      { id: 'baby2-girl', label: 'Girl',          labelKm: 'ស្រី',           yes: 48 },
      { id: 'baby2-none', label: 'Not announced', labelKm: 'មិនបានប្រកាស', yes: 3 },
    ],
  },
];