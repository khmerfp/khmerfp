export const SEED_MARKETS = [
  { id:'btc5m', cat:'crypto', live:true, featured:true, type:'binary', yes:50, vol:'—',
    title:'Will Bitcoin be up in the next 5 minutes?',
    titleKm:'តើតម្លៃប៊ីតខញនឹងឡើងក្នុងរយៈពេល ៥ នាទីខាងមុខដែរឬទេ?',
    sub:'A new round starts automatically every 5 minutes.',
    subKm:'ជុំថ្មីចាប់ផ្តើមរៀងរាល់ ៥ នាទី។',
    closes:'—', closesKm:'—' },

  { id:'steel-monthly', cat:'econ', type:'multi', schedule:'monthly-end', featured:true, vol:'$0',
    basePrice:650, volatility:4, currency:'$', unitSuffix:'/ton',
    title:'What will the reference steel price be at the end of this month?',
    titleKm:'តើតម្លៃដែកថែបយោងនឹងមានប៉ុន្មាននៅចុងខែនេះ?',
    sub:'Resolves to the benchmark hot-rolled coil (HRC) price per metric ton at the close of business on the last calendar day of the month. A fresh round opens automatically on the 1st of each month.',
    subKm:'សម្រេចតាមតម្លៃដែក HRC យោងក្នុងមួយតោន នៅចុងបំផុតនៃថ្ងៃធ្វើការចុងក្រោយនៃខែ។',
    options: [
      { id:'st-1', label:'Below $600', labelKm:'ក្រោម $600', lo:0, hi:600, yes:8 },
      { id:'st-2', label:'$600–$629', labelKm:'$600–$629', lo:600, hi:630, yes:18 },
      { id:'st-3', label:'$630–$659', labelKm:'$630–$659', lo:630, hi:660, yes:32 },
      { id:'st-4', label:'$660–$689', labelKm:'$660–$689', lo:660, hi:690, yes:24 },
      { id:'st-5', label:'$690–$719', labelKm:'$690–$719', lo:690, hi:720, yes:12 },
      { id:'st-6', label:'$720 or above', labelKm:'$720 ឬខ្ពស់ជាង', lo:720, hi:Infinity, yes:6 }
    ] },

  { id:'hdpe-monthly', cat:'econ', type:'multi', schedule:'monthly-end', featured:true, vol:'$0',
    basePrice:1100, volatility:6, currency:'$', unitSuffix:'/ton',
    title:'What will the HDPE plastic price be at the end of this month?',
    titleKm:'តើតម្លៃប្លាស្ទិក HDPE នឹងមានប៉ុន្មាននៅចុងខែនេះ?',
    sub:'Resolves to the benchmark HDPE film-grade resin price per metric ton at the close of business on the last calendar day of the month.',
    subKm:'សម្រេចតាមតម្លៃជ័រ HDPE យោងក្នុងមួយតោន នៅចុងបំផុតនៃថ្ងៃធ្វើការចុងក្រោយនៃខែ។',
    options: [
      { id:'hp-1', label:'Below $1,000', labelKm:'ក្រោម $1,000', lo:0, hi:1000, yes:7 },
      { id:'hp-2', label:'$1,000–$1,049', labelKm:'$1,000–$1,049', lo:1000, hi:1050, yes:16 },
      { id:'hp-3', label:'$1,050–$1,099', labelKm:'$1,050–$1,099', lo:1050, hi:1100, yes:27 },
      { id:'hp-4', label:'$1,100–$1,149', labelKm:'$1,100–$1,149', lo:1100, hi:1150, yes:27 },
      { id:'hp-5', label:'$1,150–$1,199', labelKm:'$1,150–$1,199', lo:1150, hi:1200, yes:15 },
      { id:'hp-6', label:'$1,200 or above', labelKm:'$1,200 ឬខ្ពស់ជាង', lo:1200, hi:Infinity, yes:8 }
    ] },

  { id:'petrol-weekly', cat:'econ', type:'multi', schedule:'weekly-friday', featured:true, vol:'$0',
    basePrice:1.05, volatility:0.02, currency:'$', unitSuffix:'/L',
    title:'What will the regular 92-octane petrol price be at the end of this Friday?',
    titleKm:'តើតម្លៃសាំងធម្មតា ៩២ អុកតេន នឹងមានប៉ុន្មាននៅចុងថ្ងៃសុក្រនេះ?',
    sub:'Resolves to the retail pump price per litre of regular 92-octane petrol in Phnom Penh at the close of business on Friday.',
    subKm:'សម្រេចតាមតម្លៃលក់រាយក្នុងមួយលីត្រនៃសាំងធម្មតា ៩២ អុកតេននៅភ្នំពេញ នៅចុងបំផុតនៃថ្ងៃសុក្រ។',
    options: [
      { id:'p-1', label:'Below $0.95', labelKm:'ក្រោម $0.95', lo:0, hi:0.95, yes:5 },
      { id:'p-2', label:'$0.95–$0.99', labelKm:'$0.95–$0.99', lo:0.95, hi:1.00, yes:14 },
      { id:'p-3', label:'$1.00–$1.04', labelKm:'$1.00–$1.04', lo:1.00, hi:1.05, yes:28 },
      { id:'p-4', label:'$1.05–$1.09', labelKm:'$1.05–$1.09', lo:1.05, hi:1.10, yes:28 },
      { id:'p-5', label:'$1.10–$1.14', labelKm:'$1.10–$1.14', lo:1.10, hi:1.15, yes:16 },
      { id:'p-6', label:'$1.15 or above', labelKm:'$1.15 ឬខ្ពស់ជាង', lo:1.15, hi:Infinity, yes:9 }
    ] },

  { id:'diesel-weekly', cat:'econ', type:'multi', schedule:'weekly-friday', featured:true, vol:'$0',
    basePrice:1.00, volatility:0.02, currency:'$', unitSuffix:'/L',
    title:'What will the diesel price be at the end of this Friday?',
    titleKm:'តើតម្លៃម៉ាស៊ូតនឹងមានប៉ុន្មាននៅចុងថ្ងៃសុក្រនេះ?',
    sub:'Resolves to the retail pump price per litre of standard diesel in Phnom Penh at the close of business on Friday.',
    subKm:'សម្រេចតាមតម្លៃលក់រាយក្នុងមួយលីត្រនៃម៉ាស៊ូតស្តង់ដារនៅភ្នំពេញ នៅចុងបំផុតនៃថ្ងៃសុក្រ។',
    options: [
      { id:'d-1', label:'Below $0.90', labelKm:'ក្រោម $0.90', lo:0, hi:0.90, yes:6 },
      { id:'d-2', label:'$0.90–$0.94', labelKm:'$0.90–$0.94', lo:0.90, hi:0.95, yes:14 },
      { id:'d-3', label:'$0.95–$0.99', labelKm:'$0.95–$0.99', lo:0.95, hi:1.00, yes:28 },
      { id:'d-4', label:'$1.00–$1.04', labelKm:'$1.00–$1.04', lo:1.00, hi:1.05, yes:27 },
      { id:'d-5', label:'$1.05–$1.09', labelKm:'$1.05–$1.09', lo:1.05, hi:1.10, yes:16 },
      { id:'d-6', label:'$1.10 or above', labelKm:'$1.10 ឬខ្ពស់ជាង', lo:1.10, hi:Infinity, yes:9 }
    ] },

  { id:'lpg-weekly', cat:'econ', type:'multi', schedule:'weekly-friday', vol:'$0',
    basePrice:1.35, volatility:0.02, currency:'$', unitSuffix:'/kg',
    title:'What will the LPG (cooking gas) price be at the end of this Friday?',
    titleKm:'តើតម្លៃហ្គាស LPG នឹងមានប៉ុន្មាននៅចុងថ្ងៃសុក្រនេះ?',
    sub:'Resolves to the retail LPG cylinder price per kilogram in Phnom Penh at the close of business on Friday.',
    subKm:'សម្រេចតាមតម្លៃលក់រាយហ្គាស LPG ក្នុងមួយគីឡូក្រាមនៅភ្នំពេញ នៅចុងបំផុតនៃថ្ងៃសុក្រ។',
    options: [
      { id:'l-1', label:'Below $1.20', labelKm:'ក្រោម $1.20', lo:0, hi:1.20, yes:6 },
      { id:'l-2', label:'$1.20–$1.29', labelKm:'$1.20–$1.29', lo:1.20, hi:1.30, yes:15 },
      { id:'l-3', label:'$1.30–$1.39', labelKm:'$1.30–$1.39', lo:1.30, hi:1.40, yes:29 },
      { id:'l-4', label:'$1.40–$1.49', labelKm:'$1.40–$1.49', lo:1.40, hi:1.50, yes:27 },
      { id:'l-5', label:'$1.50–$1.59', labelKm:'$1.50–$1.59', lo:1.50, hi:1.60, yes:14 },
      { id:'l-6', label:'$1.60 or above', labelKm:'$1.60 ឬខ្ពស់ជាង', lo:1.60, hi:Infinity, yes:9 }
    ] },

  { id:'durian-peak-2027', cat:'econ', type:'multi', vol:'$0',
    closes:'May 31, 2027', closesKm:'៣១ ឧសភា ២០២៧',
    title:'What will Cambodian durian (Kampot) sell for at peak season 2027?',
    titleKm:'តើធូរេនកម្ពុជា (កំពត) នឹងលក់ក្នុងតម្លៃប៉ុន្មាននៅរដូវកំពូលឆ្នាំ២០២៧?',
    sub:'Resolves to the average farmgate price per kilogram of Grade-A Kampot durian during the peak of the harvest season (May 2027).',
    subKm:'សម្រេចតាមតម្លៃមធ្យមក្នុងមួយគីឡូក្រាមនៃធូរេនកំពតថ្នាក់ A ក្នុងរដូវកំពូល (ឧសភា ២០២៧)។',
    options: [
      { id:'d-3.50', label:'$3.50/kg or below', labelKm:'៣,៥០ ដុល្លារ/គ.ក ឬទាបជាង', yes: 6 },
      { id:'d-4.00', label:'$4.00/kg', labelKm:'៤,០០ ដុល្លារ/គ.ក', yes: 14 },
      { id:'d-4.50', label:'$4.50/kg', labelKm:'៤,៥០ ដុល្លារ/គ.ក', yes: 26 },
      { id:'d-5.00', label:'$5.00/kg', labelKm:'៥,០០ ដុល្លារ/គ.ក', yes: 24 },
      { id:'d-5.50', label:'$5.50/kg', labelKm:'៥,៥០ ដុល្លារ/គ.ក', yes: 18 },
      { id:'d-6.00', label:'$6.00/kg or above', labelKm:'៦,០០ ដុល្លារ/គ.ក ឬខ្ពស់ជាង', yes: 12 }
    ] },

  { id:'temp-pp-today', cat:'weather', type:'multi', vol:'$420K',
    closes:'Today 23:59', closesKm:'ថ្ងៃនេះ ២៣:៥៩',
    title:'What will be the high temperature in Phnom Penh today?',
    titleKm:'តើសីតុណ្ហភាពខ្ពស់បំផុតនៅភ្នំពេញថ្ងៃនេះនឹងមានប៉ុន្មាន?',
    sub:'Resolves to the highest temperature recorded at the Phnom Penh weather station by 23:59 local time.',
    subKm:'សម្រេចតាមសីតុណ្ហភាពខ្ពស់បំផុតដែលបានកត់ត្រានៅស្ថានីយ៍អាកាសធាតុភ្នំពេញ មុនមោង ២៣:៥៩។',
    options: [
      { id:'30', label:'30°C or below', labelKm:'៣០°C ឬទាបជាង', yes: 4 },
      { id:'31', label:'31°C', labelKm:'៣១°C', yes: 10 },
      { id:'32', label:'32°C', labelKm:'៣២°C', yes: 24 },
      { id:'33', label:'33°C', labelKm:'៣៣°C', yes: 30 },
      { id:'34', label:'34°C', labelKm:'៣៤°C', yes: 20 },
      { id:'35p', label:'35°C or above', labelKm:'៣៥°C ឬខ្ពស់ជាង', yes: 12 }
    ] },

  { id:'m9', cat:'sports', type:'binary', yes:24, vol:'$260K', closes:'Oct 15', closesKm:'១៥ តុលា',
    title:'Will Cambodia advance past the group stage of the 2026 ASEAN Championship?',
    titleKm:'តើកម្ពុជានឹងឆ្លងផុតដំណាក់កាលជុំគ្រុបដែរឬទេ?',
    sub:'Resolves YES if Cambodia reaches the semifinals.',
    subKm:'សម្រេចថា «បាទ/ចាស» ប្រសិនបើក្រុមជាតិកម្ពុជាឈានដល់ជុំពាក់កណ្តាលផ្ទាល់។' },

  { id:'cpl-champion-27', cat:'sports', type:'multi', vol:'$0',
    closes:'May 31, 2027', closesKm:'៣១ ឧសភា ២០២៧',
    title:'Which club will win the 2026–27 Cambodian Premier League?',
    titleKm:'ក្លឹបណានឹងឈ្នះពានរង្វាន់ Cambodian Premier League រដូវកាល ២០២៦–២៧?',
    sub:'Resolves to the club that finishes first in the CPL final standings.',
    subKm:'សម្រេចទៅលើក្លឹបដែលបញ្ចប់នៅលំដាប់ទី១ក្នុងតារាងចុងក្រោយនៃ CPL។',
    options: [
      { id:'cpl-ppc', label:'Phnom Penh Crown', labelKm:'ភ្នំពេញក្រោន', yes: 30 },
      { id:'cpl-vis', label:'Visakha FC', labelKm:'វិសាខា FC', yes: 22 },
      { id:'cpl-svr', label:'Svay Rieng FC', labelKm:'ស្វាយរៀង FC', yes: 18 },
      { id:'cpl-bkt', label:'Boeung Ket FC', labelKm:'បឹងកេត FC', yes: 12 },
      { id:'cpl-naga', label:'NagaWorld FC', labelKm:'នាគវើល FC', yes: 8 },
      { id:'cpl-other', label:'Any other club', labelKm:'ក្លឹបផ្សេងទៀត', yes: 10 }
    ] },

  { id:'kun-khmer-1', cat:'sports', type:'multi', vol:'$0',
    closes:'Dec 20, 2026', closesKm:'២០ ធ្នូ ២០២៦',
    title:'Kun Khmer 70kg — Thoeun Theara vs Chan Rothana',
    titleKm:'គុនខ្មែរ ៧០ គីឡូក្រាម — ធឿន ធារា ប្រកួត ចាន់ រតនា',
    sub:'Resolves to the official winner. A draw resolves the tie option.',
    subKm:'សម្រេចទៅលើអ្នកឈ្នះផ្លូវការ។ ការស្មើ សម្រេចជាជម្រើស «ស្មើ»។',
    options: [
      { id:'kk1-fav', label:'Thoeun Theara wins', labelKm:'ធឿន ធារា ឈ្នះ', yes: 64 },
      { id:'kk1-dog', label:'Chan Rothana wins', labelKm:'ចាន់ រតនា ឈ្នះ', yes: 28 },
      { id:'kk1-tie', label:'Draw / no decision', labelKm:'ស្មើ', yes: 8 }
    ] },

  { id:'bokator-60kg-27', cat:'sports', type:'multi', vol:'$0',
    closes:'Mar 31, 2027', closesKm:'៣១ មីនា ២០២៧',
    title:'Kun Bokator 60kg — Sok Rithy vs Vong Sothea',
    titleKm:'គុនបុកគាត់ ៦០ គីឡូក្រាម — សុខ រិទ្ធី ប្រកួត វង់ សុធា',
    sub:'Resolves to the official winner.',
    subKm:'សម្រេចទៅលើអ្នកឈ្នះផ្លូវការ។',
    options: [
      { id:'bk1-fav', label:'Sok Rithy wins', labelKm:'សុខ រិទ្ធី ឈ្នះ', yes: 60 },
      { id:'bk1-dog', label:'Vong Sothea wins', labelKm:'វង់ សុធា ឈ្នះ', yes: 32 },
      { id:'bk1-tie', label:'Draw / no decision', labelKm:'ស្មើ', yes: 8 }
    ] },

  { id:'om-touk-final-26', cat:'sports', type:'multi', vol:'$0',
    closes:'Nov 30, 2026', closesKm:'៣០ វិច្ឆិកា ២០២៦',
    title:'Which boat will win the men\u2019s open 500m final at the 2026 Om Touk Water Festival?',
    titleKm:'តើទូកណានឹងឈ្នះការប្រណាំង ៥០០ ម៉ែត្របុរសនៅពិធីបុណ្យអុំទូក ឆ្នាំ២០២៦?',
    sub:'Resolves to the named boat that wins the men\u2019s open 500m final.',
    subKm:'សម្រេចទៅលើទូកដែលមានឈ្មោះជាក់លាក់ ដែលឈ្នះការប្រណាំង ៥០០ ម៉ែត្របុរស។',
    options: [
      { id:'otb-chak', label:'Chaktomuk Naga', labelKm:'ចក្តូមុខនាគ', yes: 24 },
      { id:'otb-preah', label:'Preah Ko', labelKm:'ព្រះគោ', yes: 20 },
      { id:'otb-mekong', label:'Mekong Warrior', labelKm:'មេគង្គ', yes: 16 },
      { id:'otb-bassac', label:'Bassac Storm', labelKm:'បាសាក់', yes: 14 },
      { id:'otb-angkor', label:'Angkor Racer', labelKm:'អង្គរ', yes: 14 },
      { id:'otb-sokha', label:'Sokha Victory', labelKm:'សុខា', yes: 12 }
    ] },

  { id:'petanque-sok-vs-khieu', cat:'sports', type:'multi', vol:'$0',
    closes:'Dec 31, 2027', closesKm:'៣១ ធ្នូ ២០២៧',
    title:'Pétanque singles — Sok Chanmean vs Khieu Vanna',
    titleKm:'ប៉េតង់បុគ្គល — សុខ ចន្ទមាន ប្រកួត ខៀវ វណ្ណា',
    sub:'Resolves to the official winner.',
    subKm:'សម្រេចទៅលើអ្នកឈ្នះផ្លូវការ។',
    options: [
      { id:'ps1-sok', label:'Sok Chanmean wins', labelKm:'សុខ ចន្ទមាន ឈ្នះ', yes: 62 },
      { id:'ps1-khieu', label:'Khieu Vanna wins', labelKm:'ខៀវ វណ្ណា ឈ្នះ', yes: 34 },
      { id:'ps1-tie', label:'Match abandoned', labelKm:'បោះបង់', yes: 4 }
    ] },

  /* MPL KH */
  { id:'mplkh-imp-vs-tf', cat:'sports', type:'multi', vol:'$0',
    closes:'Nov 8, 2026', closesKm:'៨ វិច្ឆិកា ២០២៦',
    title:'MPL KH S8 — Impunity KH vs Team Flash KH',
    titleKm:'MPL KH រដូវកាលទី៨ — Impunity KH ប្រកួត Team Flash KH',
    sub:'Resolves to the official match winner in the MPL KH Season 8 regular season (best-of-3).',
    subKm:'សម្រេចទៅលើក្រុមដែលឈ្នះផ្លូវការនៃការប្រកួតក្នុងរដូវកាលទី៨ នៃ MPL KH (best-of-3)។',
    options: [
      { id:'mpl1-a', label:'Impunity KH wins', labelKm:'Impunity KH ឈ្នះ', yes: 58 },
      { id:'mpl1-b', label:'Team Flash KH wins', labelKm:'Team Flash KH ឈ្នះ', yes: 38 },
      { id:'mpl1-pp', label:'Match postponed / forfeited', labelKm:'ពន្យារ / បោះបង់', yes: 4 }
    ] },
  { id:'mplkh-rrq-vs-sys', cat:'sports', type:'multi', vol:'$0',
    closes:'Nov 9, 2026', closesKm:'៩ វិច្ឆិកា ២០២៦',
    title:'MPL KH S8 — RRQ Kaguya vs See You Soon',
    titleKm:'MPL KH រដូវកាលទី៨ — RRQ Kaguya ប្រកួត See You Soon',
    sub:'Resolves to the official match winner in the MPL KH Season 8 regular season (best-of-3).',
    subKm:'សម្រេចទៅលើក្រុមដែលឈ្នះផ្លូវការនៃការប្រកួតក្នុងរដូវកាលទី៨ នៃ MPL KH (best-of-3)។',
    options: [
      { id:'mpl2-a', label:'RRQ Kaguya wins', labelKm:'RRQ Kaguya ឈ្នះ', yes: 52 },
      { id:'mpl2-b', label:'See You Soon wins', labelKm:'See You Soon ឈ្នះ', yes: 44 },
      { id:'mpl2-pp', label:'Match postponed / forfeited', labelKm:'ពន្យារ / បោះបង់', yes: 4 }
    ] },
  { id:'mplkh-cfu-vs-nm', cat:'sports', type:'multi', vol:'$0',
    closes:'Nov 10, 2026', closesKm:'១០ វិច្ឆិកា ២០២៦',
    title:'MPL KH S8 — CFU Gaming vs Niightmare Esports',
    titleKm:'MPL KH រដូវកាលទី៨ — CFU Gaming ប្រកួត Niightmare Esports',
    sub:'Resolves to the official match winner in the MPL KH Season 8 regular season (best-of-3).',
    subKm:'សម្រេចទៅលើក្រុមដែលឈ្នះផ្លូវការនៃការប្រកួតក្នុងរដូវកាលទី៨ នៃ MPL KH (best-of-3)។',
    options: [
      { id:'mpl3-a', label:'CFU Gaming wins', labelKm:'CFU Gaming ឈ្នះ', yes: 46 },
      { id:'mpl3-b', label:'Niightmare Esports wins', labelKm:'Niightmare ឈ្នះ', yes: 50 },
      { id:'mpl3-pp', label:'Match postponed / forfeited', labelKm:'ពន្យារ / បោះបង់', yes: 4 }
    ] },
  { id:'mplkh-bxf-vs-imp', cat:'sports', type:'multi', vol:'$0',
    closes:'Nov 15, 2026', closesKm:'១៥ វិច្ឆិកា ២០២៦',
    title:'MPL KH S8 — Burn x Flash vs Impunity KH',
    titleKm:'MPL KH រដូវកាលទី៨ — Burn x Flash ប្រកួត Impunity KH',
    sub:'Resolves to the official match winner in the MPL KH Season 8 regular season (best-of-3).',
    subKm:'សម្រេចទៅលើក្រុមដែលឈ្នះផ្លូវការនៃការប្រកួតក្នុងរដូវកាលទី៨ នៃ MPL KH (best-of-3)។',
    options: [
      { id:'mpl4-a', label:'Burn x Flash wins', labelKm:'Burn x Flash ឈ្នះ', yes: 34 },
      { id:'mpl4-b', label:'Impunity KH wins', labelKm:'Impunity KH ឈ្នះ', yes: 62 },
      { id:'mpl4-pp', label:'Match postponed / forfeited', labelKm:'ពន្យារ / បោះបង់', yes: 4 }
    ] },
  { id:'mplkh-tf-vs-rrq', cat:'sports', type:'multi', vol:'$0',
    closes:'Nov 16, 2026', closesKm:'១៦ វិច្ឆិកា ២០២៦',
    title:'MPL KH S8 — Team Flash KH vs RRQ Kaguya',
    titleKm:'MPL KH រដូវកាលទី៨ — Team Flash KH ប្រកួត RRQ Kaguya',
    sub:'Resolves to the official match winner in the MPL KH Season 8 regular season (best-of-3).',
    subKm:'សម្រេចទៅលើក្រុមដែលឈ្នះផ្លូវការនៃការប្រកួតក្នុងរដូវកាលទី៨ នៃ MPL KH (best-of-3)។',
    options: [
      { id:'mpl5-a', label:'Team Flash KH wins', labelKm:'Team Flash KH ឈ្នះ', yes: 55 },
      { id:'mpl5-b', label:'RRQ Kaguya wins', labelKm:'RRQ Kaguya ឈ្នះ', yes: 41 },
      { id:'mpl5-pp', label:'Match postponed / forfeited', labelKm:'ពន្យារ / បោះបង់', yes: 4 }
    ] },
  { id:'mplkh-sys-vs-cfu', cat:'sports', type:'multi', vol:'$0',
    closes:'Nov 17, 2026', closesKm:'១៧ វិច្ឆិកា ២០២៦',
    title:'MPL KH S8 — See You Soon vs CFU Gaming',
    titleKm:'MPL KH រដូវកាលទី៨ — See You Soon ប្រកួត CFU Gaming',
    sub:'Resolves to the official match winner in the MPL KH Season 8 regular season (best-of-3).',
    subKm:'សម្រេចទៅលើក្រុមដែលឈ្នះផ្លូវការនៃការប្រកួតក្នុងរដូវកាលទី៨ នៃ MPL KH (best-of-3)។',
    options: [
      { id:'mpl6-a', label:'See You Soon wins', labelKm:'See You Soon ឈ្នះ', yes: 62 },
      { id:'mpl6-b', label:'CFU Gaming wins', labelKm:'CFU Gaming ឈ្នះ', yes: 34 },
      { id:'mpl6-pp', label:'Match postponed / forfeited', labelKm:'ពន្យារ / បោះបង់', yes: 4 }
    ] },
  { id:'mplkh-imp-vs-rrq', cat:'sports', type:'multi', vol:'$0',
    closes:'Nov 22, 2026', closesKm:'២២ វិច្ឆិកា ២០២៦',
    title:'MPL KH S8 — Impunity KH vs RRQ Kaguya',
    titleKm:'MPL KH រដូវកាលទី៨ — Impunity KH ប្រកួត RRQ Kaguya',
    sub:'Resolves to the official match winner in the MPL KH Season 8 regular season (best-of-3).',
    subKm:'សម្រេចទៅលើក្រុមដែលឈ្នះផ្លូវការនៃការប្រកួតក្នុងរដូវកាលទី៨ នៃ MPL KH (best-of-3)។',
    options: [
      { id:'mpl7-a', label:'Impunity KH wins', labelKm:'Impunity KH ឈ្នះ', yes: 54 },
      { id:'mpl7-b', label:'RRQ Kaguya wins', labelKm:'RRQ Kaguya ឈ្នះ', yes: 42 },
      { id:'mpl7-pp', label:'Match postponed / forfeited', labelKm:'ពន្យារ / បោះបង់', yes: 4 }
    ] },
  { id:'mplkh-tf-vs-bxf', cat:'sports', type:'multi', vol:'$0',
    closes:'Nov 23, 2026', closesKm:'២៣ វិច្ឆិកា ២០២៦',
    title:'MPL KH S8 — Team Flash KH vs Burn x Flash',
    titleKm:'MPL KH រដូវកាលទី៨ — Team Flash KH ប្រកួត Burn x Flash',
    sub:'Resolves to the official match winner in the MPL KH Season 8 regular season (best-of-3).',
    subKm:'សម្រេចទៅលើក្រុមដែលឈ្នះផ្លូវការនៃការប្រកួតក្នុងរដូវកាលទី៨ នៃ MPL KH (best-of-3)។',
    options: [
      { id:'mpl8-a', label:'Team Flash KH wins', labelKm:'Team Flash KH ឈ្នះ', yes: 66 },
      { id:'mpl8-b', label:'Burn x Flash wins', labelKm:'Burn x Flash ឈ្នះ', yes: 30 },
      { id:'mpl8-pp', label:'Match postponed / forfeited', labelKm:'ពន្យារ / បោះបង់', yes: 4 }
    ] },
  { id:'mplkh-nm-vs-sys', cat:'sports', type:'multi', vol:'$0',
    closes:'Nov 24, 2026', closesKm:'២៤ វិច្ឆិកា ២០២៦',
    title:'MPL KH S8 — Niightmare Esports vs See You Soon',
    titleKm:'MPL KH រដូវកាលទី៨ — Niightmare Esports ប្រកួត See You Soon',
    sub:'Resolves to the official match winner in the MPL KH Season 8 regular season (best-of-3).',
    subKm:'សម្រេចទៅលើក្រុមដែលឈ្នះផ្លូវការនៃការប្រកួតក្នុងរដូវកាលទី៨ នៃ MPL KH (best-of-3)។',
    options: [
      { id:'mpl9-a', label:'Niightmare Esports wins', labelKm:'Niightmare ឈ្នះ', yes: 48 },
      { id:'mpl9-b', label:'See You Soon wins', labelKm:'See You Soon ឈ្នះ', yes: 48 },
      { id:'mpl9-pp', label:'Match postponed / forfeited', labelKm:'ពន្យារ / បោះបង់', yes: 4 }
    ] },
  { id:'mplkh-season8-champion', cat:'sports', type:'multi', featured:true, vol:'$0',
    closes:'Dec 6, 2026', closesKm:'៦ ធ្នូ ២០២៦',
    title:'Which team will win MPL KH Season 8?',
    titleKm:'តើក្រុមណានឹងឈ្នះ MPL KH រដូវកាលទី៨?',
    sub:'Resolves to the team that wins the MPL KH Season 8 Grand Final (best-of-5).',
    subKm:'សម្រេចទៅលើក្រុមដែលឈ្នះការប្រកួតជើងឯក MPL KH រដូវកាលទី៨ (best-of-5)។',
    options: [
      { id:'ch-imp', label:'Impunity KH', labelKm:'Impunity KH', yes: 32 },
      { id:'ch-tf', label:'Team Flash KH', labelKm:'Team Flash KH', yes: 24 },
      { id:'ch-sys', label:'See You Soon', labelKm:'See You Soon', yes: 18 },
      { id:'ch-rrq', label:'RRQ Kaguya', labelKm:'RRQ Kaguya', yes: 12 },
      { id:'ch-cfu', label:'CFU Gaming', labelKm:'CFU Gaming', yes: 8 },
      { id:'ch-nm', label:'Niightmare Esports', labelKm:'Niightmare', yes: 4 },
      { id:'ch-bxf', label:'Burn x Flash', labelKm:'Burn x Flash', yes: 2 }
    ] },

  { id:'rice-peak-2026', cat:'econ', type:'multi', vol:'$0',
    closes:'Dec 15, 2026', closesKm:'១៥ ធ្នូ ២០២៦',
    title:'What will Cambodian fragrant rice paddy sell for at peak harvest 2026?',
    titleKm:'តើស្រូវក្រអូបកម្ពុជានឹងលក់ក្នុងតម្លៃប៉ុន្មាននៅរដូវចម្លងឆ្នាំ២០២៦?',
    sub:'Resolves per Ministry of Agriculture harvest price reports.',
    subKm:'សម្រេចតាមរបាយការណ៍តម្លៃរបស់ក្រសួងកសិកម្ម។',
    options: [
      { id:'r-0.30', label:'$0.30/kg or below', labelKm:'០,៣០ ដុល្លារ/គ.ក ឬទាបជាង', yes: 5 },
      { id:'r-0.35', label:'$0.35/kg', labelKm:'០,៣៥ ដុល្លារ/គ.ក', yes: 13 },
      { id:'r-0.40', label:'$0.40/kg', labelKm:'០,៤០ ដុល្លារ/គ.ក', yes: 28 },
      { id:'r-0.45', label:'$0.45/kg', labelKm:'០,៤៥ ដុល្លារ/គ.ក', yes: 25 },
      { id:'r-0.50', label:'$0.50/kg', labelKm:'០,៥០ ដុល្លារ/គ.ក', yes: 17 },
      { id:'r-0.55', label:'$0.55/kg or above', labelKm:'០,៥៥ ដុល្លារ/គ.ក ឬខ្ពស់ជាង', yes: 12 }
    ] },

  { id:'m11', cat:'econ', type:'binary', yes:68, vol:'$640K', closes:'Dec 31', closesKm:'៣១ ធ្នូ',
    title:'Will Cambodia\u2019s inflation rate average above 5% for 2026?',
    titleKm:'តើអត្រាអតិផរណាមធ្យមរបស់កម្ពុជានឹងលើសពី ៥% ដែរឬទេ?',
    sub:'Resolves per National Bank of Cambodia year-end inflation data.',
    subKm:'សម្រេចតាមទិន្នន័យរបស់ធនាគារជាតិកម្ពុជា។' }
];