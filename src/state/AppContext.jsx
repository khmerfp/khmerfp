import React, { createContext, useContext, useEffect, useReducer, useRef, useCallback } from 'react';
import { SEED_MARKETS } from '../data/markets.js';
import { METAL_MARKETS, fetchMetalPriceOz } from '../data/metals.js';
import { BTC_SEED_PRICE, BTC_ROUND_SECONDS, RESULTS_DISPLAY_MS } from '../lib/constants.js';
import { genMarketBook } from '../lib/orderbook.js';
import { scheduleBounds, findWinningOption } from '../lib/schedule.js';
import {
  dailyRoundBounds,
  monthlyRoundBounds,
  annualRoundBounds,
  fiveYearRoundBounds,
  goldMarketStatus,
} from '../lib/gold.js';

const AppContext = createContext(null);

function genSeries(base, n = 24, vol = 3) {
  const arr = [base];
  for (let i = 1; i < n; i++) {
    const next = Math.min(96, Math.max(4, arr[i - 1] + (Math.random() - 0.48) * vol));
    arr.push(Math.round(next));
  }
  return arr;
}

function computeRoundBounds(fromMs) {
  const now = fromMs ? new Date(fromMs) : new Date();
  const start = new Date(now.getTime());
  start.setSeconds(0, 0);
  start.setMinutes(Math.floor(now.getMinutes() / 5) * 5);
  const end = new Date(start.getTime() + BTC_ROUND_SECONDS * 1000);
  return { startAt: start.getTime(), endAt: end.getTime() };
}

function initMarketsState() {
  const markets = SEED_MARKETS.map((m) => {
    const copy = { ...m };
    if (copy.type === 'multi') copy.options = copy.options.map((o) => ({ ...o }));
    copy.series = genSeries(copy.yes != null ? copy.yes : 50);
    if (copy.basePrice != null) copy.currentPrice = copy.basePrice;
    return copy;
  });
  const books = {};
  markets.forEach((m) => {
    if (m.type === 'multi') {
      books[m.id] = { options: {} };
      m.options.forEach((o) => { books[m.id].options[o.id] = genMarketBook(o.yes); });
    } else {
      books[m.id] = genMarketBook(m.yes);
    }
  });
  const schedules = {};
  markets.filter((m) => m.schedule).forEach((m) => {
    schedules[m.id] = { currentRound: null, history: [], lastResult: null, showResults: false, resultsUntil: 0 };
    seedScheduleHistory(m, schedules[m.id]);
  });
  return { markets, books, schedules };
}

function seedScheduleHistory(market, sched) {
  const rounds = [];
  let backMs = Date.now();
  let price = market.basePrice * (0.97 + Math.random() * 0.06);
  const numBack = market.schedule === 'weekly-friday' ? 8 : 6;
  for (let i = 0; i < numBack; i++) {
    const b = scheduleBounds(market.schedule, backMs);
    const openPrice = price;
    const move = (Math.random() - 0.48) * market.volatility * 6;
    const closePrice = Math.max(0.01, openPrice + move);
    rounds.push({
      startAt: b.startAt, endAt: b.endAt, openPrice, closePrice,
      outcome: findWinningOption(market, closePrice), settledAt: b.endAt,
    });
    price = closePrice;
    backMs = b.startAt - 1000;
  }
  sched.history = rounds;
  const cb = scheduleBounds(market.schedule);
  market.currentPrice = price;
  sched.currentRound = { startAt: cb.startAt, endAt: cb.endAt, openPrice: price };
}

function seedBtcHistory() {
  const rounds = [];
  const now = Date.now();
  let basePrice = BTC_SEED_PRICE * (0.985 + Math.random() * 0.015);
  for (let i = 6; i >= 1; i--) {
    const { startAt, endAt } = computeRoundBounds(now - i * BTC_ROUND_SECONDS * 1000);
    const openPrice = basePrice;
    const closePrice = openPrice * (1 + (Math.random() - 0.48) * 0.0045);
    rounds.push({
      startAt, endAt, openPrice, closePrice,
      outcome: closePrice >= openPrice ? 'yes' : 'no', settledAt: endAt,
    });
    basePrice = closePrice;
  }
  const bounds = computeRoundBounds();
  return {
    price: BTC_SEED_PRICE,
    sawRealPrice: false,
    round: { startAt: bounds.startAt, endAt: bounds.endAt, openPrice: basePrice },
    lastResult: null,
    history: rounds.reverse(),
    showResults: false,
    resultsUntil: 0,
  };
}

function roundBoundsFor(market, nowMs, status) {
  if (!status.open) return null;
  switch (market.roundKind) {
    case '5m':
    case '60m': {
      const ms = market.roundMs;
      const start = Math.floor(nowMs / ms) * ms;
      return { startAt: start, endAt: start + ms };
    }
    case 'daily': return dailyRoundBounds(nowMs);
    case 'monthly': return monthlyRoundBounds(nowMs);
    case '12mo': return annualRoundBounds(nowMs);
    case '60mo': return fiveYearRoundBounds(nowMs);
    default: return null;
  }
}

const initialState = (() => {
  const { markets, books, schedules } = initMarketsState();
  return {
    lang: 'km',
    themeMode: 'system',
    users: [],
    user: null,
    balances: {},
    positions: {},
    markets,
    books,
    schedules,
    btc: seedBtcHistory(),
    toast: null,
    selectedMarketId: null,
    selectedSide: 'yes',
    selectedOptionId: null,
    orderType: 'market',
    metals: {},
    goldStatus: { open: true, nextOpenMs: null, nextCloseMs: null },
  };
})();

function reducer(state, action) {
  switch (action.type) {
    case 'SET_LANG': return { ...state, lang: action.lang };
    case 'SET_THEME': return { ...state, themeMode: action.mode };
    case 'REGISTER_USER': {
      const { user } = action;
      return {
        ...state,
        users: [...state.users, action.record],
        user,
        balances: { ...state.balances, [user.email]: 0 },
        positions: { ...state.positions, [user.email]: [] },
      };
    }
    case 'LOGIN': return { ...state, user: action.user };
    case 'LOGOUT': return { ...state, user: null };
    case 'SET_BALANCE': return { ...state, balances: { ...state.balances, [action.email]: action.balance } };
    case 'ADD_BALANCE': return {
      ...state,
      balances: { ...state.balances, [action.email]: +((state.balances[action.email] || 0) + action.delta).toFixed(2) },
    };
    case 'CREDIT_POSITION': {
      const { email, marketId, side, qty, price, optionId } = action;
      const list = state.positions[email] || [];
      const existing = list.find((p) => p.marketId === marketId && p.side === side && p.optionId === optionId);
      let updated;
      if (existing) {
        updated = list.map((p) => (p.marketId === marketId && p.side === side && p.optionId === optionId)
          ? { ...p, qty: p.qty + qty, price: Math.round((p.price * p.qty + price * qty) / (p.qty + qty)) }
          : p);
      } else {
        updated = [...list, { marketId, side, qty, price: Math.round(price), optionId: optionId || null }];
      }
      return { ...state, positions: { ...state.positions, [email]: updated } };
    }
    case 'REMOVE_POSITIONS': {
      const { email, marketId } = action;
      const list = state.positions[email] || [];
      return { ...state, positions: { ...state.positions, [email]: list.filter((p) => p.marketId !== marketId) } };
    }
    case 'UPDATE_BOOK': {
      const { marketId, side, newBook, optionId } = action;
      if (optionId) {
        return {
          ...state,
          books: {
            ...state.books,
            [marketId]: {
              ...state.books[marketId],
              options: { ...state.books[marketId].options, [optionId]: newBook },
            },
          },
        };
      }
      return {
        ...state,
        books: {
          ...state.books,
          [marketId]: { ...state.books[marketId], [side]: newBook },
        },
      };
    }
    case 'UPDATE_MARKETS': return { ...state, markets: action.markets };
    case 'UPDATE_BTC': return { ...state, btc: { ...state.btc, ...action.patch } };
    case 'UPDATE_SCHEDULE': {
      return {
        ...state,
        schedules: { ...state.schedules, [action.marketId]: { ...state.schedules[action.marketId], ...action.patch } },
      };
    }
    case 'SET_TOAST': return { ...state, toast: action.toast };
    case 'OPEN_DETAIL': return {
      ...state, selectedMarketId: action.marketId,
      selectedSide: 'yes', orderType: 'market',
      selectedOptionId: action.optionId || null,
    };
    case 'CLOSE_DETAIL': return { ...state, selectedMarketId: null };
    case 'SET_SIDE': return { ...state, selectedSide: action.side };
    case 'SET_ORDER_TYPE': return { ...state, orderType: action.orderType };
    case 'SET_OPTION': return { ...state, selectedOptionId: action.optionId };
    case 'SET_GOLD_STATUS':
      return { ...state, goldStatus: action.status };

    case 'TICK_METAL': {
      const { market, priceOz } = action;
      const prev = state.metals[market.id];
      const now = Date.now();
      const status = state.goldStatus;
      if (!status.open && !prev) return state;
      const bounds = roundBoundsFor(market, now, status);
      if (!bounds) return state;

      let entry = prev || {
        priceOz, history: [],
        round: { startAt: bounds.startAt, endAt: bounds.endAt, openPrice: priceOz },
        lastResult: null, past: [],
      };

      if (status.open && now >= entry.round.endAt) {
        const closePrice = entry.priceOz ?? entry.round.openPrice;
        const outcome = closePrice >= entry.round.openPrice ? 'yes' : 'no';
        const result = {
          startAt: entry.round.startAt, endAt: entry.round.endAt,
          openPrice: entry.round.openPrice, closePrice, outcome, settledAt: now,
        };
        entry = {
          ...entry,
          priceOz,
          round: { startAt: bounds.startAt, endAt: bounds.endAt, openPrice: closePrice },
          lastResult: result,
          past: [result, ...entry.past].slice(0, 50),
        };
      } else {
        entry = { ...entry, priceOz };
      }

      entry.history = [...entry.history, priceOz].slice(-200);
      return { ...state, metals: { ...state.metals, [market.id]: entry } };
    }

    default: return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const btcPriceRef = useRef(BTC_SEED_PRICE);
  const btcInitRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const isDark = state.themeMode === 'dark' || (state.themeMode === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', isDark);
    };
    apply();
    const handler = () => apply();
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, [state.themeMode]);

  useEffect(() => {
    document.body.classList.toggle('km', state.lang === 'km');
  }, [state.lang]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      let price = null;
      try {
        const res = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');
        const data = await res.json();
        const parsed = parseFloat(data?.data?.amount);
        if (Number.isFinite(parsed) && parsed > 0) price = parsed;
      } catch {}
      if (cancelled) return;
      if (price == null) price = Math.max(1000, btcPriceRef.current * (1 + (Math.random() - 0.5) * 0.0012));
      else state.btc.sawRealPrice = true;
      btcPriceRef.current = price;
      const patch = { price };
      if (!btcInitRef.current) {
        btcInitRef.current = true;
        patch.round = { ...state.btc.round, openPrice: price };
      } else if (state.btc.round.openPrice == null) {
        patch.round = { ...state.btc.round, openPrice: price };
      }
      dispatch({ type: 'UPDATE_BTC', patch });
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const status = goldMarketStatus();
      dispatch({ type: 'SET_GOLD_STATUS', status });
      for (const m of METAL_MARKETS) {
        const priceOz = await fetchMetalPriceOz(m.metal, m.basePriceUsdPerOz);
        if (cancelled) return;
        dispatch({ type: 'TICK_METAL', market: m, priceOz });
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const markets = state.markets.map((m) => {
        if (!m.schedule) return m;
        const cur = m.currentPrice ?? m.basePrice;
        const drift = (Math.random() - 0.5) * (m.volatility || 1) * 0.3;
        return { ...m, currentPrice: Math.max(0.01, cur + drift) };
      });
      dispatch({ type: 'UPDATE_MARKETS', markets });
    }, 5000);
    return () => clearInterval(id);
  }, [state.markets]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();

      if (state.btc.round.endAt > 0 && now >= state.btc.round.endAt) {
        const openPrice = state.btc.round.openPrice;
        const closePrice = state.btc.price;
        if (openPrice != null) {
          const outcome = closePrice >= openPrice ? 'yes' : 'no';
          const result = {
            startAt: state.btc.round.startAt, endAt: state.btc.round.endAt,
            openPrice, closePrice, outcome, settledAt: now,
          };
          const bounds = computeRoundBounds();
          dispatch({
            type: 'UPDATE_BTC',
            patch: {
              history: [result, ...state.btc.history].slice(0, 100),
              lastResult: result,
              showResults: true,
              resultsUntil: now + RESULTS_DISPLAY_MS,
              round: { startAt: bounds.startAt, endAt: bounds.endAt, openPrice: closePrice },
            },
          });
          if (state.user) {
            const list = state.positions[state.user.email] || [];
            const pos = list.find((p) => p.marketId === 'btc5m');
            if (pos) {
              const won = pos.side === outcome;
              const payout = won ? pos.qty : 0;
              if (payout > 0) dispatch({ type: 'ADD_BALANCE', email: state.user.email, delta: payout });
              dispatch({ type: 'REMOVE_POSITIONS', email: state.user.email, marketId: 'btc5m' });
            }
          }
        }
      }

      Object.keys(state.schedules).forEach((mid) => {
        const s = state.schedules[mid];
        if (!s?.currentRound) return;
        if (now >= s.currentRound.endAt) {
          const m = state.markets.find((x) => x.id === mid);
          if (!m) return;
          const closePrice = m.currentPrice ?? m.basePrice;
          const outcome = findWinningOption(m, closePrice);
          const result = {
            startAt: s.currentRound.startAt, endAt: s.currentRound.endAt,
            openPrice: s.currentRound.openPrice, closePrice, outcome, settledAt: now,
          };
          const nb = scheduleBounds(m.schedule);
          dispatch({
            type: 'UPDATE_SCHEDULE',
            marketId: mid,
            patch: {
              history: [result, ...s.history].slice(0, 30),
              lastResult: result,
              showResults: true,
              resultsUntil: now + RESULTS_DISPLAY_MS,
              currentRound: { startAt: nb.startAt, endAt: nb.endAt, openPrice: closePrice },
            },
          });
          if (state.user) {
            const list = state.positions[state.user.email] || [];
            const userPos = list.filter((p) => p.marketId === mid);
            if (userPos.length) {
              let payout = 0;
              userPos.forEach((pos) => { if (pos.optionId === outcome) payout += pos.qty; });
              if (payout > 0) dispatch({ type: 'ADD_BALANCE', email: state.user.email, delta: payout });
              dispatch({ type: 'REMOVE_POSITIONS', email: state.user.email, marketId: mid });
            }
          }
        }
        if (s.showResults && now >= s.resultsUntil) {
          dispatch({ type: 'UPDATE_SCHEDULE', marketId: mid, patch: { showResults: false } });
        }
      });

      if (state.btc.showResults && now >= state.btc.resultsUntil) {
        dispatch({ type: 'UPDATE_BTC', patch: { showResults: false } });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (!state.toast) return;
    const id = setTimeout(() => dispatch({ type: 'SET_TOAST', toast: null }), 3200);
    return () => clearTimeout(id);
  }, [state.toast]);

  const showToast = useCallback((type, text) => dispatch({ type: 'SET_TOAST', toast: { type, text } }), []);

  const api = {
    ...state,
    dispatch,
    showToast,
    btcPriceRef,
    setLang: (lang) => dispatch({ type: 'SET_LANG', lang }),
    setThemeMode: (mode) => dispatch({ type: 'SET_THEME', mode }),
  };
  return <AppContext.Provider value={api}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}