import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createLifecycleService } from '../src/index.js'
import { runExpirationWorker, runRecoveryWorker, runOutboxWorker } from '../src/lifecycleWorker.js'

// Invoked only inside the verified disposable PostgreSQL parent fixture.
export async function runLifecycleCases(t, ctx) {
  const { admin, runtime, ledger, positions, registered, accounts, base, expiredFixture, enroll, sys, key, person, place, order, one, drain, reconcile, trading, engine } = ctx
  const service = createLifecycleService({ pool: runtime, enabled: true, environment: 'test', authorize: () => true })
  const d = registered.find(m => m.type === 'CATEGORICAL'), token = d.tokens[0]
  const rest = async (p, side, n, price, market = d, tok = token) => {
    const r = await place(p, side, n, price, market, tok)
    await drain(market.marketId)
    return r
  }
  const snapshot = async () => (await one(`SELECT jsonb_build_object('operations',(SELECT count(*) FROM financial_operations),'fills',(SELECT count(*) FROM trading_fills),'cash',(SELECT jsonb_agg(p ORDER BY account_id) FROM financial_balance_projections p),'positions',(SELECT jsonb_agg(p ORDER BY account_id) FROM position_balance_projections p)) AS state`)).state
  const terminal = async (receipt, status, filled = 0) => {
    const o = await order(receipt.orderId)
    assert.equal(o.status, status); assert.equal(o.filled_quantity, String(filled * 1000000)); assert.equal(o.remaining_quantity, '0')
    const hold = o.side === 'BUY'
      ? await one('SELECT amount-consumed-released AS remaining FROM cash_reservations WHERE id=$1', [o.cash_reservation_id])
      : await one('SELECT quantity-consumed-released AS remaining FROM position_reservations WHERE id=$1', [o.position_reservation_id])
    assert.equal(hold.remaining, '0')
  }
  const expiringMarket = async seconds => {
    const m = await expiredFixture(seconds); await enroll(m)
    accounts.set(m.tokens[0].id, await base.accounts(m.tokens[0].id))
    return m
  }
  const waitForCutoff = async m => {
    const end = (await one('SELECT trading_ends_at FROM markets WHERE id=$1', [m.marketId])).trading_ends_at.getTime()
    await new Promise(resolve => setTimeout(resolve, Math.max(0, end - Date.now() + 30)))
  }
  const checked = async () => {
    await reconcile()
    const health = await service.diagnostics(sys)
    assert.ok(Object.values(health.issues).every(value => value === 0), JSON.stringify(health.issues))
  }
  await t.test('lifecycle and event metadata remain inaccessible to unauthorized runtime writes', async () => {
    for (const table of ['trading_event_stream', 'trading_event_cursors']) await assert.rejects(runtime.query('DELETE FROM ' + table), e => e.code === '42501')
    await assert.rejects(service.expiring('user:1'), /system authorization/)
    await assert.rejects(service.diagnostics('user:1'), /system authorization/)
    await assert.rejects(service.expire(sys, d.marketId, 101n), /expiration batch/)
    const p = await person()
    await assert.rejects(place(p, 'BUY', 1, 60, d, token, 'engine:expiry:reserved'), /reserved engine operation key/)
    await checked()
  })
  await t.test('accepted recovery status is actor-bound and reflects authoritative progress', async () => {
    const a = await person(), op = key(), r = await place(a, 'BUY', 2, 60, d, token, op)
    assert.equal((await service.status(a.actor, op)).state, 'QUEUED')
    await assert.rejects(service.status('user:1', op), /another actor/)
    await drain(d.marketId)
    assert.equal((await service.status(a.actor, op)).orderStatus, 'OPEN')
    await trading.cancel(a.actor, key(), r.orderId); await drain(d.marketId)
    assert.equal((await service.status(a.actor, op)).orderStatus, 'CANCELLED')
    assert.equal((await service.status(a.actor, key())).state, 'NOT_FOUND')
    await checked()
  })
  for (const side of ['BUY', 'SELL']) await t.test('pending ' + side + ' cancellation preserves sequencing and repeated keys release once', async () => {
    const a = await person(), r = await place(a, side, 3, 60), op = key()
    const [first, duplicate] = await Promise.all([trading.cancel(a.actor, op, r.orderId), trading.cancel(a.actor, op, r.orderId)])
    assert.deepEqual(first, duplicate)
    await assert.rejects(trading.cancel('user:1', key(), r.orderId), /access denied/)
    await drain(d.marketId); await terminal(r, 'CANCELLED')
    const before = await snapshot(); assert.deepEqual(await trading.cancel(a.actor, op, r.orderId), first)
    assert.deepEqual(await snapshot(), before); await checked()
  })
  await t.test('cancellation race follows earlier multi-fill command and preserves every completed fill', async () => {
    const a = await person(), b = await person(), c = await person()
    await rest(a, 'SELL', 1, 60); await rest(b, 'SELL', 1, 61)
    const r = await place(c, 'BUY', 3, 65)
    await engine.step(sys, d.marketId)
    await Promise.all([trading.cancel(c.actor, key(), r.orderId), engine.step(sys, d.marketId)])
    await drain(d.marketId); await terminal(r, 'CANCELLED', 2)
    assert.equal((await one('SELECT count(*)::int AS n FROM trading_fills WHERE buyer_order_id=$1', [r.orderId])).n, 2)
    await checked()
  })
  await t.test('paused resting BUY and SELL cancel without reopening on resume', async () => {
    const a = await person(), b = await person(), buy = await rest(a, 'BUY', 2, 55), sell = await rest(b, 'SELL', 2, 65)
    await admin.query("UPDATE markets SET trading_status='PAUSED' WHERE id=$1", [d.marketId])
    await Promise.all([trading.cancel(a.actor, key(), buy.orderId), trading.cancel(b.actor, key(), sell.orderId)])
    await Promise.all([drain(d.marketId), drain(d.marketId)])
    await terminal(buy, 'CANCELLED'); await terminal(sell, 'CANCELLED')
    await admin.query("UPDATE markets SET trading_status='OPEN' WHERE id=$1", [d.marketId]); await drain(d.marketId)
    await terminal(buy, 'CANCELLED'); await checked()
  })
  await t.test('bounded concurrent expiration releases resting and accepted BUY/SELL including a paused market', async () => {
    const m = await expiringMarket(8), tok = m.tokens[0], a = await person(tok), b = await person(tok)
    const buy = await rest(a, 'BUY', 2, 55, m, tok), sell = await rest(b, 'SELL', 2, 65, m, tok)
    const pending = await place(a, 'BUY', 1, 54, m, tok)
    await admin.query("UPDATE markets SET trading_status='PAUSED' WHERE id=$1", [m.marketId]); await waitForCutoff(m)
    assert.ok((await service.expiring(sys)).includes(m.marketId))
    const results = await Promise.all([service.expire(sys, m.marketId, 1n), service.expire(sys, m.marketId, 1n)])
    assert.deepEqual(results.map(r => r.queued), [1, 1])
    for (let i = 0; i < 8; i++) { await service.expire(sys, m.marketId, 1n); await engine.step(sys, m.marketId) }
    for (const r of [buy, sell, pending]) await terminal(r, 'EXPIRED')
    assert.equal((await service.expire(sys, m.marketId, 1n)).queued, 0)
    await checked()
  })
  await t.test('expiration worker recovers cutoff during partial matching and leaves other markets usable', async () => {
    const m = await expiringMarket(7), tok = m.tokens[0], a = await person(tok), b = await person(tok)
    const sell = await rest(a, 'SELL', 1, 60, m, tok), buy = await place(b, 'BUY', 3, 65, m, tok)
    await engine.step(sys, m.marketId); await waitForCutoff(m)
    const controller = new AbortController(), errors = []
    await runExpirationWorker({ lifecycle: service, matching: engine, actor: sys, signal: controller.signal, pollMs: 25,
      onError: e => errors.push(e), onDiagnostic: () => { controller.abort() } })
    await drain(m.marketId); await terminal(buy, 'EXPIRED', 1); await terminal(sell, 'FILLED', 1)
    assert.deepEqual(errors, [])
    const p = await person(), r = await rest(p, 'BUY', 1, 50); await trading.cancel(p.actor, key(), r.orderId); await drain(d.marketId)
    await checked()
  })
  await t.test('matching continues in another market during concurrent expiration batches', async () => {
    const m = await expiringMarket(7), tok = m.tokens[0], p = await person(tok), old = await rest(p, 'SELL', 2, 70, m, tok)
    const a = await person(), b = await person(); await rest(a, 'SELL', 1, 60)
    await waitForCutoff(m)
    const incoming = await place(b, 'BUY', 1, 65)
    await Promise.all([service.expire(sys, m.marketId, 1n), drain(d.marketId)])
    await drain(m.marketId); await terminal(old, 'EXPIRED'); await terminal(incoming, 'FILLED', 1); await checked()
  })
  await t.test('diagnostics never classify unrelated accounting reservations as orphan orders', async () => {
    const p = await person(), r = await ledger.reserve(p.actor, key(), { accountId: p.cash, amount: 20n, reference: key() })
    assert.equal((await service.diagnostics(sys)).issues.orphanTradingCashHolds, 0)
    await ledger.cancel(p.actor, key(), r.reservationId); await checked()
  })
  await t.test('hold tampering is detected and reconciliation never repairs or releases suspicious funds', async () => {
    const p = await person(), r = await rest(p, 'BUY', 2, 60)
    await admin.query('ALTER TABLE cash_reservations DISABLE TRIGGER USER')
    await admin.query('UPDATE cash_reservations SET reference=$1 WHERE id=(SELECT cash_reservation_id FROM trading_orders WHERE id=$2)', ['invalid:' + key(), r.orderId])
    await admin.query('ALTER TABLE cash_reservations ENABLE TRIGGER USER')
    try {
      assert.equal((await service.diagnostics(sys)).issues.cashHoldMismatch, 1)
      const before = await snapshot(); await assert.rejects(trading.reconcile(sys), /reservation|mismatch/); assert.deepEqual(await snapshot(), before)
    } finally {
      await admin.query('ALTER TABLE cash_reservations DISABLE TRIGGER USER')
      await admin.query('UPDATE cash_reservations SET reference=$1 WHERE id=(SELECT cash_reservation_id FROM trading_orders WHERE id=$2)', ['order:' + r.orderId, r.orderId])
      await admin.query('ALTER TABLE cash_reservations ENABLE TRIGGER USER')
    }
    await trading.cancel(p.actor, key(), r.orderId); await drain(d.marketId); await checked()
  })
  await t.test('event replay preserves exact IDs and financial state; acknowledgement is ordered and consumer-bound', async () => {
    const consumer = 'system:delivery-test', before = await snapshot(), batch = await service.events(consumer, d.marketId, 3n)
    assert.equal(batch.events.length, 3); assert.deepEqual(await service.events(consumer, d.marketId, 3n), batch)
    for(const event of batch.events) assert.deepEqual(event.payload,{marketId:d.marketId,kind:event.kind})
    assert.ok(!/orderId|filledQuantity|remainingQuantity|accountId|userId/.test(JSON.stringify(batch)))
    await assert.rejects(service.acknowledge(consumer, d.marketId, batch.afterSequence, batch.events.slice(1).map(e => e.eventId)), /exact next event prefix/)
    await assert.rejects(service.acknowledge('user:1', d.marketId, batch.afterSequence, batch.events.map(e => e.eventId)), /acknowledgement/)
    const ids = batch.events.map(e => e.eventId), ack = await service.acknowledge(consumer, d.marketId, batch.afterSequence, ids)
    assert.equal(ack.sequence, batch.events.at(-1).sequence)
    assert.equal((await service.acknowledge(consumer, d.marketId, batch.afterSequence, ids)).replayed, true)
    assert.equal((await service.events('system:other-consumer', d.marketId, 3n)).afterSequence, '0')
    const other = await service.events('system:other-consumer',d.marketId,1n)
    await service.acknowledge('system:other-consumer',d.marketId,other.afterSequence,other.events.map(e=>e.eventId))
    assert.equal((await service.events(consumer,d.marketId,1n)).afterSequence,ack.sequence)
    const bound=createLifecycleService({pool:runtime,enabled:true,environment:'test',authorize:({actor})=>actor===consumer})
    await assert.rejects(bound.acknowledge('system:other-consumer',d.marketId,other.afterSequence,other.events.map(e=>e.eventId)),/not authorized/)
    assert.deepEqual((await service.events(consumer, d.marketId, 3n, 0n)).events, batch.events)
    assert.deepEqual(await snapshot(), before); await checked()
  })
  await t.test('outbox transport failure retains unacknowledged events without replaying accounting', async () => {
    const actor = 'system:failing-publisher', controller = new AbortController(), before = await snapshot(), errors = []
    await runOutboxWorker({ service, actor, signal: controller.signal, pollMs: 25, onEvents: async () => { throw new Error('secret transport detail') }, onError: e => { errors.push(e); controller.abort() } })
    assert.deepEqual(errors, [{ code: 'OUTBOX_DELIVERY_FAILED', commitOutcome: undefined }])
    assert.equal((await service.events(actor, d.marketId, 1n)).afterSequence, '0'); assert.deepEqual(await snapshot(), before)
    await checked()
  })
  await t.test('missing stream insertion rolls back the complete order and reservation', async () => {
    const p = await person(), before = await snapshot()
    await admin.query('CREATE FUNCTION suppress_stream() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$')
    await admin.query('CREATE TRIGGER suppress_stream BEFORE INSERT ON trading_event_stream FOR EACH ROW EXECUTE FUNCTION suppress_stream()')
    try { await assert.rejects(place(p, 'BUY', 1, 60), /missing or mismatched durable event stream/) }
    finally { await admin.query('DROP TRIGGER suppress_stream ON trading_event_stream'); await admin.query('DROP FUNCTION suppress_stream()') }
    assert.deepEqual(await snapshot(), before); await checked()
  })
  // Real termination at transaction boundaries: no success is inferred from memory.
  async function killAtCommit(mode, operation) {
    const config = Object.fromEntries(['host', 'port', 'database', 'user', 'password'].map(k => [k, runtime.options[k]]))
    const child = fork(fileURLToPath(new URL('./matchingCrashChild.js', import.meta.url)), [], { env: { ...process.env, NODE_ENV: 'test' }, execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    const exited = new Promise(resolve => child.once('exit', resolve))
    let timer
    try {
      const checkpoint = new Promise((resolve, reject) => { child.once('message', m => m.checkpoint === mode ? resolve() : reject(new Error('Isolated lifecycle worker failed'))); child.once('error', reject); child.once('exit', () => reject(new Error('Worker exited before checkpoint'))) })
      child.send({ config, marketId: operation?.targetMarketId ?? d.marketId, actor: sys, mode, operation })
      await Promise.race([checkpoint, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Lifecycle worker checkpoint timeout')), 15000) })])
    } finally { clearTimeout(timer); child.kill('SIGKILL'); await exited }
  }
  for (const mode of ['before', 'after']) await t.test('real process kill ' + mode + ' acceptance commit recovers the same actor-bound key', async () => {
    const p = await person(), op = key(), terms = { marketId: d.marketId, tokenId: token.id, side: 'BUY', quantity: '1000000', priceCents: '60', cashAccountId: p.cash, positionAccountId: p.position }
    await killAtCommit(mode, { type: 'PLACE', actor: p.actor, key: op, terms })
    const state = await service.status(p.actor, op)
    assert.equal(state.state, mode === 'before' ? 'NOT_FOUND' : 'QUEUED')
    const r = await trading.place(p.actor, op, { ...terms, quantity: 1000000n, priceCents: 60n }); await drain(d.marketId)
    await trading.cancel(p.actor, key(), r.orderId); await drain(d.marketId); await terminal(r, 'CANCELLED'); await checked()
  })
  for (const mode of ['before', 'after']) await t.test('real process kill ' + mode + ' cancellation commit releases funds exactly once', async () => {
    const p = await person(), r = await rest(p, 'BUY', 2, 60)
    await trading.cancel(p.actor, key(), r.orderId); await killAtCommit(mode)
    await drain(d.marketId); await terminal(r, 'CANCELLED'); await checked()
  })
  for (const mode of ['before', 'after']) await t.test('real process kill ' + mode + ' expiration acceptance and release recovers from persisted state', async () => {
    const m = await expiringMarket(7), tok = m.tokens[0], p = await person(tok), r = await rest(p, 'BUY', 2, 55, m, tok)
    await waitForCutoff(m)
    await killAtCommit(mode, { type: 'EXPIRE', marketId: m.marketId })
    assert.equal((await one("SELECT count(*)::int AS n FROM matching_requests WHERE order_id=$1 AND action='EXPIRE'", [r.orderId])).n, mode === 'before' ? 0 : 1)
    await service.expire(sys, m.marketId, 1n)
    await killAtCommit(mode, { type: 'MATCH', targetMarketId: m.marketId })
    await drain(m.marketId); await terminal(r, 'EXPIRED')
    assert.equal((await one("SELECT count(*)::int AS n FROM trading_commands WHERE terms->>'orderId'=$1 AND action='EXPIRE'", [r.orderId])).n, 1)
    await checked()
  })
  for (const mode of ['before', 'after']) await t.test('real process kill ' + mode + ' event acknowledgement commit preserves replay cursor', async () => {
    const actor = 'system:ack-' + mode, batch = await service.events(actor, d.marketId, 2n), ids = batch.events.map(e => e.eventId), before = await snapshot()
    await killAtCommit(mode, { type: 'ACK', actor, marketId: d.marketId, after: batch.afterSequence, eventIds: ids })
    assert.equal((await service.events(actor, d.marketId, 1n)).afterSequence, mode === 'before' ? '0' : batch.events.at(-1).sequence)
    await service.acknowledge(actor, d.marketId, batch.afterSequence, ids); assert.deepEqual(await snapshot(), before); await checked()
  })
  await t.test('recovery worker coordinates independent markets and reports only structured diagnostics', async () => {
    const p = await person(), r = await place(p, 'BUY', 1, 50), controller = new AbortController(), diagnostics = [], errors = []
    await runRecoveryWorker({ lifecycle: service, matching: engine, actor: sys, signal: controller.signal, pollMs: 25, onError: e => errors.push(e), onDiagnostic: e => { diagnostics.push(e); controller.abort() } })
    assert.deepEqual(errors, []); assert.ok(diagnostics[0].recoveryAttempts >= 1)
    await trading.cancel(p.actor, key(), r.orderId); await drain(d.marketId); await checked()
  })
  for (const m of registered) await t.test('lifecycle canonical cancellation isolation ' + m.type, async () => {
    for (const tok of m.tokens.slice(0, 2)) {
      const p = await person(tok), r = await rest(p, 'SELL', 1, 70, m, tok)
      await trading.cancel(p.actor, key(), r.orderId); await drain(m.marketId); await terminal(r, 'CANCELLED')
    }
    await checked()
  })
  // Small reproducible smoke benchmarks. No production throughput target is asserted.
  for (const kind of ['cancellation', 'expiration', 'recovery', 'mixed-shared', 'outbox']) await t.test('lifecycle benchmark ' + kind, async () => {
    const p = await person(), times = [], actor = 'system:benchmark-' + kind
    let m = d, tok = token, receipts = [], deliveredEvents = 0
    if (kind === 'expiration') { m = await expiringMarket(7); tok = m.tokens[0] }
    const holder = kind === 'expiration' ? await person(tok) : p
    for (let i = 0; i < 8; i++) receipts.push(await place(holder, i % 2 ? 'BUY' : 'SELL', 1, i % 2 ? 50 : 70, m, tok))
    if (kind === 'cancellation' || kind === 'expiration') await drain(m.marketId)
    if (kind === 'expiration') await waitForCutoff(m)
    const deadlocks = (await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks
    let stop = false, maxWaiters = 0
    const monitor = (async () => { while (!stop) { maxWaiters = Math.max(maxWaiters, (await one("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).n); await new Promise(r => setTimeout(r, 5)) } })()
    const start = performance.now()
    try {
      if (kind === 'expiration') { const tick = performance.now(); await Promise.all([service.expire(actor, m.marketId, 4n), service.expire(actor, m.marketId, 4n)]); times.push(performance.now() - tick) }
      if (kind === 'cancellation' || kind === 'mixed-shared') for (const r of [...receipts]) {
        const tick = performance.now()
        if (kind === 'mixed-shared') {
          const [, accepted] = await Promise.all([trading.cancel(holder.actor, key(), r.orderId), place(holder, 'BUY', 1, 49, m, tok)])
          receipts.push(accepted)
        } else await trading.cancel(holder.actor, key(), r.orderId)
        times.push(performance.now() - tick)
      }
      if (kind === 'outbox') for (let i = 0; i < 8; i++) { const tick = performance.now(), batch = await service.events(actor, m.marketId, 10n); if (batch.events.length) { await service.acknowledge(actor, m.marketId, batch.afterSequence, batch.events.map(e => e.eventId)); deliveredEvents += batch.events.length } times.push(performance.now() - tick) }
      const backlogTick = performance.now(); await Promise.all([drain(m.marketId), drain(m.marketId)]); const drainMs = performance.now() - backlogTick
      if (kind === 'recovery') times.push(drainMs)
      const elapsedMs = performance.now() - start
      if (kind === 'recovery' || kind === 'outbox' || kind === 'mixed-shared') { for (const r of receipts) if (['OPEN','PARTIAL'].includes((await order(r.orderId)).status)) await trading.cancel(holder.actor, key(), r.orderId); await drain(m.marketId) }
      await checked()
      for (const r of receipts) await terminal(r, kind === 'expiration' ? 'EXPIRED' : 'CANCELLED')
      assert.equal((await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks, deadlocks)
      times.sort((a, b) => a - b)
      t.diagnostic(JSON.stringify({ lifecycleBenchmark: kind, orders: receipts.length, deliveredEvents, samples: times.length, sampleUnit: kind==='recovery'?'entire backlog drain':kind==='expiration'?'paired four-order enqueue batches':kind==='outbox'?'ten-event read-and-ack batch':kind==='mixed-shared'?'concurrent cancel and acceptance':'cancellation acceptance', elapsedMs, throughput: (kind==='outbox'?deliveredEvents:receipts.length) * 1000 / elapsedMs, throughputUnit: kind==='outbox'?'events/s':'orders/s', averageMs: times.reduce((a, b) => a + b, 0) / times.length, p95: times[Math.ceil(times.length * .95) - 1], p99: times[Math.ceil(times.length * .99) - 1], drainMs, maxWaiters, deadlockRetries: 0, deadlocks: 0, discrepancies: 0, unreleasedReservations: 0, reconciled: true }))
    } finally { stop = true; await monitor }
  })
  await ledger.rebuild(sys, key()); await positions.rebuild(sys, key()); await checked()
}
