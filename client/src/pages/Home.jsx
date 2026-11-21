import { tradingLabels } from '../lib/tradingText.js';
import { custodialEnabled } from '../services/custodialTrading.js';
import React, { useState } from 'react';
import { Flame } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { CATS } from '../lib/constants.js';
import Header from '../components/Header.jsx';
import CategoryRail from '../components/CategoryRail.jsx';
import MarketCard from '../components/MarketCard.jsx';
import FeaturedCard from '../components/FeaturedCard.jsx';
import DetailPanel from '../components/DetailPanel.jsx';
import AuthModal from '../components/AuthModal.jsx';
import TopUpModal from '../components/TopUpModal.jsx';
import PositionsPanel from '../components/PositionsPanel.jsx';

export default function Home() {
  const { lang, markets, selectedMarketId, dispatch, trading, authoritative } = useApp();
  const t = {...T[lang],...tradingLabels(lang)};
  const [activeCat, setActiveCat] = useState('trending');
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [showTopUp, setShowTopUp] = useState(false);
  const [showPositions, setShowPositions] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const isTrending = activeCat === 'trending';
  const featured = markets.filter((m) => m.featured).slice(0, 4);
  const extra=markets.filter(m=>!featured.some(f=>f.id===m.id));
  const gridList = isTrending ? extra : markets.filter((m) => m.cat === activeCat);
  const selectedCategory=markets.find(m=>m.cat===activeCat)?.category_name;
  const activeCatObj = CATS.find((c) => c.id === activeCat)||{label:selectedCategory,labelKm:selectedCategory};

  const openMarket = (id) => {
    const m = markets.find((x) => x.id === id);
    dispatch({ type: 'OPEN_DETAIL', marketId: id, optionId: m?.type === 'multi' ? m.options[0]?.id : null });
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] dark:bg-[#0A0E14] text-[#0A0E14] dark:text-[#ECEDEF] pb-safe">
      <Header
        onAuthOpen={(mode) => { setAuthMode(mode); setShowAuth(true); }}
        onTopUpOpen={() => setShowTopUp(true)}
        onPositionsOpen={() => setShowPositions(true)}
        accountMenuOpen={accountMenuOpen}
        setAccountMenuOpen={setAccountMenuOpen}
      />
      {authoritative && <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-3 text-xs text-[#7C8697]">{custodialEnabled?t.testMode:t.setupPending}{trading?.connection.includes('Reconnecting') && <span role="status"> - {t.reconnecting}</span>}{trading?.error && <div role="alert" className="mt-2 rounded-lg border border-[#F2B84B]/30 p-3">{t[trading.error]||t.connectionError} <button onClick={()=>trading.refresh()}>{t.retry}</button></div>}{trading?.loading && <p role="status">{t.loading}</p>}{!trading?.loading && !markets.length && <p>{t.emptyMarkets}</p>}</div>}
      <CategoryRail activeCat={activeCat} onSelectCat={setActiveCat} />

      {isTrending ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-8">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-[#F2B84B]/10 flex items-center justify-center">
                <Flame className="w-4 h-4 text-[#F2B84B]" />
              </span>
              <span className="text-sm md:text-base text-[#202833] dark:text-[#ECEDEF] font-semibold">
              {authoritative?t.browse:t.featured}
              </span>
            </div>
            <span className="text-[10px] uppercase tracking-[0.16em] text-[#7C8796] dark:text-[#687486]">{t.markets(featured.length)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            {featured.map((m) => <FeaturedCard key={m.id} m={m} onOpen={openMarket} />)}
          </div>
        </div>
      ) : (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 pt-8">
          <div className="flex items-end justify-between gap-4 mb-5 pb-4 border-b border-[#E4E7EC] dark:border-[#1C242E]">
            <h2 className="font-display-en text-xl md:text-2xl leading-none" style={{ fontWeight: 700 }}>
              {lang === 'km' ? activeCatObj?.labelKm : activeCatObj?.label}
            </h2>
            <span className="px-2.5 py-1 rounded-full bg-[#E9EDF1] dark:bg-[#121922] text-[10px] text-[#5B6472] dark:text-[#8994A4] font-mono">{t.markets(gridList.length)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {gridList.map((m) => <MarketCard key={m.id} m={m} onOpen={openMarket} />)}
          </div>
        </main>
      )}

      {isTrending && gridList.length>0 && <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{gridList.map(m=><MarketCard key={m.id} m={m} onOpen={openMarket}/>)}</div>}
      {authoritative && trading?.markets.length===25 && <div className="max-w-7xl mx-auto px-4 pb-5"><button onClick={()=>trading.setAfter(trading.markets.at(-1).id)}>{t.more}</button></div>}
      {selectedMarketId && <DetailPanel marketId={selectedMarketId} onClose={() => dispatch({ type: 'CLOSE_DETAIL' })} />}
      {showAuth && <AuthModal mode={authMode} onModeChange={setAuthMode} onClose={() => setShowAuth(false)} />}
      {showTopUp && <TopUpModal onClose={() => setShowTopUp(false)} />}
      {showPositions && <PositionsPanel onClose={() => setShowPositions(false)} onOpenMarket={openMarket} />}
    </div>
  );
}
