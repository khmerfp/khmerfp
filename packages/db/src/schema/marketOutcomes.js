import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  pgTable,
  numeric,
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
    outcomeLabel: varchar('outcome_label', { length: 255 }).notNull(),
    rangeLower: numeric('range_lower'),
    rangeUpper: numeric('range_upper'),
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
    check('market_outcomes_integer_bounds_check', sql`(${table.rangeLower} IS NULL OR (scale(${table.rangeLower}) = 0 AND abs(${table.rangeLower}) < power(10::numeric, 78))) AND (${table.rangeUpper} IS NULL OR (scale(${table.rangeUpper}) = 0 AND abs(${table.rangeUpper}) < power(10::numeric, 78)))`),
    check('market_outcomes_index_check', sql`${table.outcomeIndex} BETWEEN 0 AND 255`),
    check('market_outcomes_label_check', sql`length(btrim(${table.outcomeLabel})) > 0`),
    check('market_outcomes_range_check', sql`${table.rangeLower} IS NULL OR ${table.rangeUpper} IS NULL OR ${table.rangeLower} < ${table.rangeUpper}`),
  ],
)
