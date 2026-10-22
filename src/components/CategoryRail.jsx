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
    <div className="border-b border-[#E4E7EC] dark:border-[#212832] overflow-x-auto no-scrollbar">
      <div className="max-w-7xl mx-auto px-4 flex gap-1 py-2">
        {CATS.map((c) => {
          const Icon = ICONS[c.icon] || Flame;
          const active = activeCat === c.id;
          const label = lang === 'km' ? c.labelKm : c.label;
          return (
            <button
              key={c.id}
              onClick={() => onSelectCat(c.id)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs md:text-sm whitespace-nowrap transition-colors ${
                active ? 'bg-[#33C7A6]/15 text-[#33C7A6]' : 'text-[#5B6472] dark:text-[#7C8697]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
        <Link
          to="/rounds"
          className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs md:text-sm whitespace-nowrap text-[#5B6472] dark:text-[#7C8697] hover:text-[#0A0E14] dark:hover:text-[#ECEDEF]"
        >
          <Clock className="w-3.5 h-3.5" />
          {t.rounds}
        </Link>
      </div>
    </div>
  );
}