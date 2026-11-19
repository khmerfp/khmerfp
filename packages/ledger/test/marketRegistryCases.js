import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createPositionFixture } from './positionCases.js'
import { deriveConditionId, deriveCollectionId, derivePositionId } from '../../contracts/src/ctfIdentifiers.js'
import { claimIndexSet, parseObservation } from '../../domain/src/marketRegistry.js'

// Invoked only inside the parent runner's verified disposable PostgreSQL container.
export async function runMarketRegistryCases(t, context) {
  const { admin, sys, key } = context
  const one = async (sql, args) => (await admin.query(sql, args)).rows[0]
  const hex = bytes => `0x${randomBytes(bytes).toString('hex')}`
  const base = await createPositionFixture({ ...context, chainSeed: 950000 })
  const definitions = []

  async function definition(type = 'CATEGORICAL', options = {}) {
    const category = await one("INSERT INTO market_categories(name,slug) VALUES('Registry fixture',$1) RETURNING id", [key()])
    const market = await one(`INSERT INTO markets(category_id,slug,title,description,market_type,outcome_count,
      trading_starts_at,trading_ends_at,resolution_deadline,series_key,round_key)
      VALUES($1,$2,'Registry fixture','Mock observation only',$3,$4,clock_timestamp()-interval '1 hour',
      clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours',$5,$6) RETURNING id`,
    [category.id, key(), type, type === 'BINARY' ? 2 : 6, options.series ?? null, options.round ?? null])
    const question = await one(`INSERT INTO market_questions(market_id,question_text,resolution_rules,resolution_source)
      VALUES($1,'Fixture question','Exactly one result; missing evidence stays pending','Mock source') RETURNING id`, [market.id])
    const d = { marketId: market.id, questionId: question.id, type, outcomes: [] }
    if (type === 'PRICE_RANGE') {
      await admin.query(`INSERT INTO market_observation_specs(market_id,reference_asset,unit,decimals,domain_lower,source_policy,observation_timezone)
        VALUES($1,$2,$3,$4,0,'Exact source boundary; no rounding or fallback','Asia/Phnom_Penh')`,
      [d.marketId, options.decimals === 2 ? 'HDPE' : 'GASOLINE', options.decimals === 2 ? 'USD_PER_METRIC_TON' : 'KHR_PER_LITRE', options.decimals ?? 0])
    }
    definitions.push(d)
    return d
  }

  async function outcomes(d, bounds = null) {
    const n = d.type === 'BINARY' ? 2 : 6
    for (let i = 0; i < n; i++) {
      const o = await one(`INSERT INTO market_outcomes(market_id,question_id,outcome_index,outcome_label,range_lower,range_upper)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id,outcome_index`,
      [d.marketId, d.questionId, i, d.type === 'BINARY' ? ['YES', 'NO'][i] : `Outcome ${i}`, bounds?.[i]?.[0] ?? null, bounds?.[i]?.[1] ?? null])
      d.outcomes.push(o)
    }
  }

  async function freeze(d) {
    await admin.query("UPDATE markets SET lifecycle_status='REVIEW' WHERE id=$1", [d.marketId])
    await admin.query("UPDATE markets SET lifecycle_status='SCHEDULED',terms_hash=$2,terms_frozen_at=clock_timestamp() WHERE id=$1", [d.marketId, hex(32)])
    await admin.query("UPDATE markets SET lifecycle_status='ACTIVE',trading_status='OPEN' WHERE id=$1", [d.marketId])
  }

  async function register(d) {
    const template = await one(`SELECT c.*,a.contract_address AS collateral_address FROM ctf_conditions c
      JOIN market_questions q ON q.id=c.market_question_id JOIN chain_assets a ON a.id=c.collateral_asset_id
      WHERE q.market_id=$1`, [base.market.marketId])
    const questionId = hex(32)
    const count = d.outcomes.length
    const conditionId = deriveConditionId({ oracle: template.oracle_address, questionId, outcomeSlotCount: count })
    const condition = await one(`INSERT INTO ctf_conditions(market_question_id,chain_id,ctf_contract_deployment_id,
      oracle_contract_deployment_id,oracle_address,ctf_question_id,condition_id,outcome_slot_count,collateral_asset_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [d.questionId, template.chain_id, template.ctf_contract_deployment_id, template.oracle_contract_deployment_id,
      template.oracle_address, questionId, conditionId, count, template.collateral_asset_id])
    d.condition = { ...template, id: condition.id, condition_id: conditionId, collateral_address: template.collateral_address }
    d.tokens = []
    for (const o of d.outcomes) {
      for (const polarity of ['YES', 'NO']) {
        const mask = claimIndexSet(count, o.outcome_index, polarity)
        if (d.tokens.some(token => token.mask === mask)) continue
        const atomic = d.outcomes.find(row => (1n << BigInt(row.outcome_index)) === mask)
        const collectionId = deriveCollectionId({ conditionId, indexSet: mask })
        const positionId = BigInt(derivePositionId({ collateralAddress: template.collateral_address, collectionId })).toString()
        const token = await one(`INSERT INTO ctf_position_tokens(condition_id,market_outcome_id,chain_id,
          ctf_contract_deployment_id,collateral_asset_id,outcome_index,index_set,collection_id,position_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [condition.id, atomic?.id ?? null, template.chain_id, template.ctf_contract_deployment_id,
          template.collateral_asset_id, atomic?.outcome_index ?? null, mask.toString(), collectionId, positionId])
        d.tokens.push({ ...token, mask })
      }
    }
  }

  await t.test('six categorical outcomes freeze with no binary labels or invented token identities', async () => {
    const d = await definition()
    await outcomes(d)
    await freeze(d)
    await register(d)
    assert.equal(d.tokens.length, 12)
    assert.equal((await one(`SELECT count(*)::int AS n FROM market_outcome_tokens a
      JOIN market_outcomes o ON o.id=a.market_outcome_id WHERE o.market_id=$1`, [d.marketId])).n, 12)
  })

  await t.test('binary claim aliases reuse two canonical tokens instead of four inventories', async () => {
    const d = await definition('BINARY')
    await outcomes(d)
    await freeze(d)
    await register(d)
    const rows = (await admin.query(`SELECT a.polarity,o.outcome_index,a.token_id FROM market_outcome_tokens a
      JOIN market_outcomes o ON o.id=a.market_outcome_id WHERE o.market_id=$1 ORDER BY o.outcome_index,a.polarity`, [d.marketId])).rows
    assert.equal(rows.length, 4)
    assert.equal(new Set(rows.map(row => row.token_id)).size, 2)
    assert.equal(rows.find(row => row.outcome_index === 0 && row.polarity === 'NO').token_id,
      rows.find(row => row.outcome_index === 1 && row.polarity === 'YES').token_id)
  })

  await t.test('six HDPE intervals preserve cents per ton, exact coverage and complement identities', async () => {
    const d = await definition('PRICE_RANGE', { decimals: 2 })
    const edges = ['0', '1000.25', '1050.50', '1100.75', '1150.25', '1200.50'].map(value => parseObservation(value, 2).toString())
    await outcomes(d, edges.map((value, i) => [value, edges[i + 1] ?? null]))
    await freeze(d)
    await register(d)
    assert.equal((await one('SELECT range_upper FROM market_outcomes WHERE id=$1', [d.outcomes[0].id])).range_upper, '100025')
    assert.equal(d.tokens.length, 12)
  })

  await t.test('gasoline uses whole KHR observations without changing USD trading precision', async () => {
    const d = await definition('PRICE_RANGE')
    const edges = ['0', '4000', '4100', '4200', '4300', '4400']
    await outcomes(d, edges.map((value, i) => [value, edges[i + 1] ?? null]))
    await freeze(d)
    assert.equal((await one('SELECT decimals FROM market_observation_specs WHERE market_id=$1', [d.marketId])).decimals, 0)
    assert.equal((await one("SELECT decimals FROM financial_assets WHERE code='USD'")).decimals, 2)
  })

  await t.test('overlap is rejected and a missing range prevents freezing', async () => {
    const d = await definition('PRICE_RANGE')
    await admin.query(`INSERT INTO market_outcomes(market_id,question_id,outcome_index,outcome_label,range_lower,range_upper)
      VALUES($1,$2,0,'First',0,4000)`, [d.marketId, d.questionId])
    await assert.rejects(admin.query(`INSERT INTO market_outcomes(market_id,question_id,outcome_index,outcome_label,range_lower,range_upper)
      VALUES($1,$2,1,'Overlap',3999,4100)`, [d.marketId, d.questionId]), /overlapping/)
    const gap = await definition('PRICE_RANGE')
    await outcomes(gap, [['0', '4000'], ['4001', '4100'], ['4100', '4200'], ['4200', '4300'], ['4300', '4400'], ['4400', null]])
    await assert.rejects(freeze(gap), /gap/)
  })

  await t.test('fractional scaled boundaries, invalid precision and unknown timezones are rejected', async () => {
    const d = await definition('PRICE_RANGE')
    for (const lower of ['0.5', 'NaN', 'Infinity', '1'.repeat(79)]) {
      await assert.rejects(admin.query(`INSERT INTO market_outcomes(market_id,question_id,outcome_index,outcome_label,range_lower,range_upper)
        VALUES($1,$2,0,'Invalid',$3,4000)`, [d.marketId, d.questionId, lower]), error => error.code === '23514')
    }
    await assert.rejects(admin.query('UPDATE market_observation_specs SET decimals=19 WHERE market_id=$1', [d.marketId]), error => error.code === '23514')
    await assert.rejects(admin.query("UPDATE market_observation_specs SET observation_timezone='Unknown/Zone' WHERE market_id=$1", [d.marketId]), /timezone/)
  })

  await t.test('freezing waits for concurrent outcome edits and validates their committed state', async () => {
    const d = await definition()
    const writer = await admin.connect(), freezer = await admin.connect()
    let pending
    try {
      await writer.query('BEGIN')
      await writer.query("INSERT INTO market_outcomes(market_id,question_id,outcome_index,outcome_label) VALUES($1,$2,0,'Only one')", [d.marketId, d.questionId])
      await freezer.query('BEGIN')
      const pid = (await freezer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      pending = assert.rejects((async () => {
        await freezer.query("UPDATE markets SET lifecycle_status='REVIEW' WHERE id=$1", [d.marketId])
        await freezer.query('UPDATE markets SET terms_hash=$2,terms_frozen_at=clock_timestamp() WHERE id=$1', [d.marketId, hex(32)])
      })(), /complete question/)
      let blocked = false
      for (let i = 0; i < 100; i++) {
        blocked = (await one('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked', [pid])).blocked
        if (blocked) break
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.equal(blocked, true)
      await writer.query('COMMIT')
      await pending
    } finally {
      await writer.query('ROLLBACK')
      await pending
      await freezer.query('ROLLBACK')
      writer.release(); freezer.release()
    }
  })

  await t.test('missing outcomes, out-of-order ranges and missing domain tails cannot freeze', async () => {
    const missing = await definition()
    await assert.rejects(freeze(missing), /complete question/)
    const reversed = await definition('PRICE_RANGE')
    await outcomes(reversed, [['0', '100'], ['200', '300'], ['100', '200'], ['300', '400'], ['400', '500'], ['500', null]])
    await assert.rejects(freeze(reversed), /gap/)
    const tail = await definition('PRICE_RANGE')
    await outcomes(tail, [['0', '100'], ['100', '200'], ['200', '300'], ['300', '400'], ['400', '500'], ['500', '600']])
    await assert.rejects(freeze(tail), /upper domain/)
  })

  await t.test('frozen definitions, precision, source policy and mappings are immutable', async () => {
    const d = definitions.find(row => row.type === 'PRICE_RANGE' && row.tokens)
    await assert.rejects(admin.query('UPDATE market_observation_specs SET decimals=3 WHERE market_id=$1', [d.marketId]), /frozen/)
    await assert.rejects(admin.query('UPDATE market_outcomes SET range_lower=1 WHERE id=$1', [d.outcomes[0].id]), /frozen/)
    await assert.rejects(admin.query('UPDATE markets SET outcome_count=7 WHERE id=$1', [d.marketId]), /immutable|frozen|freezes|protects/)
    await assert.rejects(admin.query('DELETE FROM market_outcome_tokens WHERE token_id=$1', [d.tokens[0].id]), /immutable/)
    await assert.rejects(admin.query('UPDATE ctf_position_tokens SET index_set=3 WHERE id=$1', [d.tokens[0].id]))
  })

  await t.test('condition slot mismatch, wrong claim mask and cross-question aliases are rejected', async () => {
    const d = definitions.find(row => row.type === 'CATEGORICAL' && row.tokens)
    const binary = definitions.find(row => row.type === 'BINARY')
    await assert.rejects(admin.query(`INSERT INTO market_outcome_tokens(market_outcome_id,polarity,token_id)
      VALUES($1,'YES',$2)`, [binary.outcomes[0].id, d.tokens[0].id]), /claim does not match/)
    await assert.rejects(admin.query(`INSERT INTO market_outcome_tokens(market_outcome_id,polarity,token_id)
      VALUES($1,'YES',$2)`, [d.outcomes[0].id, d.tokens.find(token => token.mask === 62n).id]), /claim does not match/)
    const c = d.condition
    const fresh = await definition()
    await outcomes(fresh)
    await assert.rejects(admin.query(`INSERT INTO ctf_conditions(market_question_id,chain_id,ctf_contract_deployment_id,
      oracle_address,ctf_question_id,condition_id,outcome_slot_count,collateral_asset_id)
      VALUES($1,$2,$3,$4,$5,$6,2,$7)`, [fresh.questionId, c.chain_id, c.ctf_contract_deployment_id, c.oracle_address, hex(32), hex(32), c.collateral_asset_id]),
    error => error.code === '23514' && error.constraint === 'ctf_conditions_market_count_check')
  })

  await t.test('empty, full and out-of-condition masks, cross-chain tokens and duplicate identities fail', async () => {
    const d = definitions.find(row => row.type === 'CATEGORICAL' && row.tokens)
    const c = d.condition
    const insert = (mask, chain = c.chain_id, positionId = BigInt(hex(32)).toString()) => admin.query(`
      INSERT INTO ctf_position_tokens(condition_id,chain_id,ctf_contract_deployment_id,collateral_asset_id,index_set,collection_id,position_id)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [c.id, chain, c.ctf_contract_deployment_id, c.collateral_asset_id, mask, hex(32), positionId])
    for (const mask of ['0', '63', '64']) {
      await assert.rejects(insert(mask), error => error.code === '23514' && error.constraint === 'ctf_position_tokens_index_set_check')
    }
    await assert.rejects(insert('59', (BigInt(c.chain_id) + 1n).toString()), /match its condition/)
    await assert.rejects(insert('59'), error => error.code === '23505')
  })

  await t.test('recurring rounds have distinct immutable market and condition identities', async () => {
    const series = `btc-${key()}`
    const first = await definition('BINARY', { series, round: 'round-1' })
    const second = await definition('BINARY', { series, round: 'round-2' })
    for (const d of [first, second]) { await outcomes(d); await freeze(d); await register(d) }
    assert.notEqual(first.marketId, second.marketId)
    assert.notEqual(first.condition.condition_id, second.condition.condition_id)
    await assert.rejects(definition('BINARY', { series, round: 'round-1' }), error => error.code === '23505')
    await assert.rejects(admin.query("UPDATE markets SET round_key='replacement' WHERE id=$1", [first.marketId]), /frozen/)
  })

  await t.test('categorical and range accounts cannot enable recognition, allocation or trading', async () => {
    for (const d of definitions.filter(row => row.type !== 'BINARY' && row.tokens)) {
      for (const token of d.tokens) {
        await assert.rejects(base.accounts(token.id), error => error.code === '42501' && /Phase 4.4/.test(error.message))
        await assert.rejects(admin.query("INSERT INTO position_accounts(token_id,account_key,kind) VALUES($1,$2,'UNALLOCATED')", [token.id, key()]), error => error.code === '42501')
      }
    }
    assert.equal((await one("SELECT count(*)::int AS n FROM position_accounts a JOIN ctf_position_tokens t ON t.id=a.token_id JOIN ctf_conditions c ON c.id=t.condition_id JOIN market_questions q ON q.id=c.market_question_id JOIN markets m ON m.id=q.market_id WHERE m.market_type<>'BINARY'")).n, 0)
    assert.equal((await base.positions.reconcile(sys)).reconciled, true)
  })

  await t.test('all five authoritative accounting boundaries carry non-disableable runtime guards', async () => {
    const guards = (await admin.query(`SELECT c.relname,t.tgtype,t.tgenabled,p.proname
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE p.proname='block_unsupported_position_accounting' ORDER BY c.relname`)).rows
    assert.deepEqual(guards.map(row => row.relname), ['cash_position_settlements', 'position_accounts', 'position_balance_projections', 'position_journal_entries', 'position_reservations'])
    assert.ok(guards.every(row => row.tgtype === 23 && row.tgenabled === 'O'))
    const d = definitions.find(row => row.type === 'CATEGORICAL' && row.tokens)
    const args = [sys, key(), JSON.stringify({ tokenId: d.tokens[0].id, ownerUserId: null, accountKey: key(), kind: 'UNALLOCATED' })]
    await assert.rejects(context.runtime.query("SELECT public.position_execute($1,'POSITION_ACCOUNT',$2,$3::jsonb)", args), error => error.code === '42501' && /permission denied/.test(error.message))
    await assert.rejects(context.runtime.query("SELECT public.financial_execute($1,'POSITION_ACCOUNT',$2,$3::jsonb)", args), error => error.code === '42501' && /Phase 4.4/.test(error.message))
    await assert.rejects(context.runtime.query('ALTER TABLE position_accounts DISABLE TRIGGER position_accounts_binary_accounting_only'), error => error.code === '42501')
  })

  await t.test('downstream guards reject categorical credits, reservations and projections even with an injected account', async () => {
    const d = definitions.find(row => row.type === 'CATEGORICAL' && row.tokens)
    const tokenId = d.tokens[0].id
    const rollback = new Error('rollback adversarial fixture')
    await assert.rejects(context.ownerTx(async client => {
      // Owner-only fault injection inside a transaction that always rolls back.
      await client.query('ALTER TABLE position_accounts DISABLE TRIGGER position_accounts_binary_accounting_only')
      const account = (await client.query("INSERT INTO position_accounts(token_id,account_key,kind) VALUES($1,$2,'UNALLOCATED') RETURNING id", [tokenId, key()])).rows[0].id
      await client.query('ALTER TABLE position_accounts ENABLE TRIGGER position_accounts_binary_accounting_only')
      for (const [sql, args] of [
        ['INSERT INTO position_balance_projections(account_id,posted,reserved) VALUES($1,0,0)', [account]],
        ["INSERT INTO position_reservations(account_id,quantity,reference) VALUES($1,1000000,$2)", [account, key()]],
        ["INSERT INTO position_journal_entries(journal_id,account_id,token_id,side,quantity) VALUES(0,$1,$2,'IN',1000000)", [account, tokenId]],
      ]) {
        await client.query('SAVEPOINT categorical_bypass')
        await assert.rejects(client.query(sql, args), error => error.code === '42501' && /Phase 4.4/.test(error.message))
        await client.query('ROLLBACK TO SAVEPOINT categorical_bypass')
        await client.query('RELEASE SAVEPOINT categorical_bypass')
      }
      throw rollback
    }), error => error === rollback)
    assert.equal((await base.positions.reconcile(sys)).reconciled, true)
  })

  await t.test('restricted runtime cannot modify registry tables or invoke private guards', async () => {
    for (const sql of ["DELETE FROM market_outcome_tokens", "DELETE FROM market_observation_specs", "SELECT public.block_unsupported_position_accounting()"])
      await assert.rejects(context.runtime.query(sql), error => error.code === '42501')
  })
}
