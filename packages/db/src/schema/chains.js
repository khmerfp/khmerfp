import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  numeric,
  pgTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core'

// register supported evm networks
export const chains = pgTable(
  'chains',
  {
    // primary key
    id: bigint('id', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),

    // chain id of the network
    chainId: numeric('chain_id', { precision: 78, scale: 0 }).notNull(),

    // name of the network
    name: varchar('name', { length: 100 }).notNull(),

    // environment of the network (testnet or mainnet)
    environment: varchar('environment', { length: 20 }).notNull(),

    // native symbol of the network (e.g. ETH, MATIC, etc.)
    nativeSymbol: varchar('native_symbol', { length: 20 }).notNull(),

    // reference to the rpc config for the network
    rpcConfigReference: varchar('rpc_config_reference', { length: 255 }),
    enabled: boolean('enabled').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('chains_chain_id_key').on(table.chainId),
    unique('chains_name_environment_key').on(
      table.name,
      table.environment,
    ),
    check('chains_chain_id_positive', sql`${table.chainId} > 0`),
    check(
      'chains_environment_check',
      sql`${table.environment} IN ('testnet', 'mainnet')`,
    ),
    check(
      'chains_native_symbol_check',
      sql`${table.nativeSymbol} ~ '^[A-Z][A-Z0-9_]{0,19}$'`,
    ),
    check(
      'chains_rpc_config_reference_check',
      sql`${table.rpcConfigReference} IS NULL
        OR ${table.rpcConfigReference} ~ '^[A-Z][A-Z0-9_]{0,254}$'`,
    ),
  ],
)
