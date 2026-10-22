import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, CheckCircle2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useApp } from '../state/AppContext.jsx';
import { useAuth } from '../auth/authContext.js';
import { T } from '../lib/i18n.js';

export default function TopUpModal({ onClose }) {
  const { lang, dispatch, showToast } = useApp();
  const { user } = useAuth();
  const t = T[lang];
  const [amount, setAmount] = useState(25);
  const [stage, setStage] = useState('amount');
  const [txn, setTxn] = useState(null);
  const amountRef = useRef(amount);
  const pollRef = useRef(null);

  useEffect(() => { amountRef.current = amount; }, [amount]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const startPayment = () => {
    if (!amount || amount <= 0) return;
    setStage('creating');
    setTimeout(() => {
      const tran_id = 'TU' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const qr_string = '00020101021229370016A0000006770101110215123456789012345303' + amountRef.current.toFixed(2).replace('.', '') + '5802KH5910KHMER FUTUR6002PP6304ABCD';
      setTxn({ tran_id, qr_string });
      setStage('pending');
    }, 1100);
  };

  const simulateApproved = () => {
    setStage('approved');
    dispatch({ type: 'ADD_BALANCE', email: user.email, delta: amountRef.current });
    showToast('success', t.topUpSuccess(amountRef.current));
    setTimeout(onClose, 1400);
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
                <QRCodeSVG value={txn.qr_string} size={160} level="M" />
              </div>
              <p className="text-[10px] text-[#5B6472] dark:text-[#7C8697] text-center">{t.scanToPay}</p>
              <div className="w-full space-y-1 text-[10px] font-mono">
                <div className="flex justify-between"><span className="text-[#5B6472] dark:text-[#7C8697]">{t.amount}</span><span>${amount.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-[#5B6472] dark:text-[#7C8697]">{t.reference}</span><span className="truncate">{txn.tran_id}</span></div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 mt-3 text-sm text-[#5B6472] dark:text-[#7C8697]">
              <Loader2 className="w-4 h-4 animate-spin text-[#33C7A6]" />
              {t.waiting}
            </div>
            <button onClick={simulateApproved} className="w-full mt-2 py-2 rounded-lg text-[10px] uppercase tracking-widest text-[#6C8EF5] border border-dashed border-[#6C8EF5]/50">
              {t.demoSim}
            </button>
            <button onClick={onClose} className="w-full mt-1.5 py-2 rounded-lg text-sm text-[#5B6472] dark:text-[#7C8697] border border-[#E4E7EC] dark:border-[#212832]">
              {t.cancel}
            </button>
          </>
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