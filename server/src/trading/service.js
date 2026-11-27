import { createCapabilityClient, requireTradingSession } from '../../../packages/ledger/src/capabilities.js';

// Application-level trading orchestration.
//
// This layer validates the request shape and resolves accounts belonging to the
// authenticated user. PostgreSQL remains authoritative for market state, funds,
// positions, reservations, idempotency, locking and atomic settlement.
const MAX_BIGINT = 9223372036854775807n;
const SHARE_SCALE = 1000000n;
const MAX_PRICE_CENTS = 99n;
const ENABLED_ENVIRONMENTS = new Set(['test', 'development']);
const DISABLED_ENVIRONMENTS = new Set(['production', 'staging']);
const ORDER_TYPES = new Set(['LIMIT', 'MARKET']);
const ORDER_SIDES = new Set(['BUY', 'SELL']);
const ORDER_FIELDS = new Set([
  'marketId',
  'tokenId',
  'side',
  'quantity',
  'priceCents',
  'maxSpendCents',
  'orderType'
]);
const MARKET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]{0,18}$/;

export class TradingApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export function integer(value, name, maximum = MAX_BIGINT) {
  // Financial values arrive as decimal strings and are converted directly to
  // BigInt. JavaScript Number and floating-point inputs are deliberately rejected.
  if (
    typeof value !== 'string'
    || !POSITIVE_INTEGER_PATTERN.test(value)
    || BigInt(value) > maximum
  ) {
    throw new TradingApiError(`INVALID_${name}`);
  }
  return BigInt(value);
}

function stringifyBigInts(value) {
  return JSON.stringify(
    value,
    (_, item) => typeof item === 'bigint' ? item.toString() : item
  );
}

export function createCustodialTradingService({
  pool,
  reads,
  environment = process.env.NODE_ENV
}) {
  if (
    !ENABLED_ENVIRONMENTS.has(environment)
    || DISABLED_ENVIRONMENTS.has(process.env.NODE_ENV)
  ) {
    throw new TradingApiError('TRADING_DISABLED', 503);
  }

  const call = createCapabilityClient(pool, { environment });

  function services(session) {
    const actor = requireTradingSession(session);

    return {
      actor,
      trading: {
        place: (_, key, request) => call(
          'order',
          [actor.sessionHash, 'PLACE', key, stringifyBigInts(request)]
        ),
        placeMarket: (_, key, request) => call(
          'order',
          [actor.sessionHash, 'PLACE_MARKET', key, stringifyBigInts(request)]
        ),
        cancel: (_, key, orderId) => call(
          'order',
          [actor.sessionHash, 'CANCEL', key, JSON.stringify({ orderId })]
        )
      },
      quotes: {
        estimate: (_, request) => call(
          'quote',
          [actor.sessionHash, stringifyBigInts(request)],
          { readOnly: true }
        )
      },
      lifecycle: {
        status: (_, key) => call(
          'status',
          [actor.sessionHash, key],
          { readOnly: true }
        )
      }
    };
  }
  function terms(body) {
    // Allowlist fields so callers cannot smuggle actors, account IDs or internal
    // settlement instructions into a normal order request.
    if (
      !body
      || typeof body !== 'object'
      || Object.keys(body).some(field => !ORDER_FIELDS.has(field))
    ) {
      throw new TradingApiError('INVALID_ORDER_FIELDS');
    }
    if (
      !MARKET_ID_PATTERN.test(body.marketId || '')
      || !ORDER_SIDES.has(body.side)
    ) {
      throw new TradingApiError('INVALID_MARKET_OR_SIDE');
    }

    const quantity = integer(body.quantity, 'QUANTITY');
    if (quantity % SHARE_SCALE) {
      throw new TradingApiError('WHOLE_SHARES_REQUIRED');
    }

    const result = {
      marketId: body.marketId,
      tokenId: integer(body.tokenId, 'TOKEN'),
      side: body.side,
      quantity,
      priceCents: integer(body.priceCents, 'PRICE', MAX_PRICE_CENTS)
    };

    if (body.maxSpendCents !== undefined) {
      result.maxSpendCents = integer(body.maxSpendCents, 'BUDGET');
    }
    return result;
  }

  return {
    reads,
    async place(session, key, body) {
      const { actor, trading } = services(session);
      const parsed = terms(body);

      if (!ORDER_TYPES.has(body.orderType)) {
        throw new TradingApiError('ORDER_TYPE_REQUIRED');
      }
      if (
        body.orderType === 'MARKET'
        && body.side === 'BUY'
        && !parsed.maxSpendCents
      ) {
        throw new TradingApiError('SPENDING_CAP_REQUIRED');
      }

      // Account ownership comes from the verified session. The browser cannot
      // choose another user's cash or position account.
      const accounts = await reads.accounts(actor, String(parsed.tokenId));
      if (!accounts.cashAccountId || !accounts.positionAccountId) {
        throw new TradingApiError('TRADING_ACCOUNT_NOT_PROVISIONED', 409);
      }

      const request = {
        ...parsed,
        cashAccountId: accounts.cashAccountId,
        positionAccountId: accounts.positionAccountId
      };

      // The database wrapper creates the reservation and persistent matching
      // command in one transaction. A 202 response means accepted, not filled.
      return body.orderType === 'MARKET'
        ? trading.placeMarket(actor, key, request)
        : trading.place(actor, key, request);
    },

    async quote(session, body) {
      const { actor, quotes } = services(session);
      return quotes.estimate(actor, terms(body));
    },

    async cancel(session, key, id) {
      const { actor, trading } = services(session);
      integer(id, 'ORDER');

      if (!(await reads.ownsOrder(actor, id)).owned) {
        throw new TradingApiError('ORDER_NOT_FOUND', 404);
      }
      return trading.cancel(actor, key, id);
    },

    async status(session, key) {
      const { actor, lifecycle } = services(session);
      return lifecycle.status(actor, key);
    }
  };
}
