import { sql } from 'drizzle-orm'
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { marketCategories } from './marketCategories.js'
import { users } from './users.js'

// keep market administration separate from trading and resolution state
export const markets = pgTable(
  'markets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    categoryId: bigint('category_id', { mode: 'bigint' }).notNull(),
    createdByUserId: bigint('created_by_user_id', { mode: 'bigint' }),
    slug: varchar('slug', { length: 160 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull(),
    lifecycleStatus: varchar('lifecycle_status', { length: 20 })
      .default('DRAFT')
      .notNull(),
    tradingStatus: varchar('trading_status', { length: 20 })
      .default('NOT_STARTED')
      .notNull(),
    resolutionStatus: varchar('resolution_status', { length: 20 })
      .default('UNRESOLVED')
      .notNull(),
    tradingStartsAt: timestamp('trading_starts_at', { withTimezone: true })
      .notNull(),
    tradingEndsAt: timestamp('trading_ends_at', { withTimezone: true })
      .notNull(),
    resolutionDeadline: timestamp('resolution_deadline', {
      withTimezone: true,
    }).notNull(),
    termsHash: char('terms_hash', { length: 66 }),
    termsFrozenAt: timestamp('terms_frozen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'markets_category_id_fkey',
      columns: [table.categoryId],
      foreignColumns: [marketCategories.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'markets_created_by_user_id_fkey',
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
    }).onDelete('set null'),
    unique('markets_slug_key').on(table.slug),
    check('markets_title_check', sql`length(btrim(${table.title})) > 0`),
    check(
      'markets_description_check',
      sql`length(btrim(${table.description})) > 0`,
    ),
    check(
      'markets_slug_check',
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check(
      'markets_lifecycle_status_check',
      sql`${table.lifecycleStatus} IN (
        'DRAFT', 'REVIEW', 'SCHEDULED', 'ACTIVE', 'CANCELLED', 'ARCHIVED'
      )`,
    ),
    check(
      'markets_trading_status_check',
      sql`${table.tradingStatus} IN ('NOT_STARTED', 'OPEN', 'PAUSED', 'CLOSED')`,
    ),
    check(
      'markets_resolution_status_check',
      sql`${table.resolutionStatus} IN (
        'UNRESOLVED', 'PENDING', 'RESOLVED', 'INVALID'
      )`,
    ),
    check(
      'markets_trading_window_check',
      sql`${table.tradingEndsAt} > ${table.tradingStartsAt}`,
    ),
    check(
      'markets_resolution_deadline_check',
      sql`${table.resolutionDeadline} >= ${table.tradingEndsAt}`,
    ),
    check(
      'markets_terms_hash_check',
      sql`${table.termsHash} IS NULL OR ${table.termsHash} ~ '^0x[0-9a-f]{64}$'`,
    ),
    check(
      'markets_terms_freeze_pair_check',
      sql`(${table.termsHash} IS NULL) = (${table.termsFrozenAt} IS NULL)`,
    ),
    check(
      'markets_frozen_before_trading_check',
      sql`${table.tradingStatus} = 'NOT_STARTED'
        OR (${table.termsHash} IS NOT NULL AND ${table.termsFrozenAt} IS NOT NULL)`,
    ),
    check(
      'markets_frozen_lifecycle_check',
      sql`${table.lifecycleStatus} IN ('DRAFT', 'REVIEW', 'CANCELLED')
        OR (${table.termsHash} IS NOT NULL AND ${table.termsFrozenAt} IS NOT NULL)`,
    ),
    check(
      'markets_open_lifecycle_check',
      sql`${table.tradingStatus} <> 'OPEN' OR ${table.lifecycleStatus} = 'ACTIVE'`,
    ),
    check(
      'markets_resolution_requires_closed_check',
      sql`${table.resolutionStatus} = 'UNRESOLVED'
        OR ${table.tradingStatus} = 'CLOSED'`,
    ),
    index('idx_markets_category_lifecycle').on(
      table.categoryId,
      table.lifecycleStatus,
    ),
    index('idx_markets_trading_end').on(
      table.tradingStatus,
      table.tradingEndsAt,
    ),
    index('idx_markets_resolution_deadline').on(
      table.resolutionStatus,
      table.resolutionDeadline,
    ),
  ],
)
