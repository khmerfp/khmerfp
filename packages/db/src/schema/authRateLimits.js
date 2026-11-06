import { sql } from 'drizzle-orm'
import {
  check,
  integer,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

// track blocked authentication requests
export const authRateLimits = pgTable(
  'auth_rate_limits',
  {
    rateLimitKey: varchar('rate_limit_key', { length: 255 }).primaryKey(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    requestCount: integer('request_count').default(0).notNull(),
    blockedUntil: timestamp('blocked_until', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // reject negative request counts
    check(
      'auth_rate_limits_request_count_check',
      sql`${table.requestCount} >= 0`,
    ),
  ],
)
