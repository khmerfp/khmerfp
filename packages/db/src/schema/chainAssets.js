import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  smallint,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core'

import { chains } from './chains.js'

// identify contract assets without relying on symbols
export const chainAssets = pgTable(
  'chain_assets',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    chainId: numeric('chain_id', { precision: 78, scale: 0 }).notNull(),
    contractAddress: char('contract_address', { length: 42 }).notNull(),
    symbol: varchar('symbol', { length: 32 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    decimals: smallint('decimals').notNull(),
    assetType: varchar('asset_type', { length: 20 }).notNull(),
    enabled: boolean('enabled').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'chain_assets_chain_id_fkey',
      columns: [table.chainId],
      foreignColumns: [chains.chainId],
    }).onDelete('restrict'),
    unique('chain_assets_chain_address_key').on(
      table.chainId,
      table.contractAddress,
    ),
    check(
      'chain_assets_contract_address_check',
      sql`${table.contractAddress} ~ '^0x[0-9a-f]{40}$'`,
    ),
    check(
      'chain_assets_symbol_check',
      sql`${table.symbol} ~ '^[A-Z][A-Z0-9_]{0,31}$'`,
    ),
    check(
      'chain_assets_decimals_check',
      sql`${table.decimals} BETWEEN 0 AND 255`,
    ),
    check(
      'chain_assets_asset_type_check',
      sql`${table.assetType} IN ('ERC20', 'ERC1155')`,
    ),
    index('idx_chain_assets_chain_enabled').on(
      table.chainId,
      table.enabled,
    ),
  ],
)
