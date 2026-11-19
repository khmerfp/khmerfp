import { sql } from 'drizzle-orm'
import { pgTable, uuid, varchar, smallint, numeric, text, check } from 'drizzle-orm/pg-core'
import { markets } from './markets.js'

// Frozen measurement terms, not live prices or prediction-token quotes.
export const marketObservationSpecs = pgTable('market_observation_specs', {
  marketId: uuid('market_id').primaryKey().references(() => markets.id, { onDelete: 'restrict' }),
  referenceAsset: varchar('reference_asset', { length: 100 }).notNull(),
  unit: varchar('unit', { length: 100 }).notNull(),
  decimals: smallint('decimals').notNull(),
  domainLower: numeric('domain_lower'),
  domainUpper: numeric('domain_upper'),
  sourcePolicy: text('source_policy').notNull(),
  observationTimezone: varchar('observation_timezone', { length: 100 }).notNull(),
}, table => [
  check('market_observation_specs_integer_check', sql`(${table.domainLower} IS NULL OR (scale(${table.domainLower}) = 0 AND abs(${table.domainLower}) < power(10::numeric, 78))) AND (${table.domainUpper} IS NULL OR (scale(${table.domainUpper}) = 0 AND abs(${table.domainUpper}) < power(10::numeric, 78)))`),
  check('market_observation_specs_precision_check', sql`${table.decimals} BETWEEN 0 AND 18`),
  check('market_observation_specs_domain_check', sql`${table.domainLower} IS NULL OR ${table.domainUpper} IS NULL OR ${table.domainLower} < ${table.domainUpper}`),
  check('market_observation_specs_text_check', sql`length(btrim(${table.referenceAsset})) > 0 AND length(btrim(${table.unit})) > 0 AND length(btrim(${table.sourcePolicy})) > 0 AND length(btrim(${table.observationTimezone})) > 0`),
])
