import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { fmtUsd, fmtRange, fmtRangeLabel } from '../lib/format.js';

export default function RoundPage() {
  const { marketId, startAt } = useParams();
  const { lang, markets, schedules, btc } = useApp();
  const t = T[lang];
  const startAtNum = Number(startAt);

  let round = null;
  if (marketId === 'btc5m') round = btc.history.find((r) => r.startAt === startAtNum);
  else {
    const s = schedules[marketId];
    if (s) round = s.history.find((r) => r.startAt === startAtNum);
  }

  const market = markets.find((m) => m.id === marketId);

  if (!round || !market) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA] dark:bg-[#0A0E14] text-[#0A0E14] dark:text-[#ECEDEF]">
        <div className="text-center">
          <p className="mb-3">Round not found</p>
          <Link to="/rounds" className="text-[#6C8EF5]">{t.viewAllRounds}</Link>
        </div>
      </div>
    );
  }

  const isBtc = marketId === 'btc5m';
  const title = lang === 'km' ? market.titleKm : market.title;
  const rangeLabel = market.schedule ? fmtRangeLabel(round.startAt, round.endAt, market.schedule) : fmtRange(round.startAt, round.endAt);

  let body;
  if (isBtc) {
    const isUp = round.outcome === 'yes';
    const color = isUp ? '#33C7A6' : '#E15A4D';
    const changeAbs = Math.abs(round.closePrice - round.openPrice);
    const changePct = (changeAbs / round.openPrice) * 100;
    body = (
      <div className="pop-in rounded-2xl border border-[#E4E7EC] dark:border-[#212832] bg-gradient-to-br from-white to-[#F7F8FA] dark:from-[#141B24] dark:to-[#12171F] p-6 text-center space-y-3">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full" style={{ background: `${color}1a`, border: `3px solid ${color}66`, color }}>
          {isUp ? <ArrowUpRight className="w-10 h-10" /> : <ArrowDownRight className="w-10 h-10" />}
        </div>
        <p className="text-4xl tracking-widest font-display-en" style={{ color, fontWeight: 700 }}>{isUp ? t.up : t.down}</p>
        <p className="text-2xl font-mono">{fmtUsd(round.closePrice)}</p>
        <p className="text-sm font-mono" style={{ color }}>{isUp ? '+' : '−'}{fmtUsd(changeAbs).slice(1)} ({changePct.toFixed(3)}%)</p>
      </div>
    );
  } else {
    const w = market.options.find((o) => o.id === round.outcome);
    const wl = w ? (lang === 'km' ? w.labelKm : w.label) : '—';
    body = (
      <div className="pop-in rounded-2xl border border-[#E4E7EC] dark:border-[#212832] bg-gradient-to-br from-white to-[#F7F8FA] dark:from-[#141B24] dark:to-[#12171F] p-6 text-center space-y-3">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full" style={{ background: '#6C8EF51a', border: '3px solid #6C8EF566', color: '#6C8EF5' }}>
          <span className="text-3xl">✓</span>
        </div>
        <p className="text-[10px] uppercase tracking-[0.14em] text-[#5B6472] dark:text-[#7C8697]">Winning outcome</p>
        <p className="text-2xl font-display-en" style={{ color: '#6C8EF5', fontWeight: 700 }}>{wl}</p>
        <p className="text-xl font-mono">{(market.currency || '$') + round.closePrice.toFixed(2) + (market.unitSuffix || '')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F8FA] dark:bg-[#0A0E14] text-[#0A0E14] dark:text-[#ECEDEF]">
      <header className="border-b border-[#E4E7EC] dark:border-[#212832] sticky top-0 bg-[#F7F8FA]/95 dark:bg-[#0A0E14]/95 backdrop-blur z-30">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/rounds" className="flex items-center gap-1.5 text-sm text-[#5B6472] dark:text-[#7C8697]">
            <ArrowLeft className="w-4 h-4" /> {t.viewAllRounds}
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="text-center space-y-1">
          <p className="text-[10px] uppercase tracking-[0.14em] text-[#5B6472] dark:text-[#7C8697]">{t.roundSettled}</p>
          <h1 className="font-display-en text-2xl md:text-3xl" style={{ fontWeight: 600 }}>{rangeLabel}</h1>
          <p className="text-xs text-[#5B6472] dark:text-[#7C8697] font-mono">{title}</p>
        </div>
        {body}
        <div className="text-center pt-2">
          <Link to="/rounds" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#6C8EF5] text-white text-sm font-semibold">
            {t.viewAllRounds}
          </Link>
        </div>
      </main>
    </div>
  );
}