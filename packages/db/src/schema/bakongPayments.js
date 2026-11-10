import { sql } from 'drizzle-orm'
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

import { users } from './users.js'

// store bakong khqr payment attempts and verification results
export const bakongPayments = pgTable(
  'bakong_payments',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedByDefaultAsIdentity()
      .primaryKey(),
    userId: bigint('user_id', { mode: 'bigint' }),
    tranId: varchar('tran_id', { length: 25 }).notNull(),
    md5: char('md5', { length: 32 }).notNull(),
    qrString: text('qr_string').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 100 }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 })
      .default('USD')
      .notNull(),
    status: varchar('status', { length: 20 })
      .default('PENDING')
      .notNull(),
    statusAccessTokenHash: char('status_access_token_hash', { length: 64 }),
    idempotencyKey: varchar('idempotency_key', { length: 64 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    walletCreditedAt: timestamp('wallet_credited_at', { withTimezone: true }),
    providerEvidence: jsonb('provider_evidence'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'bakong_payments_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('set null'),
    unique('bakong_payments_tran_id_key').on(table.tranId),
    unique('bakong_payments_md5_key').on(table.md5),
    check('bakong_payments_amount_check', sql`${table.amount} > 0`),
    check(
      'bakong_payments_amount_minor_positive',
      sql`${table.amountMinor} > 0`,
    ),
    check(
      'bakong_payments_currency_check',
      sql`${table.currency} IN ('USD', 'KHR')`,
    ),
    check(
      'bakong_payments_status_check',
      sql`${table.status} IN ('PENDING', 'PAID', 'EXPIRED', 'FAILED')`,
    ),
    check(
      'bakong_payments_status_access_token_hash_check',
      sql`${table.statusAccessTokenHash} IS NULL
        OR ${table.statusAccessTokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
    index('idx_bakong_payments_status_expires').on(
      table.status,
      table.expiresAt,
    ),
    uniqueIndex('idx_bakong_payments_user_idempotency')
      .on(table.userId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    index('idx_bakong_payments_user_status').on(
      table.userId,
      table.status,
    ),
  ],
)
