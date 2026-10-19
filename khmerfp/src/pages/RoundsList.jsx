import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { fmtDate, fmtRange, fmtRangeLabel, fmtUsd } from '../lib/format.js';

export default function RoundsList() {
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