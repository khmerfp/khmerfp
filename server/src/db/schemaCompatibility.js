import { readCanonicalMigrationManifest } from '../../../packages/db/src/migrationManifest.js'

// Runtime startup is verification-only: it must never create or repair schema.
const FORBIDDEN_RUNTIME_ROLES = [
  'kf_migration',
  'kf_core_owner',
  'kf_api_owner',
  'kf_trading_http',
  'kf_matching_worker',
  'kf_market_scheduler',
  'kf_market_admin',
  'kf_reconciliation',
  'kf_public_read',
  'kf_private_read',
  'kf_funding',
]

const HTTP_TABLE_PRIVILEGES = [
  ['users', ['SELECT', 'INSERT', 'UPDATE']],
  ['wallets', ['SELECT', 'INSERT', 'UPDATE']],
  ['sessions', ['SELECT', 'INSERT', 'UPDATE']],
  ['user_factors', ['SELECT', 'INSERT', 'UPDATE']],
  ['auth_rate_limits', ['SELECT', 'INSERT', 'UPDATE']],
  ['auth_audit_logs', ['SELECT', 'INSERT']],
  ['phone_otps', ['SELECT', 'INSERT', 'UPDATE']],
  ['transactions', ['SELECT', 'INSERT', 'UPDATE']],
  ['bakong_payments', ['SELECT', 'INSERT', 'UPDATE']],
  ['user_wallets', ['SELECT', 'INSERT', 'UPDATE']],
  ['wallet_link_challenges', ['SELECT', 'INSERT', 'UPDATE']],
]

const HTTP_SEQUENCES = [
  'users_id_seq',
  'wallets_id_seq',
  'user_factors_id_seq',
  'auth_audit_logs_id_seq',
  'phone_otps_id_seq',
  'transactions_id_seq',
  'bakong_payments_id_seq',
  'user_wallets_id_seq',
]

// Public callers receive a sanitized error; `reason` remains server-side evidence.
export class DatabaseCompatibilityError extends Error {
  constructor(message = 'Database schema or runtime privileges are incompatible.') {
    super(message)
    this.name = 'DatabaseCompatibilityError'
  }
}

function incompatible(reason) {
  const error = new DatabaseCompatibilityError()
  error.reason = reason
  throw error
}

async function verifyMigrationHistory(client) {
  const expected = readCanonicalMigrationManifest()
  const table = await client.query(
    "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS name",
  )
  if (table.rows[0]?.name !== 'drizzle.__drizzle_migrations') incompatible('migration-table')

  const actual = await client.query(
    'SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id',
  )
  if (actual.rowCount !== expected.length) incompatible('migration-count')

  for (let index = 0; index < expected.length; index += 1) {
    if (
      actual.rows[index].hash !== expected[index].hash
      || actual.rows[index].created_at !== expected[index].createdAt
    ) incompatible('migration-history')
  }
}

// Verify the minimum catalog contract required by each isolated process role.
async function verifyCatalog(client, mode) {
  const result = await client.query(`
    SELECT
      to_regclass('public.users') IS NOT NULL AS users,
      to_regclass('public.sessions') IS NOT NULL AS sessions,
      to_regclass('public.bakong_payments') IS NOT NULL AS bakong,
      to_regclass('public.wallet_link_challenges') IS NOT NULL AS wallet_links,
      EXISTS (
        SELECT 1
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'bakong_payments'
           AND a.attname = 'last_checked_at'
           AND NOT a.attisdropped
           AND format_type(a.atttypid, a.atttypmod) = 'timestamp with time zone'
           AND NOT a.attnotnull
           AND a.atthasdef = false
      ) AS payment_lease,
      EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.wallet_link_challenges'::regclass
           AND conname = 'wallet_link_challenges_pkey'
      ) AS wallet_link_constraint
  `)
  const missing = Object.entries(result.rows[0] ?? {})
    .filter(([, value]) => value !== true)
    .map(([name]) => name)
  if (missing.length) incompatible(`catalog:${missing.join(',')}`)

  if (mode !== 'http') {
    const signature = {
      'trading-http': 'custodial_api.http_order(text,text,text,jsonb)',
      'public-read': 'custodial_api.public_read(text,jsonb)',
      'private-read': 'custodial_api.private_read(text,text,jsonb)',
      matching: 'custodial_api.matching(text,jsonb)',
      scheduler: 'custodial_api.scheduler(text,jsonb)',
    }[mode]
    const capability = await client.query(
      'SELECT to_regprocedure($1) IS NOT NULL AS present',
      [signature],
    )
    if (capability.rows[0]?.present !== true) incompatible('capability-catalog')
  }
}

async function verifySafeRole(client, mode) {
  const role = await client.query(`
    SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication,
           r.rolbypassrls,
           has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
           has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
           has_schema_privilege(current_user, 'custodial_api', 'CREATE') AS api_create
      FROM pg_roles r
     WHERE r.rolname = current_user
  `)
  const row = role.rows[0]
  if (!row || Object.values(row).some(Boolean)) incompatible('role-safety')

  const allowedCapability = {
    'trading-http': 'kf_trading_http',
    'public-read': 'kf_public_read',
    'private-read': 'kf_private_read',
    matching: 'kf_matching_worker',
    scheduler: 'kf_market_scheduler',
  }[mode]
  const forbidden = FORBIDDEN_RUNTIME_ROLES.filter(
    (roleName) => roleName !== allowedCapability,
  )
  const memberships = await client.query(
    `SELECT role_name FROM unnest($1::text[]) role_name
      WHERE pg_has_role(current_user, role_name, 'MEMBER')`,
    [forbidden],
  )
  if (memberships.rowCount !== 0) incompatible('role-membership')
}

async function verifyHttpPrivileges(client) {
  for (const [table, privileges] of HTTP_TABLE_PRIVILEGES) {
    for (const privilege of privileges) {
      const result = await client.query(
        'SELECT has_table_privilege(current_user, $1, $2) AS allowed',
        [`public.${table}`, privilege],
      )
      if (result.rows[0]?.allowed !== true) incompatible(`table-privilege:${table}:${privilege}`)
    }
  }
  for (const sequence of HTTP_SEQUENCES) {
    const result = await client.query(
      'SELECT has_sequence_privilege(current_user, $1, $2) AS allowed',
      [`public.${sequence}`, 'USAGE'],
    )
    if (result.rows[0]?.allowed !== true) incompatible(`sequence-privilege:${sequence}`)
  }
}

async function verifyCapability(client, signature) {
  const result = await client.query(
    'SELECT has_function_privilege(current_user, $1, $2) AS allowed',
    [signature, 'EXECUTE'],
  )
  if (result.rows[0]?.allowed !== true) incompatible(`function-privilege:${signature}`)
}

export async function verifyDatabaseCompatibility(pool, { mode = 'http' } = {}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await verifyMigrationHistory(client)
    await verifyCatalog(client, mode)
    await verifySafeRole(client, mode)

    if (mode === 'http') await verifyHttpPrivileges(client)
    else if (mode === 'trading-http') {
      await verifyCapability(client, 'custodial_api.http_order(text,text,text,jsonb)')
    } else if (mode === 'public-read') {
      await verifyCapability(client, 'custodial_api.public_read(text,jsonb)')
    } else if (mode === 'private-read') {
      await verifyCapability(client, 'custodial_api.private_read(text,text,jsonb)')
    } else if (mode === 'matching') {
      await verifyCapability(client, 'custodial_api.matching(text,jsonb)')
    } else if (mode === 'scheduler') {
      await verifyCapability(client, 'custodial_api.scheduler(text,jsonb)')
    } else incompatible('unknown-mode')

    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (error instanceof DatabaseCompatibilityError) throw error
    const wrapped = new DatabaseCompatibilityError()
    wrapped.reason = error.code ?? error.message
    throw wrapped
  } finally {
    client.release()
  }
}
