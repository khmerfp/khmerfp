import React from 'react';
import { Link } from 'react-router-dom';
import { Languages, Moon, Smartphone, LogIn, Wallet, CreditCard } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';

export default function Header({ onAuthOpen, onTopUpOpen, onPositionsOpen, authOpen, accountMenuOpen, setAccountMenuOpen }) {
  const { lang, setLang, themeMode, setThemeMode, user, balances, positions, dispatch } = useApp();
  const t = T[lang];

  const balance = user ? balances[user.email] ?? 0 : 0;
  const initial = user ? (user.name || user.email || '?').trim().charAt(0).toUpperCase() : '';

  return (
    <header className="border-b border-[#E4E7EC] dark:border-[#212832] sticky top-0 bg-[#F7F8FA]/95 dark:bg-[#0A0E14]/95 backdrop-blur z-30">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2 min-w-0 shrink">
          <div className="w-7 h-7 shrink-0 rounded-md bg-[#33C7A6] flex items-center justify-center">
            <div className="w-2.5 h-2.5 bg-[#0A0E14]" style={{ clipPath: 'polygon(0 100%, 100% 100%, 100% 0)' }} />
          </div>
          <div className="flex flex-col leading-none min-w-0">
            <span className="font-display-km text-sm md:text-base truncate" style={{ fontWeight: 600 }}>ការទស្សន៍ទាយអនាគត</span>
            <span className="font-display-en text-[8px] md:text-[9px] uppercase tracking-[0.16em] text-[#5B6472] dark:text-[#7C8697] mt-0.5 truncate" style={{ fontWeight: 500 }}>Khmer Future Prediction</span>
          </div>
        </Link>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setLang(lang === 'en' ? 'km' : 'en')}
            className="flex items-center gap-1 rounded-full border border-[#E4E7EC] dark:border-[#212832] bg-white dark:bg-[#12171F] px-2 py-1 text-xs"
            aria-label="Switch language"
          >
            <Languages className="w-3 h-3 text-[#5B6472] dark:text-[#7C8697]" />
            <span className={lang === 'en' ? 'text-[#33C7A6] font-semibold' : 'text-[#5B6472] dark:text-[#7C8697]'}>EN</span>
            <span className={lang === 'km' ? 'text-[#33C7A6] font-semibold' : 'text-[#5B6472] dark:text-[#7C8697]'} style={{ fontFamily: "'Noto Sans Khmer', sans-serif" }}>ខ្មែរ</span>
          </button>

          <button
            onClick={() => setThemeMode(themeMode === 'dark' ? 'system' : 'dark')}
            className="flex items-center gap-0.5 rounded-full border border-[#E4E7EC] dark:border-[#212832] bg-white dark:bg-[#12171F] p-0.5"
            aria-label="Toggle theme"
          >
            <span className={`flex items-center justify-center w-6 h-6 rounded-full ${themeMode === 'dark' ? 'bg-[#33C7A6] text-[#0A0E14]' : 'text-[#5B6472] dark:text-[#7C8697]'}`}>
              <Moon className="w-3 h-3" />
            </span>
            <span className={`flex items-center justify-center w-6 h-6 rounded-full ${themeMode === 'system' ? 'bg-[#33C7A6] text-[#0A0E14]' : 'text-[#5B6472] dark:text-[#7C8697]'}`}>
              <Smartphone className="w-3 h-3" />
            </span>
          </button>

          {user ? (
            <div className="relative">
              <button
                onClick={() => setAccountMenuOpen(!accountMenuOpen)}
                className="flex items-center gap-1.5 rounded-full border border-[#E4E7EC] dark:border-[#212832] bg-white dark:bg-[#12171F] pl-0.5 pr-2 py-0.5 hover:border-[#33C7A6]/40"
              >
                <span className="w-6 h-6 rounded-full bg-[#33C7A6] text-[#0A0E14] text-xs font-semibold flex items-center justify-center">
                  {initial}
                </span>
                <Wallet className="w-3 h-3 text-[#F2B84B]" />
                <span className="font-mono text-xs">${balance.toFixed(2)}</span>
              </button>
              {accountMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAccountMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-56 bg-white/95 dark:bg-[#0F141B]/90 backdrop-blur-xl border border-[#E4E7EC] dark:border-[#212832] rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="px-3 py-2 border-b border-[#E4E7EC] dark:border-[#212832]">
                      <p className="text-sm truncate">{user.name}</p>
                      <p className="text-[10px] text-[#5B6472] dark:text-[#7C8697] truncate font-mono">{user.email}</p>
                    </div>
                    <button
                      onClick={() => { setAccountMenuOpen(false); onTopUpOpen(); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[#F7F8FA] dark:hover:bg-[#12171F] flex items-center gap-2"
                    >
                      <CreditCard className="w-3.5 h-3.5" /> {t.topUp}
                    </button>
                    <button
                      onClick={() => { setAccountMenuOpen(false); onPositionsOpen(); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[#F7F8FA] dark:hover:bg-[#12171F] flex items-center justify-between"
                    >
                      {t.yourPositions}
                      <span className="text-[10px] text-[#5B6472] dark:text-[#7C8697] font-mono">
                        {(positions[user.email] || []).length}
                      </span>
                    </button>
                    <button
                      onClick={() => { setAccountMenuOpen(false); dispatch({ type: 'LOGOUT' }); }}
                      className="w-full text-left px-3 py-2 text-sm text-[#E15A4D] hover:bg-[#F7F8FA] dark:hover:bg-[#12171F] border-t border-[#E4E7EC] dark:border-[#212832]"
                    >
                      {t.logOut}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={() => onAuthOpen('login')}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium bg-[#33C7A6] text-[#0A0E14]"
            >
              <LogIn className="w-3 h-3" />
              {t.signIn}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}