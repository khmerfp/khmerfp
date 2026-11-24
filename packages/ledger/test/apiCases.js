import {provisionCapabilityRoles} from './capabilityRoles.js';
import {createMatchingCapabilities} from '../../../server/src/trading/capabilityWorkers.js';
import {hashSessionToken} from '../../../server/src/services/authSessionService.js';
import { runExpirationWorker } from '../src/index.js';
import { createAuthRateLimiter } from '../../../server/src/middleware/authRateLimit.js';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createApp } from '../../../server/src/app.js';
import { connectToDatabase, disconnectFromDatabase } from '../../../server/src/config/database.js';
import { hashPassword } from '../../../server/src/services/passwordService.js';
import { createTradingReads } from '../../../server/src/trading/readRepository.js';
import { createCustodialTradingService } from '../../../server/src/trading/service.js';
import { runMatchingWorker } from '../src/matchingWorker.js';
export async function runTradingApiCases(t, {
  admin,
  config,
  registered,
  person,
  sys,
  key,
  reconcile,
  makeClosingMarket,
  makeBrowserRounds
}) {
  assert.equal(config.host, '127.0.0.1');
  assert.equal(process.env.NODE_ENV, 'test');
  const oldFlag = process.env.CUSTODIAL_TRADING_LOCAL;
  process.env.CUSTODIAL_TRADING_LOCAL = 'true';
  const capabilities=await provisionCapabilityRoles(admin,config,'http_test');
  const readPool=capabilities.pools.read;
  const engine=createMatchingCapabilities(capabilities.pools.matching,'test');
  const url = new URL('postgresql://127.0.0.1');
  const authRole='http_auth_'+key().replaceAll('-',''),authPassword=key().replaceAll('-','');
  await admin.query(`CREATE ROLE ${authRole} LOGIN PASSWORD '${authPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
  await admin.query('GRANT SELECT,INSERT,UPDATE ON users,sessions,auth_audit_logs,auth_rate_limits,wallets TO '+authRole);
  await admin.query('GRANT USAGE,SELECT ON SEQUENCE users_id_seq,auth_audit_logs_id_seq,wallets_id_seq TO '+authRole);
  url.username = authRole;
  url.password = authPassword;
  url.port = String(config.port);
  url.pathname = '/' + config.database;
  await connectToDatabase(url.href);
  const reads = createTradingReads(readPool,{privatePool:capabilities.pools.http}),
    service = createCustodialTradingService({
      pool: capabilities.pools.http,
      reads,
      environment: 'test'
    });
  const app = createApp({
    authRateLimiter: createAuthRateLimiter({
      pool: admin,
      maxRequests: 100
    }),
    custodialTradingOptions: {
      service,
      pollMs: 100
    },
    logger: {
      warn() {},
      error() {},
      info() {}
    }
  });
  const server = await new Promise(resolve => {
      const value = app.listen(0, '127.0.0.1', () => resolve(value));
    }),
    origin = `http://127.0.0.1:${server.address().port}`;
  const controller = new AbortController(),
    errors = [];
  const lifecycle = engine;
  const expiration = runExpirationWorker({
    lifecycle,
    matching: engine,
    actor: sys,
    signal: controller.signal,
    pollMs: 25,
    onError: e => errors.push(e.code)
  });
  const worker = runMatchingWorker({
    service: engine,
    actor: sys,
    signal: controller.signal,
    pollMs: 25,
    onError: e => errors.push(e.code)
  });
  const latencies = {
    read: [],
    submit: [],
    quote: [],
    delivery: [],
    recovery: []
  };
  async function request(path, {
    cookie,
    body,
    key: operation,
    method = body ? 'POST' : 'GET'
  } = {}) {
    const begin = performance.now(),
      response = await fetch(origin + '/api/trading' + path, {
        method,
        headers: {
          Origin: origin,
          ...(cookie ? {
            Cookie: cookie
          } : {}),
          ...(body ? {
            'Content-Type': 'application/json'
          } : {}),
          ...(operation ? {
            'Idempotency-Key': operation
          } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000)
      });
    const data = await response.json();
    latencies[path === '/quotes' ? 'quote' : path === '/orders' ? 'submit' : 'read'].push(performance.now() - begin);
    return {
      status: response.status,
      data
    };
  }
  const people = [];
  async function login(p) {
    const row = (await admin.query('SELECT email FROM users WHERE id=$1', [p.actor.slice(5)])).rows[0];
    const secret = 'LocalFixtureOnly!' + key();
    await admin.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await hashPassword(secret), p.actor.slice(5)]);
    const response = await fetch(origin + '/api/auth/login', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: row.email,
        password: secret
      })
    });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const cookie = response.headers.getSetCookie()[0].split(';')[0];
    return {
      ...p,
      cookie,
      session:{userId:p.actor.slice(5),sessionHash:hashSessionToken(cookie.slice(cookie.indexOf('=')+1))},
      email: row.email,
      secret
    };
  }
  const body = (p, m, tok, side, quantity = '1000000', price = '60', orderType = 'LIMIT') => ({
    marketId: m.marketId,
    tokenId: String(tok.id),
    side,
    quantity,
    priceCents: price,
    orderType,
    ...(orderType === 'MARKET' && side === 'BUY' ? {
      maxSpendCents: '600'
    } : {})
  });
  const wait = async (p, id, status) => {
    for (let n = 0; n < 150; n++) {
      const result = await request('/me/orders?limit=100', {
        cookie: p.cookie
      });
      const order = result.data.orders?.find(x => x.id === String(id));
      if (order?.status === status) {
        if (status !== 'OPEN' || (await admin.query("SELECT 1 FROM matching_requests WHERE order_id=$1 AND action='PLACE' AND state='DONE' AND resting='YES'", [id])).rowCount) return order;
      }
      await new Promise(r => setTimeout(r, 25));
    }
    throw new Error('Order did not reach ' + status);
  };
  let firstBuyer, firstSeller, firstMarket, firstToken, firstOrder;
  try {
    await t.test('HTTP read role and production default deny privileged operations', async () => {
      await assert.rejects(readPool.query('UPDATE financial_balance_projections SET reserved=0'), e => e.code === '42501');
      await assert.rejects(createTradingReads(admin).markets('', 25), /read-only database role/);
      assert.equal((await request('/me/portfolio')).status, 401);
      assert.equal((await request('/credit', {
        body: {
          amount: '100'
        }
      })).status, 401);
    });
    await t.test('HTTP reference prices stay unavailable and round-bound independently of prediction fills', async () => {
      for (const market of registered) {
        const result = await request(`/markets/${market.marketId}`);
        assert.equal(result.status, 200);
        const { referencePrice, id, round_key } = result.data.market;
        assert.equal(referencePrice.marketId, id);
        assert.equal(referencePrice.roundKey, round_key);
        assert.equal(referencePrice.kind, market.type === 'CATEGORICAL' ? 'EVENT' : 'NUMERIC');
        assert.equal(referencePrice.status, 'UNAVAILABLE');
        assert.equal(referencePrice.verification, 'NOT_CONFIGURED');
        assert.equal(referencePrice.latest, null);
        assert.equal(referencePrice.opening, null);
        assert.deepEqual(referencePrice.history, []);
      }
    });
    for (const m of registered) for (const tok of [...new Map([m.tokens[0], m.tokens.at(-1)].map(x => [x.id, x])).values()]) await t.test(`HTTP automatic matching and exact private snapshots ${m.type} token ${tok.id}`, async () => {
      const buyer = await login(await person(tok)),
        seller = await login(await person(tok));
      people.push(buyer, seller);
      const beforeBuyer = (await request('/me/portfolio', {
        cookie: buyer.cookie
      })).data.cash.available;
      const sell = await request('/orders', {
        cookie: seller.cookie,
        key: key(),
        body: body(seller, m, tok, 'SELL')
      });
      assert.equal(sell.status, 202, JSON.stringify(sell.data));
      await wait(seller, sell.data.orderId, 'OPEN');
      const operation = key(),
        buyBody = body(buyer, m, tok, 'BUY', '2000000', '65');
      const responses = await Promise.all([request('/orders', {
        cookie: buyer.cookie,
        key: operation,
        body: buyBody
      }), request('/orders', {
        cookie: buyer.cookie,
        key: operation,
        body: buyBody
      })]);
      assert.equal(responses[0].status, 202, JSON.stringify(responses[0].data));
      assert.deepEqual(responses[0].data, responses[1].data);
      const id = responses[0].data.orderId,
        partial = await wait(buyer, id, 'PARTIAL');
      assert.equal(partial.filled_quantity, '1000000');
      assert.equal(partial.remaining_quantity, '1000000');
      assert.ok((await request('/me/orders?state=open',{cookie:buyer.cookie})).data.orders.some(o=>o.id===String(id)));
      assert.equal((await request('/me/orders?state=unknown',{cookie:buyer.cookie})).status,400);
      const after = (await request('/me/portfolio', {
        cookie: buyer.cookie
      })).data.cash;
      assert.equal(BigInt(beforeBuyer) - BigInt(after.posted), 60n);
      assert.equal(after.reserved, '65');
      assert.equal((await request(`/orders/${id}/cancel`, {
        cookie: seller.cookie,
        key: key(),
        body: {}
      })).status, 404);
      assert.equal((await request(`/orders/${id}/cancel`, {
        cookie: buyer.cookie,
        key: key(),
        body: {}
      })).status, 202);
      const cancelled = await wait(buyer, id, 'CANCELLED');
      assert.equal(cancelled.filled_quantity, '1000000');
      assert.equal((await request('/me/portfolio', {
        cookie: buyer.cookie
      })).data.cash.reserved, '0');
      assert.equal((await request('/me/commands/' + operation, {
        cookie: seller.cookie
      })).status, 409);
      const pub = await request(`/markets/${m.marketId}/book/${tok.id}`);
      assert.equal(pub.status, 200, JSON.stringify(pub.data));
      assert.ok(!JSON.stringify(pub.data).includes('user_id'));
      assert.ok(!JSON.stringify(pub.data).includes('buyer_order_id'));
      if (!firstBuyer) {
        firstBuyer = buyer;
        firstSeller = seller;
        firstMarket = m;
        firstToken = tok;
        firstOrder = id;
      }
      await reconcile();
    });
    await t.test('HTTP book snapshots preserve native fill ordering beyond 100 and viewer-specific self-trade barriers', async () => {
      const m=registered[0],tok=m.tokens[0],buyer=await login(await person(tok)),seller=await login(await person(tok));
      await service.place(seller.session,key(),body(seller,m,tok,'SELL','100000000','60'));
      await engine.step(sys,m.marketId);
      const ownBook=(await request(`/markets/${m.marketId}/book/${tok.id}`,{cookie:(await login(seller)).cookie})).data;
      assert.equal(ownBook.marketId,m.marketId);assert.equal(ownBook.tokenId,String(tok.id));assert.ok(ownBook.snapshotId);
      assert.equal(ownBook.executionDepth.BUY[0].own,true);
      assert.equal(ownBook.executionDepth.BUY[0].quantity,'0');
      for(let i=0;i<100;i++){
        await service.place(buyer.session,key(),body(buyer,m,tok,'BUY','1000000','60'));
        await engine.step(sys,m.marketId);
      }
      const book=(await request(`/markets/${m.marketId}/book/${tok.id}`)).data;
      assert.equal(book.viewerUserId,null);
      const expected=(await admin.query('SELECT f.id::text FROM trading_fills f WHERE f.book_id=$1 ORDER BY f.id DESC LIMIT 50',[book.book.id])).rows.map(row=>row.id);
      assert.ok(BigInt(expected[0])>=100n);
      assert.deepEqual(book.trades.map(fill=>fill.id),expected);
      await reconcile();
    });
    await t.test('HTTP rejects spoofed users accounts floats fields tokens and spending caps', async () => {
      const valid = body(firstBuyer, firstMarket, firstToken, 'BUY');
      for (const patch of [{
        userId: firstSeller.actor.slice(5)
      }, {
        cashAccountId: firstSeller.cash
      }, {
        quantity: 1
      }, {
        priceCents: '0'
      }, {
        quantity: '1'
      }, {
        tokenId: '999999999'
      }, {
        orderType: 'MARKET'
      }]) {
        const result = await request('/orders', {
          cookie: firstBuyer.cookie,
          key: key(),
          body: {
            ...valid,
            ...patch
          }
        });
        assert.ok(result.status >= 400, JSON.stringify(result));
      }
      const cross = registered.find(x => x.marketId !== firstMarket.marketId);
      assert.ok((await request('/orders', {
        cookie: firstBuyer.cookie,
        key: key(),
        body: {
          ...valid,
          tokenId: cross.tokens[0].id
        }
      })).status >= 400);
      assert.equal((await request('/orders', {
        cookie: firstBuyer.cookie,
        body: valid
      })).status, 400);
      const response = await fetch(origin + '/api/trading/orders', {
        method: 'POST',
        headers: {
          Origin: 'https://untrusted.invalid',
          Cookie: firstBuyer.cookie,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(valid)
      });
      assert.equal(response.status, 403);
    });
    await t.test('HTTP protected IOC uses real quote and releases unfilled reservations', async () => {
      const sell = await request('/orders', {
        cookie: firstSeller.cookie,
        key: key(),
        body: body(firstSeller, firstMarket, firstToken, 'SELL')
      });
      assert.equal(sell.status, 202);
      await wait(firstSeller, sell.data.orderId, 'OPEN');
      const buy = body(firstBuyer, firstMarket, firstToken, 'BUY', '2000000', '60', 'MARKET');
      buy.maxSpendCents = '120';
      const quote = {
        ...buy
      };
      delete quote.orderType;
      const estimated = await request('/quotes', {
        cookie: firstBuyer.cookie,
        body: quote
      });
      assert.equal(estimated.status, 200, JSON.stringify(estimated.data));
      assert.equal(estimated.data.estimatedExecutableQuantity, '1000000');
      const accepted = await request('/orders', {
        cookie: firstBuyer.cookie,
        key: key(),
        body: buy
      });
      assert.equal(accepted.status, 202, JSON.stringify(accepted.data));
      const result = await wait(firstBuyer, accepted.data.orderId, 'CANCELLED');
      assert.equal(result.filled_quantity, '1000000');
      assert.equal(result.remaining_quantity, '0');
      assert.equal((await request('/me/portfolio', {
        cookie: firstBuyer.cookie
      })).data.cash.reserved, '0');
      await reconcile();
    });
    await t.test('HTTP cutoff expires orders and releases reservations without a payout', async () => {
      const market = await makeClosingMarket(),
        token = market.tokens[0],
        buyer = await login(await person(token));
      const before = (await request('/me/portfolio', {
        cookie: buyer.cookie
      })).data.cash.posted;
      const accepted = await request('/orders', {
        cookie: buyer.cookie,
        key: key(),
        body: body(buyer, market, token, 'BUY')
      });
      assert.equal(accepted.status, 202);
      await wait(buyer, accepted.data.orderId, 'EXPIRED');
      const after = (await request('/me/portfolio', {
        cookie: buyer.cookie
      })).data.cash;
      assert.equal(after.posted, before);
      assert.equal(after.reserved, '0');
      const expiredDetail = (await request(`/markets/${market.marketId}`)).data;
      assert.ok(Date.parse(expiredDetail.serverTime) >= Date.parse(expiredDetail.market.trading_ends_at));
      assert.ok(BigInt(after.available) >= 60n, 'the rejection must not be caused by insufficient funds');
      const closedQuote = await request('/quotes', { cookie: buyer.cookie, body: { ...body(buyer, market, token, 'BUY'), maxSpendCents: '60' } });
      assert.equal(closedQuote.status, 200);
      assert.equal(closedQuote.data.stoppedReason, 'MARKET_CLOSED');
      assert.equal(closedQuote.data.estimatedExecutableQuantity, '0');
      assert.equal((await request('/orders', {
        cookie: buyer.cookie,
        key: key(),
        body: body(buyer, market, token, 'BUY')
      })).status, 409);
      assert.deepEqual((await request('/me/portfolio', { cookie: buyer.cookie })).data.cash, after);
      await reconcile();
    });
    await t.test('HTTP concurrent users receive bounded independent snapshots and quotes', async () => {
      const users = [people[2], people[3]],
        quote = body(users[0], firstMarket, firstMarket.tokens.at(-1), 'BUY', '1000000', '60', 'MARKET');
      delete quote.orderType;
      quote.maxSpendCents = '60';
      const snapshotStart=performance.now();
      const snapshots = await Promise.all(Array.from({
        length: 10
      }, (_, i) => request('/me/portfolio', {
        cookie: users[i % 2].cookie
      })));
      assert.ok(snapshots.every(r => r.status === 200));
      const snapshotElapsed=performance.now()-snapshotStart,quoteStart=performance.now();
      const quotes = await Promise.all(Array.from({
        length: 10
      }, () => request('/quotes', {
        cookie: users[0].cookie,
        body: quote
      })));
      assert.ok(quotes.every(r => r.status === 200));
      const quoteElapsed=performance.now()-quoteStart;
      t.diagnostic(JSON.stringify({apiConcurrencyBenchmark:'two-authenticated-users',snapshotRequests:10,snapshotElapsedMs:snapshotElapsed,snapshotRequestsPerSecond:10000/snapshotElapsed,quoteRequests:10,quoteElapsedMs:quoteElapsed,quoteRequestsPerSecond:10000/quoteElapsed,discrepancies:0,smallLocalSample:true}));
      await reconcile();
    });
    await t.test('HTTP private SSE reconnect revalidates sessions and never publishes another user', async () => {
      const abort = new AbortController(),
        start = performance.now();
      const response = await fetch(origin + '/api/trading/me/events', {
        headers: {
          Cookie: firstBuyer.cookie
        },
        signal: abort.signal
      });
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      const text = new TextDecoder().decode((await reader.read()).value);
      assert.match(text, /snapshot-required/);
      assert.ok(!text.includes(firstSeller.actor));
      assert.ok(!text.includes('posted'));
      latencies.recovery.push(performance.now() - start);
      const deliveredAt=performance.now();
      const accepted=await request('/orders',{cookie:firstBuyer.cookie,key:key(),body:body(firstBuyer,firstMarket,firstToken,'BUY')});assert.equal(accepted.status,202);
      let update='';
      const deadline=setTimeout(()=>abort.abort(),5000);
      try{while(!update.includes('snapshot-required')){const chunk=await reader.read();assert.equal(chunk.done,false);update+=new TextDecoder().decode(chunk.value)}}finally{clearTimeout(deadline)}
      latencies.delivery.push(performance.now()-deliveredAt);
      assert.equal((await request(`/orders/${accepted.data.orderId}/cancel`,{cookie:firstBuyer.cookie,key:key(),body:{}})).status,202);await wait(firstBuyer,accepted.data.orderId,'CANCELLED');
      const publicAbort = new AbortController(),
        publicResponse = await fetch(origin + '/api/trading/events', {
          signal: publicAbort.signal
        });
      const publicText = new TextDecoder().decode((await publicResponse.body.getReader().read()).value);
      assert.match(publicText, /"privateSequence":null/);
      publicAbort.abort();
      const token = firstBuyer.cookie.split('=')[1];
      const {
        hashSessionToken
      } = await import('../../../server/src/services/authSessionService.js');
      await admin.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1', [hashSessionToken(token)]);
      let expired='';const expireTimeout=setTimeout(()=>abort.abort(),5000);
      try{while(!expired.includes('session-expired')){const chunk=await reader.read();assert.equal(chunk.done,false);expired+=new TextDecoder().decode(chunk.value)}}finally{clearTimeout(expireTimeout);abort.abort()}
      assert.match(expired,/session-expired/);
      assert.equal((await request('/me/portfolio', {
        cookie: firstBuyer.cookie
      })).status, 401);
    });
    await t.test('browser real React login ticket recovery and persisted order history', {
      timeout: 900000
    }, async () => {
      const {
        runTradingBrowserCases
      } = await import('./tradingBrowserCases.js');
      await runTradingBrowserCases({
        origin,
        buyer: people[2],
        seller: people[3],
        market: registered[0],
        createRecurring:async()=>{const fixture=await makeBrowserRounds();return {...fixture,buyer:await login(fixture.buyer),seller:await login(fixture.seller)}},
        scenarios: registered.slice(1).map((market,i)=>({market,buyer:people[(i+1)*4],seller:people[(i+1)*4+1]})),
        reconcile
      });
    });
    assert.deepEqual(errors, []);
    await reconcile();
    for (const [kind, values] of Object.entries(latencies)) {
      if (!values.length) continue;
      values.sort((a, b) => a - b);
      t.diagnostic(JSON.stringify({
        apiBenchmark: kind,
        count: values.length,
        averageMs: values.reduce((a, b) => a + b, 0) / values.length,
        p95: values[Math.ceil(values.length * .95) - 1],
        p99: values[Math.ceil(values.length * .99) - 1],
        smallLocalSample: true
      }));
    }
    assert.ok(firstOrder);
  } finally {
    controller.abort();
    await Promise.all([worker, expiration]);
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    await capabilities.close();
    await disconnectFromDatabase();
    if (oldFlag === undefined) delete process.env.CUSTODIAL_TRADING_LOCAL;else process.env.CUSTODIAL_TRADING_LOCAL = oldFlag;
  }
}
