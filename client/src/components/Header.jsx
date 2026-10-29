import React from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun, LogIn, Wallet, CreditCard } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { useAuth } from '../auth/authContext.js';

export default function Header({ onAuthOpen, onTopUpOpen, onPositionsOpen, accountMenuOpen, setAccountMenuOpen }) {
  const { lang, setLang, themeMode, setThemeMode, balances, positions } = useApp();
  const { user: authUser, logout } = useAuth();
  const t = T[lang];

  // Map server user to our local shape if needed
  const user = authUser ? { name: authUser.display_name, email: authUser.email } : null;
  const balance = user ? balances[user.email] ?? 0 : 0;
  const initial = user ? (user.name || user.email || '?').trim().charAt(0).toUpperCase() : '';

  return (
    <header className="border-b border-[#DCE1E7] dark:border-[#202832] sticky top-0 bg-[#F7F8FA]/90 dark:bg-[#0A0E14]/90 backdrop-blur-xl z-30 shadow-[0_1px_0_rgba(255,255,255,0.02)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <Link to="/" className="group flex items-center gap-3 min-w-0 shrink">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-[#33C7A6] shadow-[0_8px_22px_rgba(51,199,166,0.2)] flex items-center justify-center transition-transform group-hover:-translate-y-0.5">
            <div className="w-3 h-3 bg-[#07110F]" style={{ clipPath: 'polygon(0 100%, 100% 100%, 100% 0)' }} />
          </div>
          <div className="flex flex-col leading-none min-w-0 gap-1">
            <span className="font-display-km text-sm md:text-base truncate" style={{ fontWeight: 600 }}>ការទស្សន៍ទាយអនាគត</span>
            <span className="font-display-en text-[8px] md:text-[9px] uppercase tracking-[0.16em] text-[#5B6472] dark:text-[#7C8697] mt-0.5 truncate" style={{ fontWeight: 500 }}>Khmer Future Prediction</span>
          </div>
        </Link>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => setLang(lang === 'en' ? 'km' : 'en')}
            className="h-9 flex items-center gap-1 rounded-full border border-[#DCE1E7] dark:border-[#252E3A] bg-white/80 dark:bg-[#111821]/90 p-1 text-xs shadow-sm transition-all hover:border-[#33C7A6]/50"
            aria-label="Switch language"
            title={lang === 'en' ? 'Switch to Khmer' : 'Switch to English'}
          >
            <span className={`h-7 flex items-center gap-1.5 rounded-full px-2 transition-all ${lang === 'en' ? 'bg-[#33C7A6]/15 text-[#1E9F86] dark:text-[#4AD5B7]' : 'text-[#697586] dark:text-[#758195]'}`}>
              <img src="/flags/us.svg" alt="" className="w-4 h-3 rounded-[2px] object-cover shadow-sm" />
              <span className="font-semibold">EN</span>
            </span>
            <span className={`h-7 flex items-center gap-1.5 rounded-full px-2 transition-all ${lang === 'km' ? 'bg-[#33C7A6]/15 text-[#1E9F86] dark:text-[#4AD5B7]' : 'text-[#697586] dark:text-[#758195]'}`} style={{ fontFamily: "'Battambang', sans-serif" }}>
              <img src="/flags/kh.svg" alt="" className="w-4 h-3 rounded-[2px] object-cover shadow-sm" />
              <span className="font-semibold">ខ្មែរ</span>
            </span>
          </button>

          <button
            onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
            className="h-9 flex items-center gap-0.5 rounded-full border border-[#DCE1E7] dark:border-[#252E3A] bg-white/80 dark:bg-[#111821]/90 p-1 shadow-sm"
            aria-label={themeMode === 'dark' ? 'Use light theme' : 'Use dark theme'}
            title={themeMode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            <span className={`flex items-center justify-center w-6 h-6 rounded-full ${themeMode === 'dark' ? 'bg-[#33C7A6] text-[#0A0E14]' : 'text-[#5B6472] dark:text-[#7C8697]'}`}>
              <Moon className="w-3 h-3" />
            </span>
            <span className={`flex items-center justify-center w-6 h-6 rounded-full ${themeMode === 'light' ? 'bg-[#F2B84B] text-[#0A0E14]' : 'text-[#5B6472] dark:text-[#7C8697]'}`}>
              <Sun className="w-3 h-3" strokeWidth={2} />
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
                      onClick={() => { setAccountMenuOpen(false); logout().catch(() => {}); }}
                      className="w-full text-left px-3 py-2 text-sm text-[#E15A4D] hover:bg-[#F7F8FA] dark:hover:bg-[#12171F] border-t border-[#E4E7EC] dark:border-[#212832]"
                    >
                      {t.logOut}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center">
              <button
                onClick={() => onAuthOpen('login')}
                className="h-9 flex items-center gap-2 px-4 rounded-full text-xs font-bold bg-[#33C7A6] text-[#07110F] shadow-[0_6px_18px_rgba(51,199,166,0.2)] transition-all hover:bg-[#45D4B4] hover:-translate-y-px"
              >
                <LogIn className="w-3 h-3" />
                {t.signIn}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
