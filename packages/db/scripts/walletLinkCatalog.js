import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

async function readCatalog(client, schema) {
  const columns = await client.query(
    `SELECT a.attname AS name,
    format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null,
    a.attidentity AS identity, a.attgenerated AS generated,
    pg_get_expr(d.adbin,d.adrelid,true) AS default_value
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname=$1 AND c.relname='wallet_link_challenges'
      AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
    [schema],
  )
  const constraints = await client.query(
    `SELECT x.conname AS name, x.contype AS type,
    x.convalidated AS validated, x.condeferrable AS deferrable, x.condeferred AS deferred,
    pg_get_constraintdef(x.oid,true) AS definition
    FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname='wallet_link_challenges' ORDER BY x.conname`,
    [schema],
  )
  const indexes = await client.query(
    `SELECT ic.relname AS name, am.amname AS method,
    i.indisunique AS unique, i.indisvalid AS valid, i.indisready AS ready,
    i.indoption::text AS ordering,
    ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true)
      FROM generate_series(1,i.indnatts) k ORDER BY k) AS columns,
    pg_get_expr(i.indpred,i.indrelid,true) AS predicate
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid
    JOIN pg_am am ON am.oid=ic.relam
    WHERE n.nspname=$1 AND c.relname='wallet_link_challenges' ORDER BY ic.relname`,
    [schema],
  )
  const functions = await client.query(
    `SELECT p.proname AS name, l.lanname AS language,
    pg_get_function_result(p.oid) AS returns, pg_get_function_identity_arguments(p.oid) AS arguments,
    p.prosrc AS body, p.proconfig AS configuration, p.prosecdef AS security_definer,
    p.provolatile AS volatility, p.proisstrict AS strict
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname=$1 AND p.proname='protect_wallet_link_challenge'
    ORDER BY pg_get_function_identity_arguments(p.oid)`,
    [schema],
  )
  const triggers = await client.query(
    `SELECT t.tgname AS name, t.tgtype AS type,
    t.tgenabled AS enabled, p.proname AS function,
    CASE WHEN pn.nspname=$1 THEN 'self' ELSE pn.nspname END AS function_schema,
    t.tgnargs AS argument_count, encode(t.tgargs,'hex') AS arguments,
    pg_get_expr(t.tgqual,t.tgrelid,true) AS predicate
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname=$1 AND c.relname='wallet_link_challenges' AND NOT t.tgisinternal
    ORDER BY t.tgname`,
    [schema],
  )
  return {
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    functions: functions.rows,
    triggers: triggers.rows,
  }
}

export async function walletLinkFingerprint(client) {
  return createHash('sha256')
    .update(JSON.stringify(await readCatalog(client, 'public')))
    .digest('hex')
}

// compare catalog output from both definitions instead of loosening expression checks.
export async function assertWalletLinkCatalog(pool) {
  const proposal = readFileSync(
    new URL('../proposals/wallet_link_challenges.sql', import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n')
  assert.equal(
    createHash('sha256').update(proposal).digest('hex'),
    '11e3cd7a5e5bf636e1241f416166f281c22c1174e698f52ebd3d43ea58ed3b80',
    'verified proposal content changed',
  )
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const actual = await readCatalog(client, 'public')
    await client.query('CREATE SCHEMA wallet_link_reference')
    await client.query(
      proposal
        .replaceAll('public.wallet_link_challenges', 'wallet_link_reference.wallet_link_challenges')
        .replaceAll(
          'public.protect_wallet_link_challenge',
          'wallet_link_reference.protect_wallet_link_challenge',
        ),
    )
    const expected = await readCatalog(client, 'wallet_link_reference')
    assert.deepEqual(
      actual,
      expected,
      'generated wallet-link catalog differs from verified proposal',
    )
  } finally {
    try {
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  }
}
