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
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

import { chains } from './chains.js'
import { users } from './users.js'

// link users to chain wallets without storing signing secrets
export const userWallets = pgTable(
  'user_wallets',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    userId: bigint('user_id', { mode: 'bigint' }).notNull(),
    chainId: numeric('chain_id', { precision: 78, scale: 0 }).notNull(),
    walletAddress: char('wallet_address', { length: 42 }).notNull(),
    walletType: varchar('wallet_type', { length: 20 }).notNull(),
    custodyModel: varchar('custody_model', { length: 30 })
      .default('USER_CONTROLLED')
      .notNull(),
    walletProvider: varchar('wallet_provider', { length: 50 }),
    providerExternalReference: varchar('provider_external_reference', {
      length: 255,
    }),
    ownershipVerificationStatus: varchar(
      'ownership_verification_status',
      { length: 20 },
    ).default('UNVERIFIED').notNull(),
    ownershipVerifiedAt: timestamp('ownership_verified_at', {
      withTimezone: true,
    }),
    isPrimary: boolean('is_primary').default(false).notNull(),
    walletStatus: varchar('wallet_status', { length: 20 })
      .default('PENDING')
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'user_wallets_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'user_wallets_chain_id_fkey',
      columns: [table.chainId],
      foreignColumns: [chains.chainId],
    }).onDelete('restrict'),
    unique('user_wallets_chain_address_key').on(
      table.chainId,
      table.walletAddress,
    ),
    check(
      'user_wallets_address_check',
      sql`${table.walletAddress} ~ '^0x[0-9a-f]{40}$'
        AND ${table.walletAddress} = lower(${table.walletAddress})`,
    ),
    check(
      'user_wallets_wallet_type_check',
      sql`${table.walletType} IN ('EOA', 'SMART_ACCOUNT')`,
    ),
    check(
      'user_wallets_custody_model_check',
      sql`${table.custodyModel} IN ('USER_CONTROLLED', 'HYBRID_RESTRICTED')`,
    ),
    check(
      'user_wallets_provider_pair_check',
      sql`(${table.walletProvider} IS NULL) =
        (${table.providerExternalReference} IS NULL)`,
    ),
    check(
      'user_wallets_provider_check',
      sql`${table.walletProvider} IS NULL
        OR length(btrim(${table.walletProvider})) > 0`,
    ),
    check(
      'user_wallets_verification_status_check',
      sql`${table.ownershipVerificationStatus} IN (
        'UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'
      )`,
    ),
    check(
      'user_wallets_verification_timestamp_check',
      sql`(${table.ownershipVerificationStatus} = 'VERIFIED') =
        (${table.ownershipVerifiedAt} IS NOT NULL)`,
    ),
    check(
      'user_wallets_status_check',
      sql`${table.walletStatus} IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')`,
    ),
    check(
      'user_wallets_active_verification_check',
      sql`${table.walletStatus} <> 'ACTIVE'
        OR ${table.ownershipVerificationStatus} = 'VERIFIED'`,
    ),
    check(
      'user_wallets_primary_active_check',
      sql`NOT ${table.isPrimary} OR ${table.walletStatus} = 'ACTIVE'`,
    ),
    uniqueIndex('idx_user_wallets_active_primary_unique')
      .on(table.userId, table.chainId)
      .where(sql`${table.isPrimary} AND ${table.walletStatus} = 'ACTIVE'`),
    index('idx_user_wallets_user_chain_status').on(
      table.userId,
      table.chainId,
      table.walletStatus,
    ),
    index('idx_user_wallets_verification_status').on(
      table.ownershipVerificationStatus,
      table.createdAt,
    ),
  ],
)
