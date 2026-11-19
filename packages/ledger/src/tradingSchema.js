import { sql } from 'drizzle-orm'
import { pgTable, bigint, uuid, text, jsonb, timestamp, smallint, check, unique, index, foreignKey } from 'drizzle-orm/pg-core'
import { users } from '../../db/src/schema/users.js'
import { markets } from '../../db/src/schema/markets.js'
import { ctfPositionTokens } from '../../db/src/schema/ctfPositionTokens.js'
import { financialAccounts, cashReservations } from './schema.js'
import { positionAccounts, positionReservations, cashPositionSettlements } from './positionSchema.js'
const id = () => bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey()
const amount = name => bigint(name, { mode: 'bigint' }).notNull()
const time = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
const ref = (name, target) => amount(name).references(target, { onDelete: 'restrict' })
const uref = (name, target) => uuid(name).notNull().references(target, { onDelete: 'restrict' })

// Canonical books share token identity across display aliases, never across complementary tokens.
export const tradingBooks = pgTable('trading_books', {
    id: id(), tokenId: ref('token_id', () => ctfPositionTokens.id).unique(), marketId: uref('market_id', () => markets.id),
    commandSequence: amount('command_sequence').default(sql`0`), createdAt: time(),
}, t => [check('trading_books_sequence_check', sql`${t.commandSequence}>=0`)])
export const tradingCommands = pgTable('trading_commands', {
    id: uuid('id').defaultRandom().primaryKey(), bookId: ref('book_id', () => tradingBooks.id), sequence: amount('sequence'),
    operationKey: text('operation_key').notNull().unique(), actor: text('actor').notNull(), action: text('action').notNull(),
    terms: jsonb('terms').notNull(), state: text('state').notNull().default('PENDING'), result: jsonb('result'), createdAt: time(),
}, t => [unique('trading_commands_book_sequence_key').on(t.bookId, t.sequence),
check('trading_commands_state_check', sql`${t.state} IN ('PENDING','APPLIED')`),
check('trading_commands_action_check', sql`${t.action} IN ('PLACE','CANCEL','EXPIRE','FILL')`)])
export const tradingOrders = pgTable('trading_orders', {
    id: id(), bookId: ref('book_id', () => tradingBooks.id), commandId: uref('command_id', () => tradingCommands.id).unique(),
    userId: ref('user_id', () => users.id), side: text('side').notNull(), limitPriceCents: amount('limit_price_cents'),
    originalQuantity: amount('original_quantity'), filledQuantity: amount('filled_quantity').default(sql`0`), cancelledQuantity: amount('cancelled_quantity').default(sql`0`),
    remainingQuantity: bigint('remaining_quantity', { mode: 'bigint' }).generatedAlwaysAs(sql`original_quantity - filled_quantity - cancelled_quantity`),
    prioritySequence: amount('priority_sequence'), status: text('status').notNull().default('PENDING'),
    cashAccountId: ref('cash_account_id', () => financialAccounts.id), positionAccountId: ref('position_account_id', () => positionAccounts.id),
    cashReservationId: bigint('cash_reservation_id', { mode: 'bigint' }).unique().references(() => cashReservations.id, { onDelete: 'restrict' }),
    positionReservationId: bigint('position_reservation_id', { mode: 'bigint' }).unique(), createdAt: time(),
}, t => [foreignKey({name:'trading_orders_position_reservation_fk',columns:[t.positionReservationId],foreignColumns:[positionReservations.id]}).onDelete('restrict'),
 check('trading_orders_terms_check', sql`${t.side} IN ('BUY','SELL') AND ${t.limitPriceCents} BETWEEN 1 AND 99 AND ${t.originalQuantity}>0 AND ${t.originalQuantity}%1000000=0 AND ${t.filledQuantity}>=0 AND ${t.filledQuantity}%1000000=0 AND ${t.cancelledQuantity}>=0 AND ${t.cancelledQuantity}%1000000=0 AND ${t.filledQuantity}::numeric+${t.cancelledQuantity}<=${t.originalQuantity}`),
check('trading_orders_status_check', sql`${t.status} IN ('PENDING','OPEN','PARTIAL','FILLED','CANCELLED','EXPIRED','REJECTED')`),
index('trading_orders_book_priority_idx').on(t.bookId, t.side, t.limitPriceCents, t.prioritySequence)])
export const tradingFills = pgTable('trading_fills', {
    id: id(), commandId: uref('command_id', () => tradingCommands.id).unique(), bookId: ref('book_id', () => tradingBooks.id),
    buyerOrderId: ref('buyer_order_id', () => tradingOrders.id), sellerOrderId: ref('seller_order_id', () => tradingOrders.id),
    settlementId: ref('settlement_id', () => cashPositionSettlements.id).unique(), quantity: amount('quantity'), priceCents: amount('price_cents'), createdAt: time(),
}, t => [check('trading_fills_units_check', sql`${t.quantity}>0 AND ${t.quantity}%1000000=0 AND ${t.priceCents} BETWEEN 1 AND 99 AND ${t.buyerOrderId}<>${t.sellerOrderId}`),
index('trading_fills_buyer_idx').on(t.buyerOrderId), index('trading_fills_seller_idx').on(t.sellerOrderId)])
export const tradingOrderEvents = pgTable('trading_order_events', {
    id: uuid('id').defaultRandom().primaryKey(), commandId: uref('command_id', () => tradingCommands.id), orderId: ref('order_id', () => tradingOrders.id),
    ordinal: smallint('ordinal').notNull(), kind: text('kind').notNull(), payload: jsonb('payload').notNull(), createdAt: time(),
}, t => [unique('trading_events_command_order_key').on(t.commandId, t.orderId), unique('trading_events_command_ordinal_key').on(t.commandId, t.ordinal)])
// A committed event has one durable replay identity. Transport remains disabled.
export const tradingOutbox = pgTable('trading_outbox', {
    id: uuid('id').defaultRandom().primaryKey(), eventId: uref('event_id', () => tradingOrderEvents.id).unique(), createdAt: time(),
})
