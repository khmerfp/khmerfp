# KhmerFP Blockchain Database ERD

Status: Proposed target model. Wallet identity is implemented by migration `0005`, and the binary CTF registry is implemented by migration `0006`; administration, ownership projections, and trading tables remain planned.

The ERD is divided by domain so each diagram stays readable. Cross-domain links use the same table and key names throughout.

## 1. Identity, wallets, and administration

```mermaid
erDiagram
    users ||--o{ sessions : has
    users ||--o{ user_factors : verifies
    users ||--o{ auth_audit_logs : produces
    users ||--o{ user_wallets : owns
    chains ||--o{ user_wallets : hosts
    user_wallets ||--o{ wallet_authorizations : authorizes
    users ||--o{ admin_memberships : receives
    users ||--o{ admin_actions : performs
    users ||--o{ approval_requests : requests
    approval_requests ||--o{ approval_decisions : receives
    users ||--o{ approval_decisions : reviews

    users {
      bigint id PK
      varchar email UK
      varchar language
      timestamptz created_at
    }
    sessions {
      char token_hash PK
      bigint user_id FK
      timestamptz expires_at
    }
    user_factors {
      bigint id PK
      bigint user_id FK
      varchar factor_type
      varchar identifier
    }
    auth_rate_limits {
      varchar rate_limit_key PK
      integer request_count
      timestamptz window_started_at
    }
    auth_audit_logs {
      bigint id PK
      bigint user_id FK
      varchar event_type
      timestamptz created_at
    }
    phone_otps {
      bigint id PK
      varchar phone_number
      char code_hash
      timestamptz expires_at
    }
    user_wallets {
      bigint id PK
      bigint user_id FK
      numeric chain_id FK
      char wallet_address UK
      varchar wallet_type
      varchar custody_model
      varchar ownership_verification_status
      boolean is_primary
      varchar wallet_status
    }
    wallet_authorizations {
      bigint id PK
      bigint wallet_id FK
      varchar authorization_type
      varchar authorization_scope
      bigint authorized_contract_deployment_id FK
      char authorized_operator_address
      varchar authorization_reference
      char payload_hash
      char signature_hash
      timestamptz expires_at
      timestamptz revoked_at
      varchar authorization_status
    }
    admin_memberships {
      bigint id PK
      bigint user_id FK
      varchar role
      varchar scope_type
      varchar status
    }
    admin_actions {
      uuid id PK
      bigint actor_user_id FK
      varchar action_type
      varchar target_type
      varchar target_id
      timestamptz created_at
    }
    approval_requests {
      uuid id PK
      bigint requested_by FK
      varchar action_type
      varchar status
    }
    approval_decisions {
      bigint id PK
      uuid request_id FK
      bigint reviewer_id FK
      varchar decision
    }
```

## 2. Ledger, fiat, FX, and treasury

```mermaid
erDiagram
    users ||--o{ ledger_accounts : owns
    users ||--o| wallets : has_legacy_balance
    ledger_accounts ||--|| account_balance_projections : projects
    ledger_transactions ||--|{ ledger_entries : contains
    ledger_accounts ||--o{ ledger_entries : receives
    ledger_accounts ||--o{ balance_holds : reserves

    users ||--o{ deposit_intents : creates
    deposit_intents ||--o{ payment_provider_events : receives
    deposit_intents o|--o| transactions : links_aba
    deposit_intents o|--o| bakong_payments : links_bakong
    deposit_intents o|--o| ledger_transactions : posts

    users ||--o{ withdrawal_requests : requests
    withdrawal_requests ||--o{ withdrawal_attempts : attempts
    withdrawal_requests o|--o| balance_holds : reserves
    withdrawal_requests o|--o| fx_quotes : quotes
    withdrawal_requests o|--o| ledger_transactions : posts

    fx_quotes ||--o{ asset_conversions : prices
    users ||--o{ asset_conversions : converts
    asset_conversions o|--o| treasury_operations : allocates
    treasury_accounts ||--o{ treasury_operations : sources
    treasury_accounts ||--o{ treasury_reconciliations : reconciles

    wallets {
      bigint id PK
      bigint user_id FK
      bigint balance_minor
      bigint usd_balance_minor
      varchar currency
    }
    transactions {
      bigint id PK
      varchar tran_id UK
      bigint amount
      varchar status
      varchar currency
    }
    bakong_payments {
      bigint id PK
      bigint user_id FK
      varchar tran_id UK
      bigint amount_minor
      varchar status
    }
    treasury_accounts o|--|| ledger_accounts : controls

    ledger_accounts {
      bigint id PK
      bigint owner_user_id FK
      varchar account_code
      varchar asset_code
      varchar account_type
      varchar normal_side
    }
    ledger_transactions {
      uuid id PK
      varchar transaction_type
      varchar idempotency_key UK
      uuid reverses_transaction_id FK
      varchar status
    }
    ledger_entries {
      bigint id PK
      uuid ledger_transaction_id FK
      bigint account_id FK
      varchar side
      numeric amount_minor
      varchar asset_code
    }
    balance_holds {
      uuid id PK
      bigint account_id FK
      varchar reference_type
      uuid reference_id
      numeric amount_minor
      varchar status
    }
    deposit_intents {
      uuid id PK
      bigint user_id FK
      varchar provider
      varchar provider_reference UK
      bigint requested_amount_minor
      varchar status
      uuid ledger_transaction_id FK
    }
    withdrawal_requests {
      uuid id PK
      bigint user_id FK
      numeric source_amount_minor
      varchar status
      uuid hold_id FK
      uuid ledger_transaction_id FK
    }
    fx_quotes {
      uuid id PK
      varchar base_asset
      varchar quote_asset
      numeric rate_numerator
      numeric rate_denominator
      timestamptz expires_at
    }
    treasury_accounts {
      bigint id PK
      varchar account_type
      varchar asset_code
      bigint ledger_account_id FK
      varchar status
    }
```

## 3. Markets, CTF, and oracle

```mermaid
erDiagram
    market_categories o|--o{ market_categories : contains
    market_categories ||--o{ markets : categorizes
    users o|--o{ markets : creates
    markets ||--o| market_questions : defines
    market_questions ||--|{ market_outcomes : offers
    contract_deployments o|--o{ market_questions : supplies_oracle
    market_questions ||--o| ctf_conditions : prepares
    ctf_conditions ||--|{ ctf_position_tokens : derives
    market_outcomes ||--o| ctf_position_tokens : maps
    users ||--o{ user_position_projections : holds
    ctf_position_tokens ||--o{ user_position_projections : projects

    market_questions ||--o{ oracle_resolution_proposals : proposes
    oracle_resolution_proposals ||--o{ oracle_disputes : challenges
    market_questions ||--o| market_resolutions : resolves
    oracle_resolution_proposals ||--o| market_resolutions : confirms

    market_categories {
      bigint id PK
      bigint parent_id FK
      varchar slug UK
      varchar name
      boolean active
    }
    markets {
      uuid id PK
      bigint category_id FK
      bigint created_by_user_id FK
      varchar slug UK
      varchar lifecycle_status
      varchar trading_status
      varchar resolution_status
      timestamptz trading_starts_at
      timestamptz trading_ends_at
      timestamptz resolution_deadline
      char terms_hash
      timestamptz terms_frozen_at
    }
    market_questions {
      uuid id PK
      uuid market_id FK
      bigint oracle_contract_deployment_id FK
      text question_text
      text resolution_rules
      text resolution_source
    }
    market_outcomes {
      bigint id PK
      uuid market_id FK
      uuid question_id FK
      smallint outcome_index
      varchar outcome_label
    }
    ctf_conditions {
      bigint id PK
      uuid market_question_id FK
      numeric chain_id FK
      bigint ctf_contract_deployment_id FK
      bigint oracle_contract_deployment_id FK
      bigint collateral_asset_id FK
      char oracle_address
      char ctf_question_id
      char condition_id UK
      smallint outcome_slot_count
      varchar registration_status
    }
    ctf_position_tokens {
      bigint id PK
      bigint condition_id FK
      bigint market_outcome_id FK
      numeric chain_id
      bigint ctf_contract_deployment_id
      bigint collateral_asset_id FK
      smallint outcome_index
      numeric index_set
      char parent_collection_id
      char collection_id
      numeric position_id UK
    }
    user_position_projections {
      bigint user_id PK,FK
      bigint position_token_id PK,FK
      numeric confirmed_quantity_raw
      numeric pending_quantity_raw
      numeric reserved_quantity_raw
    }
    oracle_resolution_proposals {
      uuid id PK
      uuid question_id FK
      jsonb payout_vector
      varchar status
      timestamptz challenge_deadline
    }
    oracle_disputes {
      uuid id PK
      uuid proposal_id FK
      varchar status
    }
    market_resolutions {
      uuid id PK
      uuid question_id FK
      uuid proposal_id FK
      jsonb payout_vector
      varchar status
    }
```

## 4. Orders, trades, and settlement

```mermaid
erDiagram
    users ||--o{ orders : places
    user_wallets ||--o{ orders : signs
    markets ||--o{ orders : accepts
    market_questions ||--o{ orders : scopes
    ctf_position_tokens ||--o{ orders : trades
    balance_holds ||--o| orders : reserves
    user_wallets ||--o{ order_nonces : cancels

    orders ||--o{ order_matches : maker
    orders ||--o{ order_matches : taker
    order_matches ||--|| trades : creates
    trades ||--o{ trade_fees : charges
    trades ||--o| settlement_items : settles
    settlement_batches ||--|{ settlement_items : contains
    blockchain_transactions ||--o| settlement_batches : submits
    blockchain_events ||--o| settlement_items : confirms

    users ||--o{ redemption_requests : requests
    ctf_conditions ||--o{ redemption_requests : redeems
    ctf_position_tokens ||--o{ redemption_requests : burns
    blockchain_transactions ||--o| redemption_requests : executes

    orders {
      uuid id PK
      bigint user_id FK
      bigint wallet_id FK
      uuid question_id FK
      bigint position_token_id FK
      varchar side
      bigint price_microunits
      numeric quantity_raw
      numeric nonce
      bytea signature
      varchar status
    }
    order_nonces {
      bigint wallet_id PK,FK
      varchar scope PK
      numeric minimum_nonce
    }
    order_matches {
      uuid id PK
      uuid maker_order_id FK
      uuid taker_order_id FK
      bigint match_sequence UK
      numeric quantity_raw
      varchar status
    }
    trades {
      uuid id PK
      uuid match_id UK,FK
      bigint buyer_user_id FK
      bigint seller_user_id FK
      numeric gross_usdc_minor
      varchar settlement_status
    }
    settlement_batches {
      uuid id PK
      bigint chain_id FK
      bigint batch_sequence UK
      uuid blockchain_transaction_id FK
      varchar status
    }
    settlement_items {
      bigint id PK
      uuid batch_id FK
      uuid trade_id UK,FK
      integer item_index
      varchar status
      bigint event_id FK
    }
    redemption_requests {
      uuid id PK
      bigint user_id FK
      bigint condition_id FK
      bigint position_token_id FK
      numeric quantity_raw
      varchar status
    }
```

## 5. Blockchain indexing and workers

```mermaid
erDiagram
    chains ||--o{ contract_deployments : deploys
    chains ||--o{ blockchain_transactions : submits
    chains ||--o{ blockchain_events : indexes
    chains ||--o{ chain_sync_cursors : tracks
    blockchain_transactions ||--o{ blockchain_events : emits
    blockchain_transactions ||--o| blockchain_transactions : replaces
    outbox_events }o--|| orders : publishes
    outbox_events }o--|| settlement_batches : publishes

    chains {
      bigint chain_id PK
      varchar name
      integer finality_confirmations
      boolean enabled
    }
    contract_deployments {
      bigint id PK
      bigint chain_id FK
      varchar contract_role
      varchar version
      varchar address UK
      bigint active_from_block
    }
    blockchain_transactions {
      uuid id PK
      bigint chain_id FK
      varchar purpose
      varchar tx_hash UK
      numeric nonce
      varchar status
      bigint mined_block_number
      bigint finalized_block_number
    }
    blockchain_events {
      bigint id PK
      bigint chain_id FK
      char tx_hash
      integer log_index
      bigint block_number
      char block_hash
      varchar event_name
      boolean canonical
      varchar finality_status
    }
    chain_sync_cursors {
      bigint chain_id PK,FK
      varchar cursor_name PK
      bigint last_scanned_block
      bigint last_finalized_block
    }
    outbox_events {
      uuid id PK
      varchar aggregate_type
      varchar aggregate_id
      varchar event_type
      varchar status
      timestamptz available_at
    }
```

## 6. Cross-domain source-of-truth map

| Concern | Authority | PostgreSQL role |
|---|---|---|
| Authentication | PostgreSQL identity/session tables | Primary authority |
| Fiat provider payment | Provider plus verified evidence | Intent, evidence, idempotency, ledger posting |
| User financial liability | Double-entry ledger | Primary accounting authority |
| Open order availability | PostgreSQL orders and holds | Durable authority; Redis is a cache |
| CTF token ownership | Finalized Base state | Indexed projection and reconciliation |
| Market definition | PostgreSQL plus contract identifiers | Product authority |
| Resolution payout vector | Finalized oracle/CTF transaction | Proposal, approvals, evidence, indexed final state |
| Settlement finality | Base canonical chain | Pending/final state and ledger reconciliation |

## 7. Diagram limitations

Mermaid shows logical relationships, not every operational FK. Polymorphic references such as `reference_type/reference_id` cannot use a normal FK and require application validation plus unique idempotency keys. Exact constraint names and deletion behavior must be defined during each implementation milestone.
