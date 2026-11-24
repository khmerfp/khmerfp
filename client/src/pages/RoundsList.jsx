import { tradingRequest } from '../services/custodialTrading.js';
import { marketView } from '../services/marketView.js';
import { tradingLabels } from '../lib/tradingText.js';
import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search, CalendarDays, Clock3, ChevronRight } from 'lucide-react';
import { MarketIdentityIcon } from '../components/AuthoritativeCardData.jsx';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { fmtDate, fmtRange, fmtRangeLabel } from '../lib/format.js';

function LegacyRoundsList() {
  const { lang, markets, schedules, btc } = useApp();
  const t = T[lang];
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const items = useMemo(() => {
    const all = [];
    markets.filter((m) => m.schedule).forEach((m) => {
      const s = schedules[m.id];
      if (!s) return;
      s.history.forEach((r) => all.push({ market: m, round: r, marketId: m.id }));
    });
    btc.history.forEach((r) => {
      const m = markets.find((x) => x.id === 'btc5m');
      all.push({ market: m, round: r, marketId: 'btc5m' });
    });
    let filtered = all;
    if (filter === 'btc') filtered = all.filter((x) => x.marketId === 'btc5m');
    else if (filter === 'steel') filtered = all.filter((x) => x.marketId === 'steel-monthly');
    else if (filter === 'hdpe') filtered = all.filter((x) => x.marketId === 'hdpe-monthly');
    else if (filter === 'petrol') filtered = all.filter((x) => x.marketId === 'petrol-weekly');
    else if (filter === 'diesel') filtered = all.filter((x) => x.marketId === 'diesel-weekly');
    else if (filter === 'lpg') filtered = all.filter((x) => x.marketId === 'lpg-weekly');
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((x) => {
        const title = lang === 'km' ? x.market.titleKm : x.market.title;
        return title.toLowerCase().includes(q) || fmtDate(x.round.startAt).toLowerCase().includes(q);
      });
    }
    return filtered.sort((a, b) => b.round.startAt - a.round.startAt);
  }, [markets, schedules, btc, filter, search, lang]);

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'btc', label: 'Bitcoin' },
    { id: 'steel', label: 'Steel' },
    { id: 'hdpe', label: 'Plastics' },
    { id: 'petrol', label: 'Petrol' },
    { id: 'diesel', label: 'Diesel' },
    { id: 'lpg', label: 'LPG' },
  ];

  return (
    <div className="min-h-screen bg-[#F7F8FA] dark:bg-[#0A0E14] text-[#0A0E14] dark:text-[#ECEDEF]">
      <header className="border-b border-[#E4E7EC] dark:border-[#212832] sticky top-0 bg-[#F7F8FA]/95 dark:bg-[#0A0E14]/95 backdrop-blur z-30">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-1.5 text-sm text-[#5B6472] dark:text-[#7C8697]">
            <ArrowLeft className="w-4 h-4" /> {t.backToMarkets}
          </Link>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6">
        <h1 className="font-display-en text-2xl md:text-3xl mb-2" style={{ fontWeight: 600 }}>{t.viewAllRounds}</h1>
        <p className="text-sm text-[#5B6472] dark:text-[#7C8697] mb-4">Settled rounds from every repeating market.</p>

        <div className="bg-white dark:bg-[#12171F] border border-[#E4E7EC] dark:border-[#212832] rounded-xl p-3 mb-4 space-y-2">
          <div className="flex items-center gap-2 bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-lg px-3 py-2">
            <Search className="w-4 h-4 text-[#5B6472] dark:text-[#7C8697]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search market or date…" className="bg-transparent outline-none text-sm w-full" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filters.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)} className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${filter === f.id ? 'bg-[#33C7A6]/15 text-[#33C7A6]' : 'text-[#5B6472] dark:text-[#7C8697] border border-[#E4E7EC] dark:border-[#212832]'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-16 text-[#5B6472] dark:text-[#7C8697]">{t.noRoundsFound}</div>
        ) : (
          <div className="space-y-2">
            {items.map(({ market, round, marketId }) => {
              const title = lang === 'km' ? market.titleKm : market.title;
              const rangeLabel = market.schedule ? fmtRangeLabel(round.startAt, round.endAt, market.schedule) : fmtRange(round.startAt, round.endAt);
              let outcomeStr, outcomeColor;
              if (marketId === 'btc5m') {
                outcomeStr = round.outcome === 'yes' ? 'UP' : 'DOWN';
                outcomeColor = round.outcome === 'yes' ? '#33C7A6' : '#E15A4D';
              } else {
                const w = market.options.find((o) => o.id === round.outcome);
                outcomeStr = lang === 'km' ? (w?.labelKm || '—') : (w?.label || '—');
                outcomeColor = '#6C8EF5';
              }
              return (
                <Link key={`${marketId}-${round.startAt}`} to={`/round/${marketId}/${round.startAt}`} className="flex items-center gap-3 p-3 rounded-xl border border-[#E4E7EC] dark:border-[#212832] bg-white dark:bg-[#12171F] hover:border-[#6C8EF5]/40">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697] font-medium mb-0.5 truncate">{title}</p>
                    <p className="font-mono text-sm font-semibold">{rangeLabel}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm font-semibold" style={{ color: outcomeColor }}>{(market.currency || '$') + round.closePrice.toFixed(2)}</p>
                    <p className="text-[10px] font-mono truncate max-w-[140px]" style={{ color: outcomeColor }}>{outcomeStr}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
function AuthoritativeRoundsList() {
  const {lang,trading}=useApp(),t={...T[lang],...tradingLabels(lang)}
  const [search,setSearch]=useState(''),[filter,setFilter]=useState('all')
  const [markets,setMarkets]=useState([]);
  useEffect(()=>{let active=true;const controller=new AbortController();const refresh=async()=>{try{const response=await tradingRequest('/markets?limit=100',{signal:controller.signal});if(active)setMarkets(response.markets.map(marketView))}catch{/* Preserve the last confirmed public history on a transient failure. */}};void refresh();const timer=setInterval(refresh,10000);return()=>{active=false;controller.abort();clearInterval(timer)}},[]);
  const rows=markets.filter(m=>m.template_key&&(filter==='all'||m.market_type===filter)&&m.title.toLowerCase().includes(search.toLowerCase())).slice().sort((a,b)=>Date.parse(b.startsAt)-Date.parse(a.startsAt))
  return <div className="min-h-screen bg-[#F7F8FA] dark:bg-[#0A0E14] text-[#0A0E14] dark:text-[#ECEDEF]">
    <header className="border-b border-[#E4E7EC] dark:border-[#212832] sticky top-0 bg-[#F7F8FA]/95 dark:bg-[#0A0E14]/95 backdrop-blur z-30">
      <div className="max-w-4xl mx-auto px-4 py-3"><Link to="/" className="inline-flex items-center gap-2 text-xs text-[#5B6472] dark:text-[#9AA6B5] hover:text-[#1E9F86] dark:hover:text-[#4AD5B7]"><ArrowLeft className="w-4 h-4"/>{t.backToMarkets}</Link></div>
    </header>
    <main className="max-w-4xl mx-auto px-4 py-6 md:py-8">
      <h1 className="font-display-en text-2xl md:text-3xl mb-6" style={{fontWeight:600}}>{t.viewAllRounds}</h1>
      <div className="rounded-2xl border border-[#E4E7EC] bg-white p-3 md:p-4 mb-5 dark:border-[#252E3A] dark:bg-[#12171F] space-y-3">
        <div className="flex items-center gap-2.5 rounded-xl border border-[#E4E7EC] bg-[#F7F8FA] px-3 py-2.5 focus-within:border-[#33C7A6]/60 dark:border-[#252E3A] dark:bg-[#0D1219]">
          <Search className="h-4 w-4 shrink-0 text-[#7C8697]" aria-hidden="true"/>
          <input aria-label={t.browse} className="min-w-0 flex-1 bg-transparent outline-none text-sm placeholder:text-[#8A95A5]" value={search} onChange={e=>setSearch(e.target.value)} placeholder={t.browse}/>
        </div>
        <div className="flex flex-wrap gap-1.5">{['all','BINARY','CATEGORICAL','PRICE_RANGE'].map(value=><button type="button" key={value} aria-pressed={value===filter} onClick={()=>setFilter(value)} className={`min-h-9 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#33C7A6] ${value===filter?'bg-[#33C7A6]/10 text-[#1E9F86] dark:text-[#4AD5B7]':'text-[#697586] hover:bg-[#F4F6F8] dark:text-[#9AA6B5] dark:hover:bg-[#1A222D]'}`}>{value==='all'?t.browse:value==='BINARY'?t.yes+'/'+t.no:value==='CATEGORICAL'?t.multiOutcome:t.rangeMarket}</button>)}</div>
      </div>
      <div className="space-y-3">{rows.length?rows.map(m=><RoundHistoryCard key={m.id} market={m} lang={lang} labels={t}/>):<p className="rounded-xl border border-dashed border-[#DCE1E7] px-4 py-12 text-center text-sm text-[#7C8697] dark:border-[#252E3A]">{t.noRoundsFound}</p>}</div>
      {trading.markets.length===25&&<button onClick={()=>trading.setAfter(trading.markets.at(-1).id)}>{t.more}</button>}
    </main>
  </div>

}
function RoundHistoryCard({ market, lang, labels: t }) {
  const locale = lang === 'km' ? 'km-KH' : 'en-US';
  const opening = new Date(market.startsAt), cutoff = new Date(market.endsAt);
  const date = value => value.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = value => value.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const sameDay = opening.toDateString() === cutoff.toDateString();
  const statusColor = market.trading_status === 'OPEN'
    ? 'bg-[#33C7A6]/10 text-[#1E9F86] dark:text-[#4AD5B7]'
    : ['SCHEDULED', 'NOT_STARTED'].includes(market.trading_status)
      ? 'bg-[#6C8EF5]/10 text-[#5373D4] dark:text-[#9BAFFF]'
      : market.trading_status === 'PAUSED'
        ? 'bg-[#F2B84B]/10 text-[#986A15] dark:text-[#F2B84B]'
        : 'bg-[#7C8697]/10 text-[#697586] dark:text-[#9AA6B5]';

  return <Link data-round-id={market.id} to={`/round/${market.id}/${Date.parse(market.startsAt)}`} className="group block rounded-xl border border-[#E4E7EC] bg-white p-3.5 md:p-4 transition-colors hover:border-[#33C7A6]/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#33C7A6] dark:border-[#252E3A] dark:bg-[#12171F]">
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F4F6F8] text-[#697586] dark:bg-[#1B2430] dark:text-[#9AA6B5]"><MarketIdentityIcon market={market}/></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-relaxed text-[#263140] dark:text-[#E1E6ED]">{lang==='km'?market.titleKm:market.title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-[#697586] dark:text-[#8A95A5]">
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/>{date(opening)}</span>
          <span className="inline-flex flex-wrap items-center gap-1.5 font-mono tabular-nums"><Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/><time dateTime={market.startsAt}>{time(opening)}</time><span aria-hidden="true">{'\u2013'}</span><time dateTime={market.endsAt}>{!sameDay&&date(cutoff)+' '}{time(cutoff)}</time></span>
        </div>
      </div>
      <ChevronRight className="hidden h-4 w-4 shrink-0 mt-1 text-[#9AA6B5] group-hover:text-[#1E9F86] sm:block" aria-hidden="true"/>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#E4E7EC] pt-3 dark:border-[#252E3A]">
      <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium ${statusColor}`}><span className="h-1 w-1 rounded-full bg-current" aria-hidden="true"/>{t[market.trading_status]||t.unavailable}</span>
      <span className="text-[10px] text-[#7C8697]">{t[market.resolution_status]||t.awaiting}</span>
    </div>
  </Link>;
}

export default function RoundsList(){const {authoritative}=useApp();return authoritative?<AuthoritativeRoundsList/>:<LegacyRoundsList/>}
