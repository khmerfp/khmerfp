import React from 'react';
import { useApp } from '../state/AppContext.jsx';
import { tradingLabels } from '../lib/tradingText.js';
import { MarketDisclosure } from './MarketTradingViews.jsx';
import PriceChart from './PriceChart.jsx';

export default function TradingPriceHistory() {
  const { trading, lang } = useApp(), t = tradingLabels(lang);
  return <MarketDisclosure data-price-history data-market-id={trading.book?.marketId} data-token-id={trading.book?.tokenId} data-snapshot-id={trading.book?.snapshotId} className="rounded-xl border border-[#E4E7EC] dark:border-[#212832] p-3" title={t.priceHistory}>
    <p className="text-[10px] text-[#7C8697] mb-2">{t.predictionPrices}</p>
    <PriceChart tradeSamples={(trading.book?.trades || []).slice().reverse()} emptyLabel={t.noChart} />
  </MarketDisclosure>;
}
