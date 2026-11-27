import React from 'react';
import { Link } from 'react-router-dom';
import { Flame, DollarSign, CloudRain, Bitcoin, Trophy, Clock, Heart } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { CATS } from '../lib/constants.js';
import { T } from '../lib/i18n.js';

const ICONS = { flame: Flame, dollar: DollarSign, cloud: CloudRain, btc: Bitcoin, trophy: Trophy, heart: Heart };

export default function CategoryRail({ activeCat, onSelectCat }) {
  const { lang } = useApp();
  const t = T[lang];

  return (
    <nav aria-label="Market categories" className="sticky top-16 z-20 border-b border-[#E4E7EC] dark:border-[#202832] bg-[#F7F8FA]/92 dark:bg-[#0A0E14]/92 backdrop-blur-xl overflow-x-auto no-scrollbar">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-2 py-2.5">
        {CATS.map((c) => {
          const Icon = ICONS[c.icon] || Flame;
          const active = activeCat === c.id;
          const label = lang === 'km' ? c.labelKm : c.label;
          return (
            <button
              key={c.id}
              onClick={() => onSelectCat(c.id)}
              aria-pressed={active}
              className={`h-9 flex items-center gap-2 px-3.5 rounded-full text-xs md:text-sm whitespace-nowrap font-medium border transition-all ${
                active
                  ? 'bg-[#33C7A6]/15 border-[#33C7A6]/25 text-[#1E9F86] dark:text-[#4AD5B7]'
                  : 'border-transparent text-[#667180] dark:text-[#8490A1] hover:text-[#0A0E14] dark:hover:text-[#ECEDEF] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
        <Link
          to="/rounds"
          className="h-9 flex items-center gap-2 px-3.5 rounded-full text-xs md:text-sm font-medium whitespace-nowrap border border-transparent text-[#667180] dark:text-[#8490A1] hover:text-[#0A0E14] dark:hover:text-[#ECEDEF] hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors"
        >
          <Clock className="w-3.5 h-3.5" />
          {t.rounds}
        </Link>
      </div>
    </nav>
  );
}
