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

// store verified sign-in factors for each user
export const userFactors = pgTable(
  'user_factors',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    userId: bigint('user_id', { mode: 'bigint' }).notNull(),
    factorType: varchar('factor_type', { length: 30 }).notNull(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [

    // remove factors when the user is removed
    foreignKey({
      name: 'user_factors_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    check(
      'user_factors_factor_type_check',
      sql`${table.factorType} IN ('telegram', 'sms')`,
    ),
    
    // prevent duplicate factors for one user
    unique('user_factors_user_id_factor_type_identifier_key').on(
      table.userId,
      table.factorType,
      table.identifier,
    ),
  ],
)
