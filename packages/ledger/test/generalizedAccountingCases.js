import { runMatchingCases } from './matchingCases.js'
import { runTradingCases } from './tradingCases.js'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { verifyMockTokenIdentity } from '../src/tokenVerification.js'

// No runtime enrollment API. This verifier runs only in the parent-verified disposable fixture.
export async function runGeneralizedAccountingCases(t, { admin, runtime, ledger, sys, key, base, definitions, expiredFixture, fixture }) {
  const { positions, cash, unit } = base
  const registered = definitions.filter(d => d.tokens)
  const generalized = registered.filter(d => d.type !== 'BINARY')
  const one = async (sql, args) => (await admin.query(sql, args)).rows[0]
  const accounts = new Map()
  const snapshot = async () => (await admin.query(`SELECT jsonb_build_object(
    'cash',(SELECT jsonb_agg(p ORDER BY account_id) FROM financial_balance_projections p),
    'positions',(SELECT jsonb_agg(p ORDER BY account_id) FROM position_balance_projections p),
    'settlements',(SELECT count(*) FROM cash_position_settlements)) AS state`)).rows[0].state

  async function enroll(d) {
    const condition = await one('SELECT * FROM ctf_conditions WHERE id=$1', [d.condition.id])
    for (const token of d.tokens) {
      const row = await one('SELECT * FROM ctf_position_tokens WHERE id=$1', [token.id])
      assert.throws(() => verifyMockTokenIdentity({ condition, token: { ...row, index_set: 1 }, collateralAddress: d.condition.collateral_address }), /exact integer/)
      const evidence = verifyMockTokenIdentity({ condition, token: row, collateralAddress: d.condition.collateral_address })
      assert.throws(() => verifyMockTokenIdentity({ condition, token: { ...row, position_id: '1' }, collateralAddress: d.condition.collateral_address }), /identifier/)
      assert.throws(() => verifyMockTokenIdentity({ condition: { ...condition, ctf_question_id: '0x'+'f'.repeat(64) }, token: row, collateralAddress: d.condition.collateral_address }), /Condition identifier/)
      assert.throws(() => verifyMockTokenIdentity({ condition, token: { ...row, chain_id: '999999999' }, collateralAddress: d.condition.collateral_address }), /references/)
      await admin.query('INSERT INTO position_token_verifications(token_id,condition_id,collection_id,position_id,evidence_hash) VALUES($1,$2,$3,$4,$5)', [evidence.tokenId, evidence.conditionId, evidence.collectionId, evidence.positionId, evidence.evidenceHash])
    }
  }
  await t.test('only independently derived canonical identities receive immutable mock evidence', async () => {
    for (const d of generalized) await enroll(d)
    await assert.rejects(runtime.query('DELETE FROM position_token_verifications'), e => e.code === '42501')
    await assert.rejects(runtime.query('TRUNCATE position_token_verifications'), e => e.code === '42501')
    await assert.rejects(runtime.query("INSERT INTO position_token_verifications(token_id) VALUES(1)"), e => e.code === '42501')
    await assert.rejects(admin.query('UPDATE position_token_verifications SET evidence_hash=evidence_hash'), /immutable/)
    await assert.rejects(admin.query('DELETE FROM position_token_verifications'), /immutable/)
  })

  async function reserve(d, tokenId, a, n = 2, price = 65n) {
    const cashReservationReference = key(), positionReservationReference = key()
    const cr = await ledger.reserve(cash.actor, key(), { accountId: cash.a, amount: BigInt(n) * price, reference: cashReservationReference })
    const pr = await positions.reserve(cash.other, key(), { accountId: a.seller, quantity: BigInt(n) * unit, reference: positionReservationReference })
    return { marketId: d.marketId, tokenId, buyerCashAccountId: cash.a, sellerCashAccountId: cash.b,
      buyerPositionAccountId: a.buyer, sellerPositionAccountId: a.seller, cashReservationId: cr.reservationId,
      positionReservationId: pr.reservationId, cashReservationReference, positionReservationReference, quantity: unit, priceCents: 60n }
  }
  const fill = terms => positions.settle(sys, key(), { ...terms, matchReference: key() })

  for (const d of registered) {
    await t.test(`${d.type} ${d.marketId}: every canonical singleton/complement supports exact accounting`, async () => {
      for (const token of d.tokens) {
        const a = await base.accounts(token.id)
        accounts.set(token.id, a)
        const terms = await reserve(d, token.id, a)
        const operation = key(), request = { ...terms, matchReference: key() }
        const [result, duplicate] = await Promise.all([positions.settle(sys, operation, request), positions.settle(sys, operation, request)])
        assert.deepEqual(duplicate, result)
        await fill(terms)
        // Two fills at 60 consume 120 of the 130-cent hold; release the improvement explicitly.
        await ledger.release(cash.actor, key(), { reservationId: terms.cashReservationId, amount: 10n })
        assert.equal((await positions.balance(cash.actor, a.buyer)).posted, '2000000')
        const cancel = await positions.reserve(cash.other, key(), { accountId: a.seller, quantity: unit, reference: key() })
        await positions.cancel(cash.other, key(), cancel.reservationId)
        await assert.rejects(positions.reserve(cash.other, key(), { accountId: a.seller, quantity: 1000000000n, reference: key() }), /insufficient/)
      }
      assert.equal((await positions.reconcile(sys)).reconciled, true)
    })
  }

  const d = generalized.find(d => d.type === 'CATEGORICAL')
  const token = d.tokens[0], a = accounts.get(token.id)
  await t.test('exact token, market, condition, chain and round identities cannot substitute reservations', async () => {
    const terms = await reserve(d, token.id, a, 8)
    const foreign = await base.registry()
    await assert.rejects(fill({...terms, tokenId: foreign.tokenId, marketId: foreign.marketId}), /market token mismatch|token mismatch/)
    const before = await snapshot()
    for (const other of registered.flatMap(m => m.tokens.map(token => ({ market: m, token }))).filter(v => v.token.id !== token.id)) {
      await assert.rejects(fill({ ...terms, tokenId: other.token.id }))
      if (other.market.marketId !== d.marketId) await assert.rejects(fill({ ...terms, marketId: other.market.marketId }))
    }
    await assert.rejects(fill({ ...terms, sellerCashAccountId: cash.a }), /owner mismatch|self trade/)
    await assert.rejects(positions.reserve(cash.actor, key(), { accountId: a.seller, quantity: unit, reference: key() }), /access denied/)
    assert.deepEqual(await snapshot(), before)
    await admin.query("UPDATE markets SET trading_status='PAUSED' WHERE id=$1", [d.marketId])
    await assert.rejects(fill(terms), /not open/)
    await admin.query("UPDATE markets SET trading_status='OPEN' WHERE id=$1", [d.marketId])
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => fill(terms)))
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 3)
    await ledger.cancel(cash.actor, key(), terms.cashReservationId)
    await positions.cancel(cash.other, key(), terms.positionReservationId)
  })

  await t.test('one generalized seller reservation serves distinct authorized counterparties', async () => {
    const third = await admin.query("INSERT INTO users(email,display_name) VALUES($1,'Third counterparty') RETURNING id", [key()+'@example.test'])
    const ownerUserId = third.rows[0].id, actor = 'user:'+ownerUserId
    const cashAccount = (await ledger.createAccount(sys,key(),{asset:'USD',ownerUserId,accountKey:key(),kind:'CUSTOMER',normalSide:'CREDIT'})).accountId
    await ledger.post(sys,key(),[{accountId:cash.cash,asset:'USD',side:'DEBIT',amount:1000n},{accountId:cashAccount,asset:'USD',side:'CREDIT',amount:1000n}],key())
    const positionAccount = (await positions.createAccount(sys,key(),{tokenId:token.id,ownerUserId,accountKey:key(),kind:'CUSTOMER'})).accountId
    const terms = await reserve(d,token.id,a,2,60n)
    await fill(terms)
    const reference = key(), hold = await ledger.reserve(actor,key(),{accountId:cashAccount,amount:60n,reference})
    await fill({...terms,buyerCashAccountId:cashAccount,buyerPositionAccountId:positionAccount,cashReservationId:hold.reservationId,cashReservationReference:reference})
    await ledger.cancel(cash.actor,key(),terms.cashReservationId)
    assert.equal((await positions.balance(actor,positionAccount)).posted,'1000000')
    assert.equal((await positions.reconcile(sys)).reconciled,true)
  })

  await t.test('elapsed categorical trading cutoff rejects settlement while cancellation remains available', async () => {
    const expired = await expiredFixture(); await enroll(expired)
    const tok = expired.tokens[0], pair = await base.accounts(tok.id)
    const terms = await reserve(expired, tok.id, pair)
    const before = await snapshot()
    await assert.rejects(fill(terms), /cutoff/)
    assert.deepEqual(await snapshot(), before)
    await ledger.cancel(cash.actor, key(), terms.cashReservationId)
    await positions.cancel(cash.other, key(), terms.positionReservationId)
    assert.equal((await positions.reconcile(sys)).reconciled, true)
  })

  await t.test('generalized settlement rolls back cash and positions after a late injected failure', async () => {
    const terms = await reserve(d, token.id, a)
    const before = await snapshot()
    // A persistent trigger cannot reference a session-local function on a pool connection. Use an isolated public fixture, then remove it in finally.
    await admin.query(`CREATE FUNCTION public.test_fail_generalized_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected generalized settlement failure'; END $$`)
    try {
      await admin.query('CREATE TRIGGER zz_test_fail_generalized BEFORE INSERT ON cash_position_settlements FOR EACH ROW EXECUTE FUNCTION public.test_fail_generalized_settlement()')
      await assert.rejects(fill(terms), /injected generalized/)
      assert.deepEqual(await snapshot(), before)
    } finally {
      await admin.query('DROP TRIGGER IF EXISTS zz_test_fail_generalized ON cash_position_settlements')
      await admin.query('DROP FUNCTION public.test_fail_generalized_settlement()')
    }
    await ledger.cancel(cash.actor, key(), terms.cashReservationId)
    await positions.cancel(cash.other, key(), terms.positionReservationId)
  })

  await t.test('reconstructed generalized projections support subsequent settlements', async () => {
    await ledger.rebuild(sys, key()); await positions.rebuild(sys, key())
    const terms = await reserve(d, token.id, a)
    await fill(terms)
    await ledger.cancel(cash.actor, key(), terms.cashReservationId)
    await positions.cancel(cash.other, key(), terms.positionReservationId)
    assert.equal((await positions.reconcile(sys)).reconciled, true)
  })

  await t.test('comparable binary, singleton, complement and shared-account benchmarks reconcile', async () => {
    const binary = registered.find(d => d.type === 'BINARY')
    const cases = [['binary', binary, binary.tokens[0], 1], ['singleton', d, d.tokens[0], 1], ['complement', d, d.tokens[1], 1], ['shared', d, d.tokens[0], 8]]
    for (const [name, market, tok, concurrency] of cases) {
      const pair = accounts.get(tok.id)
      const count = concurrency === 1 ? 1000 : 100
      // Grow inventory using owner-only balanced mock recognition, then allocate through the authorized service.
      await pair.recognize(2000n * unit)
      await positions.transfer(sys, key(), { sourceAccountId: pair.unallocated, targetAccountId: pair.seller, quantity: 1000n * unit, reference: key() })
      const terms = await reserve(market, tok.id, pair, count, 60n)
      const times = [], start = performance.now()
      const deadlocks = (await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks
      for (let i = 0; i < count; i += concurrency) {
        await Promise.all(Array.from({ length: Math.min(concurrency, count - i) }, async () => {
          const tick = performance.now(); await fill(terms); times.push(performance.now() - tick)
        }))
      }
      const elapsed = performance.now() - start
      times.sort((a,b) => a-b)
      assert.equal((await one('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()')).deadlocks, deadlocks)
      assert.equal((await positions.reconcile(sys)).reconciled, true)
      t.diagnostic(JSON.stringify({ generalizedBenchmark: name, count, elapsedMs: elapsed, tps: count * 1000 / elapsed,
        averageMs: times.reduce((a,b)=>a+b,0)/count, p95: times[Math.ceil(count*.95)-1], p99: times[Math.ceil(count*.99)-1], deadlocks: 0, reconciled: true }))
    }
  })
  const tradingContext={admin,runtime,ledger,positions,cash,accounts,registered,sys,key,expiredFixture,enroll,base,fixture}
  await runTradingCases(t, tradingContext)
  await runMatchingCases(t, tradingContext)

}
