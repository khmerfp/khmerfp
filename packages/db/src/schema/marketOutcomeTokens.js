import { sql } from 'drizzle-orm'
import { pgTable, bigint, varchar, unique, check, index } from 'drizzle-orm/pg-core'
import { marketOutcomes } from './marketOutcomes.js'
import { ctfPositionTokens } from './ctfPositionTokens.js'

// Display claims alias canonical tokens. Binary NO(A) and YES(B) share inventory.
export const marketOutcomeTokens = pgTable('market_outcome_tokens', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  marketOutcomeId: bigint('market_outcome_id', { mode: 'bigint' }).notNull().references(() => marketOutcomes.id, { onDelete: 'restrict' }),
  polarity: varchar('polarity', { length: 3 }).notNull(),
  tokenId: bigint('token_id', { mode: 'bigint' }).notNull().references(() => ctfPositionTokens.id, { onDelete: 'restrict' }),
}, table => [
  unique('market_outcome_tokens_claim_key').on(table.marketOutcomeId, table.polarity),
  check('market_outcome_tokens_polarity_check', sql`${table.polarity} IN ('YES', 'NO')`),
  index('idx_market_outcome_tokens_token').on(table.tokenId),
])
