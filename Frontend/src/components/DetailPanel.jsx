import React, { useState, useEffect } from 'react';
import { X, ArrowUpRight, ArrowDownRight, Clock } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { fmtUsd, fmtCountdown, fmtScheduleCountdown, fmtPrice, fmtDate, fmtRange, fmtRangeLabel } from '../lib/format.js';
import { CATS, RESULTS_DISPLAY_MS } from '../lib/constants.js';
import { walkAsks, takerFeeForFills } from '../lib/orderbook.js';

export default function DetailPanel({ marketId, onClose }) {
  const { lang, markets, books, btc, schedules, user, positions, selectedSide, orderType, selectedOptionId, dispatch, showToast, balances } = useApp();
  const t = T[lang];
  const m = markets.find((x) => x.id === marketId);

  const [qty, setQty] = useState(10);

  useEffect(() => {
    dispatch({ type: 'SET_SIDE', side: 'yes' });
    dispatch({ type: 'SET_ORDER_TYPE', orderType: 'market' });
  }, [marketId, dispatch]);

  if (!m) return null;

  // BTC results view
  if (m.id === 'btc5m' && btc.showResults && btc.lastResult) {
    return <BtcResultPanel onClose={onClose} />;
  }

  const isLive = m.live;
  const isScheduled = !!m.schedule;
  const isMulti = m.type === 'multi';
  const title = lang === 'km' ? m.titleKm : m.title;
  const sub = lang === 'km' ? m.subKm : m.sub;
  const cat = CATS.find((c) => c.id === m.cat);
  const s = isScheduled ? schedules[m.id] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end bg-black/50 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="w-full md:max-w-md max-h-[92vh] md:max-h-full md:h-full detail-sheet md:rounded-none bg-white dark:bg-[#0F141B] border-t md:border-l md:border-t-0 border-[#E4E7EC] dark:border-[#212832] overflow-y-auto slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-[#E4E7EC] dark:border-[#212832] flex items-center justify-between sticky top-0 bg-white/95 dark:bg-[#0F141B]/95 backdrop-blur z-10">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[#5B6472] dark:text-[#7C8697]">
            {lang === 'km' ? cat?.labelKm : cat?.label}{isMulti ? ` · ${t.multiOutcome}` : ''}
          </span>
          <button onClick={onClose} className="text-[#5B6472] dark:text-[#7C8697]"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-4">
          <h2 className="font-display-en text-lg md:text-xl leading-tight" style={{ fontWeight: 600 }}>{title}</h2>
          <p className="text-xs md:text-sm text-[#5B6472] dark:text-[#7C8697] leading-relaxed">{sub}</p>

          {isLive && <LiveBtcHeader market={m} />}
          {isScheduled && s && <ScheduledHeader market={m} schedule={s} />}

          {isMulti ? (
            <MultiTicket market={m} schedule={s} qty={qty} setQty={setQty} />
          ) : (
            <BinaryTicket market={m} isLive={isLive} qty={qty} setQty={setQty} />
          )}
        </div>
      </div>
    </div>
  );
}

function LiveBtcHeader({ market }) {
  const { btc, lang } = useApp();
  const t = T[lang];
  const rem = Math.max(0, btc.round.endAt - Date.now());
  const up = btc.price >= (btc.round.openPrice || btc.price);
  return (
    <div className="rounded-xl border border-[#F7931A]/30 bg-[#F7931A]/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">BTC/USD</p>
          <p className="text-xl font-mono font-semibold">{fmtUsd(btc.price)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.vsOpen}</p>
          <p className={`text-sm font-mono flex items-center justify-end gap-1 ${up ? 'text-[#33C7A6]' : 'text-[#E15A4D]'}`}>
            {up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            {fmtUsd(Math.abs(btc.price - (btc.round.openPrice || btc.price)))}
          </p>
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between text-[10px] text-[#5B6472] dark:text-[#7C8697] mb-1">
          <span>{t.nextRound}</span>
          <span className="font-mono">{fmtCountdown(rem)}</span>
        </div>
        <div className="h-1 rounded-full bg-[#E4E7EC] dark:bg-[#212832] overflow-hidden">
          <div className="h-full bg-[#F7931A]" style={{ width: `${Math.min(100, (rem / 300000) * 100)}%` }} />
        </div>
      </div>
      <RecentBtcHistory />
    </div>
  );
}

function RecentBtcHistory() {
  const { btc, lang, dispatch } = useApp();
  const t = T[lang];
  const handleClick = (h) => {
    dispatch({ type: 'CLOSE_DETAIL' });
    window.location.hash = `#/round/btc5m/${h.startAt}`;
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.recentRounds}</span>
        <a href="#/rounds" className="text-[10px] text-[#6C8EF5]">{t.viewAllRounds}</a>
      </div>
      <div className="flex flex-wrap gap-1">
        {btc.history.slice(0, 12).map((h) => (
          <button
            key={h.startAt}
            onClick={() => handleClick(h)}
            title={`${fmtRange(h.startAt, h.endAt)} · ${h.outcome === 'yes' ? 'UP' : 'DOWN'}`}
            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold ${h.outcome === 'yes' ? 'bg-[#33C7A6]/15 text-[#33C7A6]' : 'bg-[#E15A4D]/15 text-[#E15A4D]'}`}
          >
            {h.outcome === 'yes' ? '↑' : '↓'}
          </button>
        ))}
      </div>
    </div>
  );
}

function ScheduledHeader({ market, schedule }) {
  const { lang } = useApp();
  const t = T[lang];
  const up = market.currentPrice >= schedule.currentRound.openPrice;
  const change = market.currentPrice - schedule.currentRound.openPrice;
  const pct = (change / schedule.currentRound.openPrice) * 100;
  return (
    <div className="rounded-xl border border-[#F7931A]/30 bg-[#F7931A]/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.livePrice}</p>
          <p className="text-xl font-mono font-semibold">{fmtPrice(market)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.vsOpen}</p>
          <p className={`text-sm font-mono ${up ? 'text-[#33C7A6]' : 'text-[#E15A4D]'}`}>
            {up ? '+' : '−'}{Math.abs(change).toFixed(2)} ({pct >= 0 ? '+' : '−'}{Math.abs(pct).toFixed(2)}%)
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-white/60 dark:bg-[#0A0E14]/50 border border-[#F7931A]/20 px-2.5 py-1.5">
        <span className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{market.schedule === 'weekly-friday' ? t.thisWeek : t.thisMonth}</span>
        <span className="font-mono text-sm font-semibold text-[#F7931A]">{fmtScheduleCountdown(schedule.currentRound.endAt - Date.now())}</span>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.recentRoundsLabel}</span>
          <a href="#/rounds" className="text-[10px] text-[#6C8EF5]">{t.viewAllRounds}</a>
        </div>
        <div className="flex flex-wrap gap-1">
          {schedule.history.slice(0, 12).map((h) => {
            const win = market.options.find((o) => o.id === h.outcome);
            const wl = win ? (lang === 'km' ? win.labelKm : win.label) : '—';
            return (
              <button
                key={h.startAt}
                onClick={() => { window.location.hash = `#/round/${market.id}/${h.startAt}`; }}
                title={`${fmtRangeLabel(h.startAt, h.endAt, market.schedule)} · ${wl}`}
                className={`px-1.5 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-semibold ${h.closePrice >= h.openPrice ? 'bg-[#33C7A6]/15 text-[#33C7A6]' : 'bg-[#E15A4D]/15 text-[#E15A4D]'}`}
              >
                {(market.currency || '$')}{h.closePrice.toFixed(market.currentPrice < 10 ? 2 : 0)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MultiTicket({ market, schedule, qty, setQty }) {
  const { lang, books, user, positions, balances, selectedSide, selectedOptionId, dispatch, showToast } = useApp();
  const t = T[lang];
  const optId = selectedOptionId || market.options[0].id;
  const opt = market.options.find((o) => o.id === optId) || market.options[0];
  const optLabel = lang === 'km' ? opt.labelKm : opt.label;
  const side = selectedSide;
  const book = books[market.id]?.options?.[optId];
  const sideBook = book?.[side] || { bids: [], asks: [] };
  const preview = walkAsks(sideBook.asks, qty);
  const previewTotal = (preview.avgPrice * preview.filledQty) / 100 + takerFeeForFills(preview.fills);

  const submit = () => {
    if (!user) {
      showToast('error', t.signInToTrade);
      return;
    }
    if (preview.filledQty === 0) {
      showToast('error', t.noLiquidity);
      return;
    }
    const current = balances[user.email] ?? 0;
    if (previewTotal > current) {
      showToast('error', t.insufficient);
      return;
    }
    dispatch({ type: 'ADD_BALANCE', email: user.email, delta: -previewTotal });
    dispatch({ type: 'CREDIT_POSITION', email: user.email, marketId: market.id, side, qty: preview.filledQty, price: preview.avgPrice, optionId: optId });
    const newBook = { ...sideBook, asks: preview.newAsks };
    dispatch({ type: 'UPDATE_BOOK', marketId: market.id, side, newBook, optionId: optId });
    showToast('success', t.bought(preview.filledQty, side === 'yes' ? t.yes : t.no, Math.round(preview.avgPrice * 10) / 10));
  };

  return (
    <div className="bg-white dark:bg-[#12171F] border border-[#E4E7EC] dark:border-[#212832] rounded-xl p-3 space-y-3">
      <div>
        <p className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697] mb-2">{t.pickOutcome}</p>
        <div className="space-y-1.5">
          {market.options.map((o) => {
            const isSel = o.id === optId;
            return (
              <button
                key={o.id}
                onClick={() => dispatch({ type: 'SET_OPTION', optionId: o.id })}
                className={`w-full flex items-center gap-2 p-2 rounded-lg border text-left transition-all ${isSel ? 'border-[#6C8EF5] bg-[#6C8EF5]/5' : 'border-[#E4E7EC] dark:border-[#212832]'}`}
              >
                <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center shrink-0 ${isSel ? 'border-[#6C8EF5]' : 'border-[#5B6472]/40'}`}>
                  {isSel && <div className="w-1.5 h-1.5 rounded-full bg-[#6C8EF5]" />}
                </div>
                <span className="flex-1 text-xs font-mono truncate">{lang === 'km' ? o.labelKm : o.label}</span>
                <span className="text-xs text-[#6C8EF5] font-mono font-semibold">{o.yes}¢</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => dispatch({ type: 'SET_SIDE', side: 'yes' })}
          className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${side === 'yes' ? 'bg-[#33C7A6] text-[#0A0E14]' : 'bg-white dark:bg-[#0A0E14] text-[#33C7A6] border border-[#33C7A6]/40'}`}
        >
          {t.yes} · {opt.yes}¢
        </button>
        <button
          onClick={() => dispatch({ type: 'SET_SIDE', side: 'no' })}
          className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${side === 'no' ? 'bg-[#E15A4D] text-[#0A0E14]' : 'bg-white dark:bg-[#0A0E14] text-[#E15A4D] border border-[#E15A4D]/40'}`}
        >
          {t.no} · {100 - opt.yes}¢
        </button>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.contracts}</label>
        <div className="flex items-center gap-2 mt-1.5">
          <button onClick={() => setQty(Math.max(1, qty - 5))} className="w-8 h-8 rounded-md bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832]">−</button>
          <input type="number" min="1" value={qty} onChange={(e) => setQty(Math.max(1, Math.round(Number(e.target.value)) || 1))} className="flex-1 bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-md text-center py-1.5 font-mono text-sm" />
          <button onClick={() => setQty(qty + 5)} className="w-8 h-8 rounded-md bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832]">+</button>
        </div>
      </div>

      <div className="space-y-1 text-xs">
        <div className="flex justify-between text-[#5B6472] dark:text-[#7C8697]">
          <span>{t.estAvgPrice}</span>
          <span className="font-mono">{preview.filledQty ? `${preview.avgPrice.toFixed(1)}¢` : '—'}</span>
        </div>
        <div className="flex justify-between text-[#5B6472] dark:text-[#7C8697]">
          <span>{t.estTotalCost}</span>
          <span className="font-mono">${previewTotal.toFixed(2)}</span>
        </div>
      </div>

      <button onClick={submit} className={`w-full py-2.5 rounded-lg font-semibold text-[#0A0E14] ${side === 'yes' ? 'bg-[#33C7A6]' : 'bg-[#E15A4D]'}`}>
        {!user ? t.signInToTrade : t.placeBuyMarket(`${optLabel} · ${side === 'yes' ? t.yes : t.no}`)}
      </button>
    </div>
  );
}

function BinaryTicket({ market, isLive, qty, setQty }) {
  const { lang, books, user, positions, balances, selectedSide, dispatch, showToast } = useApp();
  const t = T[lang];
  const side = selectedSide;
  const sideYes = market.yes ?? 50;
  const sideBook = books[market.id]?.[side] || { bids: [], asks: [] };
  const preview = walkAsks(sideBook.asks, qty);
  const previewTotal = (preview.avgPrice * preview.filledQty) / 100 + takerFeeForFills(preview.fills);

  const submit = () => {
    if (!user) { showToast('error', t.signInToTrade); return; }
    if (preview.filledQty === 0) { showToast('error', t.noLiquidity); return; }
    const current = balances[user.email] ?? 0;
    if (previewTotal > current) { showToast('error', t.insufficient); return; }
    dispatch({ type: 'ADD_BALANCE', email: user.email, delta: -previewTotal });
    dispatch({ type: 'CREDIT_POSITION', email: user.email, marketId: market.id, side, qty: preview.filledQty, price: preview.avgPrice, optionId: null });
    dispatch({ type: 'UPDATE_BOOK', marketId: market.id, side, newBook: { ...sideBook, asks: preview.newAsks } });
    showToast('success', t.bought(preview.filledQty, side === 'yes' ? t.yes : t.no, Math.round(preview.avgPrice * 10) / 10));
  };

  return (
    <div className="bg-white dark:bg-[#12171F] border border-[#E4E7EC] dark:border-[#212832] rounded-xl p-3 space-y-3">
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => dispatch({ type: 'SET_SIDE', side: 'yes' })}
          className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${side === 'yes' ? 'bg-[#33C7A6] text-[#0A0E14]' : 'bg-white dark:bg-[#0A0E14] text-[#33C7A6] border border-[#33C7A6]/40'}`}
        >
          {t.yes} · {sideYes}¢
        </button>
        <button
          onClick={() => dispatch({ type: 'SET_SIDE', side: 'no' })}
          className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${side === 'no' ? 'bg-[#E15A4D] text-[#0A0E14]' : 'bg-white dark:bg-[#0A0E14] text-[#E15A4D] border border-[#E15A4D]/40'}`}
        >
          {t.no} · {100 - sideYes}¢
        </button>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.contracts}</label>
        <div className="flex items-center gap-2 mt-1.5">
          <button onClick={() => setQty(Math.max(1, qty - 5))} className="w-8 h-8 rounded-md bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832]">−</button>
          <input type="number" min="1" value={qty} onChange={(e) => setQty(Math.max(1, Math.round(Number(e.target.value)) || 1))} className="flex-1 bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-md text-center py-1.5 font-mono text-sm" />
          <button onClick={() => setQty(qty + 5)} className="w-8 h-8 rounded-md bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832]">+</button>
        </div>
      </div>

      <div className="space-y-1 text-xs">
        <div className="flex justify-between text-[#5B6472] dark:text-[#7C8697]">
          <span>{t.estAvgPrice}</span>
          <span className="font-mono">{preview.filledQty ? `${preview.avgPrice.toFixed(1)}¢` : '—'}</span>
        </div>
        <div className="flex justify-between text-[#5B6472] dark:text-[#7C8697]">
          <span>{t.estTotalCost}</span>
          <span className="font-mono">${previewTotal.toFixed(2)}</span>
        </div>
      </div>

      <button onClick={submit} className={`w-full py-2.5 rounded-lg font-semibold text-[#0A0E14] ${side === 'yes' ? 'bg-[#33C7A6]' : 'bg-[#E15A4D]'}`}>
        {!user ? t.signInToTrade : t.placeBuyMarket(side === 'yes' ? t.yes : t.no)}
      </button>
    </div>
  );
}

function BtcResultPanel({ onClose }) {
  const { lang, btc } = useApp();
  const t = T[lang];
  const r = btc.lastResult;
  const isUp = r.outcome === 'yes';
  const color = isUp ? '#33C7A6' : '#E15A4D';
  const change = Math.abs(r.closePrice - r.openPrice);
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end bg-black/50 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full md:max-w-md max-h-[92vh] md:max-h-full md:h-full detail-sheet md:rounded-none bg-white dark:bg-[#0F141B] border-t md:border-l md:border-t-0 border-[#E4E7EC] dark:border-[#212832] overflow-y-auto slide-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-[#E4E7EC] dark:border-[#212832] flex items-center justify-between sticky top-0 bg-white/95 dark:bg-[#0F141B]/95 backdrop-blur">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[#5B6472] dark:text-[#7C8697]">{t.roundSettled}</span>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div className="text-center">
            <a href={`#/round/btc5m/${r.startAt}`} onClick={onClose} className="font-mono text-sm text-[#6C8EF5]">{fmtRange(r.startAt, r.endAt)} →</a>
          </div>
          <div className="pop-in text-center space-y-2 py-4">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full" style={{ background: `${color}1a`, border: `2px solid ${color}66`, color }}>
              {isUp ? <ArrowUpRight className="w-10 h-10" /> : <ArrowDownRight className="w-10 h-10" />}
            </div>
            <p className="text-4xl tracking-wider font-display-en" style={{ color, fontWeight: 700 }}>{isUp ? t.up : t.down}</p>
            <p className="text-2xl font-mono">{fmtUsd(r.closePrice)}</p>
            <p className="text-sm font-mono" style={{ color }}>{isUp ? '+' : '−'}{fmtUsd(change).slice(1)}</p>
          </div>
          <a href="#/rounds" onClick={onClose} className="block w-full text-center py-2.5 rounded-lg text-sm text-[#6C8EF5] border border-[#6C8EF5]/40">{t.viewAllRounds} →</a>
        </div>
      </div>
    </div>
  );
}