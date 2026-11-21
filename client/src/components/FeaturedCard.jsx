import { effectiveTradingStatus } from '../services/marketView.js';
import { AuthoritativePreview, AuthoritativeCountdown, MarketIdentityIcon } from './AuthoritativeCardData.jsx';
import { tradingLabels } from '../lib/tradingText.js';
import React from 'react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { fmtScheduleCountdown } from '../lib/format.js';
import { CATS } from '../lib/constants.js';
import { MarketCardFrame } from './MarketTradingViews.jsx';

export default function FeaturedCard({ m, onOpen }) {
  const { lang, schedules, trading } = useApp();
  const t = {...T[lang],...tradingLabels(lang)};
  const isMulti = m.type === 'multi';
  const isScheduled = !!m.schedule;
  const isLive = m.live;
  const title = lang === 'km' ? (m.titleKm||m.title) : m.title;
  const s = isScheduled ? schedules[m.id] : null;
  const cat = CATS.find((c) => c.id === m.cat) || {color:'#6C8EF5',icon:'',label:m.category_name||'',labelKm:m.category_name||''};
  const yes = m.authoritative?null:m.yes??50;

  const status = m.authoritative ? effectiveTradingStatus(m,trading.clock) : null;
  const liveLabel = status === 'OPEN' ? (m.live ? t.live : m.schedule ? (m.schedule === 'weekly-friday' ? t.cyclesWeekly : t.cyclesMonthly) : t.OPEN) : t[status];

  if (m.authoritative) return (
    <MarketCardFrame
      onClick={() => onOpen(m.id)}
      marketId={m.id}
      label={`${title} - ${new Date(m.endsAt).toLocaleString(lang === 'km' ? 'km-KH' : 'en-US')}`}
      featured
      accent={cat.color}
    >
      <div className="flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${cat.color}14`, border: `1px solid ${cat.color}35`, color: cat.color }}>
          <MarketIdentityIcon market={m} />
        </span>
        <span className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.12em] font-semibold text-[#F7931A]">
          <span className="w-1 h-1 rounded-full bg-current" />{liveLabel || t.unavailable}
        </span>
      </div>
      <h3 className="font-display-en text-[15px] leading-6 mt-1 lg:min-h-[72px]" style={{ fontWeight: 600 }}>{title}</h3>
      <AuthoritativeCountdown market={m} />
      <div className="pt-1 pb-2"><AuthoritativePreview market={m} /></div>
      <div className="mt-auto pt-3 border-t border-[#E4E7EC] dark:border-[#212832] space-y-2">
        <p className="text-[9px] leading-relaxed text-[#7C8697]">{t.lastTrade}</p>
        <div className="flex items-center justify-between text-[10px] text-[#7C8697]">
          <span>{t.vol}</span><span className="font-mono tabular-nums text-[#5B6472] dark:text-[#BAC3CF]">{m.vol ?? t.unavailable}</span>
        </div>
      </div>
    </MarketCardFrame>
  );

  let badge = '';
  if(m.authoritative)badge=<span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] font-semibold text-[#F7931A] mb-1"><span className="w-1.5 h-1.5 rounded-full bg-[#F7931A]"/>{liveLabel||t.unavailable}</span>;
  else if (isScheduled) badge = <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] font-semibold text-[#F7931A] mb-1"><span className="w-1.5 h-1.5 rounded-full bg-[#F7931A] pulse-dot" />{m.schedule === 'weekly-friday' ? t.cyclesWeekly : t.cyclesMonthly}</span>;
  else if (isMulti) badge = <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-[#6C8EF5] mb-1">{t.multiOutcome}</span>;
  else if (isLive) badge = <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] font-semibold text-[#F7931A] mb-1"><span className="w-1.5 h-1.5 rounded-full bg-[#F7931A] pulse-dot" />{t.live}</span>;

  return (
    <MarketCardFrame
      onClick={() => onOpen(m.id)}
      marketId={m.authoritative?m.id:undefined}
      label={m.authoritative?`${title} - ${new Date(m.endsAt).toLocaleString(lang==='km'?'km-KH':'en-US')}`:undefined}
      featured
      accent={cat?.color || '#F2B84B'}
    >
      <div className="flex items-start gap-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${cat?.color}22`, border: `1px solid ${cat?.color}55`, color: cat?.color }}
        >
          <span className="text-xs">{m.authoritative ? <MarketIdentityIcon market={m}/> : cat?.icon?.slice(0, 1).toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          {badge}
          <h3 className="font-display-en text-base leading-snug" style={{ fontWeight: 600 }}>{title}</h3>
        </div>
      </div>
      {m.authoritative && <AuthoritativeCountdown market={m}/>}
      {isScheduled && s && (
        <div className="flex items-center justify-between mt-1 rounded-lg bg-[#F7931A]/8 border border-[#F7931A]/20 px-2.5 py-1.5">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{m.schedule === 'weekly-friday' ? t.thisWeek : t.thisMonth}</span>
          <span className="font-mono text-sm font-semibold text-[#F7931A]">{fmtScheduleCountdown(s.currentRound.endAt - Date.now())}</span>
        </div>
      )}
      {m.authoritative ? <AuthoritativePreview market={m}/> : isMulti ? (
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
      {m.authoritative && <p className="text-[9px] text-[#7C8697]">{t.lastTrade}</p>}
      {m.authoritative && <div className="flex justify-between pt-2 border-t border-[#E4E7EC] dark:border-[#212832] text-[10px] text-[#7C8697]"><span>{t.vol}</span><span className="font-mono">{m.vol ?? t.unavailable}</span></div>}
    </MarketCardFrame>
  );
}
