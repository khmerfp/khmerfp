import { useState, useRef, useEffect } from 'react';
import { custodialEnabled, tradingRequest, subscribeTrading } from '../services/custodialTrading.js';

// One shared session-bound workspace powers the original platform components.
export function useTradingWorkspace(userId, dispatch) {
  const [marketId, setMarket] = useState(null),
    [claimId, setClaim] = useState(null),
    [data, setData] = useState({}),
    [error, setError] = useState(''),
    [connection, setConnection] = useState('Connecting'),
    [busyCancel, setBusyCancel] = useState(null),
    [clock, setClock] = useState(Date.now()),
    [after, setAfter] = useState(''),
    [before, setBefore] = useState(null),
    [openOnly, setOpenOnly] = useState(false),
    [pendingCancels, setPendingCancels] = useState({});
  const refreshRef = useRef(() => {}),
    cancelFlight = useRef(false),
    actorRef = useRef(userId),
    serverClock = useRef(null);
  actorRef.current = userId;
  const scope = `${userId}:${marketId}:${claimId}:${after}:${before}:${openOnly}`;
  const visible = data.scope === scope ? data : {};
  useEffect(() => {
    const id = setInterval(() => setClock(serverClock.current ? serverClock.current.time + performance.now() - serverClock.current.received : Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!custodialEnabled) return;
    let active = true,
      inflight = false,
      again = false,
      timer;
    const controller = new AbortController();
    async function refresh() {
      if (!active) return;
      if (inflight) {
        again = true;
        return;
      }
      inflight = true;
      try {
        const get = path => tradingRequest(path, {
          signal: controller.signal
        });
        const [markets, portfolio, orders, trades, detail, rounds] = await Promise.all([get(`/markets?view=current&after=${after}`), userId ? get('/me/portfolio') : null, userId ? get(`/me/orders?state=${openOnly ? 'open' : 'all'}${before ? '&before=' + before : ''}`) : null, userId ? get('/me/trades') : null, marketId ? get(`/markets/${marketId}`) : null, marketId ? get(`/markets/${marketId}/rounds`) : null]);
        const claim = detail?.market?.claims.find(c => String(c.outcome_id) + ':' + c.polarity === claimId) || detail?.market?.claims.find(c => c.polarity === 'YES') || detail?.market?.claims[0];
        const book = claim ? await get(`/markets/${marketId}/book/${claim.token_id}`) : null;
        if (!active) return;
        serverClock.current = { time: Date.parse(book?.serverTime || markets.serverTime), received: performance.now() };
        setClock(serverClock.current.time);
        setPendingCancels(previous => {
          let changed = false;
          const next = {
            ...previous
          };
          for (const order of orders?.orders || []) if (!['OPEN', 'PARTIAL', 'PENDING'].includes(order.status)) {
            const key = `${userId}:${order.id}`;
            if (next[key]) {
              delete next[key];
              changed = true;
              sessionStorage.removeItem(`khmerfp-cancel:${userId}:${order.id}`);
            }
          }
          return changed ? next : previous;
        });
        setData({
          scope,
          userId,
          markets: markets.markets,
          portfolio,
          orders: orders?.orders || [],
          trades: trades?.trades || [],
          market: detail?.market,
          claim,
          book,
          rounds: rounds?.rounds || []
        });
        setError('');
        dispatch({
          type: 'SET_TRADING_BALANCE',
          value: userId ? {
            userId,
            available: portfolio?.cash?.available ?? null
          } : null
        });
      } catch (e) {
        if (active && e.name !== 'AbortError') {
          // A failed refresh cannot leave old balances, orders or executable depth
          // looking current. Recovery always loads a complete new snapshot.
          setError(e.status === 401 ? 'sessionExpired' : 'connectionError');
          setData({});
          dispatch({ type: 'SET_TRADING_BALANCE', value: null });
        }
      } finally {
        inflight = false;
        if (active && again) {
          again = false;
          timer = setTimeout(refresh, 100);
        }
      }
    }
    refreshRef.current = refresh;
    void refresh();
    // Poll fallback recovers missed delivery; it never executes or mutates accounting.
    const fallback = setInterval(refresh, 10000);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      clearInterval(fallback);
    };
  }, [scope, userId, marketId, claimId, after, before, openOnly, dispatch]);
  // Subscription identity follows the session, not market/ticket navigation.
  useEffect(() => {
    if (!custodialEnabled) return;
    let notification;
    const invalidate = () => {
      clearTimeout(notification);
      notification = setTimeout(() => refreshRef.current(), 150);
    };
    const stopPublic = subscribeTrading(false, invalidate, setConnection);
    const stopPrivate = userId ? subscribeTrading(true, invalidate, setConnection) : () => {};
    return () => {
      clearTimeout(notification);
      stopPublic();
      stopPrivate();
    };
  }, [userId]);
  async function cancel(id) {
    if (cancelFlight.current || pendingCancels[`${userId}:${id}`] === 'ACCEPTED') return;
    cancelFlight.current = true;
    setBusyCancel(id);
    setPendingCancels(previous => ({
      ...previous,
      [`${userId}:${id}`]: 'PENDING'
    }));
    const keyName = `khmerfp-cancel:${userId}:${id}`,
      key = sessionStorage.getItem(keyName) || crypto.randomUUID();
    sessionStorage.setItem(keyName, key);
    try {
      await tradingRequest(`/orders/${id}/cancel`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': key
        },
        body: '{}'
      });
      setPendingCancels(previous => ({
        ...previous,
        [`${userId}:${id}`]: 'ACCEPTED'
      }));
      if (actorRef.current !== userId) return;
      setError('cancellationPending');
      refreshRef.current();
    } catch (e) {
      setPendingCancels(previous => ({
        ...previous,
        [`${userId}:${id}`]: 'UNCERTAIN'
      }));
      if (actorRef.current === userId) setError(e.message);
    } finally {
      cancelFlight.current = false;
      setBusyCancel(null);
    }
  }
  const privateData = userId && data.userId === userId ? data : {};
  return {
    ...visible,
    markets: data.markets || [],
    marketId,
    claimId,
    portfolio: privateData.portfolio,
    orders: privateData.orders || [],
    trades: privateData.trades || [],
    userId,
    clock,
    error,
    connection,
    after,
    before,
    openOnly,
    busyCancel,
    pendingCancels,
    setMarket,
    setClaim,
    setAfter,
    setBefore,
    setOpenOnly,
    setError,
    refresh: () => refreshRef.current(),
    cancel,
    loading: custodialEnabled && !data.markets && !error,
    enabled: custodialEnabled
  };
}
