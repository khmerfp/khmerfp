import { sql } from 'drizzle-orm';
import { pgTable, bigint, text, timestamp, uuid, check, unique, uniqueIndex, foreignKey, index } from 'drizzle-orm/pg-core';
import { users } from '../../db/src/schema/users.js';
import { markets } from '../../db/src/schema/markets.js';
import { ctfPositionTokens } from '../../db/src/schema/ctfPositionTokens.js';
import { financialAccounts, financialOperations, financialJournals, cashReservations } from './schema.js';
const id = () => bigint('id', {
  mode: 'bigint'
}).generatedAlwaysAsIdentity().primaryKey();
const qty = name => bigint(name, {
  mode: 'bigint'
}).notNull();
const time = () => timestamp('created_at', {
  withTimezone: true
}).defaultNow().notNull();
export const positionAccounts = pgTable('position_accounts', {
  id: id(),
  tokenId: qty('token_id').references(() => ctfPositionTokens.id, {
    onDelete: 'restrict'
  }),
  ownerUserId: bigint('owner_user_id', {
    mode: 'bigint'
  }).references(() => users.id, {
    onDelete: 'restrict'
  }),
  accountKey: text('account_key').notNull().unique(),
  kind: text('kind').notNull(),
  createdAt: time()
}, t => [unique('position_accounts_id_token_key').on(t.id, t.tokenId), unique('position_accounts_owner_token_key').on(t.ownerUserId, t.tokenId), uniqueIndex('position_accounts_system_token_key').on(t.tokenId, t.kind).where(sql`${t.ownerUserId} IS NULL`), check('position_accounts_kind_check', sql`(${t.kind}='CUSTOMER' AND ${t.ownerUserId} IS NOT NULL) OR (${t.kind} IN ('UNALLOCATED','EXTERNAL_CONTROL') AND ${t.ownerUserId} IS NULL)`)]);
export const positionJournals = pgTable('position_journals', {
  id: id(),
  operationId: qty('operation_id').unique().references(() => financialOperations.id, {
    onDelete: 'restrict'
  }),
  reference: text('reference').notNull().unique(),
  purpose: text('purpose').notNull(),
  status: text('status').notNull().default('DRAFT'),
  reversalOf: bigint('reversal_of', {
    mode: 'bigint'
  }),
  createdAt: time()
}, t => [foreignKey({
  name: 'position_journals_reversal_fk',
  columns: [t.reversalOf],
  foreignColumns: [t.id]
}).onDelete('restrict'), unique('position_journals_reversal_key').on(t.reversalOf), check('position_journals_status_check', sql`${t.status} IN ('DRAFT','POSTED')`), check('position_journals_purpose_check', sql`${t.purpose} IN ('POST','TRANSFER','CONSUMPTION','REVERSAL','RECOGNITION','SETTLEMENT')`)]);
export const positionJournalEntries = pgTable('position_journal_entries', {
  id: id(),
  journalId: qty('journal_id').references(() => positionJournals.id, {
    onDelete: 'restrict'
  }),
  accountId: qty('account_id'),
  tokenId: qty('token_id'),
  side: text('side').notNull(),
  quantity: qty('quantity')
}, t => [foreignKey({
  name: 'position_entries_account_token_fk',
  columns: [t.accountId, t.tokenId],
  foreignColumns: [positionAccounts.id, positionAccounts.tokenId]
}).onDelete('restrict'), check('position_entries_quantity_check', sql`${t.quantity}>0 AND ${t.quantity}%1000000=0`), check('position_entries_side_check', sql`${t.side} IN ('IN','OUT')`), index('idx_position_entries_account').on(t.accountId, t.id), index('idx_position_entries_journal').on(t.journalId)]);
export const positionBalanceProjections = pgTable('position_balance_projections', {
  accountId: bigint('account_id', {
    mode: 'bigint'
  }).primaryKey().references(() => positionAccounts.id, {
    onDelete: 'restrict'
  }),
  posted: qty('posted').default(sql`0`),
  reserved: qty('reserved').default(sql`0`)
}, t => [check('position_projection_units_check', sql`${t.posted}%1000000=0 AND ${t.reserved}>=0 AND ${t.reserved}%1000000=0`)]);
export const positionReservations = pgTable('position_reservations', {
  id: id(),
  accountId: qty('account_id').references(() => positionAccounts.id, {
    onDelete: 'restrict'
  }),
  operationId: qty('operation_id').unique().references(() => financialOperations.id, {
    onDelete: 'restrict'
  }),
  reference: text('reference').notNull(),
  quantity: qty('quantity'),
  consumed: qty('consumed').default(sql`0`),
  released: qty('released').default(sql`0`),
  status: text('status').notNull().default('OPEN'),
  createdAt: time()
}, t => [unique('position_reservations_reference_key').on(t.accountId, t.reference), check('position_reservations_units_check', sql`${t.quantity}>0 AND ${t.consumed}>=0 AND ${t.released}>=0 AND ${t.quantity}%1000000=0 AND ${t.consumed}%1000000=0 AND ${t.released}%1000000=0 AND ${t.consumed}::numeric+${t.released}<=${t.quantity}`), check('position_reservations_status_check', sql`(${t.status}='OPEN' AND ${t.consumed}::numeric+${t.released}<${t.quantity}) OR (${t.status} IN ('CLOSED','CANCELLED') AND ${t.consumed}::numeric+${t.released}=${t.quantity})`), index('idx_position_reservations_account').on(t.accountId)]);
export const positionReservationEvents = pgTable('position_reservation_events', {
  id: id(),
  reservationId: qty('reservation_id').references(() => positionReservations.id, {
    onDelete: 'restrict'
  }),
  operationId: qty('operation_id').unique().references(() => financialOperations.id, {
    onDelete: 'restrict'
  }),
  kind: text('kind').notNull(),
  quantity: qty('quantity'),
  journalId: bigint('journal_id', {
    mode: 'bigint'
  }).unique().references(() => positionJournals.id, {
    onDelete: 'restrict'
  }),
  createdAt: time()
}, t => [check('position_reservation_events_kind_check', sql`${t.kind} IN ('RESERVE','CONSUME','RELEASE','CANCEL')`), check('position_reservation_events_quantity_check', sql`${t.quantity}>0 AND ${t.quantity}%1000000=0`), check('position_reservation_events_journal_check', sql`(${t.kind}='CONSUME')=(${t.journalId} IS NOT NULL)`), index('idx_position_reservation_events_reservation').on(t.reservationId, t.id)]);
export const cashPositionSettlements = pgTable('cash_position_settlements', {
  id: id(),
  operationId: qty('operation_id').unique().references(() => financialOperations.id, {
    onDelete: 'restrict'
  }),
  matchReference: text('match_reference').notNull().unique(),
  marketId: uuid('market_id').notNull().references(() => markets.id, {
    onDelete: 'restrict'
  }),
  tokenId: qty('token_id').references(() => ctfPositionTokens.id, {
    onDelete: 'restrict'
  }),
  buyerCashAccountId: qty('buyer_cash_account_id').references(() => financialAccounts.id, {
    onDelete: 'restrict'
  }),
  sellerCashAccountId: qty('seller_cash_account_id').references(() => financialAccounts.id, {
    onDelete: 'restrict'
  }),
  buyerPositionAccountId: qty('buyer_position_account_id'),
  sellerPositionAccountId: qty('seller_position_account_id'),
  cashReservationId: qty('cash_reservation_id').references(() => cashReservations.id, {
    onDelete: 'restrict'
  }),
  positionReservationId: qty('position_reservation_id').references(() => positionReservations.id, {
    onDelete: 'restrict'
  }),
  cashJournalId: qty('cash_journal_id').unique().references(() => financialJournals.id, {
    onDelete: 'restrict'
  }),
  positionJournalId: qty('position_journal_id').unique().references(() => positionJournals.id, {
    onDelete: 'restrict'
  }),
  quantity: qty('quantity'),
  priceCents: qty('price_cents'),
  considerationCents: qty('consideration_cents'),
  createdAt: time()
}, t => [foreignKey({
  name: 'settlement_buyer_position_token_fk',
  columns: [t.buyerPositionAccountId, t.tokenId],
  foreignColumns: [positionAccounts.id, positionAccounts.tokenId]
}).onDelete('restrict'), foreignKey({
  name: 'settlement_seller_position_token_fk',
  columns: [t.sellerPositionAccountId, t.tokenId],
  foreignColumns: [positionAccounts.id, positionAccounts.tokenId]
}).onDelete('restrict'), check('settlement_consideration_check', sql`${t.quantity}>0 AND ${t.quantity}%1000000=0 AND ${t.priceCents}>0 AND ${t.considerationCents}>0 AND ${t.considerationCents}::numeric=(${t.quantity}::numeric/1000000)*${t.priceCents}`), index('idx_cash_position_settlements_market').on(t.marketId, t.id)]);
