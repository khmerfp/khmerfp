import React from 'react'
import { Clock } from 'lucide-react'
import { MarketCardFrame } from '../components/MarketTradingViews.jsx'
import { display } from './demoClient.js'

export default function DemoBitcoinCard({ config, closed, now, onOpen }) {
  const remaining = Math.max(0, Math.ceil((config.round.tradingCutoff * 1000 - now) / 1000))
  const countdown = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
  return <MarketCardFrame featured accent="#F7931A" label="Open Bitcoin trading ticket" onClick={onOpen}>
    <div className="flex items-start gap-2">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[#F7931A]/15 border border-[#F7931A]/30 text-[#F7931A] font-bold">₿</div>
      <div className="flex-1 min-w-0">
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] font-semibold text-[#F7931A] mb-1"><span className="w-1.5 h-1.5 rounded-full bg-[#F7931A]" />Local demo · 5 minutes</span>
        <h2 className="font-display-en text-base leading-snug font-semibold">Bitcoin · 5 minutes</h2>
      </div>
      <span className="inline-flex items-center gap-1 text-xs font-mono text-[#F7931A]"><Clock className="w-3 h-3" />{closed ? 'Closed' : countdown}</span>
    </div>
    <p className="text-sm leading-relaxed">{config.round.question}</p>
    <div className="grid grid-cols-2 gap-1.5">
      <span className="rounded-lg border border-[#33C7A6]/30 bg-[#33C7A6]/10 py-2 text-center text-sm font-semibold text-[#33C7A6]">YES</span>
      <span className="rounded-lg border border-[#E15A4D]/30 bg-[#E15A4D]/10 py-2 text-center text-sm font-semibold text-[#E15A4D]">NO</span>
    </div>
    <p className="text-[10px] text-[#5B6472] dark:text-[#7C8697]">No quoted market prices yet. Choose your own limit price in the ticket.</p>
    <div className="flex items-center justify-between pt-2 border-t border-[#E4E7EC] dark:border-[#212832] text-[10px] text-[#5B6472] dark:text-[#7C8697]">
      <span>Opening fixture: {config.round.openingSample ? `$${display(config.round.openingSample.priceUsd6)}` : 'Not supplied'}</span><span className="text-[#6C8EF5] font-semibold">Open trading ticket →</span>
    </div>
  </MarketCardFrame>
}
