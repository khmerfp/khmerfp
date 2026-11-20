import { sql } from 'drizzle-orm'
import { pgTable, uuid, text, bigint, integer, boolean, jsonb, timestamp, numeric, primaryKey, unique, uniqueIndex, check, foreignKey, index } from 'drizzle-orm/pg-core'
import { markets } from './markets.js'
import { marketCategories } from './marketCategories.js'
import { contractDeployments } from './contractDeployments.js'
import { chainAssets } from './chainAssets.js'

const time = name => timestamp(name, { withTimezone: true }).notNull()
const uuidRef = (name, target) => uuid(name).notNull().references(target, { onDelete: 'restrict' })
const ref = (name, target) => bigint(name, { mode: 'bigint' }).notNull().references(target, { onDelete: 'restrict' })

// A version is immutable. Operational scheduling switches live separately.
export const marketTemplates = pgTable('market_templates', {
  id: uuid('id').defaultRandom().primaryKey(), templateKey: text('template_key').notNull(), version: integer('version').notNull(),
  categoryId: ref('category_id', () => marketCategories.id), ctfDeploymentId: ref('ctf_deployment_id', () => contractDeployments.id),
  oracleDeploymentId: bigint('oracle_deployment_id', { mode: 'bigint' }).notNull(), collateralAssetId: ref('collateral_asset_id', () => chainAssets.id),
  definition: jsonb('definition').notNull(), registryIdentity: jsonb('registry_identity').notNull(), createdAt: time('created_at').defaultNow(),
}, t => [foreignKey({name:'market_templates_oracle_deployment_fk',columns:[t.oracleDeploymentId],foreignColumns:[contractDeployments.id]}).onDelete('restrict'),
  unique('market_templates_key_version_key').on(t.templateKey, t.version),
  unique('market_templates_id_key_key').on(t.id, t.templateKey),
  check('market_templates_version_check', sql`${t.version} > 0 AND ${t.templateKey} ~ '^[a-z0-9][a-z0-9_-]{0,99}$'`),
  check('market_templates_scope_check', sql`jsonb_typeof(${t.definition}) = 'object' AND coalesce(${t.definition}->>'scope','') = 'MOCK_ONLY'`)])

export const marketTemplateControls = pgTable('market_template_controls', {
  templateId: uuidRef('template_id', () => marketTemplates.id).primaryKey(), templateKey: text('template_key').notNull(),
  enabled: boolean('enabled').notNull().default(false), nextOrdinal: bigint('next_ordinal', { mode: 'bigint' }).notNull().default(sql`0`),
  nextAt: timestamp('next_at', { withTimezone: true }), duplicateAttempts: bigint('duplicate_attempts', { mode: 'bigint' }).notNull().default(sql`0`),
  failureCount: bigint('failure_count', { mode: 'bigint' }).notNull().default(sql`0`), lastError: text('last_error'),
}, t => [foreignKey({ name: 'market_template_controls_identity_fk', columns: [t.templateId, t.templateKey], foreignColumns: [marketTemplates.id, marketTemplates.templateKey] }).onDelete('restrict'),
  uniqueIndex('market_template_controls_enabled_key').on(t.templateKey).where(sql`${t.enabled}`),
  check('market_template_controls_counters_check', sql`${t.nextOrdinal} >= 0 AND ${t.duplicateAttempts} >= 0 AND ${t.failureCount} >= 0`),
  index('market_template_controls_due_idx').on(t.enabled, t.nextAt)])

// Extend the existing market identity; never create a second trading registry.
export const marketRounds = pgTable('market_rounds', {
  marketId: uuidRef('market_id', () => markets.id).primaryKey(), templateId: uuidRef('template_id', () => marketTemplates.id),
  ordinal: bigint('ordinal', { mode: 'bigint' }).notNull(), opensAt: time('opens_at'), cutoffAt: time('cutoff_at'),
  observationStart: time('observation_start'), observationEnd: time('observation_end'), expectedAvailableAt: time('expected_available_at'),
  missed: boolean('missed').notNull(), expirationComplete: boolean('expiration_complete').notNull().default(false), createdAt: time('created_at').defaultNow(),
}, t => [unique('market_rounds_template_ordinal_key').on(t.templateId, t.ordinal),
  check('market_rounds_boundaries_check', sql`${t.ordinal} >= 0 AND ${t.cutoffAt} > ${t.opensAt} AND ${t.observationEnd} >= ${t.observationStart} AND ${t.expectedAvailableAt} >= ${t.observationEnd}`),
  index('market_rounds_cutoff_idx').on(t.expirationComplete, t.cutoffAt)])

export const marketRoundRequirements = pgTable('market_round_requirements', {
  marketId: uuidRef('market_id', () => marketRounds.marketId), kind: text('kind').notNull(), sourceId: text('source_id').notNull(),
  unit: text('unit').notNull(), decimals: integer('decimals').notNull(), windowStart: time('window_start'), windowEnd: time('window_end'),
  expectedAvailableAt: time('expected_available_at'), revisionPolicy: text('revision_policy').notNull(),
}, t => [primaryKey({ columns: [t.marketId, t.kind] }),
  check('market_round_requirements_terms_check', sql`${t.kind} IN ('OPEN','CLOSE','RESULT') AND ${t.decimals} BETWEEN 0 AND 18 AND ${t.windowEnd} >= ${t.windowStart} AND ${t.revisionPolicy} IN ('NO_REVISIONS','REQUIRE_FINAL') AND length(btrim(${t.sourceId})) > 0 AND length(btrim(${t.unit})) > 0`)])

// Append-only mock evidence; no winner, payout or CTF transaction is produced.
export const marketRoundObservations = pgTable('market_round_observations', {
  id: uuid('id').defaultRandom().primaryKey(), marketId: uuid('market_id').notNull(), kind: text('kind').notNull(),
  observedAt: time('observed_at'), value: numeric('value', { precision: 78, scale: 0 }), evidenceRef: text('evidence_ref').notNull(),
  isFinal: boolean('is_final').notNull(), recordedAt: time('recorded_at').defaultNow(),
}, t => [foreignKey({ name: 'market_round_observations_requirement_fk', columns: [t.marketId, t.kind], foreignColumns: [marketRoundRequirements.marketId, marketRoundRequirements.kind] }).onDelete('restrict'),
  unique('market_round_observations_evidence_key').on(t.marketId, t.kind, t.evidenceRef),
  check('market_round_observations_value_check', sql`(${t.value} IS NULL OR scale(${t.value}) = 0) AND length(btrim(${t.evidenceRef})) > 0`)])

// Public lifecycle stream: no customer order, position or financial-account payloads.
export const marketLifecycleEvents = pgTable('market_lifecycle_events', {
  id: uuid('id').defaultRandom().primaryKey(), templateId: uuidRef('template_id', () => marketTemplates.id),
  marketId: uuid('market_id').references(() => markets.id, { onDelete: 'restrict' }), sequence: bigint('sequence', { mode: 'bigint' }).notNull(),
  operationKey: text('operation_key').notNull().unique(), kind: text('kind').notNull(), code: text('code'), createdAt: time('created_at').defaultNow(),
}, t => [unique('market_lifecycle_events_sequence_key').on(t.templateId, t.sequence),
  check('market_lifecycle_events_sequence_check', sql`${t.sequence} > 0`)])

export const marketLifecycleCursors = pgTable('market_lifecycle_cursors', {
  consumer: text('consumer').notNull(), templateId: uuidRef('template_id', () => marketTemplates.id), sequence: bigint('sequence', { mode: 'bigint' }).notNull().default(sql`0`),
}, t => [primaryKey({ columns: [t.consumer, t.templateId] }),
  check('market_lifecycle_cursors_identity_check', sql`${t.consumer} ~ '^system:[a-z][a-z0-9_-]{0,60}$' AND ${t.sequence} >= 0`)])
