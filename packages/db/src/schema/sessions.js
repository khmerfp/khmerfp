import { sql } from 'drizzle-orm'
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  inet,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

import { users } from './users.js'

// store active and revoked user sessions
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: char('token_hash', { length: 64 }).primaryKey(),
    userId: bigint('user_id', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true })
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    stepUpAt: timestamp('step_up_at', { withTimezone: true }),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
  },
  (table) => [
    // remove sessions when the user is removed
    foreignKey({
      name: 'sessions_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    // accept only sha-256 token hashes
    check(
      'sessions_token_hash_check',
      sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'sessions_check',
      sql`${table.idleExpiresAt} <= ${table.expiresAt}`,
    ),
    // speed up active session lookup
    index('idx_sessions_user_active')
      .on(table.userId, table.expiresAt)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
)
