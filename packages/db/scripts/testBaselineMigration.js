import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

const { Pool } = pg

const databaseName = 'khmerfp_migration_test'
const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const expectedTables = [
  'auth_audit_logs',
  'auth_rate_limits',
  'phone_otps',
  'sessions',
  'transactions',
  'user_factors',
  'users',
  'wallets',
]
const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageDir = join(scriptDir, '..')
const migrationsDir = join(packageDir, 'migrations')
const journalPath = join(migrationsDir, 'meta', '_journal.json')
const baselinePath = join(migrationsDir, '0000_fat_shen.sql')

function fail(message) {
  throw new Error(message)
}

function runOfflineValidator() {
  const result = spawnSync(
    process.execPath,
    [join(scriptDir, 'validateBaseline.js')],
    { stdio: 'inherit', env: process.env },
  )

  if (result.error) fail(`offline baseline validator failed: ${result.error.message}`)
  if (result.status !== 0) fail('offline baseline validator rejected the artifacts')
}

function readBaselineMetadata() {
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  const entry = journal.entries?.[0]
  const sql = readFileSync(baselinePath, 'utf8')

  if (journal.entries?.length !== 1 || entry?.tag !== '0000_fat_shen') {
    fail('baseline journal does not contain the expected single entry')
  }

  return {
    hash: createHash('sha256').update(sql).digest('hex'),
    timestamp: String(entry.when),
  }
}

function readConnectionUrl() {
  const value = process.env.MIGRATION_TEST_DATABASE_URL?.trim()
  if (!value) fail('MIGRATION_TEST_DATABASE_URL is required')

  let url
  try {
    url = new URL(value)
  } catch {
    fail('MIGRATION_TEST_DATABASE_URL must be a valid PostgreSQL URL')
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    fail('MIGRATION_TEST_DATABASE_URL must use PostgreSQL')
  }

  const allowedCiHost = process.env.MIGRATION_TEST_CI_HOST?.trim()
  if (allowedCiHost && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(allowedCiHost)) {
    fail('MIGRATION_TEST_CI_HOST must be a single-label CI service host')
  }
  const ciHostAllowed = process.env.CI === 'true'
    && allowedCiHost
    && url.hostname === allowedCiHost

  if (!localHosts.has(url.hostname) && !ciHostAllowed) {
    fail('migration test host is not an allowed local or configured CI host')
  }

  if (decodeURIComponent(url.pathname.slice(1)) !== databaseName) {
    fail(`migration test database must be ${databaseName}`)
  }

  return value
}

async function inspectConnection(pool) {
  const result = await pool.query(`
    SELECT
      current_database() AS database_name,
      current_setting('server_version_num') AS version_number,
      current_setting('search_path') AS search_path,
      current_schemas(false)::text[] AS active_schemas
  `)
  const state = result.rows[0]

  if (state.database_name !== databaseName) {
    fail(`connected database must be ${databaseName}`)
  }
  if (Math.floor(Number(state.version_number) / 10000) !== 16) {
    fail('migration tests require PostgreSQL major version 16')
  }
  if (!['"$user", public', 'public'].includes(state.search_path)) {
    fail('database has an unexpected search_path')
  }
  if (JSON.stringify(state.active_schemas) !== JSON.stringify(['public'])) {
    fail('database resolves an unexpected active schema')
  }
}

async function assertEmptyDatabase(pool) {
  const schemas = await pool.query(`
    SELECT nspname
    FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_%'
      AND nspname <> 'information_schema'
    ORDER BY nspname
  `)
  const schemaNames = schemas.rows.map((row) => row.nspname)
  if (JSON.stringify(schemaNames) !== JSON.stringify(['public'])) {
    fail('database contains an unexpected user schema')
  }

  const tables = await pool.query(`
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY schemaname, tablename
  `)
  if (tables.rowCount !== 0) fail('migration test database is not empty')

  const history = await pool.query(`
    SELECT to_regclass('drizzle.__drizzle_migrations') AS history_table
  `)
  if (history.rows[0].history_table !== null) {
    fail('Drizzle migration history already exists')
  }
}

async function readApplicationTables(pool) {
  const result = await pool.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `)
  return result.rows.map((row) => row.tablename)
}

async function readHistory(pool) {
  const result = await pool.query(`
    SELECT id, hash, created_at::text AS created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY id
  `)
  return result.rows
}

async function schemaFingerprint(pool) {
  const result = await pool.query(`
    SELECT jsonb_build_object(
      'columns', COALESCE((
        SELECT jsonb_agg(to_jsonb(c) ORDER BY c.table_schema, c.table_name, c.ordinal_position)
        FROM information_schema.columns c
        WHERE c.table_schema IN ('public', 'drizzle')
      ), '[]'::jsonb),
      'constraints', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'schema', n.nspname,
          'table', r.relname,
          'name', x.conname,
          'type', x.contype,
          'definition', pg_get_constraintdef(x.oid, true),
          'validated', x.convalidated
        ) ORDER BY n.nspname, r.relname, x.conname)
        FROM pg_constraint x
        JOIN pg_class r ON r.oid = x.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname IN ('public', 'drizzle')
      ), '[]'::jsonb),
      'indexes', COALESCE((
        SELECT jsonb_agg(to_jsonb(i) ORDER BY i.schemaname, i.tablename, i.indexname)
        FROM pg_indexes i
        WHERE i.schemaname IN ('public', 'drizzle')
      ), '[]'::jsonb),
      'sequences', COALESCE((
        SELECT jsonb_agg(to_jsonb(s) ORDER BY s.schemaname, s.sequencename)
        FROM pg_sequences s
        WHERE s.schemaname IN ('public', 'drizzle')
      ), '[]'::jsonb)
    ) AS schema_state
  `)

  return createHash('sha256')
    .update(JSON.stringify(result.rows[0].schema_state))
    .digest('hex')
}

function compareLists(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} do not match the expected baseline`)
  }
}

async function main() {
  runOfflineValidator()
  const baseline = readBaselineMetadata()
  const connectionString = readConnectionUrl()
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000,
    max: 2,
    query_timeout: 30000,
    statement_timeout: 30000,
  })

  try {
    await inspectConnection(pool)
    await assertEmptyDatabase(pool)

    const db = drizzle(pool)
    await migrate(db, { migrationsFolder: migrationsDir })

    compareLists(
      await readApplicationTables(pool),
      expectedTables,
      'application tables',
    )

    const firstHistory = await readHistory(pool)
    if (
      firstHistory.length !== 1
      || firstHistory[0].hash !== baseline.hash
      || firstHistory[0].created_at !== baseline.timestamp
    ) {
      fail('Drizzle migration history does not match the baseline')
    }

    const firstFingerprint = await schemaFingerprint(pool)
    await migrate(db, { migrationsFolder: migrationsDir })
    const secondFingerprint = await schemaFingerprint(pool)
    const secondHistory = await readHistory(pool)

    if (JSON.stringify(secondHistory) !== JSON.stringify(firstHistory)) {
      fail('second migration run changed migration history')
    }
    if (secondFingerprint !== firstFingerprint) {
      fail('second migration run changed the schema fingerprint')
    }

    console.log('disposable baseline migration test passed')
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(`disposable baseline migration test failed: ${error.message}`)
  process.exitCode = 1
})
