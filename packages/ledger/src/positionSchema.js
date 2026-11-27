// Position accounting schema.
//
// Immutable journals are the source of truth. Projections provide current
// balances, while reservations prevent the same position from being sold twice.
// Cash-position settlements link both accounting legs into one transaction.

import { sql } from 'drizzle-orm'
import {
  pgTable,
  bigint,
  text,
  timestamp,
  uuid,
  check,
  unique,
  uniqueIndex,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core'
import { users } from '../../db/src/schema/users.js'
import { markets } from '../../db/src/schema/markets.js'
import { ctfPositionTokens } from '../../db/src/schema/ctfPositionTokens.js'
import {
  financialAccounts,
  financialOperations,
  financialJournals,
  cashReservations,
} from './schema.js'

// Fresh column builders keep SQL identities, BigInt values and timestamps consistent.
const identityColumn = () =>
  bigint('id', {
    mode: 'bigint',
  })
    .generatedAlwaysAsIdentity()
    .primaryKey()
const requiredBigIntColumn = (name) =>
  bigint(name, {
    mode: 'bigint',
  }).notNull()
const createdAtColumn = () =>
  timestamp('created_at', {
    withTimezone: true,
  })
    .defaultNow()
    .notNull()

// Ownership of one registered CTF token. External control accounts balance history but are not spendable inventory.
export const positionAccounts = pgTable(
  'position_accounts',
  {
    id: identityColumn(),
    // Foreign key to the token registry row, not the on-chain ERC-1155 token number.
    tokenId: requiredBigIntColumn('token_id').references(() => ctfPositionTokens.id, {
      onDelete: 'restrict',
    }),
    ownerUserId: bigint('owner_user_id', {
      mode: 'bigint',
    }).references(() => users.id, {
      onDelete: 'restrict',
    }),
    accountKey: text('account_key').notNull().unique(),
    kind: text('kind').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('position_accounts_id_token_key').on(table.id, table.tokenId),
    unique('position_accounts_owner_token_key').on(table.ownerUserId, table.tokenId),
    uniqueIndex('position_accounts_system_token_key')
      .on(table.tokenId, table.kind)
      .where(sql`${table.ownerUserId} IS NULL`),
    check(
      'position_accounts_kind_check',
      sql`(${table.kind}='CUSTOMER' AND ${table.ownerUserId} IS NOT NULL) OR (${table.kind} IN ('UNALLOCATED','EXTERNAL_CONTROL') AND ${table.ownerUserId} IS NULL)`,
    ),
  ],
)

// A journal groups movements of outcome shares. SQL validates balance independently for each token.
export const positionJournals = pgTable(
  'position_journals',
  {
    id: identityColumn(),
    operationId: requiredBigIntColumn('operation_id')
      .unique()
      .references(() => financialOperations.id, {
        onDelete: 'restrict',
      }),
    reference: text('reference').notNull().unique(),
    purpose: text('purpose').notNull(),
    status: text('status').notNull().default('DRAFT'),
    reversalOf: bigint('reversal_of', {
      mode: 'bigint',
    }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({
      name: 'position_journals_reversal_fk',
      columns: [table.reversalOf],
      foreignColumns: [table.id],
    }).onDelete('restrict'),
    unique('position_journals_reversal_key').on(table.reversalOf),
    check('position_journals_status_check', sql`${table.status} IN ('DRAFT','POSTED')`),
    check(
      'position_journals_purpose_check',
      sql`${table.purpose} IN ('POST','TRANSFER','CONSUMPTION','REVERSAL','RECOGNITION','SETTLEMENT')`,
    ),
  ],
)

// Immutable IN/OUT movements. The composite foreign key prevents mixing an account with another token.
export const positionJournalEntries = pgTable(
  'position_journal_entries',
  {
    id: identityColumn(),
    journalId: requiredBigIntColumn('journal_id').references(() => positionJournals.id, {
      onDelete: 'restrict',
    }),
    accountId: requiredBigIntColumn('account_id'),
    tokenId: requiredBigIntColumn('token_id'),
    side: text('side').notNull(),
    quantity: requiredBigIntColumn('quantity'),
  },
  (table) => [
    foreignKey({
      name: 'position_entries_account_token_fk',
      columns: [table.accountId, table.tokenId],
      foreignColumns: [positionAccounts.id, positionAccounts.tokenId],
    }).onDelete('restrict'),
    check(
      'position_entries_quantity_check',
      sql`${table.quantity}>0 AND ${table.quantity}%1000000=0`,
    ),
    check('position_entries_side_check', sql`${table.side} IN ('IN','OUT')`),
    index('idx_position_entries_account').on(table.accountId, table.id),
    index('idx_position_entries_journal').on(table.journalId),
  ],
)

// Read-optimized share totals. Available shares are posted minus reserved.
export const positionBalanceProjections = pgTable(
  'position_balance_projections',
  {
    accountId: bigint('account_id', {
      mode: 'bigint',
    })
      .primaryKey()
      .references(() => positionAccounts.id, {
        onDelete: 'restrict',
      }),
    posted: requiredBigIntColumn('posted').default(sql`0`),
    reserved: requiredBigIntColumn('reserved').default(sql`0`),
  },
  (table) => [
    check(
      'position_projection_units_check',
      sql`${table.posted}%1000000=0 AND ${table.reserved}>=0 AND ${table.reserved}%1000000=0`,
    ),
  ],
)

// A share hold prevents overselling. Quantities use six-decimal units and currently require whole shares.
export const positionReservations = pgTable(
  'position_reservations',
  {
    id: identityColumn(),
    accountId: requiredBigIntColumn('account_id').references(() => positionAccounts.id, {
      onDelete: 'restrict',
    }),
    operationId: requiredBigIntColumn('operation_id')
      .unique()
      .references(() => financialOperations.id, {
        onDelete: 'restrict',
      }),
    reference: text('reference').notNull(),
    quantity: requiredBigIntColumn('quantity'),
    consumed: requiredBigIntColumn('consumed').default(sql`0`),
    released: requiredBigIntColumn('released').default(sql`0`),
    status: text('status').notNull().default('OPEN'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('position_reservations_reference_key').on(table.accountId, table.reference),
    check(
      'position_reservations_units_check',
      sql`${table.quantity}>0 AND ${table.consumed}>=0 AND ${table.released}>=0 AND ${table.quantity}%1000000=0 AND ${table.consumed}%1000000=0 AND ${table.released}%1000000=0 AND ${table.consumed}::numeric+${table.released}<=${table.quantity}`,
    ),
    check(
      'position_reservations_status_check',
      sql`(${table.status}='OPEN' AND ${table.consumed}::numeric+${table.released}<${table.quantity}) OR (${table.status} IN ('CLOSED','CANCELLED') AND ${table.consumed}::numeric+${table.released}=${table.quantity})`,
    ),
    index('idx_position_reservations_account').on(table.accountId),
  ],
)

// Append-only reservation history. A consumption event must reference its position journal.
export const positionReservationEvents = pgTable(
  'position_reservation_events',
  {
    id: identityColumn(),
    reservationId: requiredBigIntColumn('reservation_id').references(
      () => positionReservations.id,
      {
        onDelete: 'restrict',
      },
    ),
    operationId: requiredBigIntColumn('operation_id')
      .unique()
      .references(() => financialOperations.id, {
        onDelete: 'restrict',
      }),
    kind: text('kind').notNull(),
    quantity: requiredBigIntColumn('quantity'),
    journalId: bigint('journal_id', {
      mode: 'bigint',
    })
      .unique()
      .references(() => positionJournals.id, {
        onDelete: 'restrict',
      }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    check(
      'position_reservation_events_kind_check',
      sql`${table.kind} IN ('RESERVE','CONSUME','RELEASE','CANCEL')`,
    ),
    check(
      'position_reservation_events_quantity_check',
      sql`${table.quantity}>0 AND ${table.quantity}%1000000=0`,
    ),
    check(
      'position_reservation_events_journal_check',
      sql`(${table.kind}='CONSUME')=(${table.journalId} IS NOT NULL)`,
    ),
    index('idx_position_reservation_events_reservation').on(table.reservationId, table.id),
  ],
)

// Links both reservations and both journals for one atomic cash-for-shares settlement. This is not on-chain confirmation.
export const cashPositionSettlements = pgTable(
  'cash_position_settlements',
  {
    id: identityColumn(),
    operationId: requiredBigIntColumn('operation_id')
      .unique()
      .references(() => financialOperations.id, {
        onDelete: 'restrict',
      }),
    matchReference: text('match_reference').notNull().unique(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, {
        onDelete: 'restrict',
      }),
    tokenId: requiredBigIntColumn('token_id').references(() => ctfPositionTokens.id, {
      onDelete: 'restrict',
    }),
    buyerCashAccountId: requiredBigIntColumn('buyer_cash_account_id').references(
      () => financialAccounts.id,
      {
        onDelete: 'restrict',
      },
    ),
    sellerCashAccountId: requiredBigIntColumn('seller_cash_account_id').references(
      () => financialAccounts.id,
      {
        onDelete: 'restrict',
      },
    ),
    buyerPositionAccountId: requiredBigIntColumn('buyer_position_account_id'),
    sellerPositionAccountId: requiredBigIntColumn('seller_position_account_id'),
    cashReservationId: requiredBigIntColumn('cash_reservation_id').references(
      () => cashReservations.id,
      {
        onDelete: 'restrict',
      },
    ),
    positionReservationId: requiredBigIntColumn('position_reservation_id').references(
      () => positionReservations.id,
      {
        onDelete: 'restrict',
      },
    ),
    cashJournalId: requiredBigIntColumn('cash_journal_id')
      .unique()
      .references(() => financialJournals.id, {
        onDelete: 'restrict',
      }),
    positionJournalId: requiredBigIntColumn('position_journal_id')
      .unique()
      .references(() => positionJournals.id, {
        onDelete: 'restrict',
      }),
    quantity: requiredBigIntColumn('quantity'),
    priceCents: requiredBigIntColumn('price_cents'),
    considerationCents: requiredBigIntColumn('consideration_cents'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({
      name: 'settlement_buyer_position_token_fk',
      columns: [table.buyerPositionAccountId, table.tokenId],
      foreignColumns: [positionAccounts.id, positionAccounts.tokenId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'settlement_seller_position_token_fk',
      columns: [table.sellerPositionAccountId, table.tokenId],
      foreignColumns: [positionAccounts.id, positionAccounts.tokenId],
    }).onDelete('restrict'),
    check(
      'settlement_consideration_check',
      sql`${table.quantity}>0 AND ${table.quantity}%1000000=0 AND ${table.priceCents}>0 AND ${table.considerationCents}>0 AND ${table.considerationCents}::numeric=(${table.quantity}::numeric/1000000)*${table.priceCents}`,
    ),
    index('idx_cash_position_settlements_market').on(table.marketId, table.id),
  ],
)
