import { sql } from 'drizzle-orm'
import {
  bigint,
  foreignKey,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

import { users } from './users.js'

// store authentication security events
export const authAuditLogs = pgTable(
  'auth_audit_logs',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    userId: bigint('user_id', { mode: 'bigint' }),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    details: jsonb('details').default(sql`'{}'::jsonb`).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // keep logs after a user is removed
    foreignKey({
      name: 'auth_audit_logs_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('set null'),
    // speed up recent event lookup
    index('idx_auth_audit_user_created').on(
      table.userId,
      table.createdAt.desc().nullsFirst(),
    ),
    index('idx_auth_audit_event_created').on(
      table.eventType,
      table.createdAt.desc().nullsFirst(),
    ),
  ],
)
