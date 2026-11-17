import { sql } from 'drizzle-orm'
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

import { contractDeployments } from './contractDeployments.js'
import { userWallets } from './userWallets.js'

// record narrowly scoped wallet permissions without granting them on-chain
export const walletAuthorizations = pgTable(
  'wallet_authorizations',
  {
    id: bigint('id', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    walletId: bigint('wallet_id', { mode: 'bigint' }).notNull(),
    authorizationType: varchar('authorization_type', { length: 30 })
      .notNull(),
    authorizationScope: varchar('authorization_scope', { length: 50 })
      .notNull(),
    authorizedContractDeploymentId: bigint(
      'authorized_contract_deployment_id',
      { mode: 'bigint' },
    ),
    authorizedOperatorAddress: char('authorized_operator_address', {
      length: 42,
    }),
    eip712DomainName: varchar('eip712_domain_name', { length: 100 }),
    eip712DomainVersion: varchar('eip712_domain_version', { length: 50 }),
    authorizationReference: varchar('authorization_reference', {
      length: 255,
    }).notNull(),
    authorizationNonce: numeric('authorization_nonce', {
      precision: 78,
      scale: 0,
    }),
    payloadHash: char('payload_hash', { length: 66 }).notNull(),
    signatureHash: char('signature_hash', { length: 66 }),
    validFrom: timestamp('valid_from', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    authorizationStatus: varchar('authorization_status', { length: 20 })
      .default('PENDING')
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'wallet_authorizations_wallet_id_fkey',
      columns: [table.walletId],
      foreignColumns: [userWallets.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'wallet_authorizations_contract_deployment_id_fkey',
      columns: [table.authorizedContractDeploymentId],
      foreignColumns: [contractDeployments.id],
    }).onDelete('restrict'),
    unique('wallet_authorizations_wallet_reference_key').on(
      table.walletId,
      table.authorizationReference,
    ),
    check(
      'wallet_authorizations_type_check',
      sql`${table.authorizationType} IN (
        'EIP712_SIGNATURE', 'ONCHAIN_APPROVAL', 'SESSION_POLICY'
      )`,
    ),
    check(
      'wallet_authorizations_scope_check',
      sql`${table.authorizationScope} IN (
        'ORDER_SIGNING', 'TRADE_SETTLEMENT', 'CTF_OPERATIONS', 'REDEMPTION'
      )`,
    ),
    check(
      'wallet_authorizations_operator_check',
      sql`num_nonnulls(
        ${table.authorizedContractDeploymentId},
        ${table.authorizedOperatorAddress}
      ) = 1`,
    ),
    check(
      'wallet_authorizations_operator_address_check',
      sql`${table.authorizedOperatorAddress} IS NULL
        OR (
          ${table.authorizedOperatorAddress} ~ '^0x[0-9a-f]{40}$'
          AND ${table.authorizedOperatorAddress} =
            lower(${table.authorizedOperatorAddress})
        )`,
    ),
    check(
      'wallet_authorizations_domain_pair_check',
      sql`(${table.eip712DomainName} IS NULL) =
        (${table.eip712DomainVersion} IS NULL)`,
    ),
    check(
      'wallet_authorizations_eip712_domain_check',
      sql`${table.authorizationType} <> 'EIP712_SIGNATURE'
        OR ${table.eip712DomainName} IS NOT NULL`,
    ),
    check(
      'wallet_authorizations_nonce_check',
      sql`${table.authorizationNonce} IS NULL
        OR ${table.authorizationNonce} >= 0`,
    ),
    check(
      'wallet_authorizations_payload_hash_check',
      sql`${table.payloadHash} ~ '^0x[0-9a-f]{64}$'`,
    ),
    check(
      'wallet_authorizations_signature_hash_check',
      sql`${table.signatureHash} IS NULL
        OR ${table.signatureHash} ~ '^0x[0-9a-f]{64}$'`,
    ),
    check(
      'wallet_authorizations_validity_check',
      sql`${table.expiresAt} > ${table.validFrom}`,
    ),
    check(
      'wallet_authorizations_status_check',
      sql`${table.authorizationStatus} IN (
        'PENDING', 'VERIFIED', 'REVOKED', 'EXPIRED'
      )`,
    ),
    check(
      'wallet_authorizations_verified_metadata_check',
      sql`${table.authorizationStatus} <> 'VERIFIED'
        OR ${table.signatureHash} IS NOT NULL`,
    ),
    check(
      'wallet_authorizations_revocation_check',
      sql`(${table.authorizationStatus} = 'REVOKED') =
        (${table.revokedAt} IS NOT NULL)`,
    ),
    check(
      'wallet_authorizations_expired_metadata_check',
      sql`${table.authorizationStatus} <> 'EXPIRED'
        OR ${table.expiresAt} IS NOT NULL`,
    ),
    uniqueIndex('idx_wallet_authorizations_verified_contract_unique')
      .on(
        table.walletId,
        table.authorizationType,
        table.authorizationScope,
        table.authorizedContractDeploymentId,
      )
      .where(sql`${table.authorizationStatus} = 'VERIFIED'
        AND ${table.authorizedContractDeploymentId} IS NOT NULL`),
    uniqueIndex('idx_wallet_authorizations_verified_operator_unique')
      .on(
        table.walletId,
        table.authorizationType,
        table.authorizationScope,
        table.authorizedOperatorAddress,
      )
      .where(sql`${table.authorizationStatus} = 'VERIFIED'
        AND ${table.authorizedOperatorAddress} IS NOT NULL`),
    index('idx_wallet_authorizations_wallet_status').on(
      table.walletId,
      table.authorizationStatus,
    ),
    index('idx_wallet_authorizations_expiry').on(
      table.authorizationStatus,
      table.expiresAt,
    ),
  ],
)
