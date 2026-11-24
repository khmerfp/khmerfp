import React from 'react';
import { useApp } from '../state/AppContext.jsx';
import { tradingLabels } from '../lib/tradingText.js';
import { referenceView, referenceNumber, referenceUnit, referencePoints } from '../services/referencePrice.js';
import { MarketDisclosure } from './MarketTradingViews.jsx';

export default function ReferencePricePanel({ market }) {
  const { lang, trading } = useApp(), t = tradingLabels(lang);
  const view = referenceView(market, trading.clock), reference = view.reference;
  const observed = view.latest || view.lastObservation;
  const timestamp = value => new Date(value).toLocaleString(lang === 'km' ? 'km-KH' : 'en-US');
  if (view.status === 'EVENT') return <section aria-label={t.eventInformation} className="rounded-xl border border-[#E4E7EC] dark:border-[#212832] p-3.5 space-y-2">
    <h3 className="text-xs font-semibold">{t.eventInformation}</h3>
    <p className="text-xs text-[#7C8697] leading-relaxed">{reference.event?.question || market.title}</p>
    <MarketDisclosure title={t.resolutionRules}>
      <p className="text-xs leading-relaxed text-[#7C8697]">{reference.event?.rules || t.unavailable}</p>
      <p className="text-[11px] mt-2 text-[#7C8697]">{t.configuredSource}: {reference.event?.configuredSource || t.unavailable}</p>
    </MarketDisclosure>
    <p className="text-[10px] text-[#7C8697]">{t.referenceNotResolution}</p>
  </section>;
  const points = referencePoints(view.history);
  const path = points.map((point, i) => i ? `H${point.x}V${point.y}` : `M${point.x},${point.y}`).join(' ');
  return <section aria-label={t.liveReferencePrice} data-reference-market-id={market.id} data-reference-round-key={market.round_key} className="rounded-xl bg-[#F7F8FA] dark:bg-[#0D1219] border border-[#E4E7EC] dark:border-[#212832] p-3.5 space-y-3">
    <div className="flex items-center justify-between gap-3"><h3 className="text-[10px] uppercase tracking-[0.1em] text-[#7C8697]">{t.liveReferencePrice}</h3><span className="text-[10px] text-[#7C8697]">{referenceUnit(reference?.unit)}</span></div>
    <p className={view.latest ? 'text-xl font-mono font-semibold tabular-nums' : 'text-sm text-[#7C8697]'}>{view.latest ? referenceNumber(view.latest.value, reference.decimals) : t.referenceUnavailable}</p>
    {view.status === 'STALE' && <p className="text-xs text-[#F2B84B]">{t.staleReference}</p>}
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
      <dt className="text-[#7C8697]">{observed ? t.source : t.configuredSource}</dt><dd className="min-w-0 text-right break-words">{observed ? reference.sourceId : reference?.configuredSource || t.unavailable}</dd>
      <dt className="text-[#7C8697]">{t.observedAt}</dt><dd className="text-right">{observed ? <time dateTime={observed.observedAt}>{timestamp(observed.observedAt)}</time> : t.unavailable}</dd>
      <dt className="text-[#7C8697]">{t.roundOpeningPrice}</dt><dd className="font-mono text-right">{view.opening ? referenceNumber(view.opening.value, reference.decimals) : t.unavailable}</dd>
      <dt className="text-[#7C8697]">{t.changeSinceOpen}</dt><dd className="font-mono text-right">{view.change == null ? t.unavailable : `${view.change > 0n ? '+' : ''}${referenceNumber(view.change.toString(), reference.decimals)}`} {view.percentage && <span className="text-[#7C8697]">({view.percentage})</span>}</dd>
    </dl>
    {view.history.length > 0 && <MarketDisclosure title={t.referenceHistory}>
      <svg viewBox="0 0 320 80" role="img" aria-label={t.referenceHistory} data-reference-observation-ids={view.history.map(o => o.id).join(',')} className="w-full">
        {points.length > 1 && <path d={path} fill="none" stroke="#33C7A6" strokeWidth="1.5" />}
        {points.map((point, i) => <circle key={view.history[i].id} cx={point.x} cy={point.y} r="2" fill="#33C7A6"><title>{referenceNumber(view.history[i].value, reference.decimals)} {referenceUnit(reference.unit)} - {timestamp(view.history[i].observedAt)}</title></circle>)}
      </svg>
    </MarketDisclosure>}
    <p className="text-[10px] leading-relaxed text-[#7C8697]">{t.referenceNotResolution}</p>
  </section>;
}
