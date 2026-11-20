import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { spawnSync, fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createLedger, createTradingService, createMatchingService, createLifecycleService, createMarketLifecycleService } from '../src/index.js'
import { runMarketSchedulerWorker, deriveRoundRegistry } from '../src/marketScheduler.js'
import { createPositionFixture } from './positionCases.js'
import { verifyMockTokenIdentity } from '../src/tokenVerification.js'

const configured = Boolean(process.env.LEDGER_DISPOSABLE_TARGET)
if (process.env.LEDGER_REQUIRE_POSTGRES === 'true' && !configured) throw new Error('Required disposable scheduler target missing')

test('required PostgreSQL recurring market lifecycle', { skip: !configured }, async t => {
  const config = JSON.parse(process.env.LEDGER_DISPOSABLE_TARGET)
  assert.equal(process.env.NODE_ENV, 'test'); assert.equal(config.host, '127.0.0.1'); assert.equal(config.database, 'khmerfp_ledger_test')
  const inspection = spawnSync('docker', ['inspect', process.env.LEDGER_CONTAINER_ID], { encoding: 'utf8', timeout: 10000 })
  assert.equal(inspection.status, 0)
  const meta = JSON.parse(inspection.stdout)[0]
  assert.equal(meta.Config.Labels['khmerfp.disposable'], 'ledger'); assert.equal(meta.Config.Image, 'postgres:16'); assert.equal(meta.NetworkSettings.Ports['5432/tcp'][0].HostPort, String(config.port))
  const parent = new pg.Pool(config), database = 'khmerfp_scheduler_test', password = randomBytes(24).toString('hex')
  let admin, runtime
  try {
    assert.equal((await parent.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0)
    await parent.query('CREATE DATABASE ' + database)
    admin = new pg.Pool({ ...config, database, statement_timeout: 20000 })
    try { await migrate(drizzle(admin), { migrationsFolder: fileURLToPath(new URL('../../db/migrations/', import.meta.url)) }) }
    catch (error) { throw new Error('Scheduler migration: ' + (error.cause?.message || error.message)) }
    await admin.query('CREATE ROLE schedule_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT')
    await admin.query("CREATE ROLE schedule_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '" + password + "'")
    await admin.query('GRANT USAGE ON SCHEMA public TO schedule_owner,schedule_runtime')
    const owned = (await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'financial_%' OR tablename LIKE 'cash_%' OR tablename IN ('position_accounts','position_journals','position_journal_entries','position_balance_projections','position_reservations','position_reservation_events') OR tablename LIKE 'trading_%' OR tablename LIKE 'matching_%' OR tablename IN ('market_templates','market_template_controls','market_rounds','market_round_requirements','market_round_observations','market_lifecycle_events','market_lifecycle_cursors'))")).rows
    for (const row of owned) await admin.query('ALTER TABLE public.' + row.tablename + ' OWNER TO schedule_owner')
    for (const row of (await admin.query("SELECT oid::regprocedure::text AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'financial_%' OR proname LIKE 'trading_%' OR proname LIKE 'matching_%' OR proname LIKE 'market_schedule_%' OR proname IN ('position_execute','position_guard','position_validate'))")).rows) await admin.query('ALTER FUNCTION ' + row.signature + ' OWNER TO schedule_owner')
    await admin.query('GRANT SELECT,INSERT,UPDATE ON public.markets,public.market_questions,public.market_outcomes,public.market_observation_specs,public.ctf_conditions,public.ctf_position_tokens TO schedule_owner')
    await admin.query('GRANT SELECT ON public.chains,public.contract_deployments,public.chain_assets,public.market_categories,public.market_outcome_tokens,public.position_token_verifications TO schedule_owner')
    await admin.query('GRANT USAGE,SELECT ON SEQUENCE public.market_outcomes_id_seq,public.ctf_conditions_id_seq,public.ctf_position_tokens_id_seq TO schedule_owner')
    await admin.query('GRANT EXECUTE ON FUNCTION public.validate_market_definition(uuid,boolean) TO schedule_owner')
    await admin.query('GRANT INSERT ON public.market_outcome_tokens TO schedule_owner')
    await admin.query('GRANT EXECUTE ON FUNCTION public.financial_execute(text,text,text,jsonb),public.financial_reconcile(text),public.trading_execute(text,text,text,jsonb),public.matching_step(text,uuid),public.matching_pending(text),public.matching_expire(text,uuid,integer),public.matching_expiring(text),public.market_schedule_plan(text,uuid),public.market_schedule_create_round(text,jsonb),public.market_schedule_step(text,uuid),public.market_schedule_execute(text,text,jsonb),public.market_schedule_read(text,text,jsonb),public.market_schedule_event_streams(text),public.market_schedule_event_batch(text,uuid,integer,bigint),public.market_schedule_event_ack(text,uuid,bigint,jsonb) TO schedule_runtime')
    runtime = new pg.Pool({ ...config, database, user: 'schedule_runtime', password, max: 8 })
    const options = { pool: runtime, enabled: true, environment: 'test', authorize: () => true }, ledger = createLedger(options), service = createMarketLifecycleService(options), trading = createTradingService(options), engine = createMatchingService(options), lifecycle = createLifecycleService(options)
    const sys = 'system:scheduler-tests', key = randomUUID, one = async (sql, args) => (await admin.query(sql, args)).rows[0]
    const ownerTx = async work => { const c = await admin.connect(); try { await c.query('BEGIN'); await c.query('SET LOCAL ROLE schedule_owner'); await work(c); await c.query('COMMIT') } catch (error) { await c.query('ROLLBACK'); throw error } finally { c.release() } }
    const fixture = async (amount = 1000000n) => {
      const users = (await admin.query("INSERT INTO users(email,display_name) VALUES($1,'Mock buyer'),($2,'Mock seller') RETURNING id", [key() + '@example.test', key() + '@example.test'])).rows
      const account = async (ownerUserId, kind, normalSide) => (await ledger.createAccount(sys, key(), { ownerUserId, asset: 'USD', kind, normalSide, accountKey: key() })).accountId
      const a = await account(users[0].id, 'CUSTOMER', 'CREDIT'), b = await account(users[1].id, 'CUSTOMER', 'CREDIT'), cash = await account(null, 'ASSET', 'DEBIT')
      await ledger.post(sys, key(), [{ accountId: cash, asset: 'USD', side: 'DEBIT', amount }, { accountId: a, asset: 'USD', side: 'CREDIT', amount }], key())
      return { a, b, cash, actor: 'user:' + users[0].id, other: 'user:' + users[1].id }
    }
    const base = await createPositionFixture({ admin, runtime, ledger, sys, key, fixture, ownerTx, chainSeed: 2700000 })
    const refs = await one('SELECT m.category_id,c.ctf_contract_deployment_id,c.oracle_contract_deployment_id,c.collateral_asset_id FROM markets m JOIN market_questions q ON q.market_id=m.id JOIN ctf_conditions c ON c.market_question_id=q.id WHERE m.id=$1', [base.market.marketId])
    const anchor = seconds => new Date(Date.now() + seconds * 1000).toISOString().slice(0, 19)
    const definition = (type = 'BINARY', overrides = {}) => ({ scope: 'MOCK_ONLY', title: type === 'BINARY' ? 'Mock Bitcoin five-minute fixture' : 'Mock ' + type, description: 'Disposable local fixture; no live price or payout', marketType: type,
      schedule: { mode: 'FIXED', timezone: 'UTC', anchorLocal: anchor(20), dstPolicy: 'REJECT', stepSeconds: '300', months: '1', durationMode: 'SECONDS', tradingSeconds: '300', observationStartOffset: '0', observationEndOffset: '0', resultDelaySeconds: '15', resolutionDelaySeconds: '3600', lookaheadSeconds: '600', openingGraceSeconds: '10' },
      outcomes: type === 'BINARY' ? [{ label: 'YES' }, { label: 'NO' }] : type === 'CATEGORICAL' ? ['Team A','Team B','Team C','Team D','Team E','OTHER'].map(label => ({ label })) : ['0','4000','4100','4200','4300','4400'].map((lower, i, a) => ({ label: 'Range ' + i, lower, upper: a[i + 1] ?? null })),
      observation: { sourceId: 'MOCK_FIXTURE_ONLY', unit: 'MOCK_USD', decimals: '6', referenceAsset: 'BTC', revisionPolicy: 'REQUIRE_FINAL', domainLower: '0', domainUpper: null }, rules: 'Mock fixture only. For the binary fixture ties would be NO; no winner is selected here.', ruleVersion: 'fixture-v1', requireOther: type === 'CATEGORICAL', ...overrides })
    const template = async (def = definition(), templateKey = 'fixture-' + key(), version = 1n) => {
      const terms = { templateKey, version, categoryId: refs.category_id, ctfDeploymentId: refs.ctf_contract_deployment_id, oracleDeploymentId: refs.oracle_contract_deployment_id, collateralAssetId: refs.collateral_asset_id, definition: def }
      const result = await service.createTemplate(sys, terms); await service.enable(sys, result.templateId, true)
      return { ...result, terms }
    }
    const roundData = async marketId => {
      const c = await one('SELECT c.*,a.contract_address AS collateral_address FROM ctf_conditions c JOIN market_questions q ON q.id=c.market_question_id JOIN chain_assets a ON a.id=c.collateral_asset_id WHERE q.market_id=$1', [marketId])
      const tokens = (await admin.query('SELECT * FROM ctf_position_tokens WHERE condition_id=$1 ORDER BY id', [c.id])).rows
      return { c, tokens }
    }
    const enroll = async marketId => {
      const { c, tokens } = await roundData(marketId)
      for (const token of tokens) {
        const proof = verifyMockTokenIdentity({ condition: c, token, collateralAddress: c.collateral_address })
        await admin.query('INSERT INTO position_token_verifications(token_id,condition_id,collection_id,position_id,evidence_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(token_id) DO NOTHING', [proof.tokenId, proof.conditionId, proof.collectionId, proof.positionId, proof.evidenceHash])
      }
      return tokens
    }
    const waitAt = async (marketId, col) => { const row = await one('SELECT ' + col + ' AS time FROM market_rounds WHERE market_id=$1', [marketId]); await new Promise(resolve => setTimeout(resolve, Math.max(0, row.time.getTime() - Date.now() + 20))) }
    const drain = async marketId => { for (let i = 0; i < 100; i++) { await service.step(sys, marketId); const r = await engine.step(sys, marketId); if (r.state === 'IDLE') { await service.step(sys, marketId); return } } throw new Error('Unexpected scheduler backlog') }
    const reconcile = async () => { assert.equal((await trading.reconcile(sys)).reconciled, true); assert.equal((await base.positions.reconcile(sys)).reconciled, true) }
    const finance = async () => (await one("SELECT jsonb_build_object('operations',(SELECT count(*) FROM financial_operations),'cash',(SELECT jsonb_agg(p ORDER BY account_id) FROM financial_balance_projections p),'positions',(SELECT jsonb_agg(p ORDER BY account_id) FROM position_balance_projections p)) AS state")).state

    let btc
    await t.test('recurring Bitcoin five-minute rounds have independent immutable canonical identities and no automatic funding', async () => {
      const before = await finance(); btc = await template()
      const first = await service.createNext(sys, btc.templateId), second = await service.createNext(sys, btc.templateId)
      btc.rounds = [first, second]
      assert.notEqual(first.marketId, second.marketId)
      const data = await Promise.all(btc.rounds.map(r => roundData(r.marketId)))
      assert.notEqual(data[0].c.condition_id, data[1].c.condition_id)
      assert.notEqual(data[0].c.ctf_question_id, data[1].c.ctf_question_id)
      assert.equal(new Set(data.flatMap(d => d.tokens.map(tok => tok.position_id))).size, 4)
      assert.ok(data.every(d => d.c.registration_status === 'DERIVED' && d.c.preparation_tx_hash === null))
      assert.equal((await one('SELECT extract(epoch FROM cutoff_at-opens_at)::int AS seconds FROM market_rounds WHERE market_id=$1', [first.marketId])).seconds, 300)
      assert.deepEqual(await finance(), before); await reconcile()
    })
    await t.test('concurrent round creation retries cannot duplicate a round or advance its cursor twice', async () => {
      const a = await template(), plan = await service.plan(sys,a.templateId), payload=deriveRoundRegistry(plan)
      const results = (await Promise.all([runtime.query('SELECT market_schedule_create_round($1,$2::jsonb) AS result',[sys,JSON.stringify(payload)]),runtime.query('SELECT market_schedule_create_round($1,$2::jsonb) AS result',[sys,JSON.stringify(payload)])])).map(r=>r.rows[0].result)
      assert.equal(results[0].marketId, results[1].marketId)
      await assert.rejects(runtime.query('SELECT market_schedule_create_round($1,$2::jsonb)',[sys,JSON.stringify({...payload,conditionId:'0x'+'f'.repeat(64)})]),/conflicting canonical round replay/)
      assert.equal((await one('SELECT count(*)::int AS n FROM market_rounds WHERE template_id=$1', [a.templateId])).n, 1)
      assert.equal((await one('SELECT next_ordinal FROM market_template_controls WHERE template_id=$1', [a.templateId])).next_ordinal, '1')
      await reconcile()
    })
    await t.test('calendar monthly schedules preserve local time, month boundaries and delayed publication independently', async () => {
      const def = definition('PRICE_RANGE'); def.schedule = { ...def.schedule, mode: 'MONTHLY', timezone: 'America/New_York', anchorLocal: '2027-01-31T00:00:00', durationMode: 'NEXT_OCCURRENCE', resultDelaySeconds: '172800', resolutionDelaySeconds: '259200' }
      const a = await template(def), plan = await service.plan(sys, a.templateId)
      assert.equal(new Date(plan.opensAt).toISOString(), '2027-01-31T05:00:00.000Z')
      assert.equal(new Date(plan.cutoffAt).toISOString(), '2027-02-28T05:00:00.000Z')
      assert.equal(new Date(plan.expectedAvailableAt).toISOString(), '2027-03-02T05:00:00.000Z')
      const dst = await one('SELECT market_schedule_time($1::jsonb,2) AS time', [JSON.stringify(def)])
      assert.equal(dst.time.toISOString(), '2027-03-31T04:00:00.000Z')
      for (const local of ['2027-03-14T02:30:00','2027-11-07T01:30:00']) {
        const bad = structuredClone(def); bad.schedule.anchorLocal = local
        await assert.rejects(template(bad), /ambiguous or nonexistent/)
      }
    })
    for (const precision of [0, 2]) await t.test('scheduled ' + (precision ? 'HDPE decimal' : 'gasoline integer') + ' range retains exhaustive boundaries and singleton/complement tokens', async () => {
      const def = definition('PRICE_RANGE');def.schedule.mode=precision?'MONTHLY':'WEEKLY';def.schedule.durationMode='NEXT_OCCURRENCE';def.schedule.resultDelaySeconds=precision?'172800':'86400';def.schedule.resolutionDelaySeconds=precision?'259200':'172800';def.observation.decimals='0';def.observation.referenceAsset='GASOLINE';def.observation.unit='KHR_PER_LITRE';if (precision) { def.observation.decimals = '2'; def.observation.referenceAsset = 'HDPE';def.observation.unit='USD_PER_METRIC_TON'; const edges = ['0','100025','105050','110075','115025','120050']; def.outcomes = edges.map((lower, i) => ({ label: 'Range ' + i, lower, upper: edges[i + 1] ?? null })) }
      const a = await template(def), r = await service.createNext(sys, a.templateId), data = await roundData(r.marketId)
      assert.equal(data.tokens.length, 12)
      assert.equal((await one('SELECT decimals FROM market_observation_specs WHERE market_id=$1', [r.marketId])).decimals, precision)
      await enroll(r.marketId); await reconcile()
    })
    await t.test('one-time categorical football fixture freezes OTHER and never declares a winner', async () => {
      const def = definition('CATEGORICAL'); def.schedule.mode = 'ONCE'
      const a = await template(def), r = await service.createNext(sys, a.templateId)
      assert.equal((await service.createNext(sys, a.templateId)).state, 'COMPLETE')
      assert.equal((await roundData(r.marketId)).tokens.length, 12)
      assert.equal((await one("SELECT count(*)::int AS n FROM market_outcomes WHERE market_id=$1 AND outcome_label='OTHER'", [r.marketId])).n, 1)
      assert.equal((await one('SELECT resolution_status FROM markets WHERE id=$1', [r.marketId])).resolution_status, 'UNRESOLVED')
      await reconcile()
    })
    await t.test('missed scheduling windows are recorded closed and never reopened during bounded catch-up', async () => {
      const def = definition(); def.schedule.anchorLocal = anchor(-610)
      const a = await template(def), x = await service.createNext(sys, a.templateId), y = await service.createNext(sys, a.templateId)
      for (const r of [x, y]) { assert.equal(r.missed, true); assert.equal((await service.step(sys, r.marketId)).state, 'CLOSED'); assert.equal((await one('SELECT trading_status FROM markets WHERE id=$1', [r.marketId])).trading_status, 'CLOSED') }
      assert.equal((await one('SELECT next_ordinal FROM market_template_controls WHERE template_id=$1', [a.templateId])).next_ordinal, '2'); await reconcile()
    })
    await t.test('template versions cannot modify existing frozen round definitions or times', async () => {
      const a = await template(), r = await service.createNext(sys, a.templateId), old = (await admin.query('SELECT * FROM markets WHERE id=$1', [r.marketId])).rows
      await assert.rejects(admin.query("UPDATE market_templates SET definition=jsonb_set(definition,'{title}','\"Changed\"') WHERE id=$1", [a.templateId]), /immutable/)
      const second = await template({ ...a.terms.definition, title: 'New version, same immutable old round' }, a.terms.templateKey, 2n)
      assert.notEqual(second.templateId, a.templateId); assert.equal((await service.plan(sys, a.templateId)).state, 'DISABLED')
      assert.deepEqual((await admin.query('SELECT * FROM markets WHERE id=$1', [r.marketId])).rows, old)
      await assert.rejects(admin.query("UPDATE market_rounds SET opens_at=opens_at+interval '1 second' WHERE market_id=$1", [r.marketId]), /immutable/)
      await reconcile()
    })
    await t.test('restricted runtime cannot mutate scheduling metadata or grant verification evidence', async () => {
      for (const table of ['market_templates','market_rounds','market_lifecycle_events','market_lifecycle_cursors','position_token_verifications']) await assert.rejects(runtime.query('DELETE FROM ' + table), e => e.code === '42501')
      await assert.rejects(service.discover('user:1'), /system authorization/)
      await assert.rejects(runtime.query("SELECT market_schedule_emit($1,NULL,'CREATED','forged')", [btc.templateId]), e => e.code === '42501')
      const denied = createMarketLifecycleService({ ...options, authorize: () => false }); await assert.rejects(denied.createNext(sys, btc.templateId), /not authorized/)
    })
    // Accelerated local rounds exercise real database-clock closure without waiting five minutes.
    await t.test('accelerated consecutive rounds isolate positions orders and reservations while closure releases only unused holds', async () => {
      const def = definition(); def.schedule = { ...def.schedule, anchorLocal: anchor(3), stepSeconds: '7', tradingSeconds: '7', openingGraceSeconds: '5' }
      const a = await template(def), first = await service.createNext(sys, a.templateId), second = await service.createNext(sys, a.templateId)
      const tok1 = (await enroll(first.marketId))[0], tok2 = (await enroll(second.marketId))[0]
      const cash = await fixture(), p1 = await base.accounts(tok1.id), p2 = await base.accounts(tok2.id)
      await assert.rejects(trading.place(cash.actor, key(), { marketId: first.marketId, tokenId: tok1.id, side: 'BUY', quantity: 1000000n, priceCents: 65n, cashAccountId: cash.a, positionAccountId: p1.buyer }), /ownership|not open|closed/)
      await waitAt(first.marketId, 'opens_at'); await service.step(sys, first.marketId)
      const buy = await trading.place(base.cash.actor, key(), { marketId: first.marketId, tokenId: tok1.id, side: 'BUY', quantity: 3000000n, priceCents: 65n, cashAccountId: base.cash.a, positionAccountId: p1.buyer })
      const sell = await trading.place(base.cash.other, key(), { marketId: first.marketId, tokenId: tok1.id, side: 'SELL', quantity: 1000000n, priceCents: 60n, cashAccountId: base.cash.b, positionAccountId: p1.seller })
      await engine.step(sys, first.marketId); await engine.step(sys, first.marketId)
      assert.equal((await one('SELECT filled_quantity FROM trading_orders WHERE id=$1', [buy.orderId])).filled_quantity, '1000000')
      await assert.rejects(trading.place(base.cash.other, key(), { marketId: second.marketId, tokenId: tok2.id, side: 'SELL', quantity: 1000000n, priceCents: 60n, cashAccountId: base.cash.b, positionAccountId: p1.seller }))
      await waitAt(first.marketId, 'cutoff_at'); await drain(first.marketId); await service.step(sys, second.marketId)
      assert.equal((await one('SELECT trading_status FROM markets WHERE id=$1', [first.marketId])).trading_status, 'CLOSED')
      assert.equal((await one('SELECT resolution_status FROM markets WHERE id=$1', [first.marketId])).resolution_status, 'PENDING')
      assert.equal((await one('SELECT trading_status FROM markets WHERE id=$1', [second.marketId])).trading_status, 'OPEN')
      assert.equal((await one('SELECT status FROM trading_orders WHERE id=$1', [sell.orderId])).status, 'FILLED')
      assert.equal((await one('SELECT amount-consumed-released AS remaining FROM cash_reservations WHERE id=(SELECT cash_reservation_id FROM trading_orders WHERE id=$1)', [buy.orderId])).remaining, '0')
      assert.equal((await base.positions.balance(base.cash.actor, p1.buyer)).posted, '1000000')
      const originalHolds=await one('SELECT b.cash_reservation_id,s.position_reservation_id FROM trading_orders b CROSS JOIN trading_orders s WHERE b.id=$1 AND s.id=$2',[buy.orderId,sell.orderId]),beforeCross=await finance()
      await assert.rejects(base.positions.settle(sys,key(),{marketId:second.marketId,tokenId:tok2.id,buyerCashAccountId:base.cash.a,sellerCashAccountId:base.cash.b,buyerPositionAccountId:p2.buyer,sellerPositionAccountId:p2.seller,cashReservationId:originalHolds.cash_reservation_id,positionReservationId:originalHolds.position_reservation_id,cashReservationReference:'order:'+buy.orderId,positionReservationReference:'order:'+sell.orderId,quantity:1000000n,priceCents:60n,matchReference:key()}))
      assert.deepEqual(await finance(),beforeCross)
      await assert.rejects(service.resume(sys, first.marketId), /paused current round/)
      await service.pause(sys, second.marketId); await service.resume(sys, second.marketId)
      await waitAt(second.marketId, 'cutoff_at'); await drain(second.marketId); await reconcile()
      assert.notEqual(p1.buyer, p2.buyer)
    })
    await t.test('unverified scheduled rounds cannot open; repeated pause cycles retain events and paused closure is final',async()=>{
      const def=definition();def.schedule={...def.schedule,mode:'ONCE',anchorLocal:anchor(2),tradingSeconds:'8',openingGraceSeconds:'5'}
      const a=await template(def),r=await service.createNext(sys,a.templateId)
      await assert.rejects(service.pause(sys,r.marketId),/open round can pause/)
      await waitAt(r.marketId,'opens_at');assert.equal((await service.step(sys,r.marketId)).state,'SETUP_REQUIRED')
      await enroll(r.marketId);await service.step(sys,r.marketId)
      for(let i=0;i<2;i++){await service.pause(sys,r.marketId);await service.pause(sys,r.marketId);await service.resume(sys,r.marketId);await service.resume(sys,r.marketId)}
      assert.equal((await one("SELECT count(*)::int AS n FROM market_lifecycle_events WHERE market_id=$1 AND kind='PAUSED'",[r.marketId])).n,2)
      assert.equal((await one("SELECT count(*)::int AS n FROM market_lifecycle_events WHERE market_id=$1 AND kind='RESUMED'",[r.marketId])).n,2)
      await service.pause(sys,r.marketId);await waitAt(r.marketId,'cutoff_at');await drain(r.marketId)
      await assert.rejects(service.resume(sys,r.marketId),/paused current round/);await reconcile()
    })
    await t.test('invalid range definitions roll back round creation without advancing scheduler progress',async()=>{
      const def=definition('PRICE_RANGE');def.outcomes[1].lower='3999'
      const a=await template(def)
      await assert.rejects(service.createNext(sys,a.templateId),/overlapping/)
      assert.equal((await service.history(sys,a.templateId)).length,0)
      assert.equal((await one('SELECT next_ordinal FROM market_template_controls WHERE template_id=$1',[a.templateId])).next_ordinal,'0')
      await service.enable(sys,a.templateId,false);await reconcile()
    })
    await t.test('missing conflicting and delayed mock observations remain pending without payout or oracle submission', async () => {
      const def = definition(); def.schedule.anchorLocal = anchor(-400); const a = await template(def), r = await service.createNext(sys, a.templateId), row = await one('SELECT * FROM market_rounds WHERE market_id=$1', [r.marketId])
      await drain(r.marketId); assert.equal((await service.history(sys, a.templateId))[0].readiness.OPEN, 'MISSING')
      const before = await finance(), evidence = { marketId: r.marketId, kind: 'OPEN', observedAt: row.observation_start.toISOString(), value: 100000000n, evidenceRef: 'mock:' + key(), isFinal: true }
      await service.observe(sys, evidence); await service.observe(sys, evidence)
      await service.observe(sys, { ...evidence, evidenceRef: 'mock:' + key(), value: 100000001n })
      assert.equal((await service.history(sys, a.templateId))[0].readiness.OPEN, 'CONFLICT')
      await assert.rejects(service.observe(sys, { ...evidence, marketId: btc.rounds[1].marketId }), /round requirement/)
      assert.equal((await one('SELECT resolution_status FROM markets WHERE id=$1', [r.marketId])).resolution_status, 'PENDING')
      assert.deepEqual(await finance(), before); await reconcile()
    })
    await t.test('final mock evidence cannot bypass independently scheduled result availability',async()=>{
      const def=definition();def.schedule.anchorLocal=anchor(-400);def.schedule.resultDelaySeconds='3600'
      const a=await template(def),r=await service.createNext(sys,a.templateId),row=await one('SELECT * FROM market_rounds WHERE market_id=$1',[r.marketId])
      await service.observe(sys,{marketId:r.marketId,kind:'CLOSE',observedAt:row.observation_end.toISOString(),value:123000000n,evidenceRef:'mock:'+key(),isFinal:true})
      assert.equal((await service.history(sys,a.templateId))[0].readiness.CLOSE,'WAITING_PUBLICATION')
      assert.equal((await one('SELECT resolution_status FROM markets WHERE id=$1',[r.marketId])).resolution_status,'PENDING')
      await drain(r.marketId);await reconcile()
    })
    await t.test('database connection loss rolls back round creation and recovery reads its durable cursor',async()=>{
      const a=await template();let commits=0
      const wrapped={connect:async()=>{const client=await runtime.connect();client.on('error',()=>{});const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
        return {release:error=>client.release(error),query:async(...args)=>{
          if(args[0]==='COMMIT'&&++commits===2){await admin.query('SELECT pg_terminate_backend($1)',[pid]);throw Object.assign(new Error('Injected disposable connection loss'),{code:'08006'})}
          return client.query(...args)
        }}
      }}
      const interrupted=createMarketLifecycleService({...options,pool:wrapped})
      await assert.rejects(interrupted.createNext(sys,a.templateId),error=>error.commitOutcome==='UNKNOWN')
      assert.equal((await service.history(sys,a.templateId)).length,0)
      assert.equal((await one('SELECT next_ordinal FROM market_template_controls WHERE template_id=$1',[a.templateId])).next_ordinal,'0')
      await service.createNext(sys,a.templateId);assert.equal((await service.history(sys,a.templateId)).length,1);await reconcile()
    })
    await t.test('scheduler worker failure and restart use durable cursors and sanitized public diagnostics', async () => {
      const controller = new AbortController(), errors = []
      await runMarketSchedulerWorker({ service: { discover: async () => { controller.abort(); throw new Error('secret database credentials') } }, matching: engine, actor: sys, signal: controller.signal, onError: e => errors.push(e) })
      assert.deepEqual(errors, [{ code: 'SCHEDULE_DISCOVERY_FAILED' }])
      await service.failure(sys, btc.templateId, 'MOCK_CONNECTION_LOSS'); await service.recovered(sys, btc.templateId)
      assert.equal((await one('SELECT last_error FROM market_template_controls WHERE template_id=$1', [btc.templateId])).last_error, null)
    })
    await t.test('two scheduler workers and a restarted worker advance only persisted round cursors',async()=>{
      const def=definition();def.schedule.lookaheadSeconds='3600';const a=await template(def)
      assert.ok((await service.discover(sys)).templates.includes(a.templateId))
      const lane={...service,discover:async()=>({templates:[a.templateId],markets:[]})}
      const run=async()=>{const controller=new AbortController(),errors=[];await runMarketSchedulerWorker({service:lane,matching:engine,actor:sys,signal:controller.signal,pollMs:25,onError:e=>errors.push(e),onDiagnostic:()=>controller.abort()});assert.deepEqual(errors,[])}
      await Promise.all([run(),run()]);const before=Number((await one('SELECT next_ordinal FROM market_template_controls WHERE template_id=$1',[a.templateId])).next_ordinal)
      await run();assert.equal(Number((await one('SELECT next_ordinal FROM market_template_controls WHERE template_id=$1',[a.templateId])).next_ordinal),before+1)
      assert.equal((await one('SELECT count(*)::int AS n FROM market_rounds WHERE template_id=$1',[a.templateId])).n,before+1);await reconcile()
    })
    await t.test('public lifecycle event replay and cursor acknowledgement cannot expose private financial state', async () => {
      const actor = 'system:market-publisher', before = await finance(), batch = await service.events(actor, btc.templateId, 10n)
      assert.ok(batch.events.length); assert.ok(!/cashAccount|orderId|userId|filledQuantity|balance/.test(JSON.stringify(batch)))
      await assert.rejects(service.acknowledge(actor, btc.templateId, batch.afterSequence, batch.events.slice(1).map(e => e.eventId)), /exact next lifecycle/)
      const ids = batch.events.map(e => e.eventId); await service.acknowledge(actor, btc.templateId, batch.afterSequence, ids)
      assert.equal((await service.acknowledge(actor, btc.templateId, batch.afterSequence, ids)).replayed, true)
      assert.equal((await service.events('system:another-publisher', btc.templateId, 1n)).afterSequence, '0'); assert.deepEqual(await finance(), before)
    })
    for (const mode of ['before', 'after']) await t.test('scheduler process kill ' + mode + ' round creation commit recovers without duplicates', async () => {
      const a = await template(), child = fork(fileURLToPath(new URL('./schedulerCrashChild.js', import.meta.url)), [], { env: { ...process.env, NODE_ENV: 'test' }, execArgv: [], windowsHide: true, stdio: ['ignore','ignore','ignore','ipc'] }), exited = new Promise(resolve => child.once('exit', resolve))
      let timer
      try {
        const checkpoint = new Promise((resolve, reject) => { child.once('message', m => m.checkpoint === mode ? resolve() : reject(new Error('Isolated scheduler worker failed'))); child.once('error', reject); child.once('exit', () => reject(new Error('Scheduler exited before checkpoint'))) })
        child.send({ config: { ...config, database, user: 'schedule_runtime', password }, templateId: a.templateId, actor: sys, mode })
        await Promise.race([checkpoint, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Scheduler checkpoint timeout')), 15000) })])
      } finally { clearTimeout(timer); child.kill('SIGKILL'); await exited }
      const count = (await one('SELECT count(*)::int AS n FROM market_rounds WHERE template_id=$1', [a.templateId])).n
      assert.equal(count, mode === 'before' ? 0 : 1)
      if (!count) await service.createNext(sys, a.templateId)
      assert.equal((await one('SELECT count(*)::int AS n FROM market_rounds WHERE template_id=$1', [a.templateId])).n, 1); await reconcile()
    })
    await t.test('scheduler bounded concurrent bulk creation benchmark reconciles without balance credits', async () => {
      const def=definition();def.schedule.lookaheadSeconds='3600'
      const before = await finance(), a = await template(def), b = await template(def), times = [], start = performance.now(), deadlocks = (await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks
      for (let i = 0; i < 6; i++) { const tick = performance.now(); await Promise.all([service.createNext(sys, a.templateId), service.createNext(sys, b.templateId)]); times.push(performance.now() - tick) }
      const elapsedMs = performance.now() - start; times.sort((x, y) => x - y)
      assert.equal((await one('SELECT count(*)::int AS n FROM market_rounds WHERE template_id=ANY($1::uuid[])',[[a.templateId,b.templateId]])).n,12)
      assert.equal((await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks, deadlocks); assert.deepEqual(await finance(), before); await reconcile()
      t.diagnostic(JSON.stringify({ schedulerBenchmark: 'two-independent-templates', rounds: 12, workers: 2, elapsedMs, roundsPerSecond: 12000 / elapsedMs, averagePairedMs: times.reduce((x, y) => x + y, 0) / times.length, p95: times.at(-1), p99: times.at(-1), deadlocks: 0, discrepancies: 0, reconciled: true }))
    })
    await t.test('simultaneous closures expire shared-account reservations while another round keeps trading',async()=>{
      const def=definition();def.schedule={...def.schedule,mode:'ONCE',anchorLocal:anchor(4),tradingSeconds:'12',openingGraceSeconds:'10'}
      const live=structuredClone(def);live.schedule.tradingSeconds='40'
      const templates=await Promise.all([template(def),template(def),template(live)]),rounds=await Promise.all(templates.map(a=>service.createNext(sys,a.templateId)))
      const tokens=await Promise.all(rounds.map(async r=>(await enroll(r.marketId))[0])),positions=await Promise.all(tokens.map(tok=>base.accounts(tok.id)))
      await waitAt(rounds[0].marketId,'opens_at');await Promise.all(rounds.map(r=>service.step(sys,r.marketId)))
      const orders=[]
      for(let i=0;i<4;i++)for(let r=0;r<2;r++)orders.push(await trading.place(i%2?base.cash.actor:base.cash.other,key(),{marketId:rounds[r].marketId,tokenId:tokens[r].id,side:i%2?'BUY':'SELL',quantity:1000000n,priceCents:i%2?50n:70n,cashAccountId:i%2?base.cash.a:base.cash.b,positionAccountId:i%2?positions[r].buyer:positions[r].seller}))
      await Promise.all(rounds.slice(0,2).map(r=>engine.step(sys,r.marketId)))
      await waitAt(rounds[0].marketId,'cutoff_at')
      let stopped=false,maxWaiters=0
      const monitor=(async()=>{while(!stopped){maxWaiters=Math.max(maxWaiters,(await one("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).n);await new Promise(r=>setTimeout(r,5))}})()
      const deadlocks=(await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks,start=performance.now(),times=[]
      try{
        await Promise.all(rounds.slice(0,2).map(async r=>{const tick=performance.now();await drain(r.marketId);times.push(performance.now()-tick)}))
        const buyer=await trading.place(base.cash.actor,key(),{marketId:rounds[2].marketId,tokenId:tokens[2].id,side:'BUY',quantity:1000000n,priceCents:65n,cashAccountId:base.cash.a,positionAccountId:positions[2].buyer})
        await trading.place(base.cash.other,key(),{marketId:rounds[2].marketId,tokenId:tokens[2].id,side:'SELL',quantity:1000000n,priceCents:60n,cashAccountId:base.cash.b,positionAccountId:positions[2].seller})
        for(let i=0;i<4;i++)await engine.step(sys,rounds[2].marketId)
        assert.equal((await one('SELECT status FROM trading_orders WHERE id=$1',[buyer.orderId])).status,'FILLED')
        for(const r of orders)assert.equal((await one('SELECT status FROM trading_orders WHERE id=$1',[r.orderId])).status,'EXPIRED')
        assert.equal((await one('SELECT count(*)::int AS n FROM market_rounds WHERE market_id=ANY($1::uuid[]) AND expiration_complete',[rounds.slice(0,2).map(r=>r.marketId)])).n,2)
        assert.equal((await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks,deadlocks)
        await reconcile();times.sort((a,b)=>a-b)
        t.diagnostic(JSON.stringify({schedulerBenchmark:'two-closures-shared-cash-plus-live-trade',expiredOrders:8,closedMarkets:2,activeMarkets:1,elapsedMs:performance.now()-start,expiredOrdersPerSecond:8000/(performance.now()-start),averageClosureMs:times.reduce((a,b)=>a+b,0)/times.length,p95:times.at(-1),p99:times.at(-1),maxWaiters,deadlocks:0,discrepancies:0,reconciled:true}))
      }finally{stopped=true;await monitor}
    })
    await ledger.rebuild(sys, key()); await base.positions.rebuild(sys, key()); await reconcile()
    const history = (await admin.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows
    assert.equal(history.length, 20); await migrate(drizzle(admin), { migrationsFolder: fileURLToPath(new URL('../../db/migrations/', import.meta.url)) }); assert.deepEqual((await admin.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows, history)
    assert.ok((await service.diagnostics(sys)).missedSchedules > 0)
    assert.ok(lifecycle)
  } finally { await runtime?.end(); await admin?.end(); await parent.end() }
})
