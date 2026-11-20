import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = resolve(scriptDir, '../migrations')

function target() {
  if (process.env.NODE_ENV !== 'test' || process.env.CTF_REGRESSION_TEST_DISPOSABLE !== 'true') {
    throw new Error('Explicit disposable CTF test environment required.')
  }
  let url
  try {
    url = new URL(process.env.CTF_REGRESSION_TEST_DATABASE_URL)
  } catch {
    throw new Error('Dedicated CTF regression database URL required.')
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/khmerfp_ctf_regression_test' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Only the dedicated loopback CTF regression database is allowed.')
  }
  return url.href
}

async function cases(pool, stage) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      "INSERT INTO chains(chain_id,name,environment,native_symbol) VALUES (84539,'CTF regression','testnet','ETH')",
    )
    const collateral = (
      await client.query(
        `INSERT INTO chain_assets
      (chain_id,contract_address,symbol,name,decimals,asset_type)
      VALUES (84539,$1,'TEST','Test collateral',6,'ERC20') RETURNING id`,
        [`0x${'1'.repeat(40)}`],
      )
    ).rows[0].id
    async function deployment(role, seed) {
      return (
        await client.query(
          `INSERT INTO contract_deployments
        (chain_id,contract_address,contract_role,contract_version,deployment_tx_hash,deployment_block_number,deployment_status)
        VALUES (84539,$1,$2,'regression',$3,1,'CONFIRMED') RETURNING id`,
          [`0x${seed.repeat(40)}`, role, `0x${seed.repeat(64)}`],
        )
      ).rows[0].id
    }
    const ctf = await deployment('GNOSIS_CTF', '2')
    const oracle = await deployment('ORACLE', '3')
    const category = (
      await client.query(
        "INSERT INTO market_categories(name,slug) VALUES ('Regression','ctf-regression') RETURNING id",
      )
    ).rows[0].id
    const market = (
      await client.query(
        `INSERT INTO markets
      (category_id,slug,title,description,trading_starts_at,trading_ends_at,resolution_deadline)
      VALUES ($1,'ctf-regression','Regression','Disposable test',now()+interval '1 hour',now()+interval '2 hours',now()+interval '3 hours') RETURNING id`,
        [category],
      )
    ).rows[0].id
    const question = (
      await client.query(
        `INSERT INTO market_questions
      (market_id,oracle_contract_deployment_id,question_text,resolution_rules,resolution_source)
      VALUES ($1,$2,'Test?','Test rules','Test source') RETURNING id`,
        [market, oracle],
      )
    ).rows[0].id
    const original = `INSERT INTO ctf_conditions
      (market_question_id,chain_id,ctf_contract_deployment_id,oracle_address,ctf_question_id,condition_id,outcome_slot_count,collateral_asset_id)
      VALUES ($1,84539,$2,$3,$4,$5,3,$6)`
    const corrected = `INSERT INTO ctf_conditions
      (market_question_id,chain_id,ctf_contract_deployment_id,oracle_contract_deployment_id,oracle_address,ctf_question_id,condition_id,outcome_slot_count,collateral_asset_id)
      VALUES ($1,84539,$2,$3,$4,$5,$6,$7,$8) RETURNING registration_status`
    const common = [
      question,
      ctf,
      oracle,
      `0x${'3'.repeat(40)}`,
      `0x${'4'.repeat(64)}`,
      `0x${'5'.repeat(64)}`,
    ]
    const results = []
    async function attempt(label, sql, params, expectedCode, expectedConstraint, expectedMessage) {
      await client.query('SAVEPOINT ctf_case')
      let error, result
      try {
        result = await client.query(sql, params)
      } catch (failure) {
        error = failure
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT ctf_case')
        await client.query('RELEASE SAVEPOINT ctf_case')
      }
      if (expectedCode) {
        assert.ok(error, `${label} unexpectedly succeeded`)
        assert.equal(error.code, expectedCode)
        assert.equal(error.constraint || null, expectedConstraint)
        if (expectedMessage) assert.equal(error.message, expectedMessage)
      } else {
        if (error) throw error
        assert.equal(result.rows[0].registration_status, 'DERIVED')
      }
      const evidence = {
        label,
        sqlstate: error?.code || null,
        message: error?.message || null,
        constraint: error?.constraint || null,
        function: error?.where?.match(/function ([^\s(]+)/)?.[1] || null,
      }
      results.push(evidence)
      console.log(JSON.stringify({ stage, ...evidence }))
    }
    await attempt(
      'original missing-oracle fixture',
      original,
      [question, ctf, common[3], common[4], common[5], collateral],
      'P0001',
      null,
      'CTF condition oracle does not match the market question',
    )
    await attempt(
      'corrected fixture rejects three slots',
      corrected,
      [...common, 3, collateral],
      '23514',
      'ctf_conditions_outcome_slot_count_check',
    )
    await attempt(
      'malformed condition id remains rejected',
      corrected,
      [...common.slice(0, 5), '0x1234', 2, collateral],
      '23514',
      'ctf_conditions_condition_id_check',
    )
    await attempt('valid binary condition accepted', corrected, [...common, 2, collateral], null)
    return results
  } finally {
    try {
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  }
}

async function main() {
  const connectionString = target()
  const validation = spawnSync(process.execPath, [join(scriptDir, 'validateBaseline.js')], {
    stdio: 'inherit',
  })
  assert.equal(validation.status, 0)
  const pool = new pg.Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    lock_timeout: 3000,
    options: '-c search_path=public',
  })
  const fixture = mkdtempSync(join(tmpdir(), 'khmerfp-ctf-regression-'))
  try {
    const state = (
      await pool.query(`SELECT current_database() AS name,
      current_setting('server_version_num')::int AS version,current_schemas(false)::text[] AS schemas`)
    ).rows[0]
    assert.equal(state.name, 'khmerfp_ctf_regression_test')
    assert.equal(Math.floor(state.version / 10000), 16)
    assert.deepEqual(state.schemas, ['public'])
    assert.equal(
      (
        await pool.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'`)
      ).rowCount,
      0,
    )
    assert.equal(
      (
        await pool.query(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'`)
      ).rowCount,
      0,
    )
    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'))
    assert.equal(journal.entries.length, 18)
    assert.equal(journal.entries[8].tag, '0008_wallet_link_challenges')
    mkdirSync(join(fixture, 'meta'))
    writeFileSync(
      join(fixture, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 8) }),
    )
    for (const entry of journal.entries.slice(0, 8))
      copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(fixture, `${entry.tag}.sql`))
    await migrate(drizzle(pool), { migrationsFolder: fixture })
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n,
      8,
    )
    assert.equal(
      (await pool.query("SELECT to_regclass('public.wallet_link_challenges') AS t")).rows[0].t,
      null,
    )
    const definition = async () =>
      (
        await pool.query(
          "SELECT pg_get_functiondef('public.enforce_ctf_condition_registry()'::regprocedure) AS body",
        )
      ).rows[0].body
    const beforeDefinition = await definition()
    const before = await cases(pool, 'before 0008')
    // Preserve the original before/after-0008 regression through the last
    // historical binary registry. Migration 0013 intentionally changes its contract.
    writeFileSync(join(fixture, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 13) }))
    for(const entry of journal.entries.slice(8,13)) copyFileSync(join(migrationsFolder,`${entry.tag}.sql`),join(fixture,`${entry.tag}.sql`))
    await migrate(drizzle(pool), { migrationsFolder: fixture })
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n,
      13,
    )
    const after = await cases(pool, 'after 0008')
    assert.deepEqual(after, before)
    assert.equal(await definition(), beforeDefinition)
    console.log(
      `CTF trigger definition unchanged: ${createHash('sha256').update(beforeDefinition).digest('hex')}`,
    )
    console.log(
      'CTF before/after regression passed; original fixture fails identically and corrected fixtures preserve strict validation.',
    )
    await migrate(drizzle(pool), { migrationsFolder })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n,18)
    const forward=readFileSync(join(migrationsFolder,'0013_generalized_market_registry.sql'),'utf8')
    const body=forward.match(/CREATE OR REPLACE FUNCTION public\.enforce_ctf_condition_registry\([^]*?AS \$\$([^]*?)\$\$;/)[1]
    const actual=(await pool.query("SELECT prosrc FROM pg_proc WHERE oid='public.enforce_ctf_condition_registry()'::regprocedure")).rows[0].prosrc
    assert.equal(actual,body,'exact generalized CTF validation body after forward adoption')
    console.log('0013 forward CTF function and eighteen migration-history rows verified; generalized registry behavior is covered by the required ledger suite.')

  } finally {
    await pool.end()
    assert.equal(dirname(resolve(fixture)), resolve(tmpdir()))
    assert.ok(fixture.includes('khmerfp-ctf-regression-'))
    rmSync(fixture, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`CTF regression failed: ${error.message}`)
  process.exitCode = 1
})
