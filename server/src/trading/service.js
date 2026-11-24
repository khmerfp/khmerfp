import { createCapabilityClient, requireTradingSession } from '../../../packages/ledger/src/capabilities.js';
export class TradingApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export function integer(value, name, maximum = 9223372036854775807n) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > maximum) throw new TradingApiError(`INVALID_${name}`);
  return BigInt(value);
}
export function createCustodialTradingService({
  pool,
  reads,
  environment = process.env.NODE_ENV
}) {
  if (!['test', 'development'].includes(environment) || ['production', 'staging'].includes(process.env.NODE_ENV)) throw new TradingApiError('TRADING_DISABLED', 503);
  const call = createCapabilityClient(pool, {environment});
  function services(session) {
    const actor = requireTradingSession(session);
    return {
      actor,
      trading: {
        place: (_, key, request) => call('order',[actor.sessionHash,'PLACE',key,JSON.stringify(request, (_, value) => typeof value === 'bigint' ? value.toString() : value)]),
        placeMarket: (_, key, request) => call('order',[actor.sessionHash,'PLACE_MARKET',key,JSON.stringify(request, (_, value) => typeof value === 'bigint' ? value.toString() : value)]),
        cancel: (_, key, orderId) => call('order',[actor.sessionHash,'CANCEL',key,JSON.stringify({orderId})]),
      },
      quotes: {estimate: (_, request) => call('quote',[actor.sessionHash,JSON.stringify(request, (_, value) => typeof value === 'bigint' ? value.toString() : value)],{readOnly:true})},
      lifecycle: {status: (_, key) => call('status',[actor.sessionHash,key],{readOnly:true})},
    };
  }
  function terms(body) {
    const allowed = ['marketId', 'tokenId', 'side', 'quantity', 'priceCents', 'maxSpendCents', 'orderType'];
    if (!body || typeof body !== 'object' || Object.keys(body).some(k => !allowed.includes(k))) throw new TradingApiError('INVALID_ORDER_FIELDS');
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.marketId || '') || !['BUY', 'SELL'].includes(body.side)) throw new TradingApiError('INVALID_MARKET_OR_SIDE');
    const quantity = integer(body.quantity, 'QUANTITY');
    if (quantity % 1000000n) throw new TradingApiError('WHOLE_SHARES_REQUIRED');
    const result = {
      marketId: body.marketId,
      tokenId: integer(body.tokenId, 'TOKEN'),
      side: body.side,
      quantity,
      priceCents: integer(body.priceCents, 'PRICE', 99n)
    };
    if (body.maxSpendCents !== undefined) result.maxSpendCents = integer(body.maxSpendCents, 'BUDGET');
    return result;
  }
  return {
    reads,
    async place(userId, key, body) {
      const {
          actor,
          trading
        } = services(userId),
        parsed = terms(body);
      if (!['LIMIT', 'MARKET'].includes(body.orderType)) throw new TradingApiError('ORDER_TYPE_REQUIRED');
      if (body.orderType === 'MARKET' && body.side === 'BUY' && !parsed.maxSpendCents) throw new TradingApiError('SPENDING_CAP_REQUIRED');
      const accounts = await reads.accounts(actor, String(parsed.tokenId));
      if (!accounts.cashAccountId || !accounts.positionAccountId) throw new TradingApiError('TRADING_ACCOUNT_NOT_PROVISIONED', 409);
      const request = {
        ...parsed,
        cashAccountId: accounts.cashAccountId,
        positionAccountId: accounts.positionAccountId
      };
      return body.orderType === 'MARKET' ? trading.placeMarket(actor, key, request) : trading.place(actor, key, request);
    },
    async quote(userId, body) {
      const {
        actor,
        quotes
      } = services(userId);
      return quotes.estimate(actor, terms(body));
    },
    async cancel(userId, key, id) {
      const {
        actor,
        trading
      } = services(userId);
      integer(id, 'ORDER');
      if (!(await reads.ownsOrder(actor, id)).owned) throw new TradingApiError('ORDER_NOT_FOUND', 404);
      return trading.cancel(actor, key, id);
    },
    async status(userId, key) {
      const {
        actor,
        lifecycle
      } = services(userId);
      return lifecycle.status(actor, key);
    }
  };
}
