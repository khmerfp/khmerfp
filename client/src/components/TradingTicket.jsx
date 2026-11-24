import { estimateBook } from '../services/bookEstimate.js';
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { tradingLabels } from '../lib/tradingText.js';
import { exactDecimal, usd, shares, orderTerms, tradingRequest } from '../services/custodialTrading.js';
import { BinaryOutcomeButtons, MarketDisclosure } from './MarketTradingViews.jsx';
import { marketView } from '../services/marketView.js';
const input = 'w-full min-w-0 h-11 bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-lg px-3 font-mono text-sm tabular-nums outline-none focus:border-[#33C7A6]/60 focus:ring-2 focus:ring-[#33C7A6]/10 transition-colors';
const tabs = 'flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-50';
export default function TradingTicket({
  market,
  claim,
  userId,
  onCommitted
}) {
  const {
      lang,
      trading
    } = useApp(),
    t = {
      ...T[lang],
      ...tradingLabels(lang)
    };
  const [side, setSide] = useState('BUY'),
    [orderType, setOrderType] = useState('LIMIT'),
    [quantity, setQuantity] = useState('1'),
    [priceCents, setPrice] = useState('60'),
    [budget, setBudget] = useState('60');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [hasIntent, setHasIntent] = useState(false);
  const flight = useRef(false),
    generation = useRef(0);
  const storageKey = `khmerfp-trading-intent:${userId}`;
  useEffect(() => {
    generation.current++;
    flight.current = false;
    setBusy(false);
    setMessage('');
    setHasIntent(Boolean(sessionStorage.getItem(storageKey)));
    return () => {
      generation.current++;
    };
  }, [userId, market.id, claim.token_id, storageKey]);
  const terms = () => orderTerms({
    marketId: market.id,
    tokenId: claim.token_id,
    side,
    quantity,
    priceCents,
    maxSpendCents: budget,
    orderType
  });
  async function execute() {
    if (flight.current) return;
    const current = generation.current;
    flight.current = true;
    setBusy(true);
    setMessage('');
    let sent = false;
    try {
      let intent = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (!intent) {
        intent = {
          key: crypto.randomUUID(),
          terms: terms()
        };
        sessionStorage.setItem(storageKey, JSON.stringify(intent));
        setHasIntent(true);
      }
      // A retry always sends the persisted original terms/key, never the edited ticket.
      sent = true;
      await tradingRequest('/orders', {
        method: 'POST',
        headers: {
          'Idempotency-Key': intent.key
        },
        body: JSON.stringify(intent.terms)
      });
      sessionStorage.removeItem(storageKey);
      if (current === generation.current) {
        setHasIntent(false);
        setMessage('accepted');
        onCommitted();
      }
    } catch (error) {
      if (current === generation.current) {
        setMessage(error.status === 401 ? 'sessionExpired' : error.status === 409 ? 'orderRejected' : error.status || sent ? 'connectionError' : 'invalidAmount');
        if (error.status && error.status < 500) {
          sessionStorage.removeItem(storageKey);
          setHasIntent(false);
        }
      }
    } finally {
      if (current === generation.current) {
        flight.current = false;
        setBusy(false);
      }
    }
  }
  let savedIntent;
  try {
    savedIntent = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
  } catch {/* Keep an unreadable intent blocked rather than replacing its key. */}
  const closed = market.trading_status !== 'OPEN' || trading.clock < Date.parse(market.trading_starts_at) || trading.clock >= Date.parse(market.trading_ends_at);
  const value = /^[1-9][0-9]*$/.test(quantity) && /^[1-9][0-9]?$/.test(priceCents) ? BigInt(quantity) * BigInt(priceCents) : null;
  const outcomes = [...new Map(market.claims.map(c => [c.outcome_id, c])).values()];
  const outcomeLabels = useMemo(() => new Map(marketView(market).options.map(o => [o.id, lang === 'km' ? o.labelKm : o.label])), [market, lang]);
  const savedMarket = trading.markets.find(m => m.id === savedIntent?.terms?.marketId);
  const bump = delta => {
    if (/^[1-9][0-9]*$/.test(quantity)) {
      const next = BigInt(quantity) + delta;
      setQuantity(String(next < 1n ? 1n : next));
    }
  };
  const quote = useMemo(() => {
    try {
      const parsed = orderTerms({marketId:market.id,tokenId:claim.token_id,side,quantity,priceCents,maxSpendCents:budget,orderType});
      return estimateBook({...parsed,snapshot:trading.book,userId,now:trading.clock});
    } catch { return null; }
  }, [market.id,claim.token_id,side,quantity,priceCents,budget,orderType,trading.book,trading.clock,userId]);
  const executable = quote && BigInt(quote.estimatedExecutableQuantity)>0n;
  const average = quote?.estimatedAverageExecutionPriceCents;
  const averageLabel = average ? exactDecimal((BigInt(average.numerator) * 100n / BigInt(average.denominator)).toString()) : null;
  const bookReady = trading.book?.marketId === market.id && trading.book?.tokenId === String(claim.token_id) &&
    trading.book?.viewerUserId === (userId == null ? null : String(userId)) && Boolean(trading.book?.snapshotId);
  return <section className="bg-white dark:bg-[#12171F] border border-[#E4E7EC] dark:border-[#212832] rounded-xl p-4 space-y-4" aria-label={t.ticket} data-market-id={market.id} data-token-id={claim.token_id} data-snapshot-id={trading.book?.snapshotId}>
    <div className="flex gap-1.5">{['BUY', 'SELL'].map(value => <button type="button" key={value} aria-pressed={side === value} disabled={busy || hasIntent} onClick={() => setSide(value)} className={`${tabs} ${side === value ? 'border-[#6C8EF5] bg-[#6C8EF5]/10 text-[#6C8EF5]' : 'border-[#E4E7EC] dark:border-[#212832] text-[#7C8697]'}`}>{value === 'BUY' ? t.buy : t.sell}</button>)}</div>
    {market.market_type !== 'BINARY' && <MarketDisclosure data-outcome-selector className="rounded-lg border border-[#E4E7EC] dark:border-[#212832] p-3" title={<span className="inline-flex flex-col gap-1 align-middle"><span className="text-[10px] text-[#7C8697]">{t.pickOutcome}</span><span className="font-mono text-xs text-[#0A0E14] dark:text-[#ECEDEF]">{outcomeLabels.get(String(claim.outcome_id)) || claim.outcome_label}</span></span>}>
      <p className="text-[10px] text-[#7C8697] mb-2">{claim.polarity === 'YES' ? t.yes : t.no} - {t.historicalPrices}</p>
      <div className="space-y-1.5">{outcomes.map(o => {
        const registered = market.claims.find(c => c.outcome_id === o.outcome_id && c.polarity === claim.polarity);
        const price = registered?.last_price_cents;
        const validPrice = typeof price === 'string' && /^[1-9][0-9]?$/.test(price);
        return <button key={o.outcome_id} type="button" data-outcome-id={o.outcome_id} data-price-token-id={registered?.token_id} disabled={busy || hasIntent} aria-pressed={o.outcome_id === claim.outcome_id} onClick={event => {
          trading.setClaim(o.outcome_id + ':' + claim.polarity);
          if (window.matchMedia?.('(max-width: 767px)').matches) event.currentTarget.closest('details').open = false;
        }} className={`w-full flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all ${o.outcome_id === claim.outcome_id ? 'border-[#6C8EF5] bg-[#6C8EF5]/5' : 'border-[#E4E7EC] dark:border-[#212832]'}`}>
          <span className={`w-3 h-3 rounded-full border-2 shrink-0 ${o.outcome_id === claim.outcome_id ? 'border-[#6C8EF5] bg-[#6C8EF5]/40' : 'border-[#5B6472]/40'}`} />
          <span className="flex-1 min-w-0 text-xs font-mono">{outcomeLabels.get(String(o.outcome_id)) || o.outcome_label}</span>
          <span className="shrink-0 text-right"><span className="block text-[9px] text-[#7C8697]">{t.lastTradeShort}</span><span className="font-mono text-[11px] text-[#9BA9C4]" data-outcome-price>{validPrice ? `${price} ${t.cents}` : t.unavailable}</span></span>
        </button>;
      })}</div>
    </MarketDisclosure>}
    <BinaryOutcomeButtons disabled={busy || hasIntent} selected={claim.polarity.toLowerCase()} onSelect={v => trading.setClaim(claim.outcome_id + ':' + v.toUpperCase())} yesLabel={t.yes} noLabel={t.no} />
    <div className="flex gap-1.5" aria-label={t.orderType}>{['MARKET', 'LIMIT'].map(value => <button key={value} type="button" aria-pressed={orderType === value} disabled={busy || hasIntent} onClick={() => setOrderType(value)} className={`${tabs} ${orderType === value ? 'text-[#33C7A6] border-[#33C7A6]/40' : 'text-[#7C8697] border-[#E4E7EC] dark:border-[#212832]'}`}>{value === 'MARKET' ? t.market : t.limit}</button>)}</div>
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-[11px] font-medium text-[#5B6472] dark:text-[#9AA6B5]">
        {t.wholeShares}
        <span className="flex items-center gap-1 mt-2">
          <button type="button" disabled={busy || hasIntent} aria-label={t.wholeShares + ' -'} className="w-7 h-11 shrink-0 rounded-lg border border-[#E4E7EC] dark:border-[#212832] text-[#7C8697] hover:text-[#33C7A6] disabled:opacity-40" onClick={() => bump(-1n)}>-</button>
          <input aria-label={t.wholeShares} className={input + ' text-center px-1'} inputMode="numeric" value={quantity} disabled={busy || hasIntent} onChange={e => setQuantity(e.target.value)} />
          <button type="button" disabled={busy || hasIntent} aria-label={t.wholeShares + ' +'} className="w-7 h-11 shrink-0 rounded-lg border border-[#E4E7EC] dark:border-[#212832] text-[#7C8697] hover:text-[#33C7A6] disabled:opacity-40" onClick={() => bump(1n)}>+</button>
        </span>
      </label>
      <label className="block text-[11px] font-medium text-[#5B6472] dark:text-[#9AA6B5]">
        {orderType === 'LIMIT' ? t.price : t.protection} ({t.cents})
        <input className={input + ' mt-2'} inputMode="numeric" value={priceCents} disabled={busy || hasIntent} onChange={e => setPrice(e.target.value)} />
      </label>
      {orderType === 'MARKET' && side === 'BUY' && <label className="col-span-2 block text-[11px] font-medium text-[#5B6472] dark:text-[#9AA6B5]">{t.maxSpend}<input className={input + ' mt-2'} inputMode="numeric" value={budget} disabled={busy || hasIntent} onChange={e => setBudget(e.target.value)} /></label>}
    </div>

    <div className="rounded-xl bg-[#F7F8FA] dark:bg-[#0D1219] border border-[#E4E7EC] dark:border-[#212832] p-3.5 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-[#5B6472] dark:text-[#9AA6B5]">{t.estimate}</span>
        <span className="font-mono text-xl font-semibold tabular-nums">{executable ? usd(quote.estimatedTotalCents) : t.unavailable}</span>
      </div>
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-[#7C8697]">{t.avgPrice}</span>
        <span className="font-mono tabular-nums text-[#5B6472] dark:text-[#C1C9D4]">{averageLabel ? `${averageLabel} ${t.cents}` : t.unavailable}</span>
      </div>
      {quote && <>
        <details className="border-t border-[#E4E7EC] dark:border-[#212832] pt-3 text-[11px]">
          <summary className="cursor-pointer text-[#5B6472] dark:text-[#9AA6B5] marker:text-[#7C8697]">{t.executionDetails}</summary>
          <dl className="space-y-2 pt-3 text-[#7C8697]">
            <div className="flex justify-between gap-3"><dt>{t.unfilled}</dt><dd className="font-mono tabular-nums text-[#5B6472] dark:text-[#C1C9D4]">{shares(quote.estimatedUnfilledQuantity)}</dd></div>
            <div className="flex justify-between gap-3"><dt>{t.worst}</dt><dd className="font-mono tabular-nums text-[#5B6472] dark:text-[#C1C9D4]">{quote.estimatedWorstExecutionPriceCents == null ? t.unavailable : `${quote.estimatedWorstExecutionPriceCents} ${t.cents}`}</dd></div>
            <div className="flex justify-between gap-3"><dt>{t.updated}</dt><dd className="font-mono tabular-nums">{new Date(quote.generatedAt).toLocaleTimeString(lang === 'km' ? 'km-KH' : 'en-US')}</dd></div>
          </dl>
        </details>
        <p className="text-[11px] leading-relaxed text-[#7C8697]">{quote.stoppedReason === 'SELF_TRADE_PREVENTION' ? t.selfTradeEstimate : !executable ? t.noExecutableEstimate : t.indicative}</p>
      </>}
    </div>

    <div className="grid grid-cols-2 gap-3 text-xs">
      <div className="min-w-0" title={t.payoutExplanation}><p className="text-[10px] text-[#7C8697] mb-1.5">{t.payoutLabel}</p><p className="text-[#5B6472] dark:text-[#9AA6B5]">{t.payoutPending}</p></div>
      <div className="min-w-0 border-l border-[#E4E7EC] dark:border-[#212832] pl-3 text-right"><p className="text-[10px] text-[#7C8697] mb-1.5">{t.maxLoss}</p><p className="font-mono font-medium tabular-nums">{side === 'BUY' ? usd(orderType === 'MARKET' && /^[1-9][0-9]*$/.test(budget) ? budget : value) : t.unavailable}</p></div>
    </div>
    <div className="border-t border-[#E4E7EC] dark:border-[#212832] pt-3 space-y-3">
      <p className="text-[11px] leading-relaxed text-[#7C8697]"><span className="text-[#5B6472] dark:text-[#9AA6B5]">{t.noFees}</span> {orderType === 'MARKET' ? t.immediate : t.resting}</p>
      <button type="button" className="w-full h-10 rounded-lg border border-[#E4E7EC] dark:border-[#293340] text-xs font-medium text-[#5B6472] dark:text-[#C1C9D4] hover:border-[#33C7A6]/50 transition-colors disabled:opacity-40" disabled={busy || closed || !claim.book_id || hasIntent} onClick={() => trading.refresh()}>{t.quote}</button>
      <button type="button" className={`w-full h-12 rounded-lg text-sm font-semibold text-[#0A0E14] transition-colors hover:brightness-105 disabled:opacity-40 ${claim.polarity === 'YES' ? 'bg-[#33C7A6]' : 'bg-[#E15A4D]'}`} disabled={busy || !userId || !hasIntent && (closed || !claim.book_id || !bookReady)} onClick={() => execute()}>{busy ? t.processing : hasIntent ? t.retrySameTerms : !userId ? t.signInToTrade : t.submit}</button>
    </div>
    {hasIntent && <p className="text-xs text-[#7C8697]">{t.savedRequest} {savedMarket?.title || t.unavailable} {shares(savedIntent?.terms?.quantity)} {t.contracts}.</p>}
    {closed && <p className="text-xs text-[#F2B84B]" role="status">{t.marketClosed}</p>}{!claim.book_id && <p className="text-xs" role="status">{t.setupPending}</p>}{message && <p className="text-xs" role="status">{t[message] || t.connectionError}</p>}
  </section>;
}
