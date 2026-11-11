# KhmerFP Blockchain Database Architecture

Status: Stage 2.0 design proposal

Scope: PostgreSQL architecture for payments, markets, trading, Base L2 settlement, and operations

Implementation status: Design only. None of the proposed blockchain tables are implemented.

## 1. Executive summary

KhmerFP will use a hybrid architecture:

- ABA PayWay and Bakong accept local fiat payments.
- PostgreSQL records fiat activity and all internal financial movements in an append-only double-entry ledger.
- USDC on Base is the trading collateral.
- Users sign EIP-712 orders with embedded wallets.
- An off-chain central limit order book (CLOB) matches orders.
- Smart contracts settle matched trades and Gnosis Conditional Tokens Framework (CTF) positions on-chain.
- PostgreSQL stores product configuration, signed order intent, ledger history, settlement state, and indexed blockchain events.
- On-chain state is authoritative for finalized token ownership and redemption.

The first production slice should support one binary YES/NO market, one collateral token, one chain, prefunded treasury conversion, deterministic matching, and testnet settlement. Native categorical CTF conditions should wait until binary settlement and reconciliation are proven.

## 2. Confirmed architecture and proposed decisions

### Confirmed

- PostgreSQL and Drizzle ORM are the primary application database stack.
- Trading collateral is USDC on Base L2.
- Gnosis CTF represents outcome positions.
- Orders are signed off-chain using EIP-712 typed data.
- Matching is off-chain and deterministic.
- Settlement and redemption occur on-chain.
- Custody is hybrid.
- ABA PayWay and Bakong support local payment flows.
- Financial postings must use an append-only double-entry ledger.
- Initial markets use binary YES/NO conditions.
- Independent binary sub-markets are the proposed representation for future range brackets. Each sub-market has its own complete-set relationship; sub-markets do not share one $1 pool.

### Proposed and still requiring approval

- Embedded wallet provider: Privy or Coinbase Smart Wallet.
- Whether users or KhmerFP control wallet recovery and upgrade authority.
- Whether trading USDC is held in user smart wallets, an exchange escrow contract, an omnibus treasury, or a combination.
- The regulated party responsible for KHR/USDC conversion.
- FX quote sources, spreads, expiry, and loss allocation.
- Treasury approval limits and signer policy.
- Oracle signer count, challenge window, and dispute authority.
- Required Base confirmation depth and reorganization policy.
- Whether native categorical CTF conditions will ever be offered.

## 3. Existing database audit

The verified foundation has nine tables. No blockchain, market, CLOB, ledger, treasury, oracle, or settlement tables exist yet.

| Existing table | Direction | Repository evidence | Reason |
|---|---|---|---|
| `users` | REUSE | `server/src/db/authSchema.js` | Stable identity root for payments, wallets, positions, and administration. |
| `sessions` | REUSE | `server/src/db/authSchema.js` | Existing authenticated web sessions remain valid. |
| `user_factors` | REUSE | `server/src/db/authSchema.js` | Existing MFA and identity factors remain useful. |
| `auth_rate_limits` | REUSE | `server/src/db/authSchema.js` | Continue protecting authentication endpoints. Redis may later supplement it. |
| `auth_audit_logs` | REUSE | `server/src/db/authSchema.js` | Continue recording authentication security events. Do not mix it with financial or admin audit trails. |
| `phone_otps` | REUSE | `server/src/db/authSchema.js` | No blockchain-specific change is required. |
| `wallets` | TRANSITION | `server/src/db/authSchema.js`, `server/src/models/wallet.js` | Currently stores mutable KHR and USD balances. It should become a compatibility projection, not the authoritative financial record. |
| `transactions` | REFACTOR LATER | `server/src/config/database.js`, `server/src/models/transaction.js` | Existing ABA PayWay transaction record lacks the complete user-owned ledger and treasury model. Preserve it while introducing unified deposit intents and ledger references. |
| `bakong_payments` | EXTEND LATER | `server/src/db/bakongSchema.js`, `server/src/models/bakongPayment.js` | Good provider evidence and idempotency protections exist, but verified payments currently update `wallets` directly. Future posting must be linked to one ledger transaction. |

Current direct balance updates are transitional. They must not be removed until ledger backfill, reconciliation, dual-read validation, and rollout approval are complete.

Runtime DDL is still present in `server/src/db/authSchema.js`, `server/src/db/bakongSchema.js`, and `server/src/config/database.js`. The Bakong model also performs the current wallet credit in `server/src/models/bakongPayment.js`. Stage 1.6 owns the safe migration-adoption and runtime-DDL retirement plan; this Stage 2.0 design does not change either behavior.

## 4. Database conventions

- Use `BIGINT GENERATED ALWAYS AS IDENTITY` for internal identifiers unless an externally generated ID is required.
- Use application-generated `UUID` values for public order, trade, deposit, withdrawal, and settlement identifiers.
- Use `TIMESTAMPTZ` for all timestamps.
- Store fiat and token amounts as integer minor/raw units. Never use floating-point values.
- Use `NUMERIC(78,0)` for uint256-compatible token and CTF values.
- Use `NUMERIC(38,0)` for ledger amounts.
- Store USDC prices as millionths: `0` to `1_000_000` equals $0.00 to $1.00.
- Store Ethereum addresses as normalized lowercase `VARCHAR(42)` and transaction hashes as lowercase `CHAR(66)`, with format checks.
- Store EIP-712 signatures as `BYTEA` or canonical hex, never as parsed JavaScript numbers.
- Prefer `VARCHAR` plus check constraints for lifecycle states. PostgreSQL enums make controlled status evolution harder.
- Every externally retried command must have an idempotency key or natural unique key.
- Financial and blockchain history is append-only. Corrections use reversing records.
- Mutable projection tables may be rebuilt from their source records.

Table specifications below use this shorthand unless a field says otherwise:

- `id` means `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`; an `id UUID` is application-generated and is the primary key.
- A field named after another table, such as `user_id`, is a `BIGINT NOT NULL` foreign key to that table's `id`, unless explicitly nullable. UUID parents use UUID foreign keys.
- `created_at` and `updated_at` mean `TIMESTAMPTZ NOT NULL`; `created_at` defaults to `now()`. Immutable event tables normally have only `created_at`.
- Lifecycle rows receive a check constraint limiting status to the listed values and an index beginning with `status` when workers scan that lifecycle.
- Historical financial, provider, blockchain-event, match, trade, approval-decision, and audit rows are append-only. Their lifecycle is append-only or correction-by-reversal, even where no mutable status is listed.
- Foreign keys use `ON DELETE RESTRICT` for financial, trading, market, and chain history. User-facing ownership may be anonymized with a separately approved process, never cascaded. Configuration-child rows may use `ON DELETE CASCADE` only before their parent is published and only when a later schema milestone explicitly approves it.
- Every listed uniqueness rule is backed by a PostgreSQL unique constraint or unique index. Every worker lookup described as a queue receives a matching B-tree index.

## 5. Proposed tables

The following tables are proposed, not implemented.

### 5.1 Identity, wallets, and custody

#### `user_wallets`

Purpose: Map a KhmerFP user to an embedded or external Base wallet.

Columns:

- `id BIGINT` primary key.
- `user_id BIGINT NOT NULL` FK to `users(id)`.
- `chain_id BIGINT NOT NULL` FK to `chains(chain_id)`.
- `address VARCHAR(42) NOT NULL`.
- `wallet_type VARCHAR(30) NOT NULL`: `EMBEDDED_EOA`, `SMART_ACCOUNT`, `EXTERNAL`, `CUSTODIAL`.
- `provider VARCHAR(30)`: `PRIVY`, `COINBASE`, or null.
- `provider_wallet_id VARCHAR(255)` nullable external reference.
- `ownership_mode VARCHAR(30) NOT NULL`: `USER`, `PLATFORM`, `SHARED_RECOVERY`.
- `status VARCHAR(20) NOT NULL`: `PENDING`, `ACTIVE`, `SUSPENDED`, `REPLACED`.
- `is_primary BOOLEAN NOT NULL DEFAULT false`.
- `deployed_at TIMESTAMPTZ`, `created_at`, `updated_at`.

Constraints and indexes:

- Unique `(chain_id, address)`.
- Partial unique `(user_id, chain_id) WHERE is_primary AND status = 'ACTIVE'`.
- Index `(user_id, status)`.

Lifecycle: `PENDING -> ACTIVE -> SUSPENDED|REPLACED`.

#### `wallet_authorizations`

Purpose: Record wallet signing and recovery authority without storing private keys.

Columns: `id`, `wallet_id` FK, `authorization_type`, `subject_type`, `subject_reference`, `valid_from`, `valid_until`, `revoked_at`, `metadata JSONB`, timestamps.

Keys and indexes: unique active authorization by `(wallet_id, authorization_type, subject_reference)`; index on expiry.

Important rule: This table stores policy references only. Private keys and raw recovery secrets must never be stored in PostgreSQL.

### 5.2 Chains and contracts

#### `chains`

Purpose: Registry of supported networks.

Columns: `chain_id BIGINT` primary key, `name`, `environment`, `native_symbol`, `finality_confirmations INTEGER`, `enabled BOOLEAN`, `rpc_reference`, timestamps.

Constraints: positive confirmation count; unique `name` per environment.

#### `contract_deployments`

Purpose: Versioned addresses and activation blocks for CTF, exchange, treasury, collateral, and oracle contracts.

Columns: `id`, `chain_id` FK, `contract_role`, `version`, `address`, `deployment_tx_hash`, `deployment_block_number BIGINT`, `abi_hash CHAR(66)`, `active_from_block`, `active_to_block`, timestamps.

Constraints: unique `(chain_id, address)` and `(chain_id, contract_role, version)`; one active deployment per role through a partial unique index.

### 5.3 Double-entry financial ledger

#### `ledger_accounts`

Purpose: Define user, treasury, clearing, fee, FX, and suspense accounts.

Columns:

- `id BIGINT` primary key.
- `owner_type VARCHAR(20) NOT NULL`: `USER`, `TREASURY`, `SYSTEM`.
- `owner_user_id BIGINT` nullable FK to `users`.
- `account_code VARCHAR(80) NOT NULL`.
- `asset_code VARCHAR(20) NOT NULL`: initially `KHR` or `USDC_BASE`.
- `account_type VARCHAR(30) NOT NULL`: `ASSET`, `LIABILITY`, `REVENUE`, `EXPENSE`, `CLEARING`, `SUSPENSE`.
- `normal_side VARCHAR(6) NOT NULL`: `DEBIT` or `CREDIT`.
- `status VARCHAR(20) NOT NULL`, timestamps.

Constraints: unique `(owner_type, owner_user_id, account_code, asset_code)` with explicit system-owner handling; user ownership required for user accounts.

#### `ledger_transactions`

Purpose: One immutable financial business event.

Columns: `id UUID` primary key, `transaction_type`, `reference_type`, `reference_id`, `idempotency_key`, `effective_at`, `status` (`POSTED`, `REVERSED`), `reverses_transaction_id` self-FK, `description`, `metadata JSONB`, `created_by_type`, `created_by_id`, timestamps.

Constraints: unique `(transaction_type, idempotency_key)`; unique reversal target; posted rows are never updated except controlled metadata fields.

#### `ledger_entries`

Purpose: Debit and credit lines belonging to a ledger transaction.

Columns: `id BIGINT`, `ledger_transaction_id UUID` FK, `account_id BIGINT` FK, `side`, `amount_minor NUMERIC(38,0)`, `asset_code`, `entry_sequence SMALLINT`, `created_at`.

Constraints: positive amount; unique `(ledger_transaction_id, entry_sequence)`; entry asset must match account asset through posting service validation.

Invariant: For every posted ledger transaction and asset, total debits equal total credits. Enforce using one serializable posting function/service and a deferred database validation mechanism where practical.

#### `account_balance_projections`

Purpose: Fast rebuildable ledger balances.

Columns: `account_id` primary/FK, `posted_debits`, `posted_credits`, `balance_minor`, `last_entry_id`, `version BIGINT`, `updated_at`.

Rule: This is a projection, never the audit source.

#### `balance_holds`

Purpose: Reserve available funds for open orders, withdrawals, and pending settlement.

Columns: `id UUID`, `account_id` FK, `hold_type`, `reference_type`, `reference_id`, `amount_minor`, `status`, `expires_at`, `released_at`, timestamps.

Constraints: unique active hold per reference; positive amount; indexes `(account_id, status)` and `(status, expires_at)`.

Lifecycle: `ACTIVE -> CAPTURED|RELEASED|EXPIRED`.

### 5.4 Fiat deposits, withdrawals, FX, and treasury

#### `deposit_intents`

Purpose: User-owned request to deposit fiat through ABA PayWay or Bakong.

Columns: `id UUID`, `user_id` FK, `provider`, `provider_reference`, `idempotency_key`, `requested_amount_minor`, `currency`, `status`, `expires_at`, `verified_at`, `ledger_transaction_id`, timestamps.

Constraints: unique `(provider, provider_reference)` when present; unique `(user_id, idempotency_key)`; positive amount.

Lifecycle: `CREATED -> PENDING_PROVIDER -> VERIFIED -> POSTED`, with terminal `EXPIRED|FAILED|CANCELLED`.

Existing `transactions` and `bakong_payments` link to this table during transition rather than being deleted.

#### `payment_provider_events`

Purpose: Immutable provider callback and polling evidence.

Columns: `id`, `provider`, `provider_event_id`, `deposit_intent_id`, `event_type`, `payload_hash`, encrypted/redacted `payload JSONB`, `signature_valid`, `received_at`, `processed_at`, `processing_status`, `error_code`.

Constraints: unique `(provider, provider_event_id)` or fallback unique payload hash; index unprocessed events.

#### `withdrawal_requests`

Purpose: User request to convert and pay value to an approved ABA/Bakong destination.

Columns: `id UUID`, `user_id`, `source_asset`, `source_amount_minor`, `destination_currency`, encrypted destination reference, `idempotency_key`, `status`, `hold_id`, `fx_quote_id`, `ledger_transaction_id`, approval fields, timestamps.

Lifecycle: `REQUESTED -> HELD -> APPROVED -> PROCESSING -> PAID`, with `REJECTED|FAILED|CANCELLED|REVERSED`.

#### `withdrawal_attempts`

Purpose: Immutable record of each provider payout attempt.

Columns: `id`, `withdrawal_request_id`, `attempt_number`, `provider`, `provider_reference`, `request_hash`, `response_code`, `status`, `started_at`, `completed_at`, `evidence JSONB`.

Constraints: unique `(withdrawal_request_id, attempt_number)` and provider reference.

#### `fx_quotes`

Purpose: Time-limited KHR/USDC conversion quote.

Columns: `id UUID`, base/quote assets, `rate_numerator NUMERIC(38,0)`, `rate_denominator NUMERIC(38,0)`, `source`, `spread_bps`, `quoted_at`, `expires_at`, `status`, `approved_by`.

Rule: Never store FX as floating point.

#### `asset_conversions`

Purpose: Link fiat ledger movement, FX quote, and treasury USDC allocation.

Columns: `id UUID`, `user_id`, `direction`, `fx_quote_id`, source/destination amounts and assets, `status`, `source_ledger_transaction_id`, `destination_ledger_transaction_id`, `treasury_operation_id`, timestamps.

Lifecycle: `PENDING -> RESERVED -> COMPLETED`, or `FAILED|REVERSED`.

#### `treasury_accounts`

Purpose: Registry of bank, Bakong, and Base treasury accounts.

Columns: `id`, `account_type`, `asset_code`, `chain_id`, `address` or encrypted provider reference, `ledger_account_id`, `status`, `signing_policy`, timestamps.

#### `treasury_operations`

Purpose: Controlled treasury movements such as prefunding, rebalancing, FX allocation, or gas funding.

Columns: `id UUID`, `operation_type`, source/destination treasury accounts, asset, amount, status, approval policy, blockchain_transaction_id or provider reference, ledger transaction, timestamps.

#### `treasury_reconciliations`

Purpose: Compare provider/on-chain balances to ledger control accounts.

Columns: `id`, `treasury_account_id`, `as_of`, observed balance, ledger balance, difference, status, evidence hash, reviewer, timestamps.

### 5.5 Market taxonomy and product definition

#### `market_categories`

Purpose: Hierarchical categories and subcategories.

Columns: `id`, `parent_id` self-FK, `slug`, `name_en`, `name_km`, `description`, `sort_order`, `status`, timestamps.

Constraints: unique slug; prevent direct self-parenting; index `(parent_id, status)`.

#### `markets`

Purpose: User-facing market container, for example “Cambodia gasoline price in June.”

Columns: `id UUID`, category, slug, localized titles/descriptions, `market_type` (`BINARY`, `RANGE_BINARY_SET`, future `CATEGORICAL`), status, open/close/resolution times, collateral asset, creator/admin, risk limits, metadata, timestamps.

Lifecycle: `DRAFT -> REVIEW -> SCHEDULED -> OPEN -> CLOSED -> RESOLVING -> RESOLVED -> SETTLED -> ARCHIVED`, with `CANCELLED` from controlled states.

#### `market_questions`

Purpose: One independently resolvable/tradable question. A range market contains several binary questions.

Columns: `id UUID`, `market_id`, `question_index`, `question_text`, `question_id_hash CHAR(66)`, `condition_model`, `outcome_slot_count`, `resolution_rule`, `data_source`, `status`, timestamps.

Constraints: unique `(market_id, question_index)` and globally unique question hash.

#### `market_outcomes`

Purpose: Outcomes belonging to one question.

Columns: `id`, `question_id`, `outcome_index SMALLINT`, `code`, localized labels, `payout_numerator`, `is_winning`, timestamps.

Constraints: unique `(question_id, outcome_index)` and `(question_id, code)`.

Binary questions must have exactly two outcomes: YES index 0 and NO index 1, or another explicitly approved stable ordering.

### 5.6 Gnosis CTF configuration and positions

#### `ctf_conditions`

Purpose: Map a market question to an on-chain CTF condition.

Columns: `id`, `question_id` FK, `chain_id`, `ctf_contract_id`, `oracle_address`, `question_id_hash`, `condition_id CHAR(66)`, `outcome_slot_count`, `prepare_tx_id`, `prepared_block`, `status`, timestamps.

Constraints: unique question and unique `(chain_id, condition_id)`.

Lifecycle: `PLANNED -> SUBMITTED -> PREPARED -> RESOLVED`, or `FAILED`.

#### `ctf_position_tokens`

Purpose: Canonical outcome position identifiers produced from collateral, collection, and condition data.

Columns: `id`, `condition_id`, `outcome_id`, `collection_id NUMERIC(78,0)`, `position_id NUMERIC(78,0)`, `token_standard`, timestamps.

Constraints: unique `(condition_id, outcome_id)` and `(chain_id, position_id)` through the condition relation.

#### `user_position_projections`

Purpose: Queryable projection of user outcome-token ownership and trading cost.

Columns: `user_id`, `position_token_id`, `confirmed_quantity_raw`, `pending_quantity_raw`, `reserved_quantity_raw`, `average_cost_minor`, `realized_pnl_minor`, `last_event_id`, `updated_at`.

Primary key: `(user_id, position_token_id)`.

Rule: Rebuildable from finalized blockchain events, settled trades, and ledger records. It is not the ownership authority.

### 5.7 CLOB orders, matching, and trades

#### `order_nonces`

Purpose: Replay and bulk-cancellation state per wallet/market scope.

Columns: `wallet_id`, `scope`, `minimum_nonce NUMERIC(78,0)`, `updated_at`, `updated_by_tx_id`.

Primary key: `(wallet_id, scope)`.

#### `orders`

Purpose: Store one signed EIP-712 order.

Columns: `id UUID`, `client_order_id`, `user_id`, `wallet_id`, `market_id`, `question_id`, `position_token_id`, `side` (`BUY`,`SELL`), `price_microunits BIGINT`, `quantity_raw NUMERIC(78,0)`, `filled_quantity_raw`, `reserved_amount_minor`, `nonce`, `salt`, `signature BYTEA`, `signer_address`, `typed_data_hash CHAR(66)`, `time_in_force`, `expires_at`, `status`, `hold_id`, timestamps.

Constraints: unique `(wallet_id, client_order_id)`, unique typed-data hash, price between 0 and 1,000,000, positive quantity, filled quantity within total.

Indexes: active book `(question_id, position_token_id, side, price_microunits, created_at, id)`; user orders; expiry queue.

Lifecycle: `RECEIVED -> VALIDATED -> OPEN -> PARTIALLY_FILLED -> FILLED`, with `REJECTED|CANCEL_PENDING|CANCELLED|EXPIRED`.

#### `order_matches`

Purpose: Deterministic match-engine output before settlement.

Columns: `id UUID`, `market_id`, `maker_order_id`, `taker_order_id`, `price_microunits`, `quantity_raw`, `match_sequence BIGINT`, `engine_instance`, `status`, timestamps.

Constraints: global unique match sequence and unique maker/taker execution tuple.

Lifecycle: `MATCHED -> SETTLEMENT_QUEUED -> SETTLED`, or `FAILED|REVERSED`.

#### `trades`

Purpose: Durable economic trade derived from a match.

Columns: `id UUID`, `match_id`, buyer/seller users and wallets, position token, quantity, price, gross USDC, buyer/seller fees, settlement status, settlement item, executed_at, finalized_at.

Constraints: unique match; positive quantities; unique settlement reference where applicable.

#### `trade_fees`

Purpose: Explicit fee components for transparent ledger posting.

Columns: `id`, `trade_id`, `fee_type`, `charged_user_id`, `amount_minor`, `ledger_transaction_id`, timestamps.

### 5.8 Relayer, blockchain events, and settlement

#### `blockchain_transactions`

Purpose: One requested or observed transaction on Base.

Columns: `id UUID`, `chain_id`, `purpose`, `from_address`, `to_address`, `nonce`, `tx_hash`, `status`, gas fields, submitted/mined/finalized block data, replacement transaction, error code, timestamps.

Constraints: unique `(chain_id, tx_hash)` when known and unique active `(chain_id, from_address, nonce)`.

Lifecycle: `CREATED -> SIGNING -> SUBMITTED -> MINED -> FINALIZED`, with `REPLACED|REVERTED|DROPPED|FAILED`.

#### `blockchain_events`

Purpose: Idempotent event log indexed from Base.

Columns: `id`, `chain_id`, `contract_address`, `tx_hash`, `log_index`, `block_number`, `block_hash`, `event_name`, `topic0`, decoded data, `canonical`, `finality_status`, `observed_at`, `finalized_at`, `reverted_at`.

Constraints: unique `(chain_id, tx_hash, log_index)`; indexes by block and unfinalized status.

#### `chain_sync_cursors`

Purpose: Track safe scanning progress per chain and contract group.

Columns: `chain_id`, `cursor_name`, `last_scanned_block`, `last_scanned_hash`, `last_finalized_block`, timestamps.

#### `outbox_events`

Purpose: Transactional handoff from PostgreSQL commits to relayer and background workers.

Columns: `id UUID`, `aggregate_type`, `aggregate_id`, `event_type`, `payload`, `status`, `available_at`, attempts, lease fields, processed_at, error fields.

Constraints: unique business event key; indexes for ready jobs and expired leases.

#### `settlement_batches`

Purpose: Group compatible order matches into one on-chain settlement submission.

Columns: `id UUID`, `chain_id`, exchange contract, batch sequence, status, item count, aggregate amounts, blockchain transaction, timestamps.

#### `settlement_items`

Purpose: Bind one trade/match to its exact on-chain execution and ledger effects.

Columns: `id`, `batch_id`, `trade_id`, item index, order hashes, quantity, collateral amount, status, event ID, ledger transaction IDs, error fields.

Constraints: unique trade and `(batch_id, item_index)`.

Lifecycle: `QUEUED -> SUBMITTED -> MINED -> FINALIZED`, or `REVERTED|FAILED`.

#### `redemption_requests`

Purpose: User request to redeem resolved positions.

Columns: `id UUID`, `user_id`, `wallet_id`, `condition_id`, `position_token_id`, quantity, expected collateral, status, blockchain transaction, ledger transaction, idempotency key, timestamps.

Constraints: unique `(user_id, idempotency_key)` and unique finalized chain execution.

### 5.9 Oracle resolution and disputes

#### `oracle_resolution_proposals`

Purpose: Proposed payout vector and supporting evidence.

Columns: `id UUID`, `question_id`, proposer, payout vector `JSONB`, evidence hash/URI, observed value, proposed_at, challenge_deadline, status, authorization snapshot.

Lifecycle: `DRAFT -> PROPOSED -> CHALLENGE_WINDOW -> CONFIRMED`, or `CHALLENGED|REJECTED`.

#### `oracle_disputes`

Purpose: Challenge to a proposed resolution.

Columns: `id UUID`, proposal ID, challenger, reason, evidence hash, status, decided_by, decision, decided_at, timestamps.

#### `market_resolutions`

Purpose: Final application and on-chain resolution record.

Columns: `id UUID`, `question_id`, proposal ID, payout vector, resolution source, status, report transaction, finalized event, finalized_at, timestamps.

Constraints: one active/final resolution per question.

Lifecycle: `APPROVED -> SUBMITTED -> MINED -> FINALIZED`, or `REVERTED|FAILED`.

### 5.10 Administration and audit

#### `admin_memberships`

Purpose: Assign scoped administrative roles to users.

Columns: `id`, `user_id`, `role`, `scope_type`, `scope_id`, `status`, granted/revoked metadata, timestamps.

#### `admin_actions`

Purpose: Immutable audit trail for market, oracle, treasury, and emergency operations.

Columns: `id UUID`, actor user, action type, target type/id, request ID, reason, before/after hashes or redacted JSON, IP, user agent, created_at.

Rule: No secrets, private keys, raw bank details, or full provider payloads.

#### `approval_requests`

Purpose: Multi-person approval for high-risk treasury, oracle, and emergency actions.

Columns: `id UUID`, action type, target, requested by, required approvals, status, expires_at, executed_at, timestamps.

#### `approval_decisions`

Purpose: Individual approval or rejection.

Columns: `id`, request ID, reviewer ID, decision, comment, created_at.

Constraints: unique `(request_id, reviewer_id)`.

## 6. Financial invariants

1. No double crediting: one provider payment maps to at most one posted ledger transaction through a unique provider reference and idempotency key.
2. Balanced ledger: every posted transaction balances debits and credits independently for each asset.
3. No negative available balance: `posted balance - active holds` must remain nonnegative for user liability accounts. Lock the projection/account row during hold creation.
4. No direct balance edits: adjustments use explicit ledger transactions and reversals.
5. No double settlement: one match creates one trade and one settlement item; unique constraints enforce this chain.
6. No duplicate chain events: `(chain_id, tx_hash, log_index)` is unique.
7. No premature finality: mined activity stays pending until the configured confirmation threshold is reached.
8. Reorg safety: noncanonical events reverse projections and pending ledger effects; finalized accounting follows the approved reorg policy.
9. Idempotent withdrawal: one user idempotency key creates one request; each provider attempt has a unique sequence/reference.
10. Supply consistency: CTF position projections must reconcile with finalized ERC-1155 transfer/split/merge/redemption events.
11. Complete-set invariant: each binary CTF condition uses its own collateral relationship. YES plus NO represents one complete set for that condition only.

## 7. PostgreSQL, on-chain, Redis, and workers

### PostgreSQL

- User and admin identity references
- Market configuration and resolution rules
- Provider payment intents and evidence hashes
- Double-entry ledger and holds
- Signed orders, matches, trades, and settlement state
- Treasury and FX records
- Indexed blockchain transactions/events
- Rebuildable balance and position projections
- Audit and approval records

### On-chain

- USDC balances held by wallets/contracts
- CTF conditions, collections, and ERC-1155 positions
- Exchange settlement execution
- Oracle resolution transaction and payout vector
- Redemption execution
- Contract roles, permissions, and immutable emitted events

### Redis

- Live order-book levels reconstructed from open PostgreSQL orders
- WebSocket fan-out and latest price cache
- Short leases and rate-limit acceleration
- Relayer nonce coordination cache backed by PostgreSQL state
- Disposable worker queues only when a durable PostgreSQL outbox remains authoritative

Redis must never be the only store for balances, orders, fills, payments, or settlement state.

### Background workers

- CLOB matcher
- Relayer and transaction monitor
- Base event indexer and finality/reorg processor
- Ledger posting/reconciliation worker
- Provider callback/polling processor
- Treasury reconciliation worker
- Expiry/cancellation worker
- WebSocket market-data publisher

## 8. Major risks

- Treating mutable `wallets` balances as the new ledger would preserve current double-credit risk.
- Conflating KHR deposits with USDC allocation hides treasury exposure and FX losses.
- Marking a mined transaction as final can create incorrect balances after a reorg.
- Matching an order without an atomic hold permits overspending.
- Storing EIP-712 signatures without domain/version fields creates replay risk.
- Native categorical CTF and independent binary brackets have different collateral semantics and must not be mixed.
- An oracle controlled by one unreviewed admin creates resolution and insider risk.
- Omnibus custody without per-user liability reconciliation creates solvency risk.

## 9. Approval gates

Before schema implementation, approve:

1. Custody ownership, recovery, and signing model.
2. Exchange/escrow contract design and EIP-712 domain.
3. Treasury legal owner, prefunding limits, and signer quorum.
4. KHR/USDC FX responsibility and quote policy.
5. Ledger account chart and accounting treatment.
6. Binary CTF outcome ordering and collateral precision.
7. Range-market semantics and whether brackets may overlap.
8. Base confirmation depth and deep-reorg response.
9. Oracle proposer, approver, dispute window, and emergency cancellation authority.
10. Fee model and treatment of failed/reverted settlements.
