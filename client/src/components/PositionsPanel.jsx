import React from 'react';
import { X } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { CATS } from '../lib/constants.js';

export default function PositionsPanel({ onClose, onOpenMarket }) {
  const { lang, user, positions, markets } = useApp();
  const t = T[lang];
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