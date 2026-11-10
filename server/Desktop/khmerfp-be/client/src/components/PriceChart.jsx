import React from 'react';

export default function PriceChart({ series, width = 320, height = 80, color = '#33C7A6' }) {
  if (!series || series.length < 2) {
    return (
      <div className="w-full h-20 flex items-center justify-center text-[10px] text-[#5B6472] dark:text-[#7C8697]">
        Waiting for price data…
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

function points(pts, w, h) {
  return `${pts} ${w},${h} 0,${h}`;
}