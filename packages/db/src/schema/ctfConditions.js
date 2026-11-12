import { sql } from 'drizzle-orm'
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  smallint,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { chainAssets } from './chainAssets.js'
import { chains } from './chains.js'
import { contractDeployments } from './contractDeployments.js'
import { marketQuestions } from './marketQuestions.js'

// register binary CTF condition identity without claiming chain confirmation
export const ctfConditions = pgTable(
  'ctf_conditions',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    marketQuestionId: uuid('market_question_id').notNull(),
    chainId: numeric('chain_id', { precision: 78, scale: 0 }).notNull(),
    ctfContractDeploymentId: bigint('ctf_contract_deployment_id', {
      mode: 'bigint',
    }).notNull(),
    oracleContractDeploymentId: bigint('oracle_contract_deployment_id', {
      mode: 'bigint',
    }),
    oracleAddress: char('oracle_address', { length: 42 }).notNull(),
    ctfQuestionId: char('ctf_question_id', { length: 66 }).notNull(),
    conditionId: char('condition_id', { length: 66 }).notNull(),
    outcomeSlotCount: smallint('outcome_slot_count').default(2).notNull(),
    collateralAssetId: bigint('collateral_asset_id', { mode: 'bigint' })
      .notNull(),
    registrationStatus: varchar('registration_status', { length: 20 })
      .default('DERIVED')
      .notNull(),
    preparationTxHash: char('preparation_tx_hash', { length: 66 }),
    preparationBlockNumber: numeric('preparation_block_number', {
      precision: 78,
      scale: 0,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'ctf_conditions_market_question_id_fkey',
      columns: [table.marketQuestionId],
      foreignColumns: [marketQuestions.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ctf_conditions_chain_id_fkey',
      columns: [table.chainId],
      foreignColumns: [chains.chainId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ctf_conditions_ctf_contract_deployment_id_fkey',
      columns: [table.ctfContractDeploymentId],
      foreignColumns: [contractDeployments.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ctf_conditions_oracle_contract_deployment_id_fkey',
      columns: [table.oracleContractDeploymentId],
      foreignColumns: [contractDeployments.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ctf_conditions_collateral_asset_id_fkey',
      columns: [table.collateralAssetId],
      foreignColumns: [chainAssets.id],
    }).onDelete('restrict'),
    unique('ctf_conditions_market_question_key').on(table.marketQuestionId),
    unique('ctf_conditions_chain_condition_key').on(
      table.chainId,
      table.ctfContractDeploymentId,
      table.conditionId,
    ),
    unique('ctf_conditions_id_question_key').on(
      table.id,
      table.marketQuestionId,
    ),
    check(
      'ctf_conditions_oracle_address_check',
      sql`${table.oracleAddress} ~ '^0x[0-9a-f]{40}$'
        AND ${table.oracleAddress} = lower(${table.oracleAddress})`,
    ),
    check(
      'ctf_conditions_question_id_check',
      sql`${table.ctfQuestionId} ~ '^0x[0-9a-f]{64}$'`,
    ),
    check(
      'ctf_conditions_condition_id_check',
      sql`${table.conditionId} ~ '^0x[0-9a-f]{64}$'`,
    ),
    check(
      'ctf_conditions_outcome_slot_count_check',
      sql`${table.outcomeSlotCount} = 2`,
    ),
    check(
      'ctf_conditions_status_check',
      sql`${table.registrationStatus} IN (
        'DERIVED', 'SUBMITTED', 'PREPARED', 'FAILED'
      )`,
    ),
    check(
      'ctf_conditions_tx_hash_check',
      sql`${table.preparationTxHash} IS NULL
        OR ${table.preparationTxHash} ~ '^0x[0-9a-f]{64}$'`,
    ),
    check(
      'ctf_conditions_block_number_check',
      sql`${table.preparationBlockNumber} IS NULL
        OR ${table.preparationBlockNumber} >= 0`,
    ),
    check(
      'ctf_conditions_status_evidence_check',
      sql`(
        ${table.registrationStatus} = 'DERIVED'
        AND ${table.preparationTxHash} IS NULL
        AND ${table.preparationBlockNumber} IS NULL
      ) OR (
        ${table.registrationStatus} = 'SUBMITTED'
        AND ${table.preparationTxHash} IS NOT NULL
        AND ${table.preparationBlockNumber} IS NULL
      ) OR (
        ${table.registrationStatus} = 'PREPARED'
        AND ${table.preparationTxHash} IS NOT NULL
        AND ${table.preparationBlockNumber} IS NOT NULL
      ) OR (
        ${table.registrationStatus} = 'FAILED'
        AND ${table.preparationBlockNumber} IS NULL
      )`,
    ),
    index('idx_ctf_conditions_chain_status').on(
      table.chainId,
      table.registrationStatus,
    ),
    index('idx_ctf_conditions_ctf_question').on(
      table.chainId,
      table.ctfQuestionId,
    ),
  ],
)
