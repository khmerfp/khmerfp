import { sql } from 'drizzle-orm'
import { numeric, pgTable, text, bigint, integer, boolean, jsonb, timestamp, unique, check, foreignKey, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core'
import { users } from '../../db/src/schema/users.js'
const identity = () => bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey()
const amount = name => bigint(name, { mode: 'bigint' }).notNull()
const time = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
export const financialAssets = pgTable('financial_assets', {
  code: text('code').primaryKey(), decimals: integer('decimals').notNull(), enabled: boolean('enabled').notNull().default(false),
}, t => [check('financial_assets_identity_check', sql`(${t.code} = 'USD' AND ${t.decimals} = 2 AND ${t.enabled}) OR (${t.code} = 'USDC' AND ${t.decimals} = 6 AND NOT ${t.enabled})`)])
export const financialAccounts = pgTable('financial_accounts', {
  id: identity(), asset: text('asset').notNull().references(() => financialAssets.code, { onDelete: 'restrict' }),
  ownerUserId: bigint('owner_user_id', { mode: 'bigint' }).references(() => users.id, { onDelete: 'restrict' }),
  accountKey: text('account_key').notNull().unique(), kind: text('kind').notNull(), normalSide: text('normal_side').notNull(), createdAt: time(),
}, t => [unique('financial_accounts_id_asset_key').on(t.id,t.asset), unique('financial_accounts_owner_asset_key').on(t.ownerUserId,t.asset),
  check('financial_accounts_kind_check',sql`(${t.kind} = 'CUSTOMER' AND ${t.ownerUserId} IS NOT NULL AND ${t.normalSide} = 'CREDIT') OR (${t.kind} IN ('ASSET','EQUITY','REVENUE','EXPENSE','CLEARING') AND ${t.ownerUserId} IS NULL AND ${t.normalSide} IN ('DEBIT','CREDIT'))`)])
export const financialOperations = pgTable('financial_operations', {
  id: identity(), operationKey: text('operation_key').notNull().unique(), actor: text('actor').notNull(), action: text('action').notNull(), terms: jsonb('terms').notNull(), requestHash: text('request_hash').notNull(), result: jsonb('result'), createdAt: time(),
}, t => [uniqueIndex('financial_operations_post_reference_key').on(sql`(${t.terms}->>'reference')`).where(sql`${t.action} = 'POST'`)])
export const financialJournals = pgTable('financial_journals', {
  id: identity(), operationId: bigint('operation_id',{mode:'bigint'}).notNull().unique().references(()=>financialOperations.id,{onDelete:'restrict'}),
  status: text('status').notNull().default('DRAFT'), reversalOf: bigint('reversal_of',{mode:'bigint'}), createdAt: time(),
}, t=>[foreignKey({name:'financial_journals_reversal_fk',columns:[t.reversalOf],foreignColumns:[t.id]}).onDelete('restrict'), unique('financial_journals_reversal_key').on(t.reversalOf), check('financial_journals_status_check',sql`${t.status} IN ('DRAFT','POSTED')`)])
export const financialJournalEntries = pgTable('financial_journal_entries', {
  id: identity(), journalId: bigint('journal_id',{mode:'bigint'}).notNull().references(()=>financialJournals.id,{onDelete:'restrict'}),
  accountId: amount('account_id'), asset: text('asset').notNull(), side:text('side').notNull(), amount:amount('amount'),
}, t=>[foreignKey({name:'financial_entries_account_asset_fk',columns:[t.accountId,t.asset],foreignColumns:[financialAccounts.id,financialAccounts.asset]}).onDelete('restrict'), check('financial_entries_amount_check',sql`${t.amount} > 0`), check('financial_entries_side_check',sql`${t.side} IN ('DEBIT','CREDIT')`),index('idx_financial_entries_account').on(t.accountId,t.id),index('idx_financial_entries_journal').on(t.journalId)])
export const financialBalanceProjections = pgTable('financial_balance_projections', {
  accountId: bigint('account_id',{mode:'bigint'}).primaryKey().references(()=>financialAccounts.id,{onDelete:'restrict'}), posted:amount('posted').default(sql`0`), reserved:amount('reserved').default(sql`0`),
},t=>[check('financial_projection_reserved_check',sql`${t.reserved} >= 0`)])
export const cashReservations = pgTable('cash_reservations', {
  id:identity(), accountId:amount('account_id').references(()=>financialAccounts.id,{onDelete:'restrict'}), operationId:amount('operation_id').unique().references(()=>financialOperations.id,{onDelete:'restrict'}), reference:text('reference').notNull(), amount:amount('amount'), consumed:amount('consumed').default(sql`0`), released:amount('released').default(sql`0`), status:text('status').notNull().default('OPEN'), createdAt:time(),
},t=>[unique('cash_reservations_account_reference_key').on(t.accountId,t.reference),check('cash_reservation_amounts_check',sql`${t.amount} > 0 AND ${t.consumed} >= 0 AND ${t.released} >= 0 AND ${t.consumed}::numeric + ${t.released} <= ${t.amount}`),check('cash_reservation_status_check',sql`(${t.status} = 'OPEN' AND ${t.consumed}::numeric + ${t.released} < ${t.amount}) OR (${t.status} IN ('CLOSED','CANCELLED') AND ${t.consumed}::numeric + ${t.released} = ${t.amount})`),index('idx_cash_reservations_account').on(t.accountId)])
export const cashReservationEvents = pgTable('cash_reservation_events', {
  id:identity(), reservationId:amount('reservation_id').references(()=>cashReservations.id,{onDelete:'restrict'}), operationId:amount('operation_id').unique().references(()=>financialOperations.id,{onDelete:'restrict'}), kind:text('kind').notNull(), amount:amount('amount'), journalId:bigint('journal_id',{mode:'bigint'}).unique().references(()=>financialJournals.id,{onDelete:'restrict'}),createdAt:time(),
},t=>[check('cash_reservation_events_kind_check',sql`${t.kind} IN ('RESERVE','CONSUME','RELEASE','CANCEL')`),check('cash_reservation_events_amount_check',sql`${t.amount} > 0`),check('cash_reservation_events_journal_check',sql`(${t.kind} = 'CONSUME') = (${t.journalId} IS NOT NULL)`),index('idx_cash_reservation_events_reservation').on(t.reservationId,t.id)])

// Internal transaction-local validation targets. Runtime has no direct access.
export const financialAuditDeltas = pgTable('financial_audit_deltas', {
  generation: bigint('generation', {mode:'bigint'}).generatedAlwaysAsIdentity().primaryKey(),
  transactionId: text('transaction_id').notNull(),
  targetKind: text('target_kind').notNull(),
  targetId: bigint('target_id',{mode:'bigint'}).notNull(),
  baselineFirst: numeric('baseline_first').notNull(),
  baselineSecond: numeric('baseline_second').notNull(),
  deltaFirst: numeric('delta_first').notNull().default('0'),
  deltaSecond: numeric('delta_second').notNull().default('0'),
  newObject: boolean('new_object').notNull().default(false),
  fullRebuild: boolean('full_rebuild').notNull().default(false),
  eventIds: bigint('event_ids',{mode:'bigint'}).array().notNull().default(sql`'{}'::bigint[]`),
  rebuildDomain: text('rebuild_domain').notNull().default(''),
},t=>[
  unique('financial_audit_deltas_target_key').on(t.transactionId,t.targetKind,t.targetId),
  check('financial_audit_deltas_identity_check',sql`${t.transactionId} ~ '^[0-9]+$' AND ${t.targetId}>0`),
  check('financial_audit_deltas_kind_check',sql`${t.targetKind} IN ('ACCOUNT','POSITION_ACCOUNT','RESERVATION','POSITION_RESERVATION','MAINTENANCE')`),
  check('financial_audit_deltas_integer_check',sql`scale(${t.baselineFirst})=0 AND scale(${t.baselineSecond})=0 AND scale(${t.deltaFirst})=0 AND scale(${t.deltaSecond})=0`),
  check('financial_audit_deltas_domain_check',sql`(${t.targetKind}='MAINTENANCE' AND ${t.rebuildDomain} IN ('CASH','POSITION')) OR (${t.targetKind}<>'MAINTENANCE' AND ${t.rebuildDomain}='')`),
])

export const financialAuditTargets = pgTable('financial_audit_targets', {
  transactionId: text('transaction_id').notNull(),
  targetKind: text('target_kind').notNull(),
  targetId: bigint('target_id', { mode: 'bigint' }).notNull(),
  contextGeneration: bigint('context_generation',{mode:'bigint'}),
}, t => [
  foreignKey({name:'financial_targets_delta_generation_fk',columns:[t.contextGeneration],foreignColumns:[financialAuditDeltas.generation]}).onDelete('restrict'),
  primaryKey({name:'financial_audit_targets_pkey',columns:[t.transactionId,t.targetKind,t.targetId]}),
  check('financial_audit_targets_identity_check',sql`${t.transactionId} ~ '^[0-9]+$' AND ${t.targetId} > 0`),
  check('financial_audit_targets_kind_check',sql`${t.targetKind} IN ('OPERATION','JOURNAL','ACCOUNT','RESERVATION','POSITION_ACCOUNT','POSITION_JOURNAL','POSITION_RESERVATION','SETTLEMENT')`),
])
