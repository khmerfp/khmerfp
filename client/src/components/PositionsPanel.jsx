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
      {tab==='orders'&&<><button className="text-xs text-[#6C8EF5]" onClick={()=>{trading.setOpenOnly(!trading.openOnly);trading.setBefore(null)}}>{trading.openOnly?t.orderHistory:t.yourOpenOrders}</button>{trading.orders.length?trading.orders.map(o=>{const state=trading.pendingCancels[`${trading.userId}:${o.id}`];return <article key={o.id} data-order-id={o.id} className="rounded-lg p-3 border border-[#E4E7EC] dark:border-[#212832] text-xs space-y-1"><button className="text-left font-medium" onClick={()=>open(o.market_id)}>{o.title||t.unavailable}</button><p className="text-[#6C8EF5]">{claimLabel(o,t)} - {o.side==='BUY'?t.buy:t.sell}</p><p>{t[o.command_state==='QUEUED'?'PROCESSING':o.status]||t.unavailable}</p><p className="text-[#7C8697]">{t.original}: {shares(o.original_quantity)} / {t.filled}: {shares(o.filled_quantity)} / {t.remaining}: {shares(o.remaining_quantity)}</p><p className="font-mono">{o.limit_price_cents} {t.cents} - {t.reserved}: {o.side==='BUY'?usd(o.reserved??'0'):shares(o.reserved??'0')}</p>{['OPEN','PARTIAL','PENDING'].includes(o.status)&&<button disabled={trading.busyCancel!==null||state==='ACCEPTED'} onClick={()=>trading.cancel(o.id)} className="text-[#E15A4D] disabled:opacity-50 py-1">{state==='PENDING'||state==='ACCEPTED'?t.cancellationPending:state==='UNCERTAIN'?t.retry:t.cancelOrder}</button>}</article>}):<p className="text-sm text-[#7C8697]">{t.noOpenOrders}</p>}{trading.orders.length===25&&<button onClick={()=>trading.setBefore(trading.orders.at(-1).id)}>{t.more}</button>}{trading.before&&<button onClick={()=>trading.setBefore(null)}>{t.first}</button>}</>}
      {tab==='trades'&&(trading.trades.length?trading.trades.map(row=><article key={row.id} className="rounded-lg border border-[#E4E7EC] dark:border-[#212832] p-3 space-y-1 text-xs"><button onClick={()=>open(row.market_id)}>{row.title||t.unavailable}</button><p className="text-[#6C8EF5]">{claimLabel(row,t)}</p><p>{row.side==='BUY'?t.buy:t.sell} {shares(row.quantity)} @ {row.price_cents} {t.cents}</p><time className="text-[#7C8697]">{new Date(row.created_at).toLocaleString(lang==='km'?'km-KH':'en-US')}</time></article>):<p className="text-sm text-[#7C8697]">{t.unavailable}</p>)}
    </div>
  </section></div>
}
