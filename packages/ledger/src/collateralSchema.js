import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { chainAssets } from '../../db/src/schema/chainAssets.js'
import { ctfConditions } from '../../db/src/schema/ctfConditions.js'
import { ctfPositionTokens } from '../../db/src/schema/ctfPositionTokens.js'
import { markets } from '../../db/src/schema/markets.js'
import { financialOperations } from './schema.js'
import { positionAccounts, positionReservations } from './positionSchema.js'

// Mock collateral and backing-provenance schema.
//
// This ledger keeps mock USDC separate from customer USD. It records which
// positions are backed by locked collateral so legacy unbacked fixture positions
// can never release collateral. MINT and MERGE execution are not implemented yet.

const id = () => bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey()
const qty = (name) => bigint(name, { mode: 'bigint' }).notNull()
const time = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull()

// -----------------------------------------------------------------------------
// Canonical binary pair registry
// -----------------------------------------------------------------------------

// An immutable binary registry row proves that two canonical CTF tokens form one complete partition.
export const binaryComplementaryPairs = pgTable(
  'binary_complementary_pairs',
  {
    id: id(),
    marketId: uuid('market_id').notNull().references(() => markets.id, { onDelete: 'restrict' }),
    conditionId: qty('condition_id').references(() => ctfConditions.id, { onDelete: 'restrict' }),
    yesTokenId: qty('yes_token_id').references(() => ctfPositionTokens.id, { onDelete: 'restrict' }),
    noTokenId: qty('no_token_id').references(() => ctfPositionTokens.id, { onDelete: 'restrict' }),
    collateralAssetId: qty('collateral_asset_id').references(() => chainAssets.id, { onDelete: 'restrict' }),
    fullPartitionMask: qty('full_partition_mask'),
    outcomeSlotCount: integer('outcome_slot_count').notNull(),
    mockOnly: boolean('mock_only').notNull().default(true),
    createdAt: time(),
  },
  (table) => [
    unique('binary_complementary_pairs_market_key').on(table.marketId),
    unique('binary_complementary_pairs_condition_key').on(table.conditionId),
    unique('binary_complementary_pairs_tokens_key').on(table.yesTokenId, table.noTokenId),
    check(
      'binary_complementary_pairs_shape_check',
      sql`${table.yesTokenId}<>${table.noTokenId} AND ${table.outcomeSlotCount}=2 AND ${table.fullPartitionMask}=3 AND ${table.mockOnly}`,
    ),
  ],
)

// -----------------------------------------------------------------------------
// Mock collateral ledger
// -----------------------------------------------------------------------------

// Mock USDC is accounted independently from customer USD and production USDC.
export const collateralAccounts = pgTable(
  'custodial_collateral_accounts',
  {
    id: id(),
    pairId: bigint('pair_id', { mode: 'bigint' }).references(() => binaryComplementaryPairs.id, { onDelete: 'restrict' }),
    assetId: qty('asset_id').references(() => chainAssets.id, { onDelete: 'restrict' }),
    accountKey: text('account_key').notNull().unique(),
    kind: text('kind').notNull(),
    mockOnly: boolean('mock_only').notNull().default(true),
    createdAt: time(),
  },
  (table) => [
    unique('custodial_collateral_accounts_pair_kind_key').on(table.pairId, table.kind),
    unique('custodial_collateral_accounts_id_asset_key').on(table.id, table.assetId),
    check(
      'custodial_collateral_accounts_kind_check',
      sql`(${table.kind}='MOCK_FUNDING_CONTROL' AND ${table.pairId} IS NULL) OR (${table.kind} IN ('TREASURY_AVAILABLE','CTF_LOCKED') AND ${table.pairId} IS NOT NULL)`,
    ),
    check('custodial_collateral_accounts_mock_check', sql`${table.mockOnly}`),
  ],
)

// A journal groups one immutable, balanced collateral operation.
export const collateralJournals = pgTable(
  'custodial_collateral_journals',
  {
    id: id(),
    operationId: qty('operation_id').unique().references(() => financialOperations.id, { onDelete: 'restrict' }),
    purpose: text('purpose').notNull(),
    status: text('status').notNull().default('DRAFT'),
    createdAt: time(),
  },
  (table) => [
    check('custodial_collateral_journals_purpose_check', sql`${table.purpose} IN ('MOCK_FUND','MINT_LOCK','MERGE_RELEASE')`),
    check('custodial_collateral_journals_status_check', sql`${table.status} IN ('DRAFT','POSTED')`),
  ],
)

export const collateralJournalEntries = pgTable('custodial_collateral_entries', {
  id: id(),
  journalId: qty('journal_id').references(() => collateralJournals.id, { onDelete: 'restrict' }),
  accountId: qty('account_id'),
  assetId: qty('asset_id'),
  side: text('side').notNull(),
  amount: qty('amount'),
}, (table) => [
  foreignKey({
    name: 'custodial_collateral_entries_account_asset_fk',
    columns: [table.accountId, table.assetId],
    foreignColumns: [collateralAccounts.id, collateralAccounts.assetId],
  }).onDelete('restrict'),
  check('custodial_collateral_entries_amount_check', sql`${table.amount}>0`),
  check('custodial_collateral_entries_side_check', sql`${table.side} IN ('DEBIT','CREDIT')`),
  index('idx_custodial_collateral_entries_journal').on(table.journalId),
  index('idx_custodial_collateral_entries_account').on(table.accountId, table.id),
])

// Projection rows are rebuildable caches; immutable journals remain authoritative.
export const collateralBalanceProjections = pgTable(
  'custodial_collateral_projections',
  {
    accountId: qty('account_id').primaryKey().references(() => collateralAccounts.id, { onDelete: 'restrict' }),
    posted: qty('posted').default(sql`0`),
  },
  (table) => [check('custodial_collateral_projections_units_check', sql`${table.posted}%1000000=0`)],
)

// -----------------------------------------------------------------------------
// Backed-position provenance overlay
// -----------------------------------------------------------------------------

// Backed quantity is an overlay: historical fixture positions remain unbacked without rewriting position history.
export const positionBackingProjections = pgTable('position_backing_projections', {
  accountId: qty('account_id').primaryKey().references(() => positionAccounts.id, { onDelete: 'restrict' }),
  backedPosted: qty('backed_posted').default(sql`0`),
  backedReserved: qty('backed_reserved').default(sql`0`),
}, (table) => [
  check(
    'position_backing_projections_units_check',
    sql`${table.backedPosted}>=0 AND ${table.backedReserved}>=0 AND ${table.backedReserved}<=${table.backedPosted} AND ${table.backedPosted}%1000000=0 AND ${table.backedReserved}%1000000=0`,
  ),
])

// Immutable backed-provenance movements accompany minting, direct transfers and eventual merging.
export const positionBackingJournals = pgTable('position_backing_journals', {
  id: id(),
  operationId: qty('operation_id').unique().references(() => financialOperations.id, { onDelete: 'restrict' }),
  purpose: text('purpose').notNull(),
  status: text('status').notNull().default('DRAFT'),
  createdAt: time(),
}, (table) => [
  check('position_backing_journals_purpose_check', sql`${table.purpose} IN ('MINT','DIRECT_TRANSFER','MERGE')`),
  check('position_backing_journals_status_check', sql`${table.status} IN ('DRAFT','POSTED')`),
])

export const positionBackingEntries = pgTable('position_backing_entries', {
  id: id(),
  journalId: qty('journal_id').references(() => positionBackingJournals.id, { onDelete: 'restrict' }),
  accountId: qty('account_id').references(() => positionAccounts.id, { onDelete: 'restrict' }),
  side: text('side').notNull(),
  quantity: qty('quantity'),
}, (table) => [
  check('position_backing_entries_side_check', sql`${table.side} IN ('IN','OUT')`),
  check('position_backing_entries_quantity_check', sql`${table.quantity}>0 AND ${table.quantity}%1000000=0`),
  index('idx_position_backing_entries_journal').on(table.journalId),
  index('idx_position_backing_entries_account').on(table.accountId, table.id),
])

// Each reservation keeps the exact backed/unbacked split selected when it was opened.
export const positionReservationBacking = pgTable('position_reservation_backing', {
  reservationId: qty('reservation_id').primaryKey().references(() => positionReservations.id, { onDelete: 'restrict' }),
  backedAmount: qty('backed_amount'),
  unbackedAmount: qty('unbacked_amount'),
  backedConsumed: qty('backed_consumed').default(sql`0`),
  unbackedConsumed: qty('unbacked_consumed').default(sql`0`),
  backedReleased: qty('backed_released').default(sql`0`),
  unbackedReleased: qty('unbacked_released').default(sql`0`),
}, (table) => [
  check(
    'position_reservation_backing_amounts_check',
    sql`${table.backedAmount}>=0 AND ${table.unbackedAmount}>=0 AND ${table.backedConsumed}>=0 AND ${table.unbackedConsumed}>=0 AND ${table.backedReleased}>=0 AND ${table.unbackedReleased}>=0 AND ${table.backedConsumed}+${table.backedReleased}<=${table.backedAmount} AND ${table.unbackedConsumed}+${table.unbackedReleased}<=${table.unbackedAmount}`,
  ),
])

export const positionReservationBackingEvents = pgTable('position_reservation_backing_events', {
  id: id(),
  reservationId: qty('reservation_id').references(() => positionReservationBacking.reservationId, { onDelete: 'restrict' }),
  operationId: qty('operation_id').unique().references(() => financialOperations.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull(),
  backedQuantity: qty('backed_quantity'),
  unbackedQuantity: qty('unbacked_quantity'),
  createdAt: time(),
}, (table) => [
  check('position_reservation_backing_events_kind_check', sql`${table.kind} IN ('ALLOCATE','CONSUME','RELEASE','CANCEL')`),
  check(
    'position_reservation_backing_events_quantity_check',
    sql`${table.backedQuantity}>=0 AND ${table.unbackedQuantity}>=0 AND ${table.backedQuantity}+${table.unbackedQuantity}>0 AND ${table.backedQuantity}%1000000=0 AND ${table.unbackedQuantity}%1000000=0`,
  ),
  index('idx_position_reservation_backing_events_reservation').on(table.reservationId, table.id),
])

export const ctfCollateralBacking = pgTable('ctf_collateral_backing', {
  pairId: qty('pair_id').primaryKey().references(() => binaryComplementaryPairs.id, { onDelete: 'restrict' }),
  mintedQuantity: qty('minted_quantity').default(sql`0`),
  mergedQuantity: qty('merged_quantity').default(sql`0`),
  lockedCollateral: qty('locked_collateral').default(sql`0`),
}, (table) => [
  check(
    'ctf_collateral_backing_check',
    sql`${table.mintedQuantity}>=0 AND ${table.mergedQuantity}>=0 AND ${table.mergedQuantity}<=${table.mintedQuantity} AND ${table.lockedCollateral}=(${table.mintedQuantity}-${table.mergedQuantity})`,
  ),
])
