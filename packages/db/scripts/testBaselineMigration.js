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
const expectedDetailedSchemas = {
  auth_audit_logs: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.auth_audit_logs_id_seq'],
      ['user_id', 'bigint', true, null, null, null],
      ['event_type', 'varchar(100)', false, null, null, null],
      ['ip_address', 'inet', true, null, null, null],
      ['user_agent', 'text', true, null, null, null],
      ['details', 'jsonb', false, "'{}'::jsonb", null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['auth_audit_logs_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['auth_audit_logs_user_id_fkey', 'foreign key', ['user_id'], null, 'public.users', ['id'], 'set null', 'no action'],
    ],
    indexes: [
      ['idx_auth_audit_event_created', false, 'btree', ['event_type', 'created_at DESC'], null, true, true],
      ['idx_auth_audit_user_created', false, 'btree', ['user_id', 'created_at DESC'], null, true, true],
    ],
  },
  auth_rate_limits: {
    columns: [
      ['rate_limit_key', 'varchar(255)', false, null, null, null],
      ['window_started_at', 'timestamp with time zone', false, 'now()', null, null],
      ['request_count', 'integer', false, '0', null, null],
      ['blocked_until', 'timestamp with time zone', true, null, null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['auth_rate_limits_pkey', 'primary key', ['rate_limit_key'], null, null, null, null, null],
      ['auth_rate_limits_request_count_check', 'check', ['request_count'], 'request_count >= 0', null, null, null, null],
    ],
    indexes: [],
  },
  phone_otps: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.phone_otps_id_seq'],
      ['phone_number', 'varchar(32)', false, null, null, null],
      ['code_hash', 'character(64)', false, null, null, null],
      ['attempts', 'integer', false, '0', null, null],
      ['consumed_at', 'timestamp with time zone', true, null, null, null],
      ['expires_at', 'timestamp with time zone', false, null, null, null],
      ['ip_address', 'inet', true, null, null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['phone_otps_attempts_check', 'check', ['attempts'], 'attempts >= 0', null, null, null, null],
      ['phone_otps_code_hash_check', 'check', ['code_hash'], "code_hash ~ '^[a-f0-9]{64}$'", null, null, null, null],
      ['phone_otps_pkey', 'primary key', ['id'], null, null, null, null, null],
    ],
    indexes: [
      ['idx_phone_otps_lookup', false, 'btree', ['phone_number', 'created_at DESC'], null, true, true],
    ],
  },
  sessions: {
    columns: [
      ['token_hash', 'character(64)', false, null, null, null],
      ['user_id', 'bigint', false, null, null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['last_seen_at', 'timestamp with time zone', false, 'now()', null, null],
      ['idle_expires_at', 'timestamp with time zone', false, null, null, null],
      ['expires_at', 'timestamp with time zone', false, null, null, null],
      ['revoked_at', 'timestamp with time zone', true, null, null, null],
      ['step_up_at', 'timestamp with time zone', true, null, null, null],
      ['ip_address', 'inet', true, null, null, null],
      ['user_agent', 'text', true, null, null, null],
    ],
    constraints: [
      ['sessions_check', 'check', ['idle_expires_at', 'expires_at'], 'idle_expires_at <= expires_at', null, null, null, null],
      ['sessions_pkey', 'primary key', ['token_hash'], null, null, null, null, null],
      ['sessions_token_hash_check', 'check', ['token_hash'], "token_hash ~ '^[a-f0-9]{64}$'", null, null, null, null],
      ['sessions_user_id_fkey', 'foreign key', ['user_id'], null, 'public.users', ['id'], 'cascade', 'no action'],
    ],
    indexes: [
      ['idx_sessions_user_active', false, 'btree', ['user_id', 'expires_at'], 'revoked_at IS NULL', true, true],
    ],
  },
  transactions: {
    columns: [
      ['id', 'bigint', false, null, 'BY DEFAULT', 'public.transactions_id_seq'],
      ['tran_id', 'varchar(100)', false, null, null, null],
      ['name', 'varchar(100)', false, null, null, null],
      ['account_number', 'varchar(64)', false, null, null, null],
      ['amount', 'bigint', false, null, null, null],
      ['currency', 'varchar(3)', false, "'KHR'", null, null],
      ['status', 'varchar(20)', false, "'PENDING'", null, null],
      ['payway_response_code', 'text', true, null, null, null],
      ['paid_at', 'timestamp with time zone', true, null, null, null],
      ['verification_evidence', 'jsonb', true, null, null, null],
      ['status_access_token_hash', 'varchar(64)', true, null, null, null],
      ['created_at', 'timestamp with time zone', false, 'CURRENT_TIMESTAMP', null, null],
      ['updated_at', 'timestamp with time zone', false, 'CURRENT_TIMESTAMP', null, null],
    ],
    constraints: [
      ['transactions_amount_check', 'check', ['amount'], 'amount > 0', null, null, null, null],
      ['transactions_currency_check', 'check', ['currency'], "currency = 'KHR'", null, null, null, null],
      ['transactions_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['transactions_status_access_token_hash_check', 'check', ['status_access_token_hash'], "(status_access_token_hash IS NULL) OR (status_access_token_hash ~ '^[a-f0-9]{64}$')", null, null, null, null],
      ['transactions_status_check', 'check', ['status'], "status IN ('PENDING', 'PAID', 'FAILED', 'CANCELLED')", null, null, null, null],
      ['transactions_tran_id_key', 'unique', ['tran_id'], null, null, null, null, null],
    ],
    indexes: [],
  },
  user_factors: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.user_factors_id_seq'],
      ['user_id', 'bigint', false, null, null, null],
      ['factor_type', 'varchar(30)', false, null, null, null],
      ['identifier', 'varchar(255)', false, null, null, null],
      ['verified_at', 'timestamp with time zone', true, null, null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['user_factors_factor_type_check', 'check', ['factor_type'], "factor_type IN ('telegram', 'sms')", null, null, null, null],
      ['user_factors_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['user_factors_user_id_factor_type_identifier_key', 'unique', ['user_id', 'factor_type', 'identifier'], null, null, null, null, null],
      ['user_factors_user_id_fkey', 'foreign key', ['user_id'], null, 'public.users', ['id'], 'cascade', 'no action'],
    ],
    indexes: [],
  },
  users: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.users_id_seq'],
      ['google_sub', 'varchar(255)', true, null, null, null],
      ['email', 'varchar(320)', false, null, null, null],
      ['display_name', 'varchar(255)', false, null, null, null],
      ['avatar_url', 'text', true, null, null, null],
      ['language', 'varchar(5)', false, "'en'", null, null],
      ['last_login_at', 'timestamp with time zone', true, null, null, null],
      ['last_login_ip', 'inet', true, null, null, null],
      ['last_login_user_agent', 'text', true, null, null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
      ['password_hash', 'text', true, null, null, null],
      ['facebook_sub', 'varchar(255)', true, null, null, null],
      ['telegram_sub', 'varchar(255)', true, null, null, null],
      ['phone_number', 'varchar(32)', true, null, null, null],
      ['phone_verified_at', 'timestamp with time zone', true, null, null, null],
    ],
    constraints: [
      ['users_google_sub_key', 'unique', ['google_sub'], null, null, null, null, null],
      ['users_language_check', 'check', ['language'], "language IN ('en', 'km')", null, null, null, null],
      ['users_pkey', 'primary key', ['id'], null, null, null, null, null],
    ],
    indexes: [
      ['idx_users_email_unique', true, 'btree', ['email'], null, true, true],
      ['idx_users_facebook_sub_unique', true, 'btree', ['facebook_sub'], 'facebook_sub IS NOT NULL', true, true],
      ['idx_users_phone_number_unique', true, 'btree', ['phone_number'], 'phone_number IS NOT NULL', true, true],
      ['idx_users_telegram_sub_unique', true, 'btree', ['telegram_sub'], 'telegram_sub IS NOT NULL', true, true],
    ],
  },
  wallets: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.wallets_id_seq'],
      ['user_id', 'bigint', false, null, null, null],
      ['balance_minor', 'bigint', false, '0', null, null],
      ['currency', 'varchar(3)', false, "'KHR'", null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
      ['usd_balance_minor', 'bigint', false, '0', null, null],
    ],
    constraints: [
      ['wallets_balance_minor_check', 'check', ['balance_minor'], 'balance_minor >= 0', null, null, null, null],
      ['wallets_currency_check', 'check', ['currency'], "currency = 'KHR'", null, null, null, null],
      ['wallets_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['wallets_usd_balance_minor_nonnegative', 'check', ['usd_balance_minor'], 'usd_balance_minor >= 0', null, null, null, null],
      ['wallets_user_id_fkey', 'foreign key', ['user_id'], null, 'public.users', ['id'], 'cascade', 'no action'],
      ['wallets_user_id_key', 'unique', ['user_id'], null, null, null, null, null],
    ],
    indexes: [],
  },
}
const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageDir = join(scriptDir, '..')
const migrationsDir = join(packageDir, 'migrations')
const journalPath = join(migrationsDir, 'meta', '_journal.json')
const expectedMigrationTags = [
  '0000_fat_shen',
  '0001_powerful_katie_power',
]

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

function readMigrationMetadata() {
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  const entries = journal.entries

  if (
    entries?.length !== expectedMigrationTags.length
    || entries.some((entry, index) => (
      entry.idx !== index
      || entry.tag !== expectedMigrationTags[index]
      || entry.version !== '7'
      || !Number.isSafeInteger(entry.when)
      || entry.when <= 0
      || entry.breakpoints !== true
    ))
  ) {
    fail('migration journal does not contain the expected ordered entries')
  }

  return entries.map((entry, index) => ({
    hash: createHash('sha256')
      .update(readFileSync(
        join(migrationsDir, `${expectedMigrationTags[index]}.sql`),
        'utf8',
      ))
      .digest('hex'),
    timestamp: String(entry.when),
  }))
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

function stripOuterParentheses(value) {
  let result = value.trim()

  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0
    let wrapsExpression = true

    for (let index = 0; index < result.length; index += 1) {
      if (result[index] === '(') depth += 1
      if (result[index] === ')') depth -= 1
      if (depth === 0 && index < result.length - 1) {
        wrapsExpression = false
        break
      }
    }

    if (!wrapsExpression) break
    result = result.slice(1, -1).trim()
  }

  return result
}

function normalizeExpression(value) {
  if (value === null) return null

  let result = value
    .replace(/"(?:users|wallets)"\./g, '')
    .replace(/"([a-z_][a-z0-9_]*)"/gi, '$1')
    .replace(/::(?:character varying|text)(?:\[\])?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  result = stripOuterParentheses(result)
    .replace(/\(([a-z_][a-z0-9_]*)\)/gi, '$1')
    .replace(
      /=\s*ANY\s*\(\s*\(*\s*ARRAY\[(.*?)\]\s*\)*\s*\)/gi,
      'IN ($1)',
    )

  return stripOuterParentheses(result).trim()
}

function normalizeType(value) {
  return value.replace(/^character varying/, 'varchar')
}

async function readDetailedSchema(pool, tableName) {
  const columns = await pool.query(`
    SELECT
      a.attname AS name,
      format_type(a.atttypid, a.atttypmod) AS data_type,
      NOT a.attnotnull AS nullable,
      pg_get_expr(d.adbin, d.adrelid, true) AS default_value,
      CASE a.attidentity WHEN 'a' THEN 'ALWAYS' WHEN 'd' THEN 'BY DEFAULT' END AS identity_generation,
      CASE WHEN a.attidentity <> ''
        THEN pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname)
      END AS identity_sequence
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relname = $1
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
  `, [tableName])

  const constraints = await pool.query(`
    SELECT
      x.conname AS name,
      CASE x.contype
        WHEN 'p' THEN 'primary key'
        WHEN 'u' THEN 'unique'
        WHEN 'c' THEN 'check'
        WHEN 'f' THEN 'foreign key'
      END AS constraint_type,
      COALESCE((
        SELECT array_agg(a.attname ORDER BY key.ordinality)
        FROM unnest(x.conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid = x.conrelid AND a.attnum = key.attnum
      ), ARRAY[]::name[])::text[] AS columns,
      CASE WHEN x.contype = 'c' THEN pg_get_expr(x.conbin, x.conrelid, true) END AS expression,
      CASE WHEN x.contype = 'f' THEN format('%I.%I', rn.nspname, rc.relname) END AS referenced_table,
      COALESCE((
        SELECT array_agg(a.attname ORDER BY key.ordinality)
        FROM unnest(x.confkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid = x.confrelid AND a.attnum = key.attnum
      ), ARRAY[]::name[])::text[] AS referenced_columns,
      CASE x.confdeltype
        WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade'
        WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default'
      END AS on_delete,
      CASE x.confupdtype
        WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade'
        WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default'
      END AS on_update
    FROM pg_constraint x
    JOIN pg_class c ON c.oid = x.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_class rc ON rc.oid = x.confrelid
    LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = $1
    ORDER BY x.conname
  `, [tableName])

  const indexes = await pool.query(`
    SELECT
      ic.relname AS name,
      i.indisunique AS is_unique,
      am.amname AS method,
      ARRAY(
        SELECT
          pg_get_indexdef(i.indexrelid, keys.position, true)
          || CASE
            WHEN am.amname = 'btree'
              AND (i.indoption[keys.position - 1] & 1) = 1
              THEN ' DESC'
            ELSE ''
          END
          || CASE
            WHEN am.amname = 'btree'
              AND (i.indoption[keys.position - 1] & 1) = 0
              AND (i.indoption[keys.position - 1] & 2) = 2
              THEN ' NULLS FIRST'
            WHEN am.amname = 'btree'
              AND (i.indoption[keys.position - 1] & 1) = 1
              AND (i.indoption[keys.position - 1] & 2) = 0
              THEN ' NULLS LAST'
            ELSE ''
          END
        FROM generate_series(1, i.indnkeyatts) AS keys(position)
        ORDER BY keys.position
      ) AS columns,
      pg_get_expr(i.indpred, i.indrelid, true) AS predicate,
      i.indisvalid AS is_valid,
      i.indisready AS is_ready
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_am am ON am.oid = ic.relam
    WHERE n.nspname = 'public'
      AND c.relname = $1
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint x WHERE x.conindid = i.indexrelid
      )
    ORDER BY ic.relname
  `, [tableName])

  return {
    columns: columns.rows.map((column) => [
      column.name,
      normalizeType(column.data_type),
      column.nullable,
      normalizeExpression(column.default_value),
      column.identity_generation,
      column.identity_sequence,
    ]),
    constraints: constraints.rows.map((constraint) => [
      constraint.name,
      constraint.constraint_type,
      constraint.columns,
      normalizeExpression(constraint.expression),
      constraint.referenced_table,
      constraint.referenced_columns.length > 0
        ? constraint.referenced_columns
        : null,
      constraint.on_delete,
      constraint.on_update,
    ]),
    indexes: indexes.rows.map((index) => [
      index.name,
      index.is_unique,
      index.method,
      index.columns.map(normalizeExpression),
      normalizeExpression(index.predicate),
      index.is_valid,
      index.is_ready,
    ]),
  }
}

async function assertDetailedSchemas(pool) {
  for (const [tableName, expected] of Object.entries(expectedDetailedSchemas)) {
    const actual = await readDetailedSchema(pool, tableName)
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(
        `${tableName} catalog metadata mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      )
    }
  }
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
  const migrationMetadata = readMigrationMetadata()
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
    await assertDetailedSchemas(pool)

    const firstHistory = await readHistory(pool)
    const expectedHistory = migrationMetadata.map((migration, index) => ({
      id: index + 1,
      hash: migration.hash,
      created_at: migration.timestamp,
    }))
    if (JSON.stringify(firstHistory) !== JSON.stringify(expectedHistory)) {
      fail('Drizzle migration history does not match the ordered migrations')
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
