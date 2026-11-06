import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  pgTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core'

import { users } from './users.js'

// keep the current khr wallet for each user
export const wallets = pgTable(
  'wallets',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    userId: bigint('user_id', { mode: 'bigint' }).notNull(),
    balanceMinor: bigint('balance_minor', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    usdBalanceMinor: bigint('usd_balance_minor', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    currency: varchar('currency', { length: 3 })
      .default('KHR')
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [

    // allow one wallet for each user
    unique('wallets_user_id_key').on(table.userId),
    foreignKey({
      name: 'wallets_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),

    // reject invalid wallet values
    check(
      'wallets_balance_minor_check',
      sql`${table.balanceMinor} >= 0`,
    ),
    check(
      'wallets_usd_balance_minor_nonnegative',
      sql`${table.usdBalanceMinor} >= 0`,
    ),
    check(
      'wallets_currency_check',
      sql`${table.currency} = 'KHR'`,
    ),
  ],
)
