import { randomUUID } from 'node:crypto'
// PostgreSQL BIGINT limits apply before any request reaches the database.
export const MAX_BIGINT = 9223372036854775807n

// Cash amounts are positive USD cents; Number inputs are deliberately rejected.
export function money(value) {
  if (typeof value !== 'bigint' || value <= 0n || value > MAX_BIGINT)
    throw new TypeError('Amount must be a positive PostgreSQL BIGINT, in USD cents.')
  return value.toString()
}

// Six-decimal token units are retained, while trading currently permits whole shares only.
export const UNITS_PER_SHARE = 1000000n
export function quantity(value) {
  if (
    typeof value !== 'bigint' ||
    value <= 0n ||
    value > MAX_BIGINT ||
    value % UNITS_PER_SHARE !== 0n
  )
    throw new TypeError('Quantity must be positive whole-share BIGINT base units.')
  return value.toString()
}

// Sort request keys and encode BigInts as decimal strings without losing precision.
function encodeTerms(value, key = '') {
  if (key === 'quantity') return quantity(value)
  if (['amount', 'priceCents'].includes(key)) return money(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number')
    throw new TypeError('Use BigInt or strings, never Number, for ledger terms.')
  if (Array.isArray(value)) return value.map((v) => encodeTerms(v))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, encodeTerms(value[k], k)]),
    )
  return value
}
// The authorizer is a trusted backend capability boundary, never a request-body callback.
// No public routes are registered. Database access uses a restricted non-owner role.
function createOperationClient({
  pool,
  authorize,
  enabled = false,
  environment = process.env.NODE_ENV,
}) {
  if (
    enabled !== true ||
    ['production', 'staging'].includes(process.env.NODE_ENV) ||
    !['test', 'development'].includes(environment)
  )
    throw new Error('Custodial ledger is disabled outside explicit local development/test.')
  if (typeof authorize !== 'function')
    throw new TypeError('A trusted operation authorizer is required.')
  async function execute(actor, action, key, terms) {
    if (
      typeof actor !== 'string' ||
      !/^(user:[1-9][0-9]*|system:[a-z][a-z0-9_-]{0,60})$/.test(actor || '')
    )
      throw new TypeError('Invalid authorized actor.')
    if (typeof key !== 'string' || !/^[A-Za-z0-9:_-]{1,120}$/.test(key))
      throw new TypeError('Invalid idempotency key.')
    // Snapshot before asynchronous authorization; neither caller nor authorizer can retarget it.
    const payload = encodeTerms(terms)
    if ((await authorize({ actor, action, terms: structuredClone(payload) })) !== true)
      throw new Error('Financial operation not authorized.')
    const client = await pool.connect()
    let discardConnection
    try {
      // Keep execution, deferred integrity checks and rollback on the same connection.
      await client.query('BEGIN')
      await client.query("SET LOCAL statement_timeout = '10s'")
      await client.query("SET LOCAL lock_timeout = '5s'")
      // Refuse migration credentials, owner membership and direct-write privileges.
      const privilege = (
        await client.query(`
          SELECT
              r.rolsuper
              OR r.rolcreaterole
              OR r.rolcreatedb
              OR r.rolbypassrls AS elevated,
              has_schema_privilege(CURRENT_USER, 'public', 'CREATE') AS schema_create,
              EXISTS (
                  SELECT
                      1
                  FROM
                      pg_class c
                  WHERE
                      c.relnamespace = 'public'::regnamespace
                      AND c.relname IN ('financial_assets', 'financial_accounts', 'financial_operations', 'financial_journals', 'financial_journal_entries', 'financial_balance_projections', 'cash_reservations', 'cash_reservation_events', 'financial_audit_targets', 'financial_audit_deltas', 'position_accounts', 'position_journals', 'position_journal_entries', 'position_balance_projections', 'position_reservations', 'position_reservation_events', 'cash_position_settlements')
                      AND (pg_has_role(CURRENT_USER, c.relowner, 'MEMBER')
                          OR has_table_privilege(CURRENT_USER, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
                          OR has_any_column_privilege(CURRENT_USER, c.oid, 'INSERT,UPDATE'))) AS direct_write,
              EXISTS (
                  SELECT
                      1
                  FROM
                      pg_proc f
                      JOIN pg_roles owner_role ON owner_role.oid = f.proowner
                  WHERE
                      f.pronamespace = 'public'::regnamespace
                      AND f.proname IN ('financial_execute', 'financial_audit', 'financial_guard', 'financial_immutable', 'financial_schedule_audit', 'financial_validate_target', 'financial_reconcile', 'financial_cash_execute', 'position_execute', 'position_guard', 'position_validate', 'financial_protect_delta', 'financial_protect_target', 'financial_capture_baseline', 'financial_accumulate_delta', 'financial_queue_audit', 'financial_validate_delta', 'financial_delta_link_check')
                      AND (pg_has_role(CURRENT_USER, f.proowner, 'MEMBER')
                          OR owner_role.rolsuper
                          OR owner_role.rolcreaterole
                          OR owner_role.rolcreatedb
                          OR owner_role.rolbypassrls
                          OR owner_role.rolcanlogin
                          OR NOT COALESCE(f.proconfig @> ARRAY['search_path=pg_catalog'], FALSE))) AS unsafe_definer,
              pg_has_role(CURRENT_USER,(
                      SELECT
                          proowner
                      FROM pg_proc
                      WHERE
                          oid = 'public.financial_execute(text,text,text,jsonb)'::regprocedure), 'MEMBER') AS function_owner
          FROM
              pg_roles r
          WHERE
              r.rolname = CURRENT_USER
        `)
      ).rows[0]
      if (
        !privilege ||
        ['elevated', 'schema_create', 'direct_write', 'function_owner', 'unsafe_definer'].some(
          (key) => privilege[key] !== false,
        )
      ) {
        throw new Error(
          'Ledger requires a restricted runtime role distinct from migration ownership.',
        )
      }
      // Financial state changes live in the controlled PostgreSQL functions.
      const result =
        action === 'RECONCILE'
          ? await client.query('SELECT public.financial_reconcile($1) AS result', [actor])
          : await client.query('SELECT public.financial_execute($1,$2,$3,$4::jsonb) AS result', [
              actor,
              action,
              key,
              JSON.stringify(payload),
            ])
      // COMMIT runs mandatory deferred checks before returning success to the caller.
      await client.query('COMMIT')
      return result.rows[0].result
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        discardConnection = rollbackError
      }
      throw error
    } finally {
      // Discard a connection if rollback failed; do not return an aborted session to the pool.
      client.release(discardConnection)
    }
  }
  return execute
}

// Cash operations share the authorization, idempotency and transaction boundary above.
export function createLedger(options) {
  const execute = createOperationClient(options)
  return {
    createAccount: (actor, key, terms) => execute(actor, 'ACCOUNT', key, terms),
    post: (actor, key, entries, reference) => execute(actor, 'POST', key, { entries, reference }),
    balance: (actor, accountId) => execute(actor, 'BALANCE', randomUUID(), { accountId }),
    reserve: (actor, key, terms) => execute(actor, 'RESERVE', key, terms),
    release: (actor, key, terms) => execute(actor, 'RELEASE', key, terms),
    cancel: (actor, key, reservationId) => execute(actor, 'CANCEL', key, { reservationId }),
    consume: (actor, key, terms) => execute(actor, 'CONSUME', key, terms),
    reverse: (actor, key, journalId) => execute(actor, 'REVERSE', key, { journalId }),
    rebuild: (actor, key) => execute(actor, 'REBUILD', key, {}),
    reconcile: (actor) => execute(actor, 'RECONCILE', randomUUID(), {}),
  }
}

// Position operations use that same boundary; SETTLE commits both cash and share legs together.
export function createPositionLedger(options) {
  const execute = createOperationClient(options)
  return {
    createAccount: (actor, key, terms) => execute(actor, 'POSITION_ACCOUNT', key, terms),
    balance: (actor, accountId) => execute(actor, 'POSITION_BALANCE', randomUUID(), { accountId }),
    post: (actor, key, entries, reference) =>
      execute(actor, 'POSITION_POST', key, { entries, reference }),
    transfer: (actor, key, terms) => execute(actor, 'POSITION_TRANSFER', key, terms),
    reserve: (actor, key, terms) => execute(actor, 'POSITION_RESERVE', key, terms),
    consume: (actor, key, terms) => execute(actor, 'POSITION_CONSUME', key, terms),
    release: (actor, key, terms) => execute(actor, 'POSITION_RELEASE', key, terms),
    cancel: (actor, key, reservationId) =>
      execute(actor, 'POSITION_CANCEL', key, { reservationId }),
    reverse: (actor, key, journalId) => execute(actor, 'POSITION_REVERSE', key, { journalId }),
    rebuild: (actor, key) => execute(actor, 'POSITION_REBUILD', key, {}),
    reconcile: (actor) => execute(actor, 'POSITION_RECONCILE', randomUUID(), {}),
    settle: (actor, key, terms) => execute(actor, 'SETTLE', key, terms),
  }
}
