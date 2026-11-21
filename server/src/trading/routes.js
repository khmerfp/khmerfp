import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getAuthenticatedUser } from '../services/authSessionService.js';
import { isBrowserOriginAllowed } from '../config/origins.js';
import { createFixedWindowRateLimiter } from '../middleware/statusRateLimit.js';
import { TradingApiError, integer } from './service.js';
export function createCustodialTradingRouter({
  service,
  authGuard = requireAuth,
  lookupUser = getAuthenticatedUser,
  enabled = () => process.env.CUSTODIAL_TRADING_LOCAL === 'true' && ['development', 'test'].includes(process.env.NODE_ENV),
  pollMs = 1000
} = {}) {
  const router = Router();
  const streams = new Map();
  const sendError = (res, error, requestId) => {
    const known = error instanceof TradingApiError;
    const constraint = ['P0001', '23514', '23505', '42501', '22003'].includes(error.code);
    res.status(known ? error.status : constraint ? 409 : 503).json({
      error: {
        code: known ? error.code : constraint ? 'ORDER_REJECTED' : 'TRADING_UNAVAILABLE',
        message: known ? 'Please review this request.' : constraint ? 'Order rejected. Refresh balances, market status and price protection.' : 'Trading is temporarily unavailable.',
        requestId
      }
    });
  };
  const handle = fn => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      sendError(res, error, req.requestId);
    }
  };
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!enabled() || !service || ['production', 'staging'].includes(process.env.NODE_ENV)) return res.status(503).json({
      error: {
        code: 'TRADING_DISABLED',
        requestId: req.requestId
      }
    });
    next();
  });
  const publicLimit = createFixedWindowRateLimiter({
    limit: 240,
    windowMs: 60000,
    message: 'Too many public market requests.'
  });
  router.use((req, res, next) => req.path.startsWith('/markets') || req.path === '/events' ? publicLimit(req, res, next) : next());
  router.use((req, res, next) => {
    if (req.method !== 'GET' && !isBrowserOriginAllowed(req.get('origin'))) return res.status(403).json({
      error: {
        code: 'ORIGIN_REJECTED',
        requestId: req.requestId
      }
    });
    next();
  });
  const uuid = value => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')) throw new TradingApiError('INVALID_MARKET');
    return value;
  };
  const page = req => {
    const before = req.query.before ?? null;
    if (before !== null) integer(before, 'CURSOR');
    const limit = req.query.limit ?? '25';
    integer(limit, 'LIMIT', 100n);
    return [before, Number(limit)];
  };
  const key = req => {
    const value = req.get('Idempotency-Key');
    if (!/^[A-Za-z0-9:_-]{1,120}$/.test(value || '')) throw new TradingApiError('IDEMPOTENCY_KEY_REQUIRED');
    return value;
  };
  router.get('/markets', handle(async (req, res) => {
    const after = req.query.after ?? '';
    if (after) uuid(after);
    const limit = req.query.limit ?? '25';
    integer(limit, 'LIMIT', 100n);
    res.json(await service.reads.markets(after, Number(limit), req.query.view === 'current'));
  }));
  router.get('/markets/:id', handle(async (req, res) => {
    const data = await service.reads.market(uuid(req.params.id));
    if (!data.market) throw new TradingApiError('MARKET_NOT_FOUND', 404);
    res.json(data);
  }));
  router.get('/markets/:id/rounds', handle(async (req, res) => res.json(await service.reads.rounds(uuid(req.params.id)))));
  router.get('/markets/:id/book/:tokenId', handle(async (req, res) => {
    integer(req.params.tokenId, 'TOKEN');
    const viewer = await lookupUser(req);
    res.vary('Cookie');
    res.json(await service.reads.book(uuid(req.params.id), req.params.tokenId, viewer?.id ?? null));
  }));
  // Public and private subscriptions are separate; no raw order events reach the public stream.
  function stream(privateStream) {
    return handle(async (req, res) => {
      const userId = privateStream ? String(req.authUser.id) : null;
      const streamKey = String(req.ip || 'unknown'),
        count = streams.get(streamKey) || 0;
      if (count >= 4) throw new TradingApiError('TOO_MANY_STREAMS', 429);
      streams.set(streamKey, count + 1);
      let closed = false,
        last = '',
        timer,
        deadline;
      const finish = () => {
        if (closed) return;
        streams.set(streamKey, Math.max(0, (streams.get(streamKey) || 1) - 1));
        if (streams.get(streamKey) === 0) streams.delete(streamKey);
        closed = true;
        clearTimeout(timer);
        clearTimeout(deadline);
        if (!res.writableEnded) res.end();
      };
      res.set({
        'Content-Type': 'text/event-stream',
        'X-Accel-Buffering': 'no',
        'Connection': 'keep-alive'
      });
      res.flushHeaders();
      res.on('close', finish);
      deadline = setTimeout(finish, 60000);
      async function tick() {
        if (closed) return;
        try {
          if (privateStream) {
            const current = await lookupUser(req);
            if (!current || String(current.id) !== userId) {
              res.write('event: session-expired\ndata: {}\n\n');
              return finish();
            }
          }
          const value = await service.reads.watermark(userId);
          if (closed) return;
          const id = String(value.revision),
            watermark = `${value.publicSequence}:${value.privateSequence}`;
          if (watermark !== last) {
            last = watermark;
            if (!res.write(`id: ${id}\nevent: snapshot-required\ndata: ${JSON.stringify({
              revision: id,
              publicSequence: value.publicSequence,
              privateSequence: value.privateSequence
            })}\n\n`)) return finish();
          } else res.write(': heartbeat\n\n');
          timer = setTimeout(tick, pollMs);
        } catch {
          finish();
        }
      }
      void tick();
    });
  }
  router.get('/events', stream(false));
  router.use(authGuard);
  router.use(createFixedWindowRateLimiter({
    limit: 240,
    windowMs: 60000,
    message: 'Too many private trading requests.',
    keyForRequest: req => String(req.authUser.id)
  }));
  const mutationLimit = createFixedWindowRateLimiter({
    limit: 30,
    windowMs: 60000,
    message: 'Too many order requests.',
    keyForRequest: req => String(req.authUser.id)
  });
  router.use((req, res, next) => req.method === 'POST' && req.path !== '/quotes' ? mutationLimit(req, res, next) : next());
  router.get('/me/events', stream(true));
  router.get('/me/portfolio', handle(async (req, res) => res.json(await service.reads.portfolio(String(req.authUser.id)))));
  router.get('/me/orders', handle(async (req, res) => {
    if(req.query.state!==undefined && !['all','open'].includes(req.query.state))throw new TradingApiError('INVALID_ORDER_FILTER');
    res.json(await service.reads.orders(String(req.authUser.id), ...page(req), req.query.state==='open'));
  }));
  router.get('/me/trades', handle(async (req, res) => res.json(await service.reads.trades(String(req.authUser.id), ...page(req)))));
  router.get('/me/commands/:key', handle(async (req, res) => {
    if (!/^[A-Za-z0-9:_-]{1,120}$/.test(req.params.key)) throw new TradingApiError('INVALID_KEY');
    res.json(await service.status(String(req.authUser.id), req.params.key));
  }));
  router.post('/quotes', handle(async (req, res) => res.json(await service.quote(String(req.authUser.id), req.body))));
  router.post('/orders', handle(async (req, res) => res.status(202).json(await service.place(String(req.authUser.id), key(req), req.body))));
  router.post('/orders/:id/cancel', handle(async (req, res) => {
    if (Object.keys(req.body ?? {}).length) throw new TradingApiError('INVALID_CANCEL_FIELDS');
    res.status(202).json(await service.cancel(String(req.authUser.id), key(req), req.params.id));
  }));
  return router;
}
