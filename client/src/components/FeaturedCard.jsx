import React from 'react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { fmtScheduleCountdown } from '../lib/format.js';
import { CATS } from '../lib/constants.js';

export default function FeaturedCard({ m, onOpen }) {
  const { lang, schedules } = useApp();
  const t = T[lang];
  const isMulti = m.type === 'multi';
  const isScheduled = !!m.schedule;
  const isLive = m.live;
  const title = lang === 'km' ? m.titleKm : m.title;
  const s = isScheduled ? schedules[m.id] : null;
  const cat = CATS.find((c) => c.id === m.cat);
  const yes = m.yes ?? 50;

  let badge = '';
  if (isScheduled) badge = <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] font-semibold text-[#F7931A] mb-1"><span className="w-1.5 h-1.5 rounded-full bg-[#F7931A] pulse-dot" />{m.schedule === 'weekly-friday' ? t.cyclesWeekly : t.cyclesMonthly}</span>;
  else if (isMulti) badge = <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-[#6C8EF5] mb-1">{t.multiOutcome}</span>;
  else if (isLive) badge = <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] font-semibold text-[#F7931A] mb-1"><span className="w-1.5 h-1.5 rounded-full bg-[#F7931A] pulse-dot" />{t.live}</span>;

  return (
    <button
      onClick={() => onOpen(m.id)}
      className="market-card text-left rounded-2xl p-4 md:p-5 transition-all duration-200 flex flex-col gap-2 hover:-translate-y-0.5"
      style={{ '--card-accent': cat?.color || '#F2B84B' }}
    >
      <div className="flex items-start gap-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${cat?.color}22`, border: `1px solid ${cat?.color}55`, color: cat?.color }}
        >
          <span className="text-xs">{cat?.icon?.slice(0, 1).toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          {badge}
          <h3 className="font-display-en text-base leading-snug" style={{ fontWeight: 600 }}>{title}</h3>
        </div>
      </div>
      {isScheduled && s && (
        <div className="flex items-center justify-between mt-1 rounded-lg bg-[#F7931A]/8 border border-[#F7931A]/20 px-2.5 py-1.5">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{m.schedule === 'weekly-friday' ? t.thisWeek : t.thisMonth}</span>
          <span className="font-mono text-sm font-semibold text-[#F7931A]">{fmtScheduleCountdown(s.currentRound.endAt - Date.now())}</span>
        </div>
      )}
      {isMulti ? (
        <div className="grid grid-cols-2 gap-1">
          {m.options.slice(0, 4).map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-1 px-2 py-1 rounded-md bg-white/70 dark:bg-[#0A0E14] border border-[#DDE4EC] dark:border-[#212832]">
              <span className="text-[10px] font-mono truncate">{lang === 'km' ? o.labelKm : o.label}</span>
              <span className="text-[10px] text-[#6C8EF5] font-mono font-semibold">{o.yes}¢</span>
            </div>
          ))}
        </div>
      ) : (
        <div>
          <div className="w-full h-1.5 rounded-full bg-[#E15A4D]/25 overflow-hidden">
            <div className="h-full bg-[#33C7A6]" style={{ width: `${yes}%` }} />
          </div>
          <div className="flex justify-between mt-1 text-[10px] font-mono">
            <span className="text-[#33C7A6] font-medium">{t.yes} {yes}¢</span>
            <span className="text-[#E15A4D] font-medium">{t.no} {100 - yes}¢</span>
          </div>
        </div>
      )}
    </button>
  );
}
