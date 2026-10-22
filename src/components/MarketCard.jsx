import React from 'react';
import { Clock } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { fmtUsd, fmtCountdown, fmtScheduleCountdown, fmtPrice } from '../lib/format.js';
import { CATS } from '../lib/constants.js';
import { ozToDamlung } from '../lib/gold.js';

export default function MarketCard({ m, onOpen }) {
  const { lang, btc, metals, goldStatus, schedules } = useApp();
  const t = T[lang];
  const isMetal = m.kind === 'metal';
  const isLive = m.live || (isMetal && (m.roundKind === '5m' || m.roundKind === '60m'));
  const isScheduled = !!m.schedule;
  const title = lang === 'km' ? m.titleKm : m.title;
  const isMulti = m.type === 'multi';
  const s = isScheduled ? schedules[m.id] : null;
  const cat = CATS.find((c) => c.id === m.cat);

  const btcRangeMs = Math.max(0, btc.round.endAt - Date.now());
  const metalEntry = isMetal ? metals[m.id] : null;
  const metalRemMs = metalEntry?.round?.endAt ? Math.max(0, metalEntry.round.endAt - Date.now()) : 0;

  // Header (right side)
  let headerRight = null;
  if (isMetal) {
    headerRight = (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#F7931A] font-semibold">
        {goldStatus.open ? fmtCountdown(metalRemMs) : 'Closed'}
      </span>
    );
  } else if (isLive) {
    headerRight = (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#F7931A] font-semibold">
        {fmtCountdown(btcRangeMs)}
      </span>
    );
  } else if (isScheduled && s) {
    headerRight = (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#F7931A] font-semibold">
        {fmtScheduleCountdown(s.currentRound.endAt - Date.now())}
      </span>
    );
  }

  // Yes probability
  let yes = m.yes ?? 50;
  if (isMetal && isLive && metalEntry) {
    const pct = metalEntry.priceOz / metalEntry.round.openPrice - 1;
    yes = Math.round(Math.min(99, Math.max(1, 50 + pct * 5000)));
  } else if (m.live) {
    yes = Math.round(Math.min(99, Math.max(1, 50 + (btc.price - (btc.round.openPrice || btc.price)) / 100)));
  }

  const bodyBlock = isMulti ? (
    <div className="space-y-1">
      {m.options.slice(0, 6).map((o) => (
        <div key={o.id} className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="w-full h-1 rounded-full bg-[#E4E7EC] dark:bg-[#212832] overflow-hidden">
              <div className="h-full bg-[#6C8EF5]" style={{ width: `${o.yes}%` }} />
            </div>
          </div>
          <span className="text-[10px] font-mono w-20 text-right truncate">{lang === 'km' ? o.labelKm : o.label}</span>
          <span className="text-[10px] text-[#6C8EF5] font-mono font-semibold w-7 text-right">{o.yes}¢</span>
        </div>
      ))}
    </div>
  ) : (
    <div>
      <div className="w-full h-1.5 rounded-full bg-[#E15A4D]/25 overflow-hidden">
        <div className="h-full bg-[#33C7A6]" style={{ width: `${yes}%` }} />
      </div>
      <div className="flex justify-between mt-1 text-[10px] font-mono">
        <span className="text-[#33C7A6]">{t.yes} {yes}¢</span>
        <span className="text-[#E15A4D]">{t.no} {100 - yes}¢</span>
      </div>
    </div>
  );

  // Footer
  let footer;
  if (isMetal) {
    const oz = metalEntry?.priceOz ?? m.basePriceUsdPerOz;
    const damlung = ozToDamlung(oz);
    footer = (
      <>
        <span className="font-mono">{fmtUsd(damlung)}/damlung</span>
        <span className="font-mono text-[#F7931A]">
          {goldStatus.open ? fmtCountdown(metalRemMs) : 'Closed'}
        </span>
      </>
    );
  } else if (isLive) {
    footer = (
      <>
        <span className="font-mono">{fmtUsd(btc.price)}</span>
        <span className="font-mono text-[#F7931A]">{fmtCountdown(btcRangeMs)}</span>
      </>
    );
  } else if (isScheduled && s) {
    footer = (
      <>
        <span className="font-mono">{fmtPrice(m)}</span>
        <span className="font-mono">{fmtScheduleCountdown(s.currentRound.endAt - Date.now())}</span>
      </>
    );
  } else {
    footer = (
      <>
        <span className="font-mono">{t.vol} {m.vol}</span>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {t.closes} {lang === 'km' ? m.closesKm : m.closes}
        </span>
      </>
    );
  }

  return (
    <button
      onClick={() => onOpen(m.id)}
      className="group text-left bg-white dark:bg-[#12171F] border border-[#E4E7EC] dark:border-[#212832] rounded-xl p-3 md:p-4 hover:border-[#6C8EF5]/40 transition-colors flex flex-col gap-2 md:gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.1em] font-medium text-[#5B6472] dark:text-[#7C8697] flex items-center gap-1 flex-wrap">
          {lang === 'km' ? cat?.labelKm : cat?.label}
          {isMulti && <span className="text-[#6C8EF5] font-semibold normal-case tracking-normal">· {t.multiOutcome}</span>}
          {isScheduled && <span className="text-[#F7931A] font-semibold normal-case tracking-normal">· {m.schedule === 'weekly-friday' ? t.cyclesWeekly : t.cyclesMonthly}</span>}
          {isLive && !isMetal && <span className="text-[#F7931A] font-semibold normal-case tracking-normal inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#F7931A] pulse-dot" />{t.live}</span>}
          {isMetal && isLive && <span className="text-[#F7931A] font-semibold normal-case tracking-normal inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#F7931A] pulse-dot" />{t.live}</span>}
        </span>
        {headerRight}
      </div>
      <div className="flex items-start gap-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${cat?.color}22`, border: `1px solid ${cat?.color}55`, color: cat?.color }}
        >
          {cat?.icon && <span className="text-xs">{cat.icon.slice(0, 1).toUpperCase()}</span>}
        </div>
        <h3 className="flex-1 font-display-en text-sm md:text-[15px] leading-snug" style={{ fontWeight: 500 }}>{title}</h3>
      </div>
      {bodyBlock}
      <div className="flex items-center justify-between pt-2 border-t border-[#E4E7EC] dark:border-[#212832] text-[10px] text-[#5B6472] dark:text-[#7C8697]">
        {footer}
      </div>
    </button>
  );
}