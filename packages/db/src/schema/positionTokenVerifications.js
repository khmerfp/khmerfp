import { sql } from 'drizzle-orm'
import { pgTable, bigint, char, text, timestamp, check } from 'drizzle-orm/pg-core'
import { ctfPositionTokens } from './ctfPositionTokens.js'

// Restricted, immutable evidence for mock accounting; never a claim of live custody or finality.
export const positionTokenVerifications = pgTable('position_token_verifications', {
  tokenId: bigint('token_id', { mode: 'bigint' }).primaryKey().references(() => ctfPositionTokens.id, { onDelete: 'restrict' }),
  conditionId: char('condition_id', { length: 66 }).notNull(),
  collectionId: char('collection_id', { length: 66 }).notNull(),
  positionId: text('position_id').notNull(),
  scope: text('scope').notNull().default('MOCK_ONLY'),
  evidenceHash: char('evidence_hash', { length: 64 }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check('position_token_verifications_scope_check', sql`${table.scope} = 'MOCK_ONLY'`),
  check('position_token_verifications_evidence_check', sql`${table.evidenceHash} ~ '^[0-9a-f]{64}$'`),
])
