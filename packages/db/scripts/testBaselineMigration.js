import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

const { Pool } = pg

const databaseName = 'khmerfp_migration_test'
const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const expectedTables = [
  'auth_audit_logs',
  'auth_rate_limits',
  'bakong_payments',
  'chain_assets',
  'chains',
  'contract_deployments',
  'market_categories',
  'market_outcomes',
  'market_questions',
  'markets',
  'phone_otps',
  'sessions',
  'transactions',
  'user_factors',
  'user_wallets',
  'users',
  'wallet_authorizations',
  'wallets',
]
const expectedDetailedSchemas = {
  auth_audit_logs: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.auth_audit_logs_id_seq'],
      ['user_id', 'bigint', true, null, null, null],
      ['event_type', 'varchar(100)', false, null, null, null],
      ['ip_address', 'inet', true, null, null, null],
      ['user_agent', 'text', true, null, null, null],
      ['details', 'jsonb', false, "'{}'::jsonb", null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['auth_audit_logs_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['auth_audit_logs_user_id_fkey', 'foreign key', ['user_id'], null, 'public.users', ['id'], 'set null', 'no action'],
    ],
    indexes: [
      ['idx_auth_audit_event_created', false, 'btree', ['event_type', 'created_at DESC'], null, true, true],
      ['idx_auth_audit_user_created', false, 'btree', ['user_id', 'created_at DESC'], null, true, true],
    ],
  },
  auth_rate_limits: {
    columns: [
      ['rate_limit_key', 'varchar(255)', false, null, null, null],
      ['window_started_at', 'timestamp with time zone', false, 'now()', null, null],
      ['request_count', 'integer', false, '0', null, null],
      ['blocked_until', 'timestamp with time zone', true, null, null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['auth_rate_limits_pkey', 'primary key', ['rate_limit_key'], null, null, null, null, null],
      ['auth_rate_limits_request_count_check', 'check', ['request_count'], 'request_count >= 0', null, null, null, null],
    ],
    indexes: [],
  },
  bakong_payments: {
    columns: [
      ['id', 'bigint', false, null, 'BY DEFAULT', 'public.bakong_payments_id_seq'],
      ['user_id', 'bigint', true, null, null, null],
      ['tran_id', 'varchar(25)', false, null, null, null],
      ['md5', 'character(32)', false, null, null, null],
      ['qr_string', 'text', false, null, null, null],
      ['name', 'varchar(100)', false, null, null, null],
      ['description', 'varchar(100)', true, null, null, null],
      ['amount', 'numeric(14,2)', false, null, null, null],
      ['amount_minor', 'bigint', false, null, null, null],
      ['currency', 'varchar(3)', false, "'USD'", null, null],
      ['status', 'varchar(20)', false, "'PENDING'", null, null],
      ['status_access_token_hash', 'character(64)', true, null, null, null],
      ['idempotency_key', 'varchar(64)', true, null, null, null],
      ['expires_at', 'timestamp with time zone', false, null, null, null],
      ['paid_at', 'timestamp with time zone', true, null, null, null],
      ['wallet_credited_at', 'timestamp with time zone', true, null, null, null],
      ['provider_evidence', 'jsonb', true, null, null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['bakong_payments_amount_check', 'check', ['amount'], 'amount > 0::numeric', null, null, null, null],
      ['bakong_payments_amount_minor_positive', 'check', ['amount_minor'], 'amount_minor > 0', null, null, null, null],
      ['bakong_payments_currency_check', 'check', ['currency'], "currency IN ('USD', 'KHR')", null, null, null, null],
      ['bakong_payments_md5_key', 'unique', ['md5'], null, null, null, null, null],
      ['bakong_payments_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['bakong_payments_status_access_token_hash_check', 'check', ['status_access_token_hash'], "status_access_token_hash IS NULL OR status_access_token_hash ~ '^[a-f0-9]{64}$'", null, null, null, null],
      ['bakong_payments_status_check', 'check', ['status'], "status IN ('PENDING', 'PAID', 'EXPIRED', 'FAILED')", null, null, null, null],
      ['bakong_payments_tran_id_key', 'unique', ['tran_id'], null, null, null, null, null],
      ['bakong_payments_user_id_fkey', 'foreign key', ['user_id'], null, 'public.users', ['id'], 'set null', 'no action'],
    ],
    indexes: [
      ['idx_bakong_payments_status_expires', false, 'btree', ['status', 'expires_at'], null, true, true],
      ['idx_bakong_payments_user_idempotency', true, 'btree', ['user_id', 'idempotency_key'], 'idempotency_key IS NOT NULL', true, true],
      ['idx_bakong_payments_user_status', false, 'btree', ['user_id', 'status'], null, true, true],
    ],
  },
  chain_assets: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.chain_assets_id_seq'],
      ['chain_id', 'numeric(78,0)', false, null, null, null],
      ['contract_address', 'character(42)', false, null, null, null],
      ['symbol', 'varchar(32)', false, null, null, null],
      ['name', 'varchar(100)', false, null, null, null],
      ['decimals', 'smallint', false, null, null, null],
      ['asset_type', 'varchar(20)', false, null, null, null],
      ['enabled', 'boolean', false, 'false', null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['chain_assets_asset_type_check', 'check', ['asset_type'], "asset_type IN ('ERC20', 'ERC1155')", null, null, null, null],
      ['chain_assets_chain_address_key', 'unique', ['chain_id', 'contract_address'], null, null, null, null, null],
      ['chain_assets_chain_id_fkey', 'foreign key', ['chain_id'], null, 'public.chains', ['chain_id'], 'restrict', 'no action'],
      ['chain_assets_contract_address_check', 'check', ['contract_address'], "contract_address ~ '^0x[0-9a-f]{40}$'", null, null, null, null],
      ['chain_assets_decimals_check', 'check', ['decimals'], 'decimals >= 0 AND decimals <= 255', null, null, null, null],
      ['chain_assets_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['chain_assets_symbol_check', 'check', ['symbol'], "symbol ~ '^[A-Z][A-Z0-9_]{0,31}$'", null, null, null, null],
    ],
    indexes: [
      ['idx_chain_assets_chain_enabled', false, 'btree', ['chain_id', 'enabled'], null, true, true],
    ],
  },
  chains: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.chains_id_seq'],
      ['chain_id', 'numeric(78,0)', false, null, null, null],
      ['name', 'varchar(100)', false, null, null, null],
      ['environment', 'varchar(20)', false, null, null, null],
      ['native_symbol', 'varchar(20)', false, null, null, null],
      ['rpc_config_reference', 'varchar(255)', true, null, null, null],
      ['enabled', 'boolean', false, 'false', null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['chains_chain_id_key', 'unique', ['chain_id'], null, null, null, null, null],
      ['chains_chain_id_positive', 'check', ['chain_id'], 'chain_id > 0::numeric', null, null, null, null],
      ['chains_environment_check', 'check', ['environment'], "environment IN ('testnet', 'mainnet')", null, null, null, null],
      ['chains_name_environment_key', 'unique', ['name', 'environment'], null, null, null, null, null],
      ['chains_native_symbol_check', 'check', ['native_symbol'], "native_symbol ~ '^[A-Z][A-Z0-9_]{0,19}$'", null, null, null, null],
      ['chains_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['chains_rpc_config_reference_check', 'check', ['rpc_config_reference'], "rpc_config_reference IS NULL OR rpc_config_reference ~ '^[A-Z][A-Z0-9_]{0,254}$'", null, null, null, null],
    ],
    indexes: [],
  },
  contract_deployments: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.contract_deployments_id_seq'],
      ['chain_id', 'numeric(78,0)', false, null, null, null],
      ['contract_address', 'character(42)', true, null, null, null],
      ['contract_role', 'varchar(40)', false, null, null, null],
      ['contract_version', 'varchar(50)', false, null, null, null],
      ['deployment_tx_hash', 'character(66)', true, null, null, null],
      ['deployment_block_number', 'numeric(78,0)', true, null, null, null],
      ['deployment_status', 'varchar(20)', false, "'PLANNED'", null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['contract_deployments_address_check', 'check', ['contract_address'], "contract_address IS NULL OR contract_address ~ '^0x[0-9a-f]{40}$'", null, null, null, null],
      ['contract_deployments_block_number_check', 'check', ['deployment_block_number'], 'deployment_block_number IS NULL OR deployment_block_number >= 0::numeric', null, null, null, null],
      ['contract_deployments_chain_id_fkey', 'foreign key', ['chain_id'], null, 'public.chains', ['chain_id'], 'restrict', 'no action'],
      ['contract_deployments_metadata_check', 'check', ['deployment_status', 'contract_address', 'deployment_tx_hash', 'deployment_block_number'], "deployment_status = 'PLANNED' AND contract_address IS NULL AND deployment_tx_hash IS NULL AND deployment_block_number IS NULL OR deployment_status = 'PENDING' AND deployment_tx_hash IS NOT NULL AND deployment_block_number IS NULL OR deployment_status IN ('CONFIRMED', 'RETIRED') AND contract_address IS NOT NULL AND deployment_tx_hash IS NOT NULL AND deployment_block_number IS NOT NULL OR deployment_status = 'FAILED'", null, null, null, null],
      ['contract_deployments_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['contract_deployments_role_check', 'check', ['contract_role'], "contract_role ~ '^[A-Z][A-Z0-9_]{0,39}$'", null, null, null, null],
      ['contract_deployments_role_version_key', 'unique', ['chain_id', 'contract_role', 'contract_version'], null, null, null, null, null],
      ['contract_deployments_status_check', 'check', ['deployment_status'], "deployment_status IN ('PLANNED', 'PENDING', 'CONFIRMED', 'FAILED', 'RETIRED')", null, null, null, null],
      ['contract_deployments_tx_hash_check', 'check', ['deployment_tx_hash'], "deployment_tx_hash IS NULL OR deployment_tx_hash ~ '^0x[0-9a-f]{64}$'", null, null, null, null],
      ['contract_deployments_version_check', 'check', ['contract_version'], 'length(btrim(contract_version)) > 0', null, null, null, null],
    ],
    indexes: [
      ['idx_contract_deployments_active_role_unique', true, 'btree', ['chain_id', 'contract_role'], "deployment_status = 'CONFIRMED'", true, true],
      ['idx_contract_deployments_chain_address_unique', true, 'btree', ['chain_id', 'contract_address'], 'contract_address IS NOT NULL', true, true],
      ['idx_contract_deployments_chain_tx_hash_unique', true, 'btree', ['chain_id', 'deployment_tx_hash'], 'deployment_tx_hash IS NOT NULL', true, true],
      ['idx_contract_deployments_status', false, 'btree', ['deployment_status', 'chain_id'], null, true, true],
    ],
  },
  market_categories: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.market_categories_id_seq'],
      ['parent_id', 'bigint', true, null, null, null],
      ['name', 'varchar(100)', false, null, null, null],
      ['slug', 'varchar(100)', false, null, null, null],
      ['description', 'text', true, null, null, null],
      ['active', 'boolean', false, 'true', null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['market_categories_name_check', 'check', ['name'], 'length(btrim(name)) > 0', null, null, null, null],
      ['market_categories_parent_check', 'check', ['parent_id', 'id'], 'parent_id IS NULL OR parent_id <> id', null, null, null, null],
      ['market_categories_parent_id_fkey', 'foreign key', ['parent_id'], null, 'public.market_categories', ['id'], 'restrict', 'no action'],
      ['market_categories_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['market_categories_slug_check', 'check', ['slug'], "slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'", null, null, null, null],
      ['market_categories_slug_key', 'unique', ['slug'], null, null, null, null, null],
    ],
    indexes: [
      ['idx_market_categories_parent_active', false, 'btree', ['parent_id', 'active'], null, true, true],
    ],
  },
  market_outcomes: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.market_outcomes_id_seq'],
      ['market_id', 'uuid', false, null, null, null],
      ['question_id', 'uuid', false, null, null, null],
      ['outcome_index', 'smallint', false, null, null, null],
      ['outcome_label', 'varchar(3)', false, null, null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['market_outcomes_binary_pair_check', 'check', ['outcome_index', 'outcome_label'], "outcome_index = 0 AND outcome_label = 'YES' OR outcome_index = 1 AND outcome_label = 'NO'", null, null, null, null],
      ['market_outcomes_market_question_fkey', 'foreign key', ['market_id', 'question_id'], null, 'public.market_questions', ['market_id', 'id'], 'restrict', 'no action'],
      ['market_outcomes_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['market_outcomes_question_index_key', 'unique', ['question_id', 'outcome_index'], null, null, null, null, null],
      ['market_outcomes_question_label_key', 'unique', ['question_id', 'outcome_label'], null, null, null, null, null],
    ],
    indexes: [],
  },
  market_questions: {
    columns: [
      ['id', 'uuid', false, 'gen_random_uuid()', null, null],
      ['market_id', 'uuid', false, null, null, null],
      ['oracle_contract_deployment_id', 'bigint', true, null, null, null],
      ['question_text', 'text', false, null, null, null],
      ['resolution_rules', 'text', false, null, null, null],
      ['resolution_source', 'text', false, null, null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['market_questions_market_id_fkey', 'foreign key', ['market_id'], null, 'public.markets', ['id'], 'restrict', 'no action'],
      ['market_questions_market_id_id_key', 'unique', ['market_id', 'id'], null, null, null, null, null],
      ['market_questions_market_id_key', 'unique', ['market_id'], null, null, null, null, null],
      ['market_questions_oracle_contract_deployment_id_fkey', 'foreign key', ['oracle_contract_deployment_id'], null, 'public.contract_deployments', ['id'], 'restrict', 'no action'],
      ['market_questions_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['market_questions_resolution_rules_check', 'check', ['resolution_rules'], 'length(btrim(resolution_rules)) > 0', null, null, null, null],
      ['market_questions_resolution_source_check', 'check', ['resolution_source'], 'length(btrim(resolution_source)) > 0', null, null, null, null],
      ['market_questions_text_check', 'check', ['question_text'], 'length(btrim(question_text)) > 0', null, null, null, null],
    ],
    indexes: [],
  },
  markets: {
    columns: [
      ['id', 'uuid', false, 'gen_random_uuid()', null, null],
      ['category_id', 'bigint', false, null, null, null],
      ['created_by_user_id', 'bigint', true, null, null, null],
      ['slug', 'varchar(160)', false, null, null, null],
      ['title', 'varchar(255)', false, null, null, null],
      ['description', 'text', false, null, null, null],
      ['lifecycle_status', 'varchar(20)', false, "'DRAFT'", null, null],
      ['trading_status', 'varchar(20)', false, "'NOT_STARTED'", null, null],
      ['resolution_status', 'varchar(20)', false, "'UNRESOLVED'", null, null],
      ['trading_starts_at', 'timestamp with time zone', false, null, null, null],
      ['trading_ends_at', 'timestamp with time zone', false, null, null, null],
      ['resolution_deadline', 'timestamp with time zone', false, null, null, null],
      ['terms_hash', 'character(66)', true, null, null, null],
      ['terms_frozen_at', 'timestamp with time zone', true, null, null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['markets_category_id_fkey', 'foreign key', ['category_id'], null, 'public.market_categories', ['id'], 'restrict', 'no action'],
      ['markets_created_by_user_id_fkey', 'foreign key', ['created_by_user_id'], null, 'public.users', ['id'], 'set null', 'no action'],
      ['markets_description_check', 'check', ['description'], 'length(btrim(description)) > 0', null, null, null, null],
      ['markets_frozen_before_trading_check', 'check', ['trading_status', 'terms_hash', 'terms_frozen_at'], "trading_status = 'NOT_STARTED' OR terms_hash IS NOT NULL AND terms_frozen_at IS NOT NULL", null, null, null, null],
      ['markets_frozen_lifecycle_check', 'check', ['lifecycle_status', 'terms_hash', 'terms_frozen_at'], "lifecycle_status IN ('DRAFT', 'REVIEW', 'CANCELLED') OR terms_hash IS NOT NULL AND terms_frozen_at IS NOT NULL", null, null, null, null],
      ['markets_lifecycle_status_check', 'check', ['lifecycle_status'], "lifecycle_status IN ('DRAFT', 'REVIEW', 'SCHEDULED', 'ACTIVE', 'CANCELLED', 'ARCHIVED')", null, null, null, null],
      ['markets_open_lifecycle_check', 'check', ['trading_status', 'lifecycle_status'], "trading_status <> 'OPEN' OR lifecycle_status = 'ACTIVE'", null, null, null, null],
      ['markets_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['markets_resolution_deadline_check', 'check', ['resolution_deadline', 'trading_ends_at'], 'resolution_deadline >= trading_ends_at', null, null, null, null],
      ['markets_resolution_requires_closed_check', 'check', ['resolution_status', 'trading_status'], "resolution_status = 'UNRESOLVED' OR trading_status = 'CLOSED'", null, null, null, null],
      ['markets_resolution_status_check', 'check', ['resolution_status'], "resolution_status IN ('UNRESOLVED', 'PENDING', 'RESOLVED', 'INVALID')", null, null, null, null],
      ['markets_slug_check', 'check', ['slug'], "slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'", null, null, null, null],
      ['markets_slug_key', 'unique', ['slug'], null, null, null, null, null],
      ['markets_terms_freeze_pair_check', 'check', ['terms_hash', 'terms_frozen_at'], '(terms_hash IS NULL) = (terms_frozen_at IS NULL)', null, null, null, null],
      ['markets_terms_hash_check', 'check', ['terms_hash'], "terms_hash IS NULL OR terms_hash ~ '^0x[0-9a-f]{64}$'", null, null, null, null],
      ['markets_title_check', 'check', ['title'], 'length(btrim(title)) > 0', null, null, null, null],
      ['markets_trading_status_check', 'check', ['trading_status'], "trading_status IN ('NOT_STARTED', 'OPEN', 'PAUSED', 'CLOSED')", null, null, null, null],
      ['markets_trading_window_check', 'check', ['trading_ends_at', 'trading_starts_at'], 'trading_ends_at > trading_starts_at', null, null, null, null],
    ],
    indexes: [
      ['idx_markets_category_lifecycle', false, 'btree', ['category_id', 'lifecycle_status'], null, true, true],
      ['idx_markets_resolution_deadline', false, 'btree', ['resolution_status', 'resolution_deadline'], null, true, true],
      ['idx_markets_trading_end', false, 'btree', ['trading_status', 'trading_ends_at'], null, true, true],
    ],
  },
  phone_otps: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.phone_otps_id_seq'],
      ['phone_number', 'varchar(32)', false, null, null, null],
      ['code_hash', 'character(64)', false, null, null, null],
      ['attempts', 'integer', false, '0', null, null],
      ['consumed_at', 'timestamp with time zone', true, null, null, null],
      ['expires_at', 'timestamp with time zone', false, null, null, null],
      ['ip_address', 'inet', true, null, null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['phone_otps_attempts_check', 'check', ['attempts'], 'attempts >= 0', null, null, null, null],
      ['phone_otps_code_hash_check', 'check', ['code_hash'], "code_hash ~ '^[a-f0-9]{64}$'", null, null, null, null],
      ['phone_otps_pkey', 'primary key', ['id'], null, null, null, null, null],
    ],
    indexes: [
      ['idx_phone_otps_lookup', false, 'btree', ['phone_number', 'created_at DESC'], null, true, true],
    ],
  },
  sessions: {
    columns: [
      ['token_hash', 'character(64)', false, null, null, null],
      ['user_id', 'bigint', false, null, null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['last_seen_at', 'timestamp with time zone', false, 'now()', null, null],
      ['idle_expires_at', 'timestamp with time zone', false, null, null, null],
      ['expires_at', 'timestamp with time zone', false, null, null, null],
      ['revoked_at', 'timestamp with time zone', true, null, null, null],
      ['step_up_at', 'timestamp with time zone', true, null, null, null],
      ['ip_address', 'inet', true, null, null, null],
      ['user_agent', 'text', true, null, null, null],
    ],
    constraints: [
      ['sessions_check', 'check', ['idle_expires_at', 'expires_at'], 'idle_expires_at <= expires_at', null, null, null, null],
      ['sessions_pkey', 'primary key', ['token_hash'], null, null, null, null, null],
      ['sessions_token_hash_check', 'check', ['token_hash'], "token_hash ~ '^[a-f0-9]{64}$'", null, null, null, null],
      ['sessions_user_id_fkey', 'foreign key', ['user_id'], null, 'public.users', ['id'], 'cascade', 'no action'],
    ],
    indexes: [
      ['idx_sessions_user_active', false, 'btree', ['user_id', 'expires_at'], 'revoked_at IS NULL', true, true],
    ],
  },
  transactions: {
    columns: [
      ['id', 'bigint', false, null, 'BY DEFAULT', 'public.transactions_id_seq'],
      ['tran_id', 'varchar(100)', false, null, null, null],
      ['name', 'varchar(100)', false, null, null, null],
      ['account_number', 'varchar(64)', false, null, null, null],
      ['amount', 'bigint', false, null, null, null],
      ['currency', 'varchar(3)', false, "'KHR'", null, null],
      ['status', 'varchar(20)', false, "'PENDING'", null, null],
      ['payway_response_code', 'text', true, null, null, null],
      ['paid_at', 'timestamp with time zone', true, null, null, null],
      ['verification_evidence', 'jsonb', true, null, null, null],
      ['status_access_token_hash', 'varchar(64)', true, null, null, null],
      ['created_at', 'timestamp with time zone', false, 'CURRENT_TIMESTAMP', null, null],
      ['updated_at', 'timestamp with time zone', false, 'CURRENT_TIMESTAMP', null, null],
    ],
    constraints: [
      ['transactions_amount_check', 'check', ['amount'], 'amount > 0', null, null, null, null],
      ['transactions_currency_check', 'check', ['currency'], "currency = 'KHR'", null, null, null, null],
      ['transactions_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['transactions_status_access_token_hash_check', 'check', ['status_access_token_hash'], "(status_access_token_hash IS NULL) OR (status_access_token_hash ~ '^[a-f0-9]{64}$')", null, null, null, null],
      ['transactions_status_check', 'check', ['status'], "status IN ('PENDING', 'PAID', 'FAILED', 'CANCELLED')", null, null, null, null],
      ['transactions_tran_id_key', 'unique', ['tran_id'], null, null, null, null, null],
    ],
    indexes: [],
  },
  user_factors: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.user_factors_id_seq'],
      ['user_id', 'bigint', false, null, null, null],
      ['factor_type', 'varchar(30)', false, null, null, null],
      ['identifier', 'varchar(255)', false, null, null, null],
      ['verified_at', 'timestamp with time zone', true, null, null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['user_factors_factor_type_check', 'check', ['factor_type'], "factor_type IN ('telegram', 'sms')", null, null, null, null],
      ['user_factors_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['user_factors_user_id_factor_type_identifier_key', 'unique', ['user_id', 'factor_type', 'identifier'], null, null, null, null, null],
      ['user_factors_user_id_fkey', 'foreign key', ['user_id'], null, 'public.users', ['id'], 'cascade', 'no action'],
    ],
    indexes: [],
  },
  user_wallets: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.user_wallets_id_seq'],
      ['user_id', 'bigint', false, null, null, null],
      ['chain_id', 'numeric(78,0)', false, null, null, null],
      ['wallet_address', 'character(42)', false, null, null, null],
      ['wallet_type', 'varchar(20)', false, null, null, null],
      ['custody_model', 'varchar(30)', false, "'USER_CONTROLLED'", null, null],
      ['wallet_provider', 'varchar(50)', true, null, null, null],
      ['provider_external_reference', 'varchar(255)', true, null, null, null],
      ['ownership_verification_status', 'varchar(20)', false, "'UNVERIFIED'", null, null],
      ['ownership_verified_at', 'timestamp with time zone', true, null, null, null],
      ['is_primary', 'boolean', false, 'false', null, null],
      ['wallet_status', 'varchar(20)', false, "'PENDING'", null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['user_wallets_active_verification_check', 'check', ['wallet_status', 'ownership_verification_status'], "wallet_status <> 'ACTIVE' OR ownership_verification_status = 'VERIFIED'", null, null, null, null],
      ['user_wallets_address_check', 'check', ['wallet_address'], "wallet_address ~ '^0x[0-9a-f]{40}$' AND wallet_address = lower(wallet_address)", null, null, null, null],
      ['user_wallets_chain_address_key', 'unique', ['chain_id', 'wallet_address'], null, null, null, null, null],
      ['user_wallets_chain_id_fkey', 'foreign key', ['chain_id'], null, 'public.chains', ['chain_id'], 'restrict', 'no action'],
      ['user_wallets_custody_model_check', 'check', ['custody_model'], "custody_model IN ('USER_CONTROLLED', 'HYBRID_RESTRICTED')", null, null, null, null],
      ['user_wallets_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['user_wallets_primary_active_check', 'check', ['is_primary', 'wallet_status'], "NOT is_primary OR wallet_status = 'ACTIVE'", null, null, null, null],
      ['user_wallets_provider_check', 'check', ['wallet_provider'], 'wallet_provider IS NULL OR length(btrim(wallet_provider)) > 0', null, null, null, null],
      ['user_wallets_provider_pair_check', 'check', ['wallet_provider', 'provider_external_reference'], '(wallet_provider IS NULL) = (provider_external_reference IS NULL)', null, null, null, null],
      ['user_wallets_status_check', 'check', ['wallet_status'], "wallet_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')", null, null, null, null],
      ['user_wallets_user_id_fkey', 'foreign key', ['user_id'], null, 'public.users', ['id'], 'restrict', 'no action'],
      ['user_wallets_verification_status_check', 'check', ['ownership_verification_status'], "ownership_verification_status IN ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED')", null, null, null, null],
      ['user_wallets_verification_timestamp_check', 'check', ['ownership_verification_status', 'ownership_verified_at'], "(ownership_verification_status = 'VERIFIED') = (ownership_verified_at IS NOT NULL)", null, null, null, null],
      ['user_wallets_wallet_type_check', 'check', ['wallet_type'], "wallet_type IN ('EOA', 'SMART_ACCOUNT')", null, null, null, null],
    ],
    indexes: [
      ['idx_user_wallets_active_primary_unique', true, 'btree', ['user_id', 'chain_id'], "is_primary AND wallet_status = 'ACTIVE'", true, true],
      ['idx_user_wallets_user_chain_status', false, 'btree', ['user_id', 'chain_id', 'wallet_status'], null, true, true],
      ['idx_user_wallets_verification_status', false, 'btree', ['ownership_verification_status', 'created_at'], null, true, true],
    ],
  },
  users: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.users_id_seq'],
      ['google_sub', 'varchar(255)', true, null, null, null],
      ['email', 'varchar(320)', false, null, null, null],
      ['display_name', 'varchar(255)', false, null, null, null],
      ['avatar_url', 'text', true, null, null, null],
      ['language', 'varchar(5)', false, "'en'", null, null],
      ['last_login_at', 'timestamp with time zone', true, null, null, null],
      ['last_login_ip', 'inet', true, null, null, null],
      ['last_login_user_agent', 'text', true, null, null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
      ['password_hash', 'text', true, null, null, null],
      ['facebook_sub', 'varchar(255)', true, null, null, null],
      ['telegram_sub', 'varchar(255)', true, null, null, null],
      ['phone_number', 'varchar(32)', true, null, null, null],
      ['phone_verified_at', 'timestamp with time zone', true, null, null, null],
    ],
    constraints: [
      ['users_google_sub_key', 'unique', ['google_sub'], null, null, null, null, null],
      ['users_language_check', 'check', ['language'], "language IN ('en', 'km')", null, null, null, null],
      ['users_pkey', 'primary key', ['id'], null, null, null, null, null],
    ],
    indexes: [
      ['idx_users_email_unique', true, 'btree', ['email'], null, true, true],
      ['idx_users_facebook_sub_unique', true, 'btree', ['facebook_sub'], 'facebook_sub IS NOT NULL', true, true],
      ['idx_users_phone_number_unique', true, 'btree', ['phone_number'], 'phone_number IS NOT NULL', true, true],
      ['idx_users_telegram_sub_unique', true, 'btree', ['telegram_sub'], 'telegram_sub IS NOT NULL', true, true],
    ],
  },
  wallet_authorizations: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.wallet_authorizations_id_seq'],
      ['wallet_id', 'bigint', false, null, null, null],
      ['authorization_type', 'varchar(30)', false, null, null, null],
      ['authorization_scope', 'varchar(50)', false, null, null, null],
      ['authorized_contract_deployment_id', 'bigint', true, null, null, null],
      ['authorized_operator_address', 'character(42)', true, null, null, null],
      ['eip712_domain_name', 'varchar(100)', true, null, null, null],
      ['eip712_domain_version', 'varchar(50)', true, null, null, null],
      ['authorization_reference', 'varchar(255)', false, null, null, null],
      ['authorization_nonce', 'numeric(78,0)', true, null, null, null],
      ['payload_hash', 'character(66)', false, null, null, null],
      ['signature_hash', 'character(66)', true, null, null, null],
      ['valid_from', 'timestamp with time zone', false, 'now()', null, null],
      ['expires_at', 'timestamp with time zone', false, null, null, null],
      ['revoked_at', 'timestamp with time zone', true, null, null, null],
      ['authorization_status', 'varchar(20)', false, "'PENDING'", null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
    ],
    constraints: [
      ['wallet_authorizations_contract_deployment_id_fkey', 'foreign key', ['authorized_contract_deployment_id'], null, 'public.contract_deployments', ['id'], 'restrict', 'no action'],
      ['wallet_authorizations_domain_pair_check', 'check', ['eip712_domain_name', 'eip712_domain_version'], '(eip712_domain_name IS NULL) = (eip712_domain_version IS NULL)', null, null, null, null],
      ['wallet_authorizations_eip712_domain_check', 'check', ['authorization_type', 'eip712_domain_name'], "authorization_type <> 'EIP712_SIGNATURE' OR eip712_domain_name IS NOT NULL", null, null, null, null],
      ['wallet_authorizations_expired_metadata_check', 'check', ['authorization_status', 'expires_at'], "authorization_status <> 'EXPIRED' OR expires_at IS NOT NULL", null, null, null, null],
      ['wallet_authorizations_nonce_check', 'check', ['authorization_nonce'], 'authorization_nonce IS NULL OR authorization_nonce >= 0::numeric', null, null, null, null],
      ['wallet_authorizations_operator_address_check', 'check', ['authorized_operator_address'], "authorized_operator_address IS NULL OR authorized_operator_address ~ '^0x[0-9a-f]{40}$' AND authorized_operator_address = lower(authorized_operator_address)", null, null, null, null],
      ['wallet_authorizations_operator_check', 'check', ['authorized_contract_deployment_id', 'authorized_operator_address'], 'num_nonnulls(authorized_contract_deployment_id, authorized_operator_address) = 1', null, null, null, null],
      ['wallet_authorizations_payload_hash_check', 'check', ['payload_hash'], "payload_hash ~ '^0x[0-9a-f]{64}$'", null, null, null, null],
      ['wallet_authorizations_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['wallet_authorizations_revocation_check', 'check', ['authorization_status', 'revoked_at'], "(authorization_status = 'REVOKED') = (revoked_at IS NOT NULL)", null, null, null, null],
      ['wallet_authorizations_scope_check', 'check', ['authorization_scope'], "authorization_scope IN ('ORDER_SIGNING', 'TRADE_SETTLEMENT', 'CTF_OPERATIONS', 'REDEMPTION')", null, null, null, null],
      ['wallet_authorizations_signature_hash_check', 'check', ['signature_hash'], "signature_hash IS NULL OR signature_hash ~ '^0x[0-9a-f]{64}$'", null, null, null, null],
      ['wallet_authorizations_status_check', 'check', ['authorization_status'], "authorization_status IN ('PENDING', 'VERIFIED', 'REVOKED', 'EXPIRED')", null, null, null, null],
      ['wallet_authorizations_type_check', 'check', ['authorization_type'], "authorization_type IN ('EIP712_SIGNATURE', 'ONCHAIN_APPROVAL', 'SESSION_POLICY')", null, null, null, null],
      ['wallet_authorizations_validity_check', 'check', ['expires_at', 'valid_from'], 'expires_at > valid_from', null, null, null, null],
      ['wallet_authorizations_verified_metadata_check', 'check', ['authorization_status', 'signature_hash'], "authorization_status <> 'VERIFIED' OR signature_hash IS NOT NULL", null, null, null, null],
      ['wallet_authorizations_wallet_id_fkey', 'foreign key', ['wallet_id'], null, 'public.user_wallets', ['id'], 'restrict', 'no action'],
      ['wallet_authorizations_wallet_reference_key', 'unique', ['wallet_id', 'authorization_reference'], null, null, null, null, null],
    ],
    indexes: [
      ['idx_wallet_authorizations_expiry', false, 'btree', ['authorization_status', 'expires_at'], null, true, true],
      ['idx_wallet_authorizations_verified_contract_unique', true, 'btree', ['wallet_id', 'authorization_type', 'authorization_scope', 'authorized_contract_deployment_id'], "authorization_status = 'VERIFIED' AND authorized_contract_deployment_id IS NOT NULL", true, true],
      ['idx_wallet_authorizations_verified_operator_unique', true, 'btree', ['wallet_id', 'authorization_type', 'authorization_scope', 'authorized_operator_address'], "authorization_status = 'VERIFIED' AND authorized_operator_address IS NOT NULL", true, true],
      ['idx_wallet_authorizations_wallet_status', false, 'btree', ['wallet_id', 'authorization_status'], null, true, true],
    ],
  },
  wallets: {
    columns: [
      ['id', 'bigint', false, null, 'ALWAYS', 'public.wallets_id_seq'],
      ['user_id', 'bigint', false, null, null, null],
      ['balance_minor', 'bigint', false, '0', null, null],
      ['currency', 'varchar(3)', false, "'KHR'", null, null],
      ['created_at', 'timestamp with time zone', false, 'now()', null, null],
      ['updated_at', 'timestamp with time zone', false, 'now()', null, null],
      ['usd_balance_minor', 'bigint', false, '0', null, null],
    ],
    constraints: [
      ['wallets_balance_minor_check', 'check', ['balance_minor'], 'balance_minor >= 0', null, null, null, null],
      ['wallets_currency_check', 'check', ['currency'], "currency = 'KHR'", null, null, null, null],
      ['wallets_pkey', 'primary key', ['id'], null, null, null, null, null],
      ['wallets_usd_balance_minor_nonnegative', 'check', ['usd_balance_minor'], 'usd_balance_minor >= 0', null, null, null, null],
      ['wallets_user_id_fkey', 'foreign key', ['user_id'], null, 'public.users', ['id'], 'cascade', 'no action'],
      ['wallets_user_id_key', 'unique', ['user_id'], null, null, null, null, null],
    ],
    indexes: [],
  },
}
const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageDir = join(scriptDir, '..')
const migrationsDir = join(packageDir, 'migrations')
const journalPath = join(migrationsDir, 'meta', '_journal.json')
const expectedMigrationTags = [
  '0000_fat_shen',
  '0001_powerful_katie_power',
  '0002_bouncy_glorian',
  '0003_tidy_ricochet',
  '0004_giant_trish_tilby',
  '0005_mysterious_mojo',
]

function fail(message) {
  throw new Error(message)
}

function runOfflineValidator() {
  const result = spawnSync(
    process.execPath,
    [join(scriptDir, 'validateBaseline.js')],
    { stdio: 'inherit', env: process.env },
  )

  if (result.error) fail(`offline baseline validator failed: ${result.error.message}`)
  if (result.status !== 0) fail('offline baseline validator rejected the artifacts')
}

function readMigrationMetadata() {
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  const entries = journal.entries

  if (
    entries?.length !== expectedMigrationTags.length
    || entries.some((entry, index) => (
      entry.idx !== index
      || entry.tag !== expectedMigrationTags[index]
      || entry.version !== '7'
      || !Number.isSafeInteger(entry.when)
      || entry.when <= 0
      || entry.breakpoints !== true
    ))
  ) {
    fail('migration journal does not contain the expected ordered entries')
  }

  return entries.map((entry, index) => ({
    hash: createHash('sha256')
      .update(readFileSync(
        join(migrationsDir, `${expectedMigrationTags[index]}.sql`),
        'utf8',
      ))
      .digest('hex'),
    timestamp: String(entry.when),
  }))
}

function readConnectionUrl() {
  const value = process.env.MIGRATION_TEST_DATABASE_URL?.trim()
  if (!value) fail('MIGRATION_TEST_DATABASE_URL is required')

  let url
  try {
    url = new URL(value)
  } catch {
    fail('MIGRATION_TEST_DATABASE_URL must be a valid PostgreSQL URL')
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    fail('MIGRATION_TEST_DATABASE_URL must use PostgreSQL')
  }

  const allowedCiHost = process.env.MIGRATION_TEST_CI_HOST?.trim()
  if (allowedCiHost && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(allowedCiHost)) {
    fail('MIGRATION_TEST_CI_HOST must be a single-label CI service host')
  }
  const ciHostAllowed = process.env.CI === 'true'
    && allowedCiHost
    && url.hostname === allowedCiHost

  if (!localHosts.has(url.hostname) && !ciHostAllowed) {
    fail('migration test host is not an allowed local or configured CI host')
  }

  if (decodeURIComponent(url.pathname.slice(1)) !== databaseName) {
    fail(`migration test database must be ${databaseName}`)
  }

  return value
}

async function inspectConnection(pool) {
  const result = await pool.query(`
    SELECT
      current_database() AS database_name,
      current_setting('server_version_num') AS version_number,
      current_setting('search_path') AS search_path,
      current_schemas(false)::text[] AS active_schemas
  `)
  const state = result.rows[0]

  if (state.database_name !== databaseName) {
    fail(`connected database must be ${databaseName}`)
  }
  if (Math.floor(Number(state.version_number) / 10000) !== 16) {
    fail('migration tests require PostgreSQL major version 16')
  }
  if (!['"$user", public', 'public'].includes(state.search_path)) {
    fail('database has an unexpected search_path')
  }
  if (JSON.stringify(state.active_schemas) !== JSON.stringify(['public'])) {
    fail('database resolves an unexpected active schema')
  }
}

async function assertEmptyDatabase(pool) {
  const schemas = await pool.query(`
    SELECT nspname
    FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_%'
      AND nspname <> 'information_schema'
    ORDER BY nspname
  `)
  const schemaNames = schemas.rows.map((row) => row.nspname)
  if (JSON.stringify(schemaNames) !== JSON.stringify(['public'])) {
    fail('database contains an unexpected user schema')
  }

  const tables = await pool.query(`
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY schemaname, tablename
  `)
  if (tables.rowCount !== 0) fail('migration test database is not empty')

  const history = await pool.query(`
    SELECT to_regclass('drizzle.__drizzle_migrations') AS history_table
  `)
  if (history.rows[0].history_table !== null) {
    fail('Drizzle migration history already exists')
  }
}

async function readApplicationTables(pool) {
  const result = await pool.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `)
  return result.rows.map((row) => row.tablename)
}

function stripOuterParentheses(value) {
  let result = value.trim()

  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0
    let wrapsExpression = true

    for (let index = 0; index < result.length; index += 1) {
      if (result[index] === '(') depth += 1
      if (result[index] === ')') depth -= 1
      if (depth === 0 && index < result.length - 1) {
        wrapsExpression = false
        break
      }
    }

    if (!wrapsExpression) break
    result = result.slice(1, -1).trim()
  }

  return result
}

function stripRedundantAtomicPredicateParentheses(value) {
  return value
    .replace(
      /\(\s*([a-z_][a-z0-9_]*\s+IS\s+NULL)\s*\)/gi,
      '$1',
    )
    .replace(
      /\(\s*([a-z_][a-z0-9_]*\s*~\s*'(?:''|[^'])*')\s*\)/gi,
      '$1',
    )
}

function splitTopLevelBoolean(value, operator) {
  const separator = ` ${operator} `
  const parts = []
  let depth = 0
  let quoted = false
  let start = 0

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]

    if (character === "'") {
      if (quoted && value[index + 1] === "'") {
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (quoted) continue
    if (character === '(') depth += 1
    if (character === ')') depth -= 1

    if (depth === 0 && value.startsWith(separator, index)) {
      parts.push(value.slice(start, index).trim())
      index += separator.length - 1
      start = index + 1
    }
  }

  if (parts.length === 0) return [value]
  parts.push(value.slice(start).trim())
  return parts
}

function parseBooleanExpression(value) {
  const expression = stripOuterParentheses(value)

  for (const operator of ['OR', 'AND']) {
    const parts = splitTopLevelBoolean(expression, operator)
    if (parts.length > 1) {
      return {
        operator,
        parts: parts
          .map(parseBooleanExpression)
          .flatMap((part) => (
            part.operator === operator ? part.parts : [part]
          )),
      }
    }
  }

  return { value: stripOuterParentheses(expression) }
}

function serializeBooleanExpression(expression) {
  if (expression.value !== undefined) return expression.value
  return `${expression.operator}(${expression.parts
    .map(serializeBooleanExpression)
    .join(',')})`
}

function normalizeExpression(value) {
  if (value === null) return null

  let result = value
    .replace(/"[a-z_][a-z0-9_]*"\./gi, '')
    .replace(/"([a-z_][a-z0-9_]*)"/gi, '$1')
    .replace(/::(?:character varying|text)(?:\[\])?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  result = stripOuterParentheses(result)
    .replace(
      /=\s*ANY\s*\(\s*\(*\s*ARRAY\[(.*?)\]\s*\)*\s*\)/gi,
      'IN ($1)',
    )

  result = stripRedundantAtomicPredicateParentheses(result)

  return serializeBooleanExpression(parseBooleanExpression(result))
}

function normalizeConstraintExpressions(schema) {
  return {
    ...schema,
    constraints: schema.constraints.map((constraint) => {
      const normalized = [...constraint]
      normalized[3] = normalizeExpression(normalized[3])
      return normalized
    }),
  }
}

function detailedSchemasEqual(expected, actual) {
  return JSON.stringify(normalizeConstraintExpressions(expected))
    === JSON.stringify(normalizeConstraintExpressions(actual))
}

function mapConstraintRow(constraint) {
  return [
    constraint.name,
    constraint.constraint_type,
    constraint.columns,
    constraint.expression,
    constraint.referenced_table,
    constraint.referenced_columns.length > 0
      ? constraint.referenced_columns
      : null,
    constraint.on_delete,
    constraint.on_update,
  ]
}

function testExpressionNormalization() {
  const parenthesized =
    "(status_access_token_hash IS NULL) OR (status_access_token_hash ~ '^[a-f0-9]{64}$')"
  const unparenthesized =
    "status_access_token_hash IS NULL OR status_access_token_hash ~ '^[a-f0-9]{64}$'"

  assert.equal(
    normalizeExpression(parenthesized),
    normalizeExpression(unparenthesized),
  )

  const groupedOr =
    "(status_access_token_hash IS NULL OR status_access_token_hash ~ 'x') AND paid_at IS NULL"
  const ungroupedOr =
    "status_access_token_hash IS NULL OR status_access_token_hash ~ 'x' AND paid_at IS NULL"
  const groupedAnd =
    "status_access_token_hash IS NULL OR (status_access_token_hash ~ 'x' AND paid_at IS NULL)"

  assert.notEqual(
    normalizeExpression(groupedOr),
    normalizeExpression(ungroupedOr),
  )
  assert.notEqual(
    normalizeExpression(groupedOr),
    normalizeExpression(groupedAnd),
  )
  assert.match(normalizeExpression(groupedOr), /^AND\(OR\(/)
  assert.match(normalizeExpression(groupedAnd), /^OR\(.*AND\(/)

  const deploymentExpected =
    "deployment_status = 'PLANNED' AND contract_address IS NULL "
    + "OR deployment_status = 'PENDING' AND deployment_tx_hash IS NOT NULL "
    + "OR deployment_status IN ('CONFIRMED', 'RETIRED') "
    + "AND contract_address IS NOT NULL OR deployment_status = 'FAILED'"
  const deploymentCatalog =
    "(deployment_status = 'PLANNED' AND contract_address IS NULL) "
    + "OR ((deployment_status = 'PENDING' AND deployment_tx_hash IS NOT NULL) "
    + "OR (deployment_status IN ('CONFIRMED', 'RETIRED') "
    + "AND contract_address IS NOT NULL OR deployment_status = 'FAILED'))"

  assert.equal(
    normalizeExpression(deploymentExpected),
    normalizeExpression(deploymentCatalog),
  )

  const versionExpression = 'length(btrim(contract_version)) > 0'
  assert.equal(normalizeExpression(versionExpression), versionExpression)
  assert.match(normalizeExpression(versionExpression), /btrim\(contract_version\)/)

  const schemaWithExpression = (expression) => ({
    columns: [],
    constraints: [[
      'transactions_status_access_token_hash_check',
      'check',
      ['status_access_token_hash'],
      expression,
      null,
      null,
      null,
      null,
    ]],
    indexes: [],
  })

  assert.equal(
    detailedSchemasEqual(
      schemaWithExpression(parenthesized),
      schemaWithExpression(unparenthesized),
    ),
    true,
  )
  assert.equal(
    detailedSchemasEqual(
      schemaWithExpression(groupedOr),
      schemaWithExpression(ungroupedOr),
    ),
    false,
  )
  assert.equal(
    detailedSchemasEqual(
      schemaWithExpression(groupedOr),
      schemaWithExpression(groupedAnd),
    ),
    false,
  )
  assert.equal(
    detailedSchemasEqual(
      schemaWithExpression(unparenthesized),
      schemaWithExpression(
        "status_access_token_hash IS NULL AND status_access_token_hash ~ '^[a-f0-9]{64}$'",
      ),
    ),
    false,
  )
  assert.equal(
    detailedSchemasEqual(
      schemaWithExpression(deploymentExpected),
      schemaWithExpression(deploymentCatalog),
    ),
    true,
  )
  assert.equal(
    detailedSchemasEqual(
      schemaWithExpression(deploymentExpected),
      schemaWithExpression(
        "deployment_status = 'PLANNED' AND (contract_address IS NULL "
        + "OR deployment_status = 'PENDING') "
        + "AND deployment_tx_hash IS NOT NULL "
        + "OR deployment_status = 'FAILED'",
      ),
    ),
    false,
  )

  const rawCatalogConstraint = mapConstraintRow({
    name: 'contract_deployments_metadata_check',
    constraint_type: 'check',
    columns: [
      'deployment_status',
      'contract_address',
      'deployment_tx_hash',
    ],
    expression: deploymentCatalog,
    referenced_table: null,
    referenced_columns: [],
    on_delete: null,
    on_update: null,
  })
  const catalogSchema = {
    columns: [],
    constraints: [rawCatalogConstraint],
    indexes: [],
  }
  const expectedCatalogSchema = {
    columns: [],
    constraints: [[
      'contract_deployments_metadata_check',
      'check',
      ['deployment_status', 'contract_address', 'deployment_tx_hash'],
      deploymentExpected,
      null,
      null,
      null,
      null,
    ]],
    indexes: [],
  }

  assert.equal(rawCatalogConstraint[3], deploymentCatalog)
  assert.equal(detailedSchemasEqual(expectedCatalogSchema, catalogSchema), true)
}

function normalizeType(value) {
  return value.replace(/^character varying/, 'varchar')
}

async function readDetailedSchema(pool, tableName) {
  const columns = await pool.query(`
    SELECT
      a.attname AS name,
      format_type(a.atttypid, a.atttypmod) AS data_type,
      NOT a.attnotnull AS nullable,
      pg_get_expr(d.adbin, d.adrelid, true) AS default_value,
      CASE a.attidentity WHEN 'a' THEN 'ALWAYS' WHEN 'd' THEN 'BY DEFAULT' END AS identity_generation,
      CASE WHEN a.attidentity <> ''
        THEN pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname)
      END AS identity_sequence
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relname = $1
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
  `, [tableName])

  const constraints = await pool.query(`
    SELECT
      x.conname AS name,
      CASE x.contype
        WHEN 'p' THEN 'primary key'
        WHEN 'u' THEN 'unique'
        WHEN 'c' THEN 'check'
        WHEN 'f' THEN 'foreign key'
      END AS constraint_type,
      COALESCE((
        SELECT array_agg(a.attname ORDER BY key.ordinality)
        FROM unnest(x.conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid = x.conrelid AND a.attnum = key.attnum
      ), ARRAY[]::name[])::text[] AS columns,
      CASE WHEN x.contype = 'c' THEN pg_get_expr(x.conbin, x.conrelid, true) END AS expression,
      CASE WHEN x.contype = 'f' THEN format('%I.%I', rn.nspname, rc.relname) END AS referenced_table,
      COALESCE((
        SELECT array_agg(a.attname ORDER BY key.ordinality)
        FROM unnest(x.confkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid = x.confrelid AND a.attnum = key.attnum
      ), ARRAY[]::name[])::text[] AS referenced_columns,
      CASE x.confdeltype
        WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade'
        WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default'
      END AS on_delete,
      CASE x.confupdtype
        WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade'
        WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default'
      END AS on_update
    FROM pg_constraint x
    JOIN pg_class c ON c.oid = x.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_class rc ON rc.oid = x.confrelid
    LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = $1
    ORDER BY x.conname
  `, [tableName])

  const indexes = await pool.query(`
    SELECT
      ic.relname AS name,
      i.indisunique AS is_unique,
      am.amname AS method,
      ARRAY(
        SELECT
          pg_get_indexdef(i.indexrelid, keys.position, true)
          || CASE
            WHEN am.amname = 'btree'
              AND (i.indoption[keys.position - 1] & 1) = 1
              THEN ' DESC'
            ELSE ''
          END
          || CASE
            WHEN am.amname = 'btree'
              AND (i.indoption[keys.position - 1] & 1) = 0
              AND (i.indoption[keys.position - 1] & 2) = 2
              THEN ' NULLS FIRST'
            WHEN am.amname = 'btree'
              AND (i.indoption[keys.position - 1] & 1) = 1
              AND (i.indoption[keys.position - 1] & 2) = 0
              THEN ' NULLS LAST'
            ELSE ''
          END
        FROM generate_series(1, i.indnkeyatts) AS keys(position)
        ORDER BY keys.position
      ) AS columns,
      pg_get_expr(i.indpred, i.indrelid, true) AS predicate,
      i.indisvalid AS is_valid,
      i.indisready AS is_ready
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_am am ON am.oid = ic.relam
    WHERE n.nspname = 'public'
      AND c.relname = $1
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint x WHERE x.conindid = i.indexrelid
      )
    ORDER BY ic.relname
  `, [tableName])

  return {
    columns: columns.rows.map((column) => [
      column.name,
      normalizeType(column.data_type),
      column.nullable,
      normalizeExpression(column.default_value),
      column.identity_generation,
      column.identity_sequence,
    ]),
    constraints: constraints.rows.map(mapConstraintRow),
    indexes: indexes.rows.map((index) => [
      index.name,
      index.is_unique,
      index.method,
      index.columns.map(normalizeExpression),
      normalizeExpression(index.predicate),
      index.is_valid,
      index.is_ready,
    ]),
  }
}

async function assertDetailedSchemas(pool) {
  for (const [tableName, expected] of Object.entries(expectedDetailedSchemas)) {
    const actual = await readDetailedSchema(pool, tableName)
    if (!detailedSchemasEqual(expected, actual)) {
      fail(
        `${tableName} catalog metadata mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      )
    }
  }
}

async function expectConstraintFailure(
  pool,
  label,
  expectedConstraint,
  query,
  values,
) {
  await pool.query('SAVEPOINT reference_constraint_test')
  try {
    await pool.query(query, values)
  } catch (error) {
    await pool.query('ROLLBACK TO SAVEPOINT reference_constraint_test')
    await pool.query('RELEASE SAVEPOINT reference_constraint_test')
    if (error.constraint !== expectedConstraint) {
      fail(
        `${label} failed with ${error.constraint ?? error.code}, expected ${expectedConstraint}`,
      )
    }
    return
  }

  await pool.query('ROLLBACK TO SAVEPOINT reference_constraint_test')
  await pool.query('RELEASE SAVEPOINT reference_constraint_test')
  fail(`${label} was accepted`)
}

async function expectDatabaseFailure(pool, label, messagePart, query, values = []) {
  await pool.query('SAVEPOINT market_workflow_test')
  try {
    await pool.query(query, values)
  } catch (error) {
    await pool.query('ROLLBACK TO SAVEPOINT market_workflow_test')
    await pool.query('RELEASE SAVEPOINT market_workflow_test')
    if (!error.message.includes(messagePart)) {
      fail(`${label} failed with an unexpected database error`)
    }
    return
  }

  await pool.query('ROLLBACK TO SAVEPOINT market_workflow_test')
  await pool.query('RELEASE SAVEPOINT market_workflow_test')
  fail(`${label} was accepted`)
}

async function assertBinaryMarketConstraints(pool) {
  await pool.query('BEGIN')
  try {
    const category = await pool.query(`
      INSERT INTO market_categories (name, slug)
      VALUES ('Economy', 'economy')
      RETURNING id
    `)
    const categoryId = category.rows[0].id

    await expectDatabaseFailure(
      pool,
      'market created outside draft workflow',
      'market must be created in an unfrozen draft state',
      `INSERT INTO markets (
        category_id,
        slug,
        title,
        description,
        lifecycle_status,
        trading_starts_at,
        trading_ends_at,
        resolution_deadline,
        terms_hash,
        terms_frozen_at
      ) VALUES (
        $1,
        'invalid-active-market',
        'Invalid active market',
        'This insert must be rejected.',
        'ACTIVE',
        now() + interval '1 hour',
        now() + interval '2 hours',
        now() + interval '3 hours',
        $2,
        now()
      )`,
      [categoryId, `0x${'b'.repeat(64)}`],
    )

    const market = await pool.query(`
      INSERT INTO markets (
        category_id,
        slug,
        title,
        description,
        trading_starts_at,
        trading_ends_at,
        resolution_deadline
      ) VALUES (
        $1,
        'binary-market-test',
        'Will the test condition occur?',
        'Disposable binary market test.',
        now() + interval '1 hour',
        now() + interval '2 hours',
        now() + interval '3 hours'
      ) RETURNING id
    `, [categoryId])
    const marketId = market.rows[0].id
    const question = await pool.query(`
      INSERT INTO market_questions (
        market_id,
        question_text,
        resolution_rules,
        resolution_source
      ) VALUES (
        $1,
        'Will the test condition occur?',
        'Resolve YES only when the documented condition occurs.',
        'Disposable test evidence.'
      ) RETURNING id
    `, [marketId])
    const questionId = question.rows[0].id
    const termsHash = `0x${'a'.repeat(64)}`

    await expectDatabaseFailure(
      pool,
      'freeze without two outcomes',
      'binary market requires exactly two outcomes',
      `UPDATE markets
       SET terms_hash = $2, terms_frozen_at = now()
       WHERE id = $1`,
      [marketId, termsHash],
    )

    await expectConstraintFailure(
      pool,
      'invalid YES/NO index mapping',
      'market_outcomes_binary_pair_check',
      `INSERT INTO market_outcomes (
        market_id, question_id, outcome_index, outcome_label
      ) VALUES ($1, $2, 0, 'NO')`,
      [marketId, questionId],
    )

    await pool.query(`
      INSERT INTO market_outcomes (
        market_id, question_id, outcome_index, outcome_label
      ) VALUES ($1, $2, 0, 'YES'), ($1, $2, 1, 'NO')
    `, [marketId, questionId])

    await expectConstraintFailure(
      pool,
      'duplicate outcome index',
      'market_outcomes_question_index_key',
      `INSERT INTO market_outcomes (
        market_id, question_id, outcome_index, outcome_label
      ) VALUES ($1, $2, 0, 'YES')`,
      [marketId, questionId],
    )

    await pool.query(`
      UPDATE markets
      SET lifecycle_status = 'REVIEW'
      WHERE id = $1
    `, [marketId])
    await pool.query(`
      UPDATE markets
      SET
        terms_hash = $2,
        terms_frozen_at = now(),
        lifecycle_status = 'SCHEDULED'
      WHERE id = $1
    `, [marketId, termsHash])

    await expectDatabaseFailure(
      pool,
      'frozen market title change',
      'frozen market terms cannot be changed',
      'UPDATE markets SET title = $2 WHERE id = $1',
      [marketId, 'Changed title'],
    )
    await expectDatabaseFailure(
      pool,
      'frozen outcome change',
      'frozen market questions and outcomes cannot be changed',
      `UPDATE market_outcomes
       SET updated_at = now() + interval '1 second'
       WHERE market_id = $1`,
      [marketId],
    )

    await expectDatabaseFailure(
      pool,
      'backward market lifecycle transition',
      'invalid market lifecycle transition',
      "UPDATE markets SET lifecycle_status = 'REVIEW' WHERE id = $1",
      [marketId],
    )
    await pool.query(`
      UPDATE markets
      SET lifecycle_status = 'ACTIVE', trading_status = 'OPEN'
      WHERE id = $1
    `, [marketId])
    await expectDatabaseFailure(
      pool,
      'backward market trading transition',
      'invalid market trading transition',
      "UPDATE markets SET trading_status = 'NOT_STARTED' WHERE id = $1",
      [marketId],
    )
    await pool.query(`
      UPDATE markets SET trading_status = 'CLOSED' WHERE id = $1
    `, [marketId])
    await pool.query(`
      UPDATE markets SET resolution_status = 'PENDING' WHERE id = $1
    `, [marketId])
    await pool.query(`
      UPDATE markets SET resolution_status = 'RESOLVED' WHERE id = $1
    `, [marketId])
    await pool.query(`
      UPDATE markets SET lifecycle_status = 'ARCHIVED' WHERE id = $1
    `, [marketId])
  } finally {
    await pool.query('ROLLBACK')
  }
}

async function assertReferenceConstraints(pool) {
  await pool.query('BEGIN')
  try {
    await pool.query(`
      INSERT INTO chains (
        chain_id,
        name,
        environment,
        native_symbol,
        rpc_config_reference
      ) VALUES (84532, 'Base Sepolia', 'testnet', 'ETH', 'BASE_SEPOLIA_RPC_URL')
    `)

    await expectConstraintFailure(
      pool,
      'invalid chain id',
      'chains_chain_id_positive',
      `INSERT INTO chains (
        chain_id,
        name,
        environment,
        native_symbol
      ) VALUES ($1, $2, 'testnet', 'ETH')`,
      ['-1', 'Invalid Chain'],
    )

    const assetValues = [
      '84532',
      `0x${'1'.repeat(40)}`,
      'MOCK_USDC',
      'Mock USD Coin',
      6,
      'ERC20',
    ]
    await pool.query(`
      INSERT INTO chain_assets (
        chain_id,
        contract_address,
        symbol,
        name,
        decimals,
        asset_type
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, assetValues)

    await expectConstraintFailure(
      pool,
      'malformed asset address',
      'chain_assets_contract_address_check',
      `INSERT INTO chain_assets (
        chain_id,
        contract_address,
        symbol,
        name,
        decimals,
        asset_type
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      ['84532', '0x1234', 'BAD', 'Bad Address', 6, 'ERC20'],
    )

    await expectConstraintFailure(
      pool,
      'duplicate asset identity',
      'chain_assets_chain_address_key',
      `INSERT INTO chain_assets (
        chain_id,
        contract_address,
        symbol,
        name,
        decimals,
        asset_type
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      assetValues,
    )

    await expectConstraintFailure(
      pool,
      'unknown asset chain',
      'chain_assets_chain_id_fkey',
      `INSERT INTO chain_assets (
        chain_id,
        contract_address,
        symbol,
        name,
        decimals,
        asset_type
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      ['999999', `0x${'2'.repeat(40)}`, 'UNKNOWN', 'Unknown', 6, 'ERC20'],
    )

    await expectConstraintFailure(
      pool,
      'invalid deployment metadata',
      'contract_deployments_metadata_check',
      `INSERT INTO contract_deployments (
        chain_id,
        contract_role,
        contract_version,
        deployment_status
      ) VALUES (84532, 'GNOSIS_CTF', '1.0.0', 'CONFIRMED')`,
      [],
    )
  } finally {
    await pool.query('ROLLBACK')
  }
}

async function assertWalletIdentityConstraints(pool) {
  const user = await pool.query(`
    INSERT INTO users (email, display_name)
    VALUES ('wallet-owner@example.test', 'Wallet Owner')
    RETURNING id
  `)
  const userId = user.rows[0].id
  await pool.query(`
    INSERT INTO chains (chain_id, name, environment, native_symbol)
    VALUES (84532, 'Base Sepolia Wallet Test', 'testnet', 'ETH')
  `)

  const address = `0x${'a'.repeat(40)}`
  const verifiedAt = new Date().toISOString()
  const wallet = await pool.query(`
    INSERT INTO user_wallets (
      user_id,
      chain_id,
      wallet_address,
      wallet_type,
      ownership_verification_status,
      ownership_verified_at,
      is_primary,
      wallet_status
    ) VALUES ($1, 84532, $2, 'SMART_ACCOUNT', 'VERIFIED', $3, true, 'ACTIVE')
    RETURNING id
  `, [userId, address, verifiedAt])
  const walletId = wallet.rows[0].id

  await expectDatabaseFailure(
    pool,
    'wallet ownership reassignment',
    'blockchain wallet ownership identity cannot be reassigned',
    'UPDATE user_wallets SET user_id = user_id + 1 WHERE id = $1',
    [walletId],
  )

  await expectConstraintFailure(
    pool,
    'invalid wallet address',
    'user_wallets_address_check',
    `INSERT INTO user_wallets (
      user_id, chain_id, wallet_address, wallet_type
    ) VALUES ($1, 84532, '0x1234', 'EOA')`,
    [userId],
  )
  await expectConstraintFailure(
    pool,
    'duplicate wallet address on one chain',
    'user_wallets_chain_address_key',
    `INSERT INTO user_wallets (
      user_id, chain_id, wallet_address, wallet_type
    ) VALUES ($1, 84532, $2, 'EOA')`,
    [userId, address],
  )
  await expectConstraintFailure(
    pool,
    'multiple active primary wallets',
    'idx_user_wallets_active_primary_unique',
    `INSERT INTO user_wallets (
      user_id, chain_id, wallet_address, wallet_type,
      ownership_verification_status, ownership_verified_at,
      is_primary, wallet_status
    ) VALUES ($1, 84532, $2, 'EOA', 'VERIFIED', $3, true, 'ACTIVE')`,
    [userId, `0x${'b'.repeat(40)}`, verifiedAt],
  )
  await expectConstraintFailure(
    pool,
    'unknown wallet user',
    'user_wallets_user_id_fkey',
    `INSERT INTO user_wallets (
      user_id, chain_id, wallet_address, wallet_type
    ) VALUES (999999999, 84532, $1, 'EOA')`,
    [`0x${'c'.repeat(40)}`],
  )

  await pool.query(`
    INSERT INTO chains (chain_id, name, environment, native_symbol)
    VALUES (84533, 'Cross-chain Identity Test', 'testnet', 'ETH')
  `)
  await pool.query(`
    INSERT INTO user_wallets (
      user_id, chain_id, wallet_address, wallet_type
    ) VALUES ($1, 84533, $2, 'EOA')
  `, [userId, address])

  const crossChainDeployment = await pool.query(`
    INSERT INTO contract_deployments (
      chain_id, contract_role, contract_version
    ) VALUES (84533, 'TEST_OPERATOR', '1')
    RETURNING id
  `)
  await expectDatabaseFailure(
    pool,
    'cross-chain authorization target',
    'wallet authorization target must use the wallet chain',
    `INSERT INTO wallet_authorizations (
      wallet_id, authorization_type, authorization_scope,
      authorized_contract_deployment_id, eip712_domain_name,
      eip712_domain_version, authorization_reference,
      payload_hash, expires_at
    ) VALUES ($1, 'EIP712_SIGNATURE', 'ORDER_SIGNING', $2,
      'KhmerFP Orders', '1', 'cross-chain-authorization', $3,
      now() + interval '10 minutes')`,
    [walletId, crossChainDeployment.rows[0].id, `0x${'8'.repeat(64)}`],
  )

  const authorizationValues = [
    walletId,
    `0x${'d'.repeat(40)}`,
    'wallet-auth-1',
    `0x${'e'.repeat(64)}`,
  ]
  await pool.query(`
    INSERT INTO wallet_authorizations (
      wallet_id,
      authorization_type,
      authorization_scope,
      authorized_operator_address,
      eip712_domain_name,
      eip712_domain_version,
      authorization_reference,
      payload_hash,
      expires_at
    ) VALUES ($1, 'EIP712_SIGNATURE', 'ORDER_SIGNING', $2,
      'KhmerFP Orders', '1', $3, $4,
      now() + interval '10 minutes')
  `, authorizationValues)
  await pool.query(`
    UPDATE wallet_authorizations
    SET
      signature_hash = $2,
      authorization_status = 'VERIFIED',
      updated_at = now()
    WHERE wallet_id = $1 AND authorization_reference = 'wallet-auth-1'
  `, [walletId, `0x${'7'.repeat(64)}`])
  await expectDatabaseFailure(
    pool,
    'verified authorization scope mutation',
    'wallet authorization scope and evidence are immutable',
    `UPDATE wallet_authorizations
     SET authorization_scope = 'TRADE_SETTLEMENT'
     WHERE wallet_id = $1 AND authorization_reference = 'wallet-auth-1'`,
    [walletId],
  )
  await pool.query(`
    UPDATE wallet_authorizations
    SET authorization_status = 'REVOKED', revoked_at = now(), updated_at = now()
    WHERE wallet_id = $1 AND authorization_reference = 'wallet-auth-1'
  `, [walletId])
  await expectDatabaseFailure(
    pool,
    'revoked authorization reactivation',
    'terminal wallet authorization cannot be changed',
    `UPDATE wallet_authorizations
     SET authorization_status = 'VERIFIED', revoked_at = NULL
     WHERE wallet_id = $1 AND authorization_reference = 'wallet-auth-1'`,
    [walletId],
  )
  await expectConstraintFailure(
    pool,
    'invalid authorization status',
    'wallet_authorizations_status_check',
    `INSERT INTO wallet_authorizations (
      wallet_id, authorization_type, authorization_scope,
      authorized_operator_address, eip712_domain_name,
      eip712_domain_version, authorization_reference,
      payload_hash, expires_at, authorization_status
    ) VALUES ($1, 'EIP712_SIGNATURE', 'ORDER_SIGNING', $2,
      'KhmerFP Orders', '1',
      'wallet-auth-invalid-status', $3, now() + interval '10 minutes', 'ACTIVE')`,
    [walletId, `0x${'f'.repeat(40)}`, `0x${'1'.repeat(64)}`],
  )
  await expectConstraintFailure(
    pool,
    'revoked authorization without timestamp',
    'wallet_authorizations_revocation_check',
    `INSERT INTO wallet_authorizations (
      wallet_id, authorization_type, authorization_scope,
      authorized_operator_address, eip712_domain_name,
      eip712_domain_version, authorization_reference,
      payload_hash, expires_at, authorization_status
    ) VALUES ($1, 'EIP712_SIGNATURE', 'ORDER_SIGNING', $2,
      'KhmerFP Orders', '1',
      'wallet-auth-invalid-revocation', $3,
      now() + interval '10 minutes', 'REVOKED')`,
    [walletId, `0x${'2'.repeat(40)}`, `0x${'3'.repeat(64)}`],
  )
  await expectConstraintFailure(
    pool,
    'authorization expiration before validity',
    'wallet_authorizations_validity_check',
    `INSERT INTO wallet_authorizations (
      wallet_id, authorization_type, authorization_scope,
      authorized_operator_address, eip712_domain_name,
      eip712_domain_version, authorization_reference,
      payload_hash, valid_from, expires_at
    ) VALUES ($1, 'EIP712_SIGNATURE', 'ORDER_SIGNING', $2,
      'KhmerFP Orders', '1',
      'wallet-auth-invalid-expiry', $3, now(), now() - interval '1 second')`,
    [walletId, `0x${'4'.repeat(40)}`, `0x${'5'.repeat(64)}`],
  )

  const concurrentAddress = `0x${'6'.repeat(40)}`
  const concurrentInsert = () => pool.query(`
    INSERT INTO user_wallets (
      user_id, chain_id, wallet_address, wallet_type
    ) VALUES ($1, 84532, $2, 'EOA')
  `, [userId, concurrentAddress])
  const concurrentResults = await Promise.allSettled([
    concurrentInsert(),
    concurrentInsert(),
  ])
  const fulfilled = concurrentResults.filter((result) => result.status === 'fulfilled')
  const rejected = concurrentResults.filter((result) => result.status === 'rejected')
  if (
    fulfilled.length !== 1
    || rejected.length !== 1
    || rejected[0].reason?.constraint !== 'user_wallets_chain_address_key'
  ) {
    fail('concurrent wallet registration did not enforce unique chain ownership')
  }
}

function normalizeFunctionBody(value) {
  return value.replace(/\s+/g, ' ').trim()
}

async function assertBakongCompatibilityObjects(pool) {
  const functions = await pool.query(`
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      l.lanname AS language_name,
      format_type(p.prorettype, NULL) AS return_type,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments,
      p.prosrc AS function_body,
      p.provolatile AS volatility,
      p.proisstrict AS is_strict,
      p.prosecdef AS is_security_definer
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND p.proname = 'bakong_payments_fill_amount_minor'
    ORDER BY p.oid
  `)

  if (functions.rowCount !== 1) {
    fail('Bakong compatibility function must exist exactly once')
  }

  const functionMetadata = functions.rows[0]
  const expectedFunctionBody = normalizeFunctionBody(`
    BEGIN
      IF NEW.amount_minor IS NULL THEN
        NEW.amount_minor := CASE
          WHEN NEW.currency = 'KHR' THEN ROUND(NEW.amount)::BIGINT
          ELSE ROUND(NEW.amount * 100)::BIGINT
        END;
      END IF;

      RETURN NEW;
    END;
  `)

  if (
    functionMetadata.schema_name !== 'public'
    || functionMetadata.function_name !== 'bakong_payments_fill_amount_minor'
    || functionMetadata.language_name !== 'plpgsql'
    || functionMetadata.return_type !== 'trigger'
    || functionMetadata.identity_arguments !== ''
    || functionMetadata.volatility !== 'v'
    || functionMetadata.is_strict !== false
    || functionMetadata.is_security_definer !== false
    || normalizeFunctionBody(functionMetadata.function_body)
      !== expectedFunctionBody
  ) {
    fail('Bakong compatibility function metadata does not match')
  }

  const triggers = await pool.query(`
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      t.tgname AS trigger_name,
      t.tgenabled AS enabled,
      t.tgtype AS trigger_type,
      pn.nspname AS function_schema,
      p.proname AS function_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND t.tgname = 'bakong_payments_fill_amount_minor'
    ORDER BY t.oid
  `)

  if (triggers.rowCount !== 1) {
    fail('Bakong compatibility trigger must exist exactly once')
  }

  const triggerMetadata = triggers.rows[0]
  if (
    triggerMetadata.schema_name !== 'public'
    || triggerMetadata.table_name !== 'bakong_payments'
    || triggerMetadata.trigger_name !== 'bakong_payments_fill_amount_minor'
    || triggerMetadata.enabled !== 'O'
    || Number(triggerMetadata.trigger_type) !== 7
    || triggerMetadata.function_schema !== 'public'
    || triggerMetadata.function_name !== 'bakong_payments_fill_amount_minor'
  ) {
    fail('Bakong compatibility trigger metadata does not match')
  }
}

async function assertMarketProtectionObjects(pool) {
  const functions = await pool.query(`
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      l.lanname AS language_name,
      format_type(p.prorettype, NULL) AS return_type,
      p.prosrc AS function_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND p.proname = 'protect_frozen_market_terms'
  `)
  if (functions.rowCount !== 1) {
    fail('market frozen-terms function must exist exactly once')
  }
  const functionMetadata = functions.rows[0]
  if (
    functionMetadata.schema_name !== 'public'
    || functionMetadata.function_name !== 'protect_frozen_market_terms'
    || functionMetadata.language_name !== 'plpgsql'
    || functionMetadata.return_type !== 'trigger'
    || !functionMetadata.function_body.includes('binary_outcome_count <> 2')
    || !functionMetadata.function_body.includes('market must be created in an unfrozen draft state')
    || !functionMetadata.function_body.includes('OLD.terms_frozen_at IS NOT NULL')
    || !functionMetadata.function_body.includes('invalid market lifecycle transition')
    || !functionMetadata.function_body.includes('invalid market trading transition')
    || !functionMetadata.function_body.includes('invalid market resolution transition')
  ) {
    fail('market frozen-terms function metadata does not match')
  }

  const triggers = await pool.query(`
    SELECT
      c.relname AS table_name,
      t.tgname AS trigger_name,
      t.tgenabled AS enabled,
      t.tgtype AS trigger_type,
      p.proname AS function_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND p.proname = 'protect_frozen_market_terms'
    ORDER BY c.relname
  `)
  const actual = triggers.rows.map((trigger) => [
    trigger.table_name,
    trigger.trigger_name,
    trigger.enabled,
    Number(trigger.trigger_type),
    trigger.function_name,
  ])
  const expected = [
    ['market_outcomes', 'market_outcomes_protect_frozen_terms', 'O', 31, 'protect_frozen_market_terms'],
    ['market_questions', 'market_questions_protect_frozen_terms', 'O', 31, 'protect_frozen_market_terms'],
    ['markets', 'markets_protect_frozen_terms', 'O', 31, 'protect_frozen_market_terms'],
  ]
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('market frozen-terms trigger metadata does not match')
  }
}

async function assertWalletIdentityProtectionObjects(pool) {
  const functions = await pool.query(`
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      l.lanname AS language_name,
      format_type(p.prorettype, NULL) AS return_type,
      p.prosrc AS function_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'protect_user_wallet_identity',
        'protect_wallet_authorization_state'
      )
    ORDER BY p.proname
  `)
  if (functions.rowCount !== 2) {
    fail('wallet protection functions must each exist exactly once')
  }
  const authorizationFunction = functions.rows[0]
  const identityFunction = functions.rows[1]
  if (
    authorizationFunction.function_name !== 'protect_wallet_authorization_state'
    || authorizationFunction.language_name !== 'plpgsql'
    || authorizationFunction.return_type !== 'trigger'
    || !authorizationFunction.function_body.includes('NEW.authorization_scope IS DISTINCT FROM OLD.authorization_scope')
    || !authorizationFunction.function_body.includes('invalid wallet authorization transition')
    || !authorizationFunction.function_body.includes('wallet.chain_id = deployment.chain_id')
    || identityFunction.function_name !== 'protect_user_wallet_identity'
    || identityFunction.language_name !== 'plpgsql'
    || identityFunction.return_type !== 'trigger'
    || !identityFunction.function_body.includes('NEW.user_id IS DISTINCT FROM OLD.user_id')
    || !identityFunction.function_body.includes('NEW.chain_id IS DISTINCT FROM OLD.chain_id')
    || !identityFunction.function_body.includes('NEW.wallet_address IS DISTINCT FROM OLD.wallet_address')
  ) {
    fail('wallet protection function metadata does not match')
  }

  const triggers = await pool.query(`
    SELECT
      c.relname AS table_name,
      t.tgname AS trigger_name,
      t.tgenabled AS enabled,
      t.tgtype AS trigger_type,
      p.proname AS function_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND p.proname IN (
        'protect_user_wallet_identity',
        'protect_wallet_authorization_state'
      )
    ORDER BY c.relname
  `)
  const actual = triggers.rows.map((trigger) => [
    trigger.table_name,
    trigger.trigger_name,
    trigger.enabled,
    Number(trigger.trigger_type),
    trigger.function_name,
  ])
  const expected = [
    [
      'user_wallets',
      'user_wallets_protect_identity',
      'O',
      23,
      'protect_user_wallet_identity',
    ],
    [
      'wallet_authorizations',
      'wallet_authorizations_protect_state',
      'O',
      19,
      'protect_wallet_authorization_state',
    ],
  ]
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('wallet identity protection trigger metadata does not match')
  }
}

async function readHistory(pool) {
  const result = await pool.query(`
    SELECT id, hash, created_at::text AS created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY id
  `)
  return result.rows
}

async function schemaFingerprint(pool) {
  const result = await pool.query(`
    SELECT jsonb_build_object(
      'columns', COALESCE((
        SELECT jsonb_agg(to_jsonb(c) ORDER BY c.table_schema, c.table_name, c.ordinal_position)
        FROM information_schema.columns c
        WHERE c.table_schema IN ('public', 'drizzle')
      ), '[]'::jsonb),
      'constraints', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'schema', n.nspname,
          'table', r.relname,
          'name', x.conname,
          'type', x.contype,
          'definition', pg_get_constraintdef(x.oid, true),
          'validated', x.convalidated
        ) ORDER BY n.nspname, r.relname, x.conname)
        FROM pg_constraint x
        JOIN pg_class r ON r.oid = x.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname IN ('public', 'drizzle')
      ), '[]'::jsonb),
      'indexes', COALESCE((
        SELECT jsonb_agg(to_jsonb(i) ORDER BY i.schemaname, i.tablename, i.indexname)
        FROM pg_indexes i
        WHERE i.schemaname IN ('public', 'drizzle')
      ), '[]'::jsonb),
      'sequences', COALESCE((
        SELECT jsonb_agg(to_jsonb(s) ORDER BY s.schemaname, s.sequencename)
        FROM pg_sequences s
        WHERE s.schemaname IN ('public', 'drizzle')
      ), '[]'::jsonb),
      'functions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'schema', n.nspname,
          'name', p.proname,
          'arguments', pg_get_function_identity_arguments(p.oid),
          'result', format_type(p.prorettype, NULL),
          'language', l.lanname,
          'source', p.prosrc,
          'volatility', p.provolatile,
          'strict', p.proisstrict,
          'security_definer', p.prosecdef
        ) ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname IN ('public', 'drizzle')
      ), '[]'::jsonb),
      'triggers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'schema', n.nspname,
          'table', c.relname,
          'name', t.tgname,
          'enabled', t.tgenabled,
          'type', t.tgtype,
          'definition', pg_get_triggerdef(t.oid, true),
          'function_schema', pn.nspname,
          'function_name', p.proname
        ) ORDER BY n.nspname, c.relname, t.tgname)
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_proc p ON p.oid = t.tgfoid
        JOIN pg_namespace pn ON pn.oid = p.pronamespace
        WHERE NOT t.tgisinternal
          AND n.nspname IN ('public', 'drizzle')
      ), '[]'::jsonb)
    ) AS schema_state
  `)

  return createHash('sha256')
    .update(JSON.stringify(result.rows[0].schema_state))
    .digest('hex')
}

function compareLists(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} do not match the expected baseline`)
  }
}

async function main() {
  runOfflineValidator()
  const migrationMetadata = readMigrationMetadata()
  const connectionString = readConnectionUrl()
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000,
    max: 2,
    query_timeout: 30000,
    statement_timeout: 30000,
  })

  try {
    await inspectConnection(pool)
    await assertEmptyDatabase(pool)

    const db = drizzle(pool)
    await migrate(db, { migrationsFolder: migrationsDir })

    compareLists(
      await readApplicationTables(pool),
      expectedTables,
      'application tables',
    )
    await assertDetailedSchemas(pool)
    await assertBakongCompatibilityObjects(pool)
    await assertMarketProtectionObjects(pool)
    await assertWalletIdentityProtectionObjects(pool)
    await assertReferenceConstraints(pool)
    await assertBinaryMarketConstraints(pool)
    await assertWalletIdentityConstraints(pool)

    const firstHistory = await readHistory(pool)
    const expectedHistory = migrationMetadata.map((migration, index) => ({
      id: index + 1,
      hash: migration.hash,
      created_at: migration.timestamp,
    }))
    if (JSON.stringify(firstHistory) !== JSON.stringify(expectedHistory)) {
      fail('Drizzle migration history does not match the ordered migrations')
    }

    const firstFingerprint = await schemaFingerprint(pool)
    await migrate(db, { migrationsFolder: migrationsDir })
    const secondFingerprint = await schemaFingerprint(pool)
    const secondHistory = await readHistory(pool)

    if (JSON.stringify(secondHistory) !== JSON.stringify(firstHistory)) {
      fail('second migration run changed migration history')
    }
    if (secondFingerprint !== firstFingerprint) {
      fail('second migration run changed the schema fingerprint')
    }

    console.log('disposable baseline migration test passed')
  } finally {
    await pool.end()
  }
}

if (process.argv.length === 3 && process.argv[2] === '--test-normalization') {
  testExpressionNormalization()
  console.log('check expression normalization tests passed')
} else {
  main().catch((error) => {
    console.error(`disposable baseline migration test failed: ${error.message}`)
    process.exitCode = 1
  })
}
