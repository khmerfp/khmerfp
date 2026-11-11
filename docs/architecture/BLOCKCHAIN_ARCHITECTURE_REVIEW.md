# KhmerFP Stage 2.0 Architecture Review

Status: Design review only

Review date: 2026-11-11

Reviewed documents:

- `BLOCKCHAIN_DATABASE_ARCHITECTURE.md`
- `BLOCKCHAIN_DATABASE_ERD.md`
- `BLOCKCHAIN_DATA_WORKFLOWS.md`
- `BLOCKCHAIN_SCHEMA_IMPLEMENTATION_PLAN.md`

No proposed table or workflow is implemented by this review.

## 1. Overall assessment

The design has a sound high-level separation:

- PostgreSQL is the durable application and accounting store.
- Base is authoritative for finalized USDC and CTF ownership.
- Redis is rebuildable and never authoritative.
- External calls are handed to workers through a durable outbox.
- Fiat receipt, FX conversion, trading, settlement, and redemption are separate events.
- Binary questions are the first product and do not share collateral pools.

The design should not move directly to 44 Drizzle tables. Several decisions change keys, ownership, and accounting semantics. The most important unresolved point is whether trading assets are truly user-controlled on-chain or platform-controlled liabilities. That choice changes the ledger, holds, orders, settlement contract, reconciliation, and withdrawal design.

The proposed model can support future categorical markets, but the CTF mapping needs collateral, parent collection, and index-set fields before it is frozen. Independent binary range questions must remain a separate product type and must never be presented as one categorical complete set.

## 2. Consistency findings

### Consistent areas

1. All four documents agree that the first market is binary and uses one CTF condition with two outcomes.
2. The architecture, workflow, and plan consistently treat Redis as a cache.
3. The documents consistently delay final financial and position effects until Base finality.
4. Idempotency boundaries are present for payments, orders, matches, settlement, events, redemption, and withdrawals.
5. The implementation plan preserves the existing nine tables and separates Stage 1.6 adoption from new migrations.
6. The ERD broadly matches the 44 proposed tables in the architecture document.

### Contradictions or incomplete assumptions

| Severity | Finding | Why it matters | Required correction or decision |
|---|---|---|---|
| Critical | `balance_holds` reserves a ledger account, but the order workflow also uses it to reserve CTF position tokens. | A position token is not a ledger account. Sell orders cannot be safely reserved with the proposed structure. | Choose a unified reservation model or add a position-specific reservation table before order schema design. |
| Critical | The design calls the ledger the user financial authority while also saying finalized Base balances are authoritative. | The same USDC may be represented as both a wallet asset and a platform liability, creating double counting. | Define custody and the exact boundary of ledger ownership. |
| Critical | `ctf_position_tokens` lacks the collateral token, parent collection, and index set used to derive a CTF position ID. | IDs cannot be independently reproduced or extended safely to categorical/composite positions. | Add explicit CTF derivation fields or a normalized collection model. |
| Critical | Reorg detection relies on relevant events and cursors but has no canonical block-header table. | A reorg containing no relevant logs can be missed; event-only comparison is insufficient. | Add `chain_blocks` or an equivalent durable block-header window. |
| Critical | “Store the transaction hash before/with submission” is described as crash-safe. | A database commit and RPC broadcast cannot be atomic. A crash can occur between them. | Pre-sign and hash the raw transaction, persist sender/nonce/hash, then broadcast; recover by hash and sender/nonce. |
| High | Stage 2.3 describes condition preparation, but `outbox_events`, `blockchain_transactions`, and the indexer arrive in Stages 2.6–2.7. | The condition cannot safely be submitted or finalized in Stage 2.3. | Stage 2.3 must be registry-only, or blockchain infrastructure must move earlier. |
| High | Registration creates ledger accounts, but wallet registry is scheduled before the ledger. | The workflow cannot be completed at that milestone. | Defer account creation or implement ledger first. |
| High | `user_position_projections` is keyed by user, while Base owns positions by address. | One user may have several wallets; custodial escrow may own positions for many users. | Key custody projections by wallet or custody account, then derive user views. |
| High | The order/trade model assumes buyer and seller, but the exchange may also match complementary YES/NO buys and mint complete sets. | Complementary minting and secondary transfer have different assets and settlement legs. | Approve the execution models and represent them explicitly. |
| High | A PostgreSQL hold cannot stop a user-controlled wallet from moving USDC or CTF tokens elsewhere. | Off-chain orders can become uncollateralized before settlement. | Require escrow/allowance architecture, contract validation, or platform custody appropriate to the approved model. |
| High | Ledger balance is “posted balance minus holds,” but debit/credit signs depend on account normal side. | A generic subtraction rule can produce an incorrect liability balance. | Define available-balance formulas per account class and test them. |
| High | `ledger_transactions.status` changes from `POSTED` to `REVERSED`, while history is described as append-only. | Mutating the original posting weakens the audit trail. | Keep the original posted row immutable; add a linked reversal and derive reversal state. |
| High | Resolution payout vectors are JSON only. | Database constraints cannot ensure one value per outcome, valid order, or an exact denominator sum. | Add normalized resolution payout rows or a strictly validated immutable vector plus hash. |
| High | Market/question statuses both control trading without a declared state owner. | They can disagree and leave a question tradable in a closed market. | Define authoritative state and derived state-transition rules. |
| Medium | `outbox_events` is shown as belonging to orders and settlement batches through polymorphic fields. | A polymorphic target cannot have both normal foreign keys. | Treat it as an immutable outbox with a unique event key; validate aggregate references in the producer. |
| Medium | `settlement_batches` points to one blockchain transaction, while replacement and retry are one-to-many attempts. | Replacement transactions can lose history or overwrite the first attempt. | Link logical batches to transaction attempts through a separate relation or purpose reference. |
| Medium | `deposit_intents` is said to link legacy `transactions`, but `transactions` has no user foreign key. | Ownership cannot be inferred safely from the legacy row alone. | Create the intent first and store an explicit unique link during transition. |
| Medium | One `orders.hold_id` is too narrow if fees, collateral, and position reservations are separate. | Partial fills and fee changes may require several reservations. | Use an order-reservation relation or prove one reservation is sufficient. |
| Medium | Ethereum identifiers use lowercase character columns but length alone does not validate hex or EVM byte width. | Invalid identifiers can enter the database. | Prefer fixed-length `BYTEA` or strict hex checks and canonical conversion. |
| Medium | The plan puts payments/treasury before the CLOB, even though the first prototype uses mock collateral. | This increases the amount of financial code before proving settlement. | Separate the technical testnet slice from real-funds enablement. |

## 3. Critical missing components

These are missing concepts, not authorization to add tables now.

### 3.1 Chain asset registry

The model needs an immutable identity for USDC per chain and environment: chain, contract address, decimals, symbol, token standard, activation block, and status. A text `asset_code` is not sufficient for accounting or CTF derivation. Recommended concept: `chain_assets`.

### 3.2 Canonical block window

Store recent block number, block hash, parent hash, timestamp, canonical status, and finality status. This lets the indexer detect reorgs even when a replaced block has no relevant application events. Recommended concept: `chain_blocks`.

### 3.3 Position reservations

Open sell orders need durable reservation of a wallet/custody account’s CTF quantity. This must be separate from fiat/USDC ledger holds unless the approved custody contract makes all positions internal liabilities. Recommended concept: `position_reservations` or a rigorously typed general `asset_reservations` model.

### 3.4 Relayer signer and nonce state

`blockchain_transactions` needs signer identity, signed payload hash, sender, nonce, fee parameters, and replacement lineage. A durable nonce allocator or signer-specific lock is required. Never store private keys in PostgreSQL.

### 3.5 Immutable market terms

Before a market opens, persist a version/hash covering question text, outcome ordering, oracle, resolution rule, close time, collateral, fees, and cancellation policy. Admin edits after opening must create a new version or be forbidden.

### 3.6 Contract-level reconciliation

The design needs explicit checks for:

- On-chain USDC held by each wallet/escrow versus internal liabilities.
- CTF ERC-1155 supply and wallet/escrow balances versus projections.
- Submitted settlement legs versus decoded canonical events.
- Treasury USDC versus user USDC liabilities and pending withdrawals.

### 3.7 Compliance and privacy controls

Real fiat conversion and payout require approved KYC/AML responsibility, sanctions/limits policy, retention periods, encrypted destination data, key rotation, and redacted provider evidence. These are production blockers even though they are not all database tables.

## 4. Financial and blockchain safety review

### Custody and signing

The current design deliberately leaves custody open, but downstream tables assume both self-custody and platform liability accounting. The recommended first prototype is a user smart wallet plus an audited exchange/escrow contract with narrowly scoped permissions. KhmerFP may sponsor gas but should not hold an unrestricted user signing key. Recovery and upgrade authority must be visible to the user and protected by a separate signer policy.

### Ledger ownership

The ledger should account for platform obligations and controlled assets. It should not claim ownership of arbitrary assets in a self-custodied wallet. For example, KHR received by KhmerFP and USDC allocated into platform escrow create ledger entries; an ERC-1155 token held solely in a user wallet remains an on-chain asset represented only by a projection.

Every posting must be created through one database transaction that locks affected accounts, validates per-asset debit/credit equality, writes immutable entries, updates a rebuildable projection, and creates its outbox record. Application-only “balanced by convention” checks are insufficient.

### CTF accounting

The MVP may limit positions to atomic index sets for two-outcome conditions. The schema should still store enough inputs to reproduce CTF identifiers. Future categorical support can then add more atomic outcomes without changing the market/question/outcome hierarchy. Composite positions should remain unsupported until separately reviewed.

### Settlement

A match is not a finalized trade. Use clear states for matched, submitted, mined, finalized, reverted, and permanently failed. The decision to reopen orders after failure must account for expiry, changed balances, and partial fills. Never automatically replay a signed order beyond its allowed amount or expiry.

### Chain reorganization

Only finalized events may create irreversible user-visible accounting. Pending views may be updated optimistically if they are clearly marked pending and can be rebuilt. Deep reorg response should pause settlement and redemption automatically, then require reconciliation and an incident decision.

### Oracle governance

An authorized oracle is acceptable for the first binary prototype, but proposal, approval, contract submission, and emergency cancellation should be separate permissions. The market’s resolution source and terms hash must be frozen before opening. A challenge window can be disabled on testnet but must not be implied if it is not actually enforced on-chain or operationally.

### Fiat conversion

KHR receipt does not itself create USDC. The platform must prove who performs conversion, which rate applies, how rounding works, who absorbs slippage, and when the treasury allocation becomes irrevocable. Real deposits and withdrawals must remain disabled until reconciliation and regulatory ownership are approved.

## 5. Binary-first and future categorical compatibility

The market hierarchy is compatible with both models:

- A binary market has one question and two outcomes.
- A range-binary set has several independently collateralized binary questions.
- A future native categorical market has one question and more than two outcomes.

The following rules prevent incompatibility:

1. Freeze `outcome_index` before condition preparation.
2. Store `outcome_slot_count` on the immutable question version and condition.
3. Store collateral token, parent collection, and index set when deriving position IDs.
4. Do not assume YES/NO columns in orders, trades, settlement, or positions; always reference a position token.
5. Do not aggregate independent range binaries into one $1 complete-set invariant.
6. Do not enable native categorical trading until payout-vector validation, liquidity, UI, and settlement tests cover more than two slots.

Binary development is not blocked by deciding whether native categorical markets will launch, provided these structural rules are approved now.

## 6. Classification of the 44 proposed tables

“Initial MVP” means one end-to-end binary market on Base testnet with mock USDC, one wallet path, signed orders, deterministic matching, on-chain settlement, authorized resolution, and redemption. It excludes real ABA/Bakong conversion and withdrawals.

### Required for the initial MVP — 30

| Domain | Tables | Why required |
|---|---|---|
| Wallet and chain | `user_wallets`, `chains`, `contract_deployments` | Identify signer, network, USDC/CTF/exchange/oracle deployments. |
| Ledger and reservation | `ledger_accounts`, `ledger_transactions`, `ledger_entries`, `account_balance_projections`, `balance_holds` | Required if the MVP exposes a platform trading balance. Position reservation still needs the missing design correction. |
| Market | `markets`, `market_questions`, `market_outcomes` | Binary product and stable outcome ordering. |
| CTF | `ctf_conditions`, `ctf_position_tokens`, `user_position_projections` | Condition and rebuildable ownership projection. |
| Trading | `order_nonces`, `orders`, `order_matches`, `trades` | Signed order lifecycle and deterministic execution. |
| Chain and settlement | `blockchain_transactions`, `blockchain_events`, `chain_sync_cursors`, `outbox_events`, `settlement_items`, `redemption_requests` | Durable submission, indexing, finality, settlement, and redemption. The missing block model is also required. |
| Resolution | `oracle_resolution_proposals`, `market_resolutions` | Evidence and final payout reporting. |
| Administration | `admin_memberships`, `admin_actions`, `approval_requests`, `approval_decisions` | Separate authorization, audit, and high-risk approval. |

This count is conditional: if the MVP is a developer-only test harness with no internal trading balance, the five ledger tables can move to the next phase. They are mandatory before any prefunded or real user value is represented.

### Required for later real-money or scaled trading phases — 11

| Tables | Phase |
|---|---|
| `deposit_intents`, `payment_provider_events` | Verified provider deposits and idempotent posting. |
| `fx_quotes`, `asset_conversions` | KHR/USDC conversion. |
| `treasury_accounts`, `treasury_operations`, `treasury_reconciliations` | Prefunding, controls, and solvency reconciliation. |
| `withdrawal_requests`, `withdrawal_attempts` | Controlled payout. |
| `settlement_batches` | Gas-efficient batching after single-item settlement works. |
| `oracle_disputes` | Formal challenge workflow when governance is approved. |

### Optional, conditional, or potentially unnecessary — 3

| Table | Recommendation |
|---|---|
| `wallet_authorizations` | Keep only if the chosen provider and smart-account policy require changing/revocable authority records. Otherwise use provider evidence plus immutable admin/security audit records. |
| `market_categories` | Product navigation only; it does not block market correctness. Add when the UI needs taxonomy. |
| `trade_fees` | Omit for a zero-fee MVP. Add when multiple fee components or separate ledger postings are approved; a single fee can remain on `trades`. |

The 44-table list does not include the recommended `chain_assets`, `chain_blocks`, or position-reservation correction. Those gaps must be resolved before freezing the implementation count.

## 7. Revised implementation sequence

### Gate 0 — Existing database and ADR readiness

Prerequisites:

- Stage 1.6 adoption status is known for every target environment.
- Custody, exchange execution model, EIP-712 domain, ledger boundary, finality, oracle, and collateral decisions are approved.
- Contract interfaces for the prototype are stable.

Acceptance criteria:

- No open decision changes signer ownership, primary keys, CTF ID derivation, or accounting authority.
- New migrations are tested from an empty database and against an approved sanitized restore.

### Milestone 1 — Chain, asset, contract, and admin foundations

Implement chain configuration, chain asset identity, contract deployments, admin membership, immutable admin audit, and required approvals.

Acceptance criteria:

- One Base testnet USDC identity and each contract version are unambiguous.
- Unauthorized configuration changes fail and approved changes are auditable.

### Milestone 2 — Binary market terms

Implement markets, questions, outcomes, immutable terms/version hash, and state transitions. Categories may wait.

Acceptance criteria:

- One question has exactly two unique, ordered outcomes.
- Terms cannot change after approval/opening.
- Market and question state cannot disagree about whether orders are accepted.

### Milestone 3 — Wallet/custody and CTF registry

Implement user-wallet mapping and the corrected CTF condition/collection/position model. Do not submit transactions yet.

Acceptance criteria:

- Wallet ownership and recovery policy are recorded without secrets.
- Condition and two atomic position IDs are reproduced independently from frozen inputs.

### Milestone 4 — Blockchain submission and canonical indexing

Implement the outbox, transaction attempts, signer nonce control, block-header window, logs, cursors, finality, and reorg processing before using the relayer for markets.

Acceptance criteria:

- A prepared-condition transaction survives worker crashes and replacement.
- Duplicate logs are harmless.
- Short reorg simulation changes canonical state correctly, including a block with no relevant logs.

### Milestone 5 — Ledger and reservation foundation

Implement immutable balanced postings, projections, USDC holds, and the approved position reservation model.

Acceptance criteria:

- Unbalanced postings cannot commit through the supported boundary.
- Concurrent reservations cannot overspend USDC or position quantity.
- Reversals preserve original entries.

### Milestone 6 — Signed orders and deterministic matcher

Implement EIP-712/EIP-1271 verification, nonces, cancellation, orders, matches, trades, partial fills, expiry, self-trade policy, and Redis projection.

Acceptance criteria:

- The same ordered inputs produce identical matches.
- Redis is rebuildable.
- External wallet movement or escrow rules cannot leave an accepted order falsely collateralized.

### Milestone 7 — Single-item on-chain settlement

Settle one match per logical settlement first. Add batching only after correctness and recovery are proven.

Acceptance criteria:

- Finalized chain events, trade quantity, position movement, fees, and ledger effects reconcile exactly.
- Reprocessing and transaction replacement do not double settle.
- Reverted settlement follows an approved order/hold recovery policy.

### Milestone 8 — Oracle, resolution, and redemption

Implement proposal, approval, payout rows/vector validation, finality, redemption, and emergency pause. Add disputes only if governance requires them now.

Acceptance criteria:

- Frozen resolution terms identify the authorized source.
- The payout vector matches outcome count and denominator.
- Duplicate redemption cannot double pay.

### Milestone 9 — Fiat, FX, treasury, and withdrawals

Only after the testnet market reconciles, implement shadow ledger deposits, conversion, treasury controls, real-funds enablement, and payouts.

Acceptance criteria:

- Duplicate provider evidence posts once.
- KHR and USDC movements reconcile independently.
- Treasury controlled assets cover user liabilities under the approved policy.
- Failed payouts reverse pending effects and release reservations.

### Milestone 10 — Legacy transition and production hardening

Reconcile legacy balances, perform dual reads, switch authority behind a controlled rollout, rehearse rollback, complete security review, and define recovery runbooks.

## 8. Product-owner approval required

Product-owner approval is required for:

1. Whether KhmerFP or the user legally and technically controls trading assets.
2. Whether the first exchange supports secondary transfers, complementary minting, or both.
3. Whether real KHR deposits and USDC allocations are in the MVP.
4. Who performs FX conversion and bears spread, rounding, slippage, and failed-payout losses.
5. Market cancellation and invalid-market refund policy.
6. Oracle authority, evidence standard, challenge period, and emergency power.
7. Range-bracket overlap/gap behavior and whether native categorical markets are planned.
8. Trading fees, self-trade behavior, limits, and settlement-failure treatment.
9. Confirmation depth, automatic pause threshold, and deep-reorg loss policy.
10. KYC/AML, retention, privacy, and withdrawal approval requirements.

Technical leads may recommend defaults, but these decisions change user rights, financial liability, or market behavior and must not be inferred from schema design.
