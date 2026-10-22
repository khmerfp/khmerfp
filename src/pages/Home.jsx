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
  const { lang, markets, selectedMarketId, dispatch } = useApp();
  const t = T[lang];
  const [activeCat, setActiveCat] = useState('trending');
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [showTopUp, setShowTopUp] = useState(false);
  const [showPositions, setShowPositions] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const isTrending = activeCat === 'trending';
  const featured = markets.filter((m) => m.featured).slice(0, 4);
  const gridList = isTrending ? [] : markets.filter((m) => m.cat === activeCat);
  const activeCatObj = CATS.find((c) => c.id === activeCat);

  const openMarket = (id) => {
    const m = markets.find((x) => x.id === id);
    dispatch({ type: 'OPEN_DETAIL', marketId: id, optionId: m?.type === 'multi' ? m.options[0].id : null });
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
      <CategoryRail activeCat={activeCat} onSelectCat={setActiveCat} />

      {isTrending ? (
        <div className="max-w-7xl mx-auto px-4 pt-6">
          <div className="flex items-center gap-2 mb-3">
            <Flame className="w-4 h-4 text-[#F2B84B]" />
            <span className="text-[10px] uppercase tracking-[0.14em] text-[#5B6472] dark:text-[#7C8697] font-medium">
              {t.featured}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            {featured.map((m) => <FeaturedCard key={m.id} m={m} onOpen={openMarket} />)}
          </div>
        </div>
      ) : (
        <main className="max-w-7xl mx-auto px-4 pb-16 pt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display-en text-base md:text-lg" style={{ fontWeight: 500 }}>
              {lang === 'km' ? activeCatObj?.labelKm : activeCatObj?.label}
            </h2>
            <span className="text-[10px] text-[#5B6472] dark:text-[#7C8697] font-mono">{t.markets(gridList.length)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {gridList.map((m) => <MarketCard key={m.id} m={m} onOpen={openMarket} />)}
          </div>
        </main>
      )}

      {selectedMarketId && <DetailPanel marketId={selectedMarketId} onClose={() => dispatch({ type: 'CLOSE_DETAIL' })} />}
      {showAuth && <AuthModal mode={authMode} onModeChange={setAuthMode} onClose={() => setShowAuth(false)} />}
      {showTopUp && <TopUpModal onClose={() => setShowTopUp(false)} />}
      {showPositions && <PositionsPanel onClose={() => setShowPositions(false)} onOpenMarket={openMarket} />}
    </div>
  );
}