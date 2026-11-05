import { sql } from 'drizzle-orm'
import {
  bigint,
  char,
  check,
  index,
  inet,
  integer,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

// store short-lived phone verification codes
export const phoneOtps = pgTable(
  'phone_otps',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    phoneNumber: varchar('phone_number', { length: 32 }).notNull(),
    codeHash: char('code_hash', { length: 64 }).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: inet('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // accept only sha-256 code hashes
    check(
      'phone_otps_code_hash_check',
      sql`${table.codeHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'phone_otps_attempts_check',
      sql`${table.attempts} >= 0`,
    ),
    // find the newest code for a phone number
    index('idx_phone_otps_lookup').on(
      table.phoneNumber,
      table.createdAt.desc().nullsFirst(),
    ),
  ],
)
