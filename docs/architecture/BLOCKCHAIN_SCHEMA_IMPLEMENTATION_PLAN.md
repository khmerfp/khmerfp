# KhmerFP Blockchain Schema Implementation Plan

Status: Proposed milestones after Stage 2.0 design approval.

## 1. Delivery rules

- Complete Stage 1.6 adoption work independently before applying new domain migrations to an existing database.
- Implement one domain in a forward migration at a time.
- Every migration receives offline artifact validation and disposable PostgreSQL 16 testing.
- Do not change existing payment balance behavior in the same milestone that creates ledger tables.
- Use testnet contracts and mock collateral before real USDC or provider balances.
- Each financial workflow requires failure, retry, concurrency, and reconciliation tests.

## 2. Milestone order

### Stage 2.1 — Architecture decisions and ADRs

Decide:

- Wallet provider and ownership/recovery model.
- Custody/escrow contract model.
- Chain IDs, confirmation depth, and reorg policy.
- USDC contract and decimals per environment.
- EIP-712 domain, order version, nonce, cancellation, and EIP-1271 policy.
- Binary outcome index ordering.
- Oracle and dispute governance.
- Treasury, FX, and approval responsibility.

Deliverables:

- Approved ADRs
- Threat model updates
- Contract interface freeze for prototype
- Chart of ledger accounts

Acceptance criteria: No unresolved decision changes primary keys, ownership, signature format, or financial accounting semantics.

### Stage 2.2 — Market database and admin lifecycle

Tables:

- `market_categories`
- `markets`
- `market_questions`
- `market_outcomes`
- `admin_memberships`
- `admin_actions`
- `approval_requests`
- `approval_decisions`

Deliverables:

- Versioned Drizzle schema and migration
- Binary market constraints
- Admin authorization service design
- Immutable audit records

Acceptance criteria:

- One binary market can move from draft to scheduled/open on a disposable database.
- Outcome ordering and timestamps cannot change after opening.
- Unauthorized state transitions fail.
- Existing nine tables remain unchanged.

### Stage 2.3 — Chain and CTF registry

Tables:

- `chains`
- `contract_deployments`
- `user_wallets`
- `wallet_authorizations`
- `ctf_conditions`
- `ctf_position_tokens`

Deliverables:

- Base testnet configuration
- Mock USDC and CTF deployment registry
- Embedded wallet link model
- Condition preparation records

Acceptance criteria:

- One binary question maps deterministically to one condition and two position IDs.
- Address, hash, chain, and uint256 formats are validated.
- Contract versions remain historically queryable.

### Stage 2.4 — Double-entry ledger foundation

Tables:

- `ledger_accounts`
- `ledger_transactions`
- `ledger_entries`
- `account_balance_projections`
- `balance_holds`

Deliverables:

- Approved account chart
- One atomic posting API
- Reversal API
- Balance projection builder
- Reconciliation query suite

Acceptance criteria:

- Unbalanced postings are impossible through the supported posting path.
- Concurrent holds cannot make available funds negative.
- Replaying an idempotency key returns the original posting.
- Projection rebuild matches ledger history.
- No existing wallet balance is migrated or altered yet.

### Stage 2.5 — Deposit, FX, and treasury accounting

Tables:

- `deposit_intents`
- `payment_provider_events`
- `fx_quotes`
- `asset_conversions`
- `treasury_accounts`
- `treasury_operations`
- `treasury_reconciliations`

Transition work:

- Add controlled links from `transactions` and `bakong_payments` to deposit and ledger records.
- Run shadow ledger posting without changing user-visible balances.
- Compare legacy wallet balances to ledger projections.

Acceptance criteria:

- Duplicate callbacks create one ledger posting.
- KHR receipt and USDC allocation are separately auditable.
- Treasury difference reports are reproducible.
- Shadow ledger matches approved legacy test fixtures.

### Stage 2.6 — Orders, holds, and deterministic CLOB

Tables:

- `order_nonces`
- `orders`
- `order_matches`
- `trades`
- `trade_fees`
- `outbox_events`

Deliverables:

- EIP-712 verifier
- EIP-1271 verifier
- Deterministic price-time matcher
- Cancellation, expiry, partial-fill, and replay handling
- Redis order-book projection

Acceptance criteria:

- Invalid signatures/domains/nonces are rejected.
- Two concurrent orders cannot reserve the same funds.
- Matching produces the same sequence from the same input.
- Redis can be deleted and rebuilt from PostgreSQL.

### Stage 2.7 — Relayer, event indexer, and settlement

Tables:

- `blockchain_transactions`
- `blockchain_events`
- `chain_sync_cursors`
- `settlement_batches`
- `settlement_items`
- `user_position_projections`

Deliverables:

- Viem relayer
- Transaction nonce coordination
- Receipt/event decoder
- Confirmation/finality processor
- Reorg processor
- Settlement reconciliation

Acceptance criteria:

- One matched trade settles once.
- Duplicate event ingestion is harmless.
- A simulated reorg reverses pending projections.
- Second processing produces no extra ledger or position movement.
- Database settlement state reconciles with testnet events.

### Stage 2.8 — Oracle, resolution, and redemption

Tables:

- `oracle_resolution_proposals`
- `oracle_disputes`
- `market_resolutions`
- `redemption_requests`

Deliverables:

- Proposal/evidence workflow
- Multi-approval and challenge handling
- Payout-vector validation
- Relayed resolution and redemption

Acceptance criteria:

- Only authorized, approved proposals reach the relayer.
- Payout vector matches the condition outcome count.
- Resolution and redemption wait for finality.
- Duplicate redemption requests cannot double pay.

### Stage 2.9 — Withdrawals and controlled payout

Tables:

- `withdrawal_requests`
- `withdrawal_attempts`

Deliverables:

- Destination protection/encryption
- Limits and approval workflow
- USDC/KHR conversion posting
- ABA/Bakong payout integration
- Failure/reversal paths

Acceptance criteria:

- One idempotency key creates one withdrawal.
- Failed payouts release holds and reverse pending accounting.
- Provider, treasury, and ledger totals reconcile.

### Stage 2.10 — Legacy balance transition

Purpose: Make ledger projections authoritative only after sustained shadow validation.

Steps:

1. Backfill opening-balance ledger transactions from an approved snapshot.
2. Reconcile every user and treasury total.
3. Run dual reads and compare results.
4. Switch API reads to ledger projections behind a feature flag.
5. Stop direct writes to `wallets` only after approval.
6. Keep `wallets` as a temporary compatibility projection.
7. Retire it in a later migration after rollback windows close.

Acceptance criteria:

- Zero unexplained difference for KHR and USD/USDC.
- No payment is credited twice during cutover.
- Rollback procedure is rehearsed.

## 3. Testing strategy per milestone

### Schema tests

- Drizzle generation and check
- Offline migration artifact hashes
- Disposable PostgreSQL migration from empty database
- Second migration run is a no-op
- Catalog assertions for columns, constraints, indexes, functions, and triggers

### Financial tests

- Balanced postings
- Idempotent retries
- Concurrent holds and releases
- Reversal without deletion
- Provider duplicate/out-of-order events
- Treasury and ledger reconciliation

### Trading tests

- Signature and domain mismatch
- Nonce replay and bulk cancellation
- Partial fill arithmetic
- Price-time ordering
- Self-trade policy
- Expiry during matching
- Settlement failure and retry

### Blockchain tests

- Duplicate logs
- Missing RPC responses
- Transaction replacement
- Reverted receipt
- Short and deep reorg simulations
- Confirmation threshold
- Event/projection rebuild

### Security tests

- Authorization and admin scope
- EIP-1271 malicious/reverting wallet
- Signature malleability/canonical format
- SQL concurrency and lock ordering
- Secret and PII redaction
- Treasury approval bypass attempts

## 4. Recommended project structure

```text
packages/
  db/
    src/schema/
      identity/
      ledger/
      payments/
      markets/
      trading/
      blockchain/
      oracle/
      admin/
  domain/
    money/
    markets/
    orders/
    ledger/
contracts/
  ctf/
  exchange/
  oracle/
services/
  matcher/
  relayer/
  indexer/
  reconciliation/
server/
  src/modules/
    markets/
    orders/
    payments/
    treasury/
```

This is a target structure, not authorization to move existing files. Introduce it incrementally.

## 5. Migration dependency order

```text
identity/wallet registry
        ↓
market definitions ──→ CTF registry
        ↓                  ↓
ledger foundation ──→ orders and holds
        ↓                  ↓
payments/treasury     matching and trades
        └──────────→ settlement/indexing
                            ↓
                    resolution/redemption
                            ↓
                       withdrawals
```

## 6. Required approvals before coding

- All Stage 2.1 ADRs
- Table naming and domain boundaries
- Ledger account chart
- Decimal/raw-unit conventions
- Custody and settlement contract interfaces
- Oracle governance
- Data retention and encryption policy
- Regulatory review for custody, conversion, and payouts
- Stage 1.6 adoption status for every existing environment

## 7. Recommended first development task

After approvals, implement only Stage 2.2’s binary market database core:

- `market_categories`
- `markets`
- `market_questions`
- `market_outcomes`

Start with schema definitions and state-transition tests. Do not connect CTF, real payments, balances, or settlement in the same task.
