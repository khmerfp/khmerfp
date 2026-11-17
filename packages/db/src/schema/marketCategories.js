import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core'

// organize markets without coupling categories to trading logic
export const marketCategories = pgTable(
  'market_categories',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    parentId: bigint('parent_id', { mode: 'bigint' }),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'market_categories_parent_id_fkey',
      columns: [table.parentId],
      foreignColumns: [table.id],
    }).onDelete('restrict'),
    unique('market_categories_slug_key').on(table.slug),
    check(
      'market_categories_name_check',
      sql`length(btrim(${table.name})) > 0`,
    ),
    check(
      'market_categories_slug_check',
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check(
      'market_categories_parent_check',
      sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`,
    ),
    index('idx_market_categories_parent_active').on(
      table.parentId,
      table.active,
    ),
  ],
)
