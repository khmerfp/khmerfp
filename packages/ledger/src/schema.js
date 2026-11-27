// Cash-ledger schema.
//
// Source of truth: immutable journals and journal entries.
// Fast current state: balance projections.
// Spending protection: cash reservations and their immutable lifecycle events.
// Audit state: transaction-scoped targets and deltas validated before commit.
//
// Application code must use the controlled ledger functions; it must not update
// projections or posted financial history directly.

import { sql } from 'drizzle-orm'
import {
  numeric,
  pgTable,
  text,
  bigint,
  integer,
  boolean,
  jsonb,
  timestamp,
  unique,
  check,
  foreignKey,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { users } from '../../db/src/schema/users.js'

// Fresh column builders keep SQL identities, BigInt values and timestamps consistent.
const identityColumn = () =>
  bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey()
const requiredBigIntColumn = (name) => bigint(name, { mode: 'bigint' }).notNull()
const createdAtColumn = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull()

// Asset identity and precision are fixed: USD uses cents; USDC stays disabled.
export const financialAssets = pgTable(
  'financial_assets',
  {
    code: text('code').primaryKey(),
    decimals: integer('decimals').notNull(),
    enabled: boolean('enabled').notNull().default(false),
  },
  (table) => [
    check(
      'financial_assets_identity_check',
      sql`(${table.code} = 'USD' AND ${table.decimals} = 2 AND ${table.enabled}) OR (${table.code} = 'USDC' AND ${table.decimals} = 6 AND NOT ${table.enabled})`,
    ),
  ],
)

// Customer accounts hold USD liabilities. System accounts record treasury and clearing legs.
export const financialAccounts = pgTable(
  'financial_accounts',
  {
    id: identityColumn(),
    asset: text('asset')
      .notNull()
      .references(() => financialAssets.code, { onDelete: 'restrict' }),
    ownerUserId: bigint('owner_user_id', { mode: 'bigint' }).references(() => users.id, {
      onDelete: 'restrict',
    }),
    accountKey: text('account_key').notNull().unique(),
    kind: text('kind').notNull(),
    normalSide: text('normal_side').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('financial_accounts_id_asset_key').on(table.id, table.asset),
    unique('financial_accounts_owner_asset_key').on(table.ownerUserId, table.asset),
    check(
      'financial_accounts_kind_check',
      sql`(${table.kind} = 'CUSTOMER' AND ${table.ownerUserId} IS NOT NULL AND ${table.normalSide} = 'CREDIT') OR (${table.kind} IN ('ASSET','EQUITY','REVENUE','EXPENSE','CLEARING') AND ${table.ownerUserId} IS NULL AND ${table.normalSide} IN ('DEBIT','CREDIT'))`,
    ),
  ],
)

// One actor-bound operation key identifies a canonical request and its durable result.
export const financialOperations = pgTable(
  'financial_operations',
  {
    id: identityColumn(),
    operationKey: text('operation_key').notNull().unique(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    terms: jsonb('terms').notNull(),
    requestHash: text('request_hash').notNull(),
    result: jsonb('result'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('financial_operations_post_reference_key')
      .on(sql`(${table.terms}->>'reference')`)
      .where(sql`${table.action} = 'POST'`),
  ],
)

// A journal groups balanced entries. Posting and reversal rules are enforced by SQL triggers.
export const financialJournals = pgTable(
  'financial_journals',
  {
    id: identityColumn(),
    operationId: bigint('operation_id', { mode: 'bigint' })
      .notNull()
      .unique()
      .references(() => financialOperations.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('DRAFT'),
    reversalOf: bigint('reversal_of', { mode: 'bigint' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({
      name: 'financial_journals_reversal_fk',
      columns: [table.reversalOf],
      foreignColumns: [table.id],
    }).onDelete('restrict'),
    unique('financial_journals_reversal_key').on(table.reversalOf),
    check('financial_journals_status_check', sql`${table.status} IN ('DRAFT','POSTED')`),
  ],
)

// Immutable debit/credit lines are the source of truth for posted cash balances.
export const financialJournalEntries = pgTable(
  'financial_journal_entries',
  {
    id: identityColumn(),
    journalId: bigint('journal_id', { mode: 'bigint' })
      .notNull()
      .references(() => financialJournals.id, { onDelete: 'restrict' }),
    accountId: requiredBigIntColumn('account_id'),
    asset: text('asset').notNull(),
    side: text('side').notNull(),
    amount: requiredBigIntColumn('amount'),
  },
  (table) => [
    foreignKey({
      name: 'financial_entries_account_asset_fk',
      columns: [table.accountId, table.asset],
      foreignColumns: [financialAccounts.id, financialAccounts.asset],
    }).onDelete('restrict'),
    check('financial_entries_amount_check', sql`${table.amount} > 0`),
    check('financial_entries_side_check', sql`${table.side} IN ('DEBIT','CREDIT')`),
    index('idx_financial_entries_account').on(table.accountId, table.id),
    index('idx_financial_entries_journal').on(table.journalId),
  ],
)

// Read-optimized cash totals. Available cash is posted minus reserved; history remains authoritative.
export const financialBalanceProjections = pgTable(
  'financial_balance_projections',
  {
    accountId: bigint('account_id', { mode: 'bigint' })
      .primaryKey()
      .references(() => financialAccounts.id, { onDelete: 'restrict' }),
    posted: requiredBigIntColumn('posted').default(sql`0`),
    reserved: requiredBigIntColumn('reserved').default(sql`0`),
  },
  (table) => [check('financial_projection_reserved_check', sql`${table.reserved} >= 0`)],
)

// A cash hold prevents spending the same available funds twice. Consumption and release are cumulative.
export const cashReservations = pgTable(
  'cash_reservations',
  {
    id: identityColumn(),
    accountId: requiredBigIntColumn('account_id').references(() => financialAccounts.id, {
      onDelete: 'restrict',
    }),
    operationId: requiredBigIntColumn('operation_id')
      .unique()
      .references(() => financialOperations.id, { onDelete: 'restrict' }),
    reference: text('reference').notNull(),
    amount: requiredBigIntColumn('amount'),
    consumed: requiredBigIntColumn('consumed').default(sql`0`),
    released: requiredBigIntColumn('released').default(sql`0`),
    status: text('status').notNull().default('OPEN'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('cash_reservations_account_reference_key').on(table.accountId, table.reference),
    check(
      'cash_reservation_amounts_check',
      sql`${table.amount} > 0 AND ${table.consumed} >= 0 AND ${table.released} >= 0 AND ${table.consumed}::numeric + ${table.released} <= ${table.amount}`,
    ),
    check(
      'cash_reservation_status_check',
      sql`(${table.status} = 'OPEN' AND ${table.consumed}::numeric + ${table.released} < ${table.amount}) OR (${table.status} IN ('CLOSED','CANCELLED') AND ${table.consumed}::numeric + ${table.released} = ${table.amount})`,
    ),
    index('idx_cash_reservations_account').on(table.accountId),
  ],
)

// Append-only evidence of every hold, consumption, release and cancellation.
export const cashReservationEvents = pgTable(
  'cash_reservation_events',
  {
    id: identityColumn(),
    reservationId: requiredBigIntColumn('reservation_id').references(() => cashReservations.id, {
      onDelete: 'restrict',
    }),
    operationId: requiredBigIntColumn('operation_id')
      .unique()
      .references(() => financialOperations.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    amount: requiredBigIntColumn('amount'),
    journalId: bigint('journal_id', { mode: 'bigint' })
      .unique()
      .references(() => financialJournals.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    check(
      'cash_reservation_events_kind_check',
      sql`${table.kind} IN ('RESERVE','CONSUME','RELEASE','CANCEL')`,
    ),
    check('cash_reservation_events_amount_check', sql`${table.amount} > 0`),
    check(
      'cash_reservation_events_journal_check',
      sql`(${table.kind} = 'CONSUME') = (${table.journalId} IS NOT NULL)`,
    ),
    index('idx_cash_reservation_events_reservation').on(table.reservationId, table.id),
  ],
)


// Private per-transaction baselines and entry/event deltas, validated before commit and then removed.
// Account pairs mean posted/reserved; reservation pairs mean consumed/released.
// NUMERIC keeps intermediate sums exact; persisted account amounts remain bounded BIGINTs.
export const financialAuditDeltas = pgTable(
  'financial_audit_deltas',
  {
    generation: bigint('generation', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    transactionId: text('transaction_id').notNull(),
    targetKind: text('target_kind').notNull(),
    targetId: bigint('target_id', { mode: 'bigint' }).notNull(),
    baselineFirst: numeric('baseline_first').notNull(),
    baselineSecond: numeric('baseline_second').notNull(),
    deltaFirst: numeric('delta_first').notNull().default('0'),
    deltaSecond: numeric('delta_second').notNull().default('0'),
    newObject: boolean('new_object').notNull().default(false),
    fullRebuild: boolean('full_rebuild').notNull().default(false),
    eventIds: bigint('event_ids', { mode: 'bigint' })
      .array()
      .notNull()
      .default(sql`'{}'::bigint[]`),
    rebuildDomain: text('rebuild_domain').notNull().default(''),
  },
  (table) => [
    unique('financial_audit_deltas_target_key').on(
      table.transactionId,
      table.targetKind,
      table.targetId,
    ),
    check(
      'financial_audit_deltas_identity_check',
      sql`${table.transactionId} ~ '^[0-9]+$' AND ${table.targetId}>0`,
    ),
    check(
      'financial_audit_deltas_kind_check',
      sql`${table.targetKind} IN ('ACCOUNT','POSITION_ACCOUNT','RESERVATION','POSITION_RESERVATION','MAINTENANCE')`,
    ),
    check(
      'financial_audit_deltas_integer_check',
      sql`scale(${table.baselineFirst})=0 AND scale(${table.baselineSecond})=0 AND scale(${table.deltaFirst})=0 AND scale(${table.deltaSecond})=0`,
    ),
    check(
      'financial_audit_deltas_domain_check',
      sql`(${table.targetKind}='MAINTENANCE' AND ${table.rebuildDomain} IN ('CASH','POSITION')) OR (${table.targetKind}<>'MAINTENANCE' AND ${table.rebuildDomain}='')`,
    ),
  ],
)

// Private deduplicated commit checks. A generation links each account/reservation to its captured baseline.
export const financialAuditTargets = pgTable(
  'financial_audit_targets',
  {
    transactionId: text('transaction_id').notNull(),
    targetKind: text('target_kind').notNull(),
    targetId: bigint('target_id', { mode: 'bigint' }).notNull(),
    contextGeneration: bigint('context_generation', { mode: 'bigint' }),
  },
  (table) => [
    foreignKey({
      name: 'financial_targets_delta_generation_fk',
      columns: [table.contextGeneration],
      foreignColumns: [financialAuditDeltas.generation],
    }).onDelete('restrict'),
    primaryKey({
      name: 'financial_audit_targets_pkey',
      columns: [table.transactionId, table.targetKind, table.targetId],
    }),
    check(
      'financial_audit_targets_identity_check',
      sql`${table.transactionId} ~ '^[0-9]+$' AND ${table.targetId} > 0`,
    ),
    check(
      'financial_audit_targets_kind_check',
      sql`${table.targetKind} IN ('OPERATION','JOURNAL','ACCOUNT','RESERVATION','POSITION_ACCOUNT','POSITION_JOURNAL','POSITION_RESERVATION','SETTLEMENT')`,
    ),
  ],
)
