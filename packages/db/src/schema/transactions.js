import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core'

// store aba payment transactions
export const transactions = pgTable(
  'transactions',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedByDefaultAsIdentity()
      .primaryKey(),
    tranId: varchar('tran_id', { length: 100 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    accountNumber: varchar('account_number', { length: 64 }).notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 })
      .default('KHR')
      .notNull(),
    status: varchar('status', { length: 20 })
      .default('PENDING')
      .notNull(),
    paywayResponseCode: text('payway_response_code'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    verificationEvidence: jsonb('verification_evidence'),
    statusAccessTokenHash: varchar('status_access_token_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    // keep each provider transaction id unique
    unique('transactions_tran_id_key').on(table.tranId),
    check('transactions_amount_check', sql`${table.amount} > 0`),
    check(
      'transactions_currency_check',
      sql`${table.currency} = 'KHR'`,
    ),
    check(
      'transactions_status_check',
      sql`${table.status} IN ('PENDING', 'PAID', 'FAILED', 'CANCELLED')`,
    ),
    // accept only sha-256 status token hashes
    check(
      'transactions_status_access_token_hash_check',
      sql`${table.statusAccessTokenHash} IS NULL
        OR ${table.statusAccessTokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
)
