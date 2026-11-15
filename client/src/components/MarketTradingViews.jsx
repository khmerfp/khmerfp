import React from 'react'

// shared display only; callers own balances, prices and trade actions.
export function MarketCardFrame({ children, onClick, accent = '#6C8EF5', featured = false, label }) {
  return <button
    onClick={onClick}
    aria-label={label}
    className={featured
      ? 'market-card text-left rounded-2xl p-4 md:p-5 transition-all duration-200 flex flex-col gap-2 hover:-translate-y-0.5'
      : 'market-card group text-left rounded-2xl p-3 md:p-4 transition-all duration-200 flex flex-col gap-2 md:gap-3 hover:-translate-y-0.5'}
    style={{ '--card-accent': accent }}
  >{children}</button>
}

export function BinaryOutcomeButtons({ selected, onSelect, yesLabel = 'YES', noLabel = 'NO' }) {
  return <div className="grid grid-cols-2 gap-1.5">
    <button type="button" aria-pressed={selected === 'yes'} onClick={() => onSelect('yes')}
      className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${selected === 'yes' ? 'bg-[#33C7A6] text-[#0A0E14]' : 'bg-white dark:bg-[#0A0E14] text-[#33C7A6] border border-[#33C7A6]/40'}`}>{yesLabel}</button>
    <button type="button" aria-pressed={selected === 'no'} onClick={() => onSelect('no')}
      className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${selected === 'no' ? 'bg-[#E15A4D] text-[#0A0E14]' : 'bg-white dark:bg-[#0A0E14] text-[#E15A4D] border border-[#E15A4D]/40'}`}>{noLabel}</button>
  </div>
}
