import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  pgTable,
  smallint,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { marketQuestions } from './marketQuestions.js'

// fix binary outcome ordering while leaving CTF identifiers for a later stage
export const marketOutcomes = pgTable(
  'market_outcomes',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    marketId: uuid('market_id').notNull(),
    questionId: uuid('question_id').notNull(),
    outcomeIndex: smallint('outcome_index').notNull(),
    outcomeLabel: varchar('outcome_label', { length: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'market_outcomes_market_question_fkey',
      columns: [table.marketId, table.questionId],
      foreignColumns: [marketQuestions.marketId, marketQuestions.id],
    }).onDelete('restrict'),
    unique('market_outcomes_question_index_key').on(
      table.questionId,
      table.outcomeIndex,
    ),
    unique('market_outcomes_question_label_key').on(
      table.questionId,
      table.outcomeLabel,
    ),
    check(
      'market_outcomes_binary_pair_check',
      sql`(${table.outcomeIndex} = 0 AND ${table.outcomeLabel} = 'YES')
        OR (${table.outcomeIndex} = 1 AND ${table.outcomeLabel} = 'NO')`,
    ),
  ],
)
