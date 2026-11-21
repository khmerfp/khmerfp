import React from 'react';

export default function PriceChart({ series, tradeSamples, width = 320, height = 80, color = '#33C7A6', emptyLabel = 'Waiting for price data' }) {
  if (tradeSamples) return <ExecutedTradeChart samples={tradeSamples} width={width} height={height} color={color} emptyLabel={emptyLabel} />;
  if (!series || series.length < 2) {
    return (
      <div className="w-full h-20 flex items-center justify-center text-[10px] text-[#5B6472] dark:text-[#7C8697]">
        {emptyLabel}
      </div>
    );
  }
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min || 1;
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={points(pts, width, height)} fill="url(#price-fill)" stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ExecutedTradeChart({ samples, width, height, color, emptyLabel }) {
  const trades = samples.filter(sample => /^\d+$/.test(sample.price_cents) && Number(sample.price_cents) <= 100 && Number.isFinite(Date.parse(sample.created_at)))
    .slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  if (!trades.length) return <div className="w-full h-20 flex items-center justify-center text-[10px] text-[#7C8697]">{emptyLabel}</div>;
  const first = Date.parse(trades[0].created_at), last = Date.parse(trades.at(-1).created_at);
  const coordinates = trades.map(trade => ({
    x: last === first ? width / 2 : 8 + (Date.parse(trade.created_at) - first) / (last - first) * (width - 16),
    y: 8 + (100 - Number(trade.price_cents)) / 100 * (height - 16),
  }));
  // Step only at real fill timestamps. A 1-cent move stays 1% of the price scale.
  const path = coordinates.map((point, index) => index === 0 ? `M${point.x},${point.y}` : `H${point.x}V${point.y}`).join(' ');
  return <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Executed trade prices, zero to one hundred cents" data-trade-ids={trades.map(trade => trade.id).join(',')}>
    <text x="2" y="8" fill="#7C8697" fontSize="7">100¢</text>
    <text x="2" y={height - 1} fill="#7C8697" fontSize="7">0¢</text>
    {trades.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth="1.5" />}
    {coordinates.map((point, index) => <circle key={trades[index].id} cx={point.x} cy={point.y} r="2" fill={color}><title>{trades[index].price_cents}¢ · {new Date(trades[index].created_at).toISOString()}</title></circle>)}
  </svg>;
}

function points(pts, w, h) {
  return `${pts} ${w},${h} 0,${h}`;
}
