import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { contractDeployments } from './contractDeployments.js'
import { markets } from './markets.js'

// define one off-chain binary question without inventing a CTF identifier
export const marketQuestions = pgTable(
  'market_questions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketId: uuid('market_id').notNull(),
    oracleContractDeploymentId: bigint('oracle_contract_deployment_id', {
      mode: 'bigint',
    }),
    questionText: text('question_text').notNull(),
    resolutionRules: text('resolution_rules').notNull(),
    resolutionSource: text('resolution_source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'market_questions_market_id_fkey',
      columns: [table.marketId],
      foreignColumns: [markets.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'market_questions_oracle_contract_deployment_id_fkey',
      columns: [table.oracleContractDeploymentId],
      foreignColumns: [contractDeployments.id],
    }).onDelete('restrict'),
    unique('market_questions_market_id_key').on(table.marketId),
    unique('market_questions_market_id_id_key').on(table.marketId, table.id),
    check(
      'market_questions_text_check',
      sql`length(btrim(${table.questionText})) > 0`,
    ),
    check(
      'market_questions_resolution_rules_check',
      sql`length(btrim(${table.resolutionRules})) > 0`,
    ),
    check(
      'market_questions_resolution_source_check',
      sql`length(btrim(${table.resolutionSource})) > 0`,
    ),
  ],
)
