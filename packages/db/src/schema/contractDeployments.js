import { sql } from 'drizzle-orm'
import {
  bigint,
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

// keep versioned contract deployment history
export const contractDeployments = pgTable(
  'contract_deployments',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    chainId: numeric('chain_id', { precision: 78, scale: 0 }).notNull(),
    contractAddress: char('contract_address', { length: 42 }),
    contractRole: varchar('contract_role', { length: 40 }).notNull(),
    contractVersion: varchar('contract_version', { length: 50 }).notNull(),
    deploymentTxHash: char('deployment_tx_hash', { length: 66 }),
    deploymentBlockNumber: numeric('deployment_block_number', {
      precision: 78,
      scale: 0,
    }),
    deploymentStatus: varchar('deployment_status', { length: 20 })
      .default('PLANNED')
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
      name: 'contract_deployments_chain_id_fkey',
      columns: [table.chainId],
      foreignColumns: [chains.chainId],
    }).onDelete('restrict'),
    unique('contract_deployments_role_version_key').on(
      table.chainId,
      table.contractRole,
      table.contractVersion,
    ),
    check(
      'contract_deployments_address_check',
      sql`${table.contractAddress} IS NULL
        OR ${table.contractAddress} ~ '^0x[0-9a-f]{40}$'`,
    ),
    check(
      'contract_deployments_role_check',
      sql`${table.contractRole} ~ '^[A-Z][A-Z0-9_]{0,39}$'`,
    ),
    check(
      'contract_deployments_version_check',
      sql`length(btrim(${table.contractVersion})) > 0`,
    ),
    check(
      'contract_deployments_tx_hash_check',
      sql`${table.deploymentTxHash} IS NULL
        OR ${table.deploymentTxHash} ~ '^0x[0-9a-f]{64}$'`,
    ),
    check(
      'contract_deployments_block_number_check',
      sql`${table.deploymentBlockNumber} IS NULL
        OR ${table.deploymentBlockNumber} >= 0`,
    ),
    check(
      'contract_deployments_status_check',
      sql`${table.deploymentStatus} IN (
        'PLANNED',
        'PENDING',
        'CONFIRMED',
        'FAILED',
        'RETIRED'
      )`,
    ),
    check(
      'contract_deployments_metadata_check',
      sql`(
        ${table.deploymentStatus} = 'PLANNED'
        AND ${table.contractAddress} IS NULL
        AND ${table.deploymentTxHash} IS NULL
        AND ${table.deploymentBlockNumber} IS NULL
      ) OR (
        ${table.deploymentStatus} = 'PENDING'
        AND ${table.deploymentTxHash} IS NOT NULL
        AND ${table.deploymentBlockNumber} IS NULL
      ) OR (
        ${table.deploymentStatus} IN ('CONFIRMED', 'RETIRED')
        AND ${table.contractAddress} IS NOT NULL
        AND ${table.deploymentTxHash} IS NOT NULL
        AND ${table.deploymentBlockNumber} IS NOT NULL
      ) OR ${table.deploymentStatus} = 'FAILED'`,
    ),
    uniqueIndex('idx_contract_deployments_chain_address_unique')
      .on(table.chainId, table.contractAddress)
      .where(sql`${table.contractAddress} IS NOT NULL`),
    uniqueIndex('idx_contract_deployments_active_role_unique')
      .on(table.chainId, table.contractRole)
      .where(sql`${table.deploymentStatus} = 'CONFIRMED'`),
    uniqueIndex('idx_contract_deployments_chain_tx_hash_unique')
      .on(table.chainId, table.deploymentTxHash)
      .where(sql`${table.deploymentTxHash} IS NOT NULL`),
    index('idx_contract_deployments_status').on(
      table.deploymentStatus,
      table.chainId,
    ),
  ],
)
