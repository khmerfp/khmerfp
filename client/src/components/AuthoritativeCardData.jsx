import React from 'react';
import { Bitcoin, Factory, FlaskConical, Fuel, DollarSign, Clock, Trophy, CloudRain, Heart } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { tradingLabels } from '../lib/tradingText.js';
import { fmtCountdown, fmtScheduleCountdown } from '../lib/format.js';

export function MarketIdentityIcon({ market }) {
  const Icon = { btc5m: Bitcoin, 'steel-monthly': Factory, 'hdpe-monthly': FlaskConical, 'petrol-weekly': Fuel }[market.presentationKey] || { crypto: Bitcoin, econ: DollarSign, sports: Trophy, weather: CloudRain, social: Heart }[market.cat] || DollarSign;
  return <Icon aria-hidden="true" className="w-4 h-4" />;
}

export function AuthoritativeCountdown({ market }) {
  const { lang, trading } = useApp();
  const t = { ...T[lang], ...tradingLabels(lang) };
  const remaining = Math.max(0, Date.parse(market.endsAt) - trading.clock);
  const scheduled = trading.clock < Date.parse(market.startsAt);
  const label = scheduled ? t.NOT_STARTED : remaining === 0 ? t.CLOSED : t[market.trading_status];
  return <div className="flex items-center justify-between gap-2 rounded-lg bg-[#F4F6F8] dark:bg-[#0D1219] border border-[#E4E7EC] dark:border-[#212832] px-2.5 py-2">
    <span className="text-[9px] uppercase tracking-[0.08em] text-[#7C8697]">{market.schedule ? (market.schedule === 'weekly-friday' ? t.thisWeek : t.thisMonth) : label}</span>
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-[#F2B84B]" data-countdown><Clock className="w-3 h-3 opacity-70" />{scheduled ? t.NOT_STARTED : remaining ? (market.live ? fmtCountdown(remaining) : fmtScheduleCountdown(remaining)) : t.CLOSED}</span>
  </div>;
}

// Only executed backend prices are shown. NO is never fabricated as 100 - YES.
export function AuthoritativePreview({ market }) {
  const { lang } = useApp();
  const t = { ...T[lang], ...tradingLabels(lang) };
  if (market.type === 'multi') return <div className="grid grid-cols-2 gap-1.5">{market.options.slice(0, 6).map(option => <div key={option.id} className="flex items-center justify-between gap-1.5 min-h-[38px] px-2 py-1.5 rounded-lg bg-[#F7F8FA] dark:bg-[#0D1219] border border-[#E4E7EC] dark:border-[#212832]">
    <span className="text-[10px] leading-snug min-w-0 text-[#5B6472] dark:text-[#C1C9D4]" title={lang === 'km' ? option.labelKm : option.label}>{lang === 'km' ? option.labelKm : option.label}</span><span className="text-[10px] text-[#6C8EF5] font-mono tabular-nums font-semibold shrink-0">{option.yes == null ? '—' : option.yes + '¢'}</span>
  </div>)}</div>;
  return <div className="grid grid-cols-2 gap-2">{[[t.yes, market.yes, '#33C7A6'], [t.no, market.no, '#E15A4D']].map(([label, price, color]) => <div key={label} className="rounded-lg border p-3" style={{ borderColor: color + '35', backgroundColor: color + '08' }}>
    <span className="text-[10px] font-semibold" style={{ color }}>{label}</span>
    <p className="font-mono text-lg font-semibold tabular-nums mt-1" style={{ color }}>{price == null ? '—' : price + '¢'}</p>
    <div className="h-1 rounded-full bg-[#E4E7EC] dark:bg-[#212832] overflow-hidden mt-3" aria-label={label + ' ' + (price == null ? t.unavailable : price + ' ' + t.cents)}><div className="h-full rounded-full" style={{ width: price == null ? '0%' : Number(price) + '%', backgroundColor: color }} /></div>
  </div>)}</div>;
}
