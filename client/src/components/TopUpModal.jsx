import { tradingLabels } from '../lib/tradingText.js';
import { usd } from '../services/custodialTrading.js';
import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, CheckCircle2, Clock } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { createBakongPayment, getBakongPaymentStatus } from '../services/paymentApi.js';

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function LegacyTopUpModal({ onClose }) {
  const { lang, refreshWallet, showToast } = useApp();
  const t = T[lang];
  const [amount, setAmount] = useState(25);
  const [stage, setStage] = useState('amount');
  const [txn, setTxn] = useState(null);
  const [error, setError] = useState(null);
  const onCloseRef = useRef(onClose);
  const idempotencyKeyRef = useRef(null);
  const idempotencyAmountRef = useRef(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (stage !== 'pending' || !txn?.statusToken) return undefined;

    let cancelled = false;
    let timer;

    const poll = async () => {
      let delayMs = 3000;

      try {
        const payment = await getBakongPaymentStatus(txn.tranId, txn.statusToken);
        if (cancelled) return;

        setError(null);

        if (payment.status === 'PAID') {
          try {
            await refreshWallet();
          } catch {
            // The payment is still confirmed; the balance refreshes later.
          }
          showToast('success', t.topUpSuccess(payment.amount));
          setStage('approved');
          return;
        }

        if (payment.status === 'EXPIRED' || payment.status === 'FAILED') {
          setStage('expired');
          return;
        }
      } catch (pollError) {
        if (!cancelled) setError(pollError.message);
        // When the server asks us to slow down (e.g. Bakong rate limiting),
        // respect the hint instead of polling at full speed.
        delayMs = pollError?.retryAfterMs ?? 3000;
      }

      if (!cancelled) timer = setTimeout(poll, delayMs);
    };

    timer = setTimeout(poll, 1200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stage, txn, refreshWallet, showToast, t]);

  useEffect(() => {
    if (stage !== 'approved') return undefined;

    const timer = setTimeout(() => onCloseRef.current(), 1600);
    return () => clearTimeout(timer);
  }, [stage]);

  const startPayment = async () => {
    if (!amount || amount <= 0) return;

    setError(null);
    setStage('creating');

    try {
      let idempotencyKey = idempotencyKeyRef.current;

      if (!idempotencyKey || idempotencyAmountRef.current !== amount) {
        idempotencyKey = createIdempotencyKey();
        idempotencyKeyRef.current = idempotencyKey;
        idempotencyAmountRef.current = amount;
      }

      const body = await createBakongPayment({ amount, idempotencyKey });
      setTxn({
        tranId: body.payment.tranId,
        qrString: body.payment.qrString,
        statusToken: body.statusAccess.token,
        expiresAt: body.payment.expiresAt,
        amount: body.payment.amount,
      });
      setStage('pending');
    } catch (creationError) {
      setError(creationError.message);
      setStage('amount');
    }
  };

  const resetPayment = () => {
    idempotencyKeyRef.current = null;
    idempotencyAmountRef.current = null;
    setTxn(null);
    setError(null);
    setStage('amount');
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-in w-full max-w-sm bg-white dark:bg-[#0F141B] border border-[#E4E7EC] dark:border-[#212832] rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display-en text-lg" style={{ fontWeight: 600 }}>{t.topUpTitle}</h2>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>

        {stage === 'amount' && (
          <>
            <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.amount}</label>
            <div className="grid grid-cols-4 gap-1.5 mt-1.5 mb-3">
              {[10, 25, 50, 100].map((p) => (
                <button key={p} onClick={() => setAmount(p)} className={`py-1.5 rounded-lg text-xs font-mono ${amount === p ? 'bg-[#33C7A6] text-[#0A0E14]' : 'bg-[#F4F6F8] dark:bg-[#12171F] border border-[#E4E7EC] dark:border-[#212832]'}`}>${p}</button>
              ))}
            </div>
            <input type="number" min="1" value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))} className="w-full bg-[#F4F6F8] dark:bg-[#12171F] border border-[#E4E7EC] dark:border-[#212832] rounded-lg px-3 py-2 font-mono text-sm outline-none" />
            {error && (
              <p className="mt-3 text-xs text-[#E5484D] leading-relaxed">{error}</p>
            )}
            <button onClick={startPayment} disabled={!amount || amount <= 0} className="w-full mt-4 py-2.5 rounded-lg font-semibold text-[#0A0E14] bg-[#33C7A6] disabled:opacity-40">
              {t.generateQr}
            </button>
          </>
        )}

        {stage === 'creating' && (
          <div className="flex flex-col items-center gap-2 py-8">
            <Loader2 className="w-6 h-6 text-[#33C7A6] animate-spin" />
            <p className="text-sm text-[#5B6472] dark:text-[#7C8697]">{t.creating}</p>
          </div>
        )}

        {stage === 'pending' && txn && (
          <>
            <div className="bg-[#F4F6F8] dark:bg-[#12171F] border border-[#E4E7EC] dark:border-[#212832] rounded-xl p-3 flex flex-col gap-2 items-center">
              <div className="bg-white p-2 rounded-lg">
                <QRCodeSVG value={txn.qrString} size={160} level="M" />
              </div>
              <p className="text-[10px] text-[#5B6472] dark:text-[#7C8697] text-center">{t.scanToPay}</p>
              <div className="w-full space-y-1 text-[10px] font-mono">
                <div className="flex justify-between"><span className="text-[#5B6472] dark:text-[#7C8697]">{t.amount}</span><span>${txn.amount.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-[#5B6472] dark:text-[#7C8697]">{t.reference}</span><span className="truncate">{txn.tranId}</span></div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 mt-3 text-sm text-[#5B6472] dark:text-[#7C8697]">
              <Loader2 className="w-4 h-4 animate-spin text-[#33C7A6]" />
              {t.waiting}
            </div>
            {error && (
              <p className="mt-2 text-[10px] text-[#E5484D] text-center leading-relaxed">{error}</p>
            )}
            <button onClick={onClose} className="w-full mt-3 py-2 rounded-lg text-sm text-[#5B6472] dark:text-[#7C8697] border border-[#E4E7EC] dark:border-[#212832]">
              {t.cancel}
            </button>
          </>
        )}

        {stage === 'expired' && (
          <div className="flex flex-col items-center gap-2 py-6">
            <Clock className="w-8 h-8 text-[#E5A23D]" />
            <p className="text-sm text-center">{t.qrExpired}</p>
            <button onClick={resetPayment} className="w-full mt-2 py-2.5 rounded-lg font-semibold text-[#0A0E14] bg-[#33C7A6]">
              {t.tryAgain}
            </button>
          </div>
        )}

        {stage === 'approved' && (
          <div className="flex flex-col items-center gap-2 py-8">
            <CheckCircle2 className="w-8 h-8 text-[#33C7A6]" />
            <p className="text-sm">{t.confirmed}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TopUpModal({onClose}) {
  const {authoritative,lang,trading}=useApp(),t={...T[lang],...tradingLabels(lang)}
  if(!authoritative)return <LegacyTopUpModal onClose={onClose}/>
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={e=>{if(e.target===e.currentTarget)onClose()}}><section role="dialog" aria-modal="true" aria-label={t.wallet} className="w-full max-w-md rounded-2xl bg-white dark:bg-[#0F141B] border border-[#E4E7EC] dark:border-[#212832] p-5 space-y-4"><div className="flex justify-between"><h2 className="font-display-en text-xl">{t.wallet}</h2><button onClick={onClose} aria-label={t.cancel}><X className="w-5 h-5"/></button></div>{[[t.total,trading.portfolio?.cash?.posted],[t.available,trading.portfolio?.cash?.available],[t.reserved,trading.portfolio?.cash?.reserved]].map(([label,value])=><div key={label} className="flex justify-between text-sm"><span className="text-[#7C8697]">{label}</span><span className="font-mono">{value==null?t.unavailable:usd(value)}</span></div>)}<p className="text-xs text-[#7C8697]">{t.noFunding}</p></section></div>
}
