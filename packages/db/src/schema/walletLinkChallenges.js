import { sql } from 'drizzle-orm'
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users.js'
import { sessions } from './sessions.js'
import { chains } from './chains.js'

// keep ownership challenges separate from trading and transfer permissions.
export const walletLinkChallenges = pgTable(
  'wallet_link_challenges',
  {
    id: uuid('id').primaryKey(),
    userId: bigint('user_id', { mode: 'bigint' }).notNull(),
    sessionHash: char('session_hash', { length: 64 }).notNull(),
    chainId: numeric('chain_id', { precision: 78, scale: 0 }).notNull(),
    walletAddress: char('wallet_address', { length: 42 }).notNull(),
    action: varchar('action', { length: 10 }).notNull(),
    appOrigin: text('app_origin').notNull(),
    nonce: char('nonce', { length: 66 }).notNull(),
    typedData: jsonb('typed_data').notNull(),
    payloadHash: char('payload_hash', { length: 66 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'wallet_link_challenges_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'wallet_link_challenges_session_hash_fkey',
      columns: [table.sessionHash],
      foreignColumns: [sessions.tokenHash],
    }).onDelete('cascade'),
    foreignKey({
      name: 'wallet_link_challenges_chain_id_fkey',
      columns: [table.chainId],
      foreignColumns: [chains.chainId],
    }).onDelete('restrict'),
    unique('wallet_link_challenges_nonce_key').on(table.nonce),
    check(
      'wallet_link_challenges_address_check',
      sql`${table.walletAddress} ~ '^0x[0-9a-f]{40}$' AND ${table.walletAddress} <> '0x0000000000000000000000000000000000000000'`,
    ),
    check(
      'wallet_link_challenges_session_hash_check',
      sql`${table.sessionHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'wallet_link_challenges_action_check',
      sql`${table.action} IN ('LINK','UNLINK','RELINK')`,
    ),
    check('wallet_link_challenges_origin_check', sql`length(${table.appOrigin}) BETWEEN 1 AND 512`),
    check('wallet_link_challenges_nonce_check', sql`${table.nonce} ~ '^0x[0-9a-f]{64}$'`),
    check('wallet_link_challenges_hash_check', sql`${table.payloadHash} ~ '^0x[0-9a-f]{64}$'`),
    check(
      'wallet_link_challenges_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '2 minutes'`,
    ),
    check(
      'wallet_link_challenges_consumed_check',
      sql`${table.consumedAt} IS NULL OR (${table.consumedAt} >= ${table.createdAt} AND ${table.consumedAt} < ${table.expiresAt})`,
    ),
    check(
      'wallet_link_challenges_payload_check',
      sql`(
    jsonb_typeof(${table.typedData}) = 'object'
    AND ${table.typedData}->>'primaryType' = 'WalletLink'
    AND ${table.typedData} #>> '{domain,name}' = 'KhmerFP Wallet Ownership'
    AND ${table.typedData} #>> '{domain,version}' = '1'
    AND ${table.typedData} #>> '{domain,chainId}' = ${table.chainId}::text
    AND ${table.typedData} #>> '{message,challengeId}' = ${table.id}::text
    AND ${table.typedData} #>> '{message,userId}' = ${table.userId}::text
    AND ${table.typedData} #>> '{message,wallet}' = ${table.walletAddress}::text
    AND ${table.typedData} #>> '{message,action}' = ${table.action}
    AND ${table.typedData} #>> '{message,appOrigin}' = ${table.appOrigin}
    AND ${table.typedData} #>> '{message,nonce}' = ${table.nonce}::text
  ) IS TRUE`,
    ),
    index('idx_wallet_link_challenges_user_created').on(
      table.userId,
      table.createdAt.desc().nullsFirst(),
    ),
    index('idx_wallet_link_challenges_session').on(table.sessionHash),
    index('idx_wallet_link_challenges_expiry').on(table.expiresAt),
  ],
)
