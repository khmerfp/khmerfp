import { sql } from 'drizzle-orm'
import {
  bigint,
  char,
  check,
  foreignKey,
  numeric,
  pgTable,
  smallint,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import { chainAssets } from './chainAssets.js'
import { ctfConditions } from './ctfConditions.js'
import { marketOutcomes } from './marketOutcomes.js'

// register binary atomic CTF token identity, never wallet balances
export const ctfPositionTokens = pgTable(
  'ctf_position_tokens',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    conditionId: bigint('condition_id', { mode: 'bigint' }).notNull(),
    marketOutcomeId: bigint('market_outcome_id', { mode: 'bigint' }).notNull(),
    chainId: numeric('chain_id', { precision: 78, scale: 0 }).notNull(),
    ctfContractDeploymentId: bigint('ctf_contract_deployment_id', {
      mode: 'bigint',
    }).notNull(),
    collateralAssetId: bigint('collateral_asset_id', { mode: 'bigint' })
      .notNull(),
    outcomeIndex: smallint('outcome_index').notNull(),
    indexSet: numeric('index_set', { precision: 78, scale: 0 }).notNull(),
    parentCollectionId: char('parent_collection_id', { length: 66 })
      .default('0x0000000000000000000000000000000000000000000000000000000000000000')
      .notNull(),
    collectionId: char('collection_id', { length: 66 }).notNull(),
    positionId: numeric('position_id', { precision: 78, scale: 0 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'ctf_position_tokens_condition_id_fkey',
      columns: [table.conditionId],
      foreignColumns: [ctfConditions.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ctf_position_tokens_market_outcome_id_fkey',
      columns: [table.marketOutcomeId],
      foreignColumns: [marketOutcomes.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ctf_position_tokens_collateral_asset_id_fkey',
      columns: [table.collateralAssetId],
      foreignColumns: [chainAssets.id],
    }).onDelete('restrict'),
    unique('ctf_position_tokens_condition_outcome_key').on(
      table.conditionId,
      table.marketOutcomeId,
    ),
    unique('ctf_position_tokens_condition_index_key').on(
      table.conditionId,
      table.outcomeIndex,
    ),
    unique('ctf_position_tokens_condition_index_set_key').on(
      table.conditionId,
      table.indexSet,
    ),
    unique('ctf_position_tokens_chain_position_key').on(
      table.chainId,
      table.ctfContractDeploymentId,
      table.positionId,
    ),
    unique('ctf_position_tokens_condition_collection_key').on(
      table.conditionId,
      table.collectionId,
    ),
    check(
      'ctf_position_tokens_binary_mapping_check',
      sql`(${table.outcomeIndex} = 0 AND ${table.indexSet} = 1)
        OR (${table.outcomeIndex} = 1 AND ${table.indexSet} = 2)`,
    ),
    check(
      'ctf_position_tokens_root_collection_check',
      sql`${table.parentCollectionId} =
        '0x0000000000000000000000000000000000000000000000000000000000000000'`,
    ),
    check(
      'ctf_position_tokens_collection_id_check',
      sql`${table.collectionId} ~ '^0x[0-9a-f]{64}$'`,
    ),
    check(
      'ctf_position_tokens_position_id_check',
      sql`${table.positionId} >= 0`,
    ),
  ],
)
