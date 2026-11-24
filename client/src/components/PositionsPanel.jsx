import { tradingLabels } from '../lib/tradingText.js';
import { visiblePositions, claimLabel } from '../services/marketView.js';
import { usd, shares } from '../services/custodialTrading.js';
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { CATS } from '../lib/constants.js';

export default function PositionsPanel({ onClose, onOpenMarket }) {
  const { lang, user, positions, markets, authoritative, trading } = useApp();
  const t = T[lang];
  const [tab,setTab]=useState('positions');
  if(authoritative)return <AuthoritativePositions lang={lang} trading={trading} tab={tab} setTab={setTab} onClose={onClose} onOpenMarket={onOpenMarket}/>;
  const list = user ? positions[user.email] || [] : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm h-full bg-white dark:bg-[#0F141B] border-l border-[#E4E7EC] dark:border-[#212832] overflow-y-auto slide-in p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display-en text-lg" style={{ fontWeight: 600 }}>{t.yourPositions}</h2>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-[#5B6472] dark:text-[#7C8697]">{t.noPositions}</p>
        ) : (
          <div className="space-y-2">
            {list.map((p, i) => {
              const m = markets.find((mm) => mm.id === p.marketId);
              if (!m) return null;
              const cat = CATS.find((c) => c.id === m.cat);
              const title = lang === 'km' ? m.titleKm : m.title;
              const optLabel = p.optionId && m.options ? (lang === 'km' ? m.options.find((o) => o.id === p.optionId)?.labelKm : m.options.find((o) => o.id === p.optionId)?.label) : null;
              return (
                <button key={i} onClick={() => { onClose(); onOpenMarket(p.marketId); }} className="w-full text-left bg-white dark:bg-[#12171F] border border-[#E4E7EC] dark:border-[#212832] rounded-lg p-3 hover:border-[#33C7A6]/40">
                  <div className="flex items-start gap-2 mb-1.5">
                    <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: `${cat?.color}22`, border: `1px solid ${cat?.color}55`, color: cat?.color }}>
                      <span className="text-[10px]">{cat?.icon?.slice(0, 1).toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs leading-snug">{title}</p>
                      {optLabel && <p className="text-[10px] uppercase tracking-widest text-[#6C8EF5] font-mono mt-0.5">{optLabel}</p>}
                    </div>
                  </div>
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className={p.side === 'yes' ? 'text-[#33C7A6]' : 'text-[#E15A4D]'}>{p.qty} {p.side === 'yes' ? t.yes : t.no} @ {p.price}¢</span>
                    <span className="text-[#5B6472] dark:text-[#7C8697]">${((p.price / 100) * p.qty).toFixed(2)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
function AuthoritativePositions({lang,trading,tab,setTab,onClose,onOpenMarket}) {
  const t={...T[lang],...tradingLabels(lang)},positions=visiblePositions(trading.portfolio?.positions),cash=trading.portfolio?.cash
  const open=marketId=>{onClose();onOpenMarket(marketId)}
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={e=>{if(e.target===e.currentTarget)onClose()}}><section role="dialog" aria-label={t.yourPositions} aria-modal="true" className="w-full max-w-sm h-full bg-white dark:bg-[#0F141B] border-l border-[#E4E7EC] dark:border-[#212832] overflow-y-auto slide-in p-4" onKeyDown={e=>{if(e.key==='Escape')onClose()}}>
    <div className="flex items-center justify-between mb-4"><h2 className="font-display-en text-lg" style={{fontWeight:600}}>{t.yourPositions}</h2><button onClick={onClose} aria-label={t.cancel}><X className="w-5 h-5"/></button></div>
    <div className="rounded-xl border border-[#E4E7EC] dark:border-[#212832] p-3 space-y-1 text-xs mb-4"><h3 className="font-semibold">{t.wallet}</h3>{[[t.total,cash?.posted],[t.available,cash?.available],[t.reserved,cash?.reserved]].map(([label,value])=><div key={label} className="flex justify-between"><span className="text-[#7C8697]">{label}</span><span className="font-mono">{value==null?t.unavailable:usd(value)}</span></div>)}</div>
    <div role="tablist" className="flex gap-1 mb-4">{[['positions',t.yourPositions],['orders',t.orderHistory],['trades',t.tradeHistory]].map(([key,label])=><button role="tab" aria-selected={tab===key} key={key} onClick={()=>setTab(key)} className={`flex-1 rounded-lg px-2 py-2 text-xs border ${tab===key?'border-[#33C7A6] text-[#33C7A6]':'border-[#E4E7EC] dark:border-[#212832] text-[#7C8697]'}`}>{label}</button>)}</div>
    <div role="tabpanel" className="space-y-2">
      {tab==='positions'&&(positions.length?positions.map(p=><button key={p.token_id} onClick={()=>open(p.market_id)} className="w-full text-left bg-white dark:bg-[#12171F] border border-[#E4E7EC] dark:border-[#212832] rounded-lg p-3 hover:border-[#33C7A6]/40"><p className="text-xs leading-snug mb-1">{p.title||t.unavailable}</p><p className="text-[10px] text-[#6C8EF5] mb-2">{claimLabel(p,t)}</p><div className="flex justify-between text-[11px] font-mono"><span>{t.available}: {shares(p.available)}</span><span>{t.reserved}: {shares(p.reserved)}</span></div><p className="text-[10px] text-[#7C8697] mt-1">{t.costBasis}: {t.unavailable}</p></button>):<p className="text-sm text-[#7C8697]">{t.noPositions}</p>)}
      {tab==='orders'&&<><button className="text-xs text-[#6C8EF5]" onClick={()=>{trading.setOpenOnly(!trading.openOnly);trading.setBefore(null)}}>{trading.openOnly?t.orderHistory:t.yourOpenOrders}</button>{trading.orders.length?trading.orders.map(order => <OrderHistoryCard key={order.id} order={order} trading={trading} labels={t} onOpen={open} />):<p className="text-sm text-[#7C8697]">{t.noOpenOrders}</p>}{trading.orders.length===25&&<button onClick={()=>trading.setBefore(trading.orders.at(-1).id)}>{t.more}</button>}{trading.before&&<button onClick={()=>trading.setBefore(null)}>{t.first}</button>}</>}
      {tab==='trades'&&(trading.trades.length?trading.trades.map(trade => <TradeHistoryCard key={trade.id} trade={trade} lang={lang} labels={t} onOpen={open} />):<p className="text-sm text-[#7C8697]">{t.unavailable}</p>)}
    </div>
  </section></div>
}

// Presentation only: all quantities, reservations and lifecycle states remain
// supplied by the existing authenticated trading workspace.
function OrderHistoryCard({ order, trading, labels: t, onOpen }) {
  const cancellation = trading.pendingCancels[`${trading.userId}:${order.id}`];
  const status = order.command_state === 'QUEUED' ? 'PROCESSING' : order.status;
  const cancellable = ['OPEN', 'PARTIAL', 'PENDING'].includes(order.status);
  const badge = status === 'FILLED'
    ? 'bg-[#33C7A6]/10 text-[#1E9F86] dark:text-[#4AD5B7]'
    : ['OPEN', 'PARTIAL', 'PENDING', 'PROCESSING'].includes(status)
      ? 'bg-[#6C8EF5]/10 text-[#5373D4] dark:text-[#9BAFFF]'
      : 'bg-[#7C8697]/10 text-[#697586] dark:text-[#9AA6B5]';
  const side = order.side === 'BUY' ? t.buy : t.sell;

  return <article data-order-id={order.id} className="rounded-xl border border-[#E4E7EC] bg-white p-3.5 dark:border-[#252E3A] dark:bg-[#12171F] space-y-3">
    <div className="flex items-start justify-between gap-3">
      <button onClick={() => onOpen(order.market_id)} className="min-w-0 text-left text-xs font-semibold leading-relaxed text-[#263140] dark:text-[#E1E6ED] hover:text-[#1E9F86] dark:hover:text-[#4AD5B7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#33C7A6] rounded-sm">{order.title || t.unavailable}</button>
      <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-medium ${badge}`}>{t[status] || t.unavailable}</span>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-[10px]">
      <span className={`rounded-md px-2 py-1 font-semibold ${order.side === 'BUY' ? 'bg-[#33C7A6]/10 text-[#1E9F86] dark:text-[#4AD5B7]' : 'bg-[#F04452]/10 text-[#D92D3E] dark:text-[#FF5263]'}`}>{side}</span>
      <span className="min-w-0 break-words text-[#697586] dark:text-[#9AA6B5]">{claimLabel(order, t)}</span>
    </div>
    <dl className="grid grid-cols-3 gap-2 rounded-lg bg-[#F4F6F8] p-2.5 dark:bg-[#0D1219]">
      {[[t.original, order.original_quantity], [t.filled, order.filled_quantity], [t.remaining, order.remaining_quantity]].map(([label, quantity]) => <div key={label} className="min-w-0">
        <dt className="text-[10px] leading-relaxed text-[#697586] dark:text-[#8A95A5]">{label}</dt>
        <dd className="mt-1 break-words font-mono text-xs font-medium tabular-nums text-[#465161] dark:text-[#D3DAE4]">{shares(quantity)}</dd>
      </div>)}
    </dl>
    <dl className="grid grid-cols-2 gap-3 text-[10px]">
      <div className="min-w-0"><dt className="text-[#697586] dark:text-[#8A95A5]">{t.price}</dt><dd className="mt-1 font-mono text-xs tabular-nums text-[#465161] dark:text-[#D3DAE4]">{order.limit_price_cents} {t.cents}</dd></div>
      <div className="min-w-0 text-right"><dt className="text-[#697586] dark:text-[#8A95A5]">{t.reserved}</dt><dd className="mt-1 break-words font-mono text-xs tabular-nums text-[#465161] dark:text-[#D3DAE4]">{order.side === 'BUY' ? usd(order.reserved ?? '0') : shares(order.reserved ?? '0')}</dd></div>
    </dl>
    {cancellable && <div className="flex justify-end border-t border-[#E4E7EC] pt-2.5 dark:border-[#252E3A]">
      <button disabled={trading.busyCancel !== null || cancellation === 'ACCEPTED'} onClick={() => trading.cancel(order.id)} className="min-h-9 rounded-lg border border-[#E15A4D]/20 px-3 py-1.5 text-[11px] font-medium text-[#C34D43] transition-colors hover:bg-[#E15A4D]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E15A4D] disabled:opacity-50 dark:text-[#F08B81]">{cancellation === 'PENDING' || cancellation === 'ACCEPTED' ? t.cancellationPending : cancellation === 'UNCERTAIN' ? t.retry : t.cancelOrder}</button>
    </div>}
  </article>;
}

function TradeHistoryCard({ trade, lang, labels: t, onOpen }) {
  const buying = trade.side === 'BUY';
  const locale = lang === 'km' ? 'km-KH' : 'en-US';
  const executedAt = new Date(trade.created_at);

  return <article data-trade-id={trade.id} className="rounded-xl border border-[#E4E7EC] bg-white p-3.5 dark:border-[#252E3A] dark:bg-[#12171F] space-y-3">
    <button onClick={() => onOpen(trade.market_id)} className="block w-full text-left text-xs font-semibold leading-relaxed text-[#263140] dark:text-[#E1E6ED] hover:text-[#1E9F86] dark:hover:text-[#4AD5B7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#33C7A6] rounded-sm">{trade.title || t.unavailable}</button>
    <div className="flex flex-wrap items-center gap-2 text-[10px]">
      <span className={`shrink-0 rounded-md px-2 py-1 font-semibold ${buying ? 'bg-[#33C7A6]/10 text-[#1E9F86] dark:text-[#4AD5B7]' : 'bg-[#F04452]/10 text-[#D92D3E] dark:text-[#FF5263]'}`}>{buying ? t.buy : t.sell}</span>
      <span className="min-w-0 break-words text-[#697586] dark:text-[#9AA6B5]">{claimLabel(trade, t)}</span>
    </div>
    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-[#F4F6F8] p-2.5 dark:bg-[#0D1219]">
      <div className="min-w-0"><dt className="text-[10px] text-[#697586] dark:text-[#8A95A5]">{t.quantityColumn}</dt><dd className="mt-1 break-words font-mono text-sm font-medium tabular-nums text-[#465161] dark:text-[#D3DAE4]">{shares(trade.quantity)}</dd></div>
      <div className="min-w-0 text-right"><dt className="text-[10px] text-[#697586] dark:text-[#8A95A5]">{t.executionPrice}</dt><dd className="mt-1 font-mono text-sm font-medium tabular-nums text-[#465161] dark:text-[#D3DAE4]">{trade.price_cents} <span className="text-[10px] font-normal text-[#697586] dark:text-[#8A95A5]">{t.cents}</span></dd></div>
    </dl>
    <time dateTime={trade.created_at} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[#E4E7EC] pt-2.5 text-[10px] tabular-nums text-[#697586] dark:border-[#252E3A] dark:text-[#8A95A5]">
      <span>{executedAt.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      <span className="font-mono">{executedAt.toLocaleTimeString(locale)}</span>
    </time>
  </article>;
}
