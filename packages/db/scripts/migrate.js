import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'node:url'

import {
  migrationsFolder,
  readCanonicalMigrationManifest,
} from '../src/migrationManifest.js'

const { Client } = pg

// One global advisory lock serializes migration runners for this application.
const MIGRATION_LOCK = 727190021
const RUNTIME_URL_NAMES = [
  'DATABASE_URL',
  'TRADING_RUNTIME_DATABASE_URL',
  'TRADING_READ_DATABASE_URL',
  'TRADING_PRIVATE_READ_DATABASE_URL',
  'TRADING_MATCHING_DATABASE_URL',
  'TRADING_SCHEDULER_DATABASE_URL',
  'FUNDING_DATABASE_URL',
]
const FORBIDDEN_MEMBERSHIPS = [
  'kf_trading_http',
  'kf_matching_worker',
  'kf_market_scheduler',
  'kf_market_admin',
  'kf_reconciliation',
  'kf_public_read',
  'kf_private_read',
  'kf_funding',
]

function migrationFailure(message) {
  const error = new Error(message)
  error.name = 'MigrationSafetyError'
  return error
}

// Compare actual PostgreSQL identities, not merely connection URL strings.
async function databaseIdentity(client) {
  const result = await client.query(`
    SELECT current_user AS role_name,
           current_database() AS database_name,
           (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid
  `)
  return result.rows[0]
}

async function verifyCredentialIsolation(client, env) {
  const migrationIdentity = await databaseIdentity(client)
  for (const name of RUNTIME_URL_NAMES) {
    const value = env[name]?.trim()
    if (!value) continue
    if (value === env.MIGRATION_DATABASE_URL?.trim()) {
      throw migrationFailure('Migration and runtime credentials must be separate.')
    }

    const runtime = new Client({ connectionString: value, connectionTimeoutMillis: 5000 })
    try {
      await runtime.connect()
      const identity = await databaseIdentity(runtime)
      if (
        identity.database_oid === migrationIdentity.database_oid
        && identity.role_name === migrationIdentity.role_name
      ) throw migrationFailure('Migration and runtime roles must be separate.')
    } catch (error) {
      if (error.name === 'MigrationSafetyError') throw error
      throw migrationFailure(`Unable to verify ${name} database identity.`)
    } finally {
      await runtime.end().catch(() => {})
    }
  }
}

// Migration credentials must own migration capability without inheriting any
// narrower runtime capability role.
async function verifyMigrationRole(client) {
  const role = await client.query(`
    SELECT r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
           r.rolreplication, r.rolbypassrls,
           has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
           has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create
      FROM pg_roles r
     WHERE r.rolname = current_user
  `)
  const row = role.rows[0]
  if (
    !row?.rolcanlogin
    || (!row.rolsuper && (row.rolreplication || row.rolbypassrls || !row.rolcreaterole))
    || !row.database_create
    || !row.schema_create
  ) throw migrationFailure('Database role lacks reviewed migration privileges.')

  // PostgreSQL reports a superuser as an implicit member of every role. That
  // is an administrative capability, not an inherited runtime credential.
  // Dedicated non-superuser migration roles must not inherit capabilities.
  if (!row.rolsuper) {
    const memberships = await client.query(
      `SELECT r.rolname AS role_name
         FROM pg_roles r
        WHERE r.rolname = ANY($1::text[])
          AND pg_has_role(current_user, r.oid, 'MEMBER')`,
      [FORBIDDEN_MEMBERSHIPS],
    )
    if (memberships.rowCount !== 0) {
      throw migrationFailure('Migration role inherits a runtime capability.')
    }
  }
}

async function readAppliedMigrations(client) {
  const relation = await client.query(
    "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS name",
  )
  if (!relation.rows[0]?.name) return null
  const rows = await client.query(
    'SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id',
  )
  return rows.rows
}

function verifyHistoryPrefix(actual, expected, { complete = false } = {}) {
  if (actual.length > expected.length || (complete && actual.length !== expected.length)) {
    throw migrationFailure('Migration history length is incompatible.')
  }
  actual.forEach((row, index) => {
    if (row.hash !== expected[index].hash || row.created_at !== expected[index].createdAt) {
      throw migrationFailure('Migration history is not canonical.')
    }
  })
}

async function verifyAdoptableDatabase(client, expected) {
  const applied = await readAppliedMigrations(client)
  if (applied) {
    verifyHistoryPrefix(applied, expected)
    return
  }

  const existing = await client.query(`
    SELECT count(*)::integer AS count
      FROM pg_tables
     WHERE schemaname = 'public'
  `)
  if (existing.rows[0].count !== 0) {
    throw migrationFailure('Unverified legacy database cannot be stamped automatically.')
  }
}

export async function runMigrations(env = process.env) {
  const url = env.MIGRATION_DATABASE_URL?.trim()
  if (!url) throw migrationFailure('MIGRATION_DATABASE_URL is required.')

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15000 })
  await client.connect()
  let locked = false
  try {
    await verifyMigrationRole(client)
    await verifyCredentialIsolation(client, env)
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK])
    locked = true

    const expected = readCanonicalMigrationManifest()
    await verifyAdoptableDatabase(client, expected)
    await migrate(drizzle(client), { migrationsFolder })
    const applied = await readAppliedMigrations(client)
    if (!applied) throw migrationFailure('Migration history was not created.')
    verifyHistoryPrefix(applied, expected, { complete: true })
    return { migrationCount: applied.length }
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {})
    await client.end()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runMigrations()
    console.info(`Applied and verified ${result.migrationCount} canonical migrations.`)
  } catch (error) {
    console.error(
      error.name === 'MigrationSafetyError'
        ? error.message
        : 'Database migration failed; sensitive details have been redacted.',
    )
    process.exitCode = 1
  }
}
