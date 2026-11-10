# KhmerFP Blockchain Data Workflows

Status: Proposed Stage 2.0 workflows. No blockchain workflow is implemented yet.

## 1. Workflow principles

- Accept a command once, then make retries safe with an idempotency key.
- Commit business state and an outbox event in one PostgreSQL transaction.
- Let workers perform external provider or blockchain actions.
- Treat submitted and mined blockchain transactions as pending.
- Mark financial and position results final only after the configured Base confirmation depth.
- Use compensating ledger entries and projection reversals; never delete financial history.

## 2. Registration and wallet creation

1. Existing authentication creates or resolves `users` and an authenticated session.
2. The wallet service requests an embedded wallet from the approved provider.
3. PostgreSQL creates `user_wallets` in `PENDING` with the provider reference and expected Base address.
4. Provider proof or an on-chain smart-account deployment confirms the address.
5. The wallet becomes `ACTIVE` and primary.
6. Create the user's KHR liability, USDC trading liability, and required clearing ledger accounts.
7. Record an `admin_action` or security audit event for recovery/ownership policy changes.

Failure handling:

- Repeating registration returns the existing provider wallet.
- A conflicting chain/address unique constraint blocks accidental cross-user assignment.
- No private key or recovery secret enters PostgreSQL logs.

## 3. ABA/Bakong deposit to USDC trading balance

Example: A user deposits 400,000 KHR and receives an approved USDC allocation.

1. Create a user-owned `deposit_intent` with amount, currency, provider, expiry, and idempotency key.
2. Create the provider transaction using the existing ABA or Bakong integration.
3. Store each callback or polling result as a `payment_provider_event` after signature/provider verification.
4. Lock the deposit intent and provider reference.
5. If already `POSTED`, return the existing result without a new credit.
6. Post the KHR deposit ledger transaction once:
   - Debit: treasury/provider KHR asset account.
   - Credit: user KHR liability account.
7. Obtain or bind an unexpired approved `fx_quote`.
8. Create `asset_conversions` and reserve prefunded treasury USDC.
9. Post the conversion using balanced entries for both assets and explicit FX/fee accounts.
10. Credit the user's USDC trading liability only after treasury allocation is accepted.
11. Mark the deposit `POSTED` and link the unique ledger transaction.

Important: A KHR receipt and a USDC allocation are two accounting events. Do not hide them in one mutable balance update.

Transition from current code:

- Existing `transactions` and `bakong_payments` remain provider records.
- Add a nullable unique link to `deposit_intents` and the posted ledger transaction in a later migration.
- During controlled rollout, compare legacy wallet credits with ledger projections before making the ledger authoritative.

## 4. Admin market creation

1. An authorized admin creates `markets` as `DRAFT`.
2. Attach a category and localized content.
3. Define closing time, resolution source, collateral, fee/risk limits, and cancellation policy.
4. Create one or more `market_questions`.
5. Create outcomes in stable index order.
6. A second authorized reviewer approves the market through `approval_requests` when policy requires it.
7. Validate that timestamps, outcome counts, and resolution rules are immutable after opening.
8. Move the market to `SCHEDULED`, then `OPEN` through a worker at the approved time.

Every create, approve, edit, cancel, and emergency action produces an immutable `admin_action`.

## 5. Binary and categorical structures

### Binary

One `market_question` has two outcomes and one CTF condition.

Example:

- Question: “Will gasoline exceed 5,000 KHR/litre on 30 June?”
- Outcome 0: YES
- Outcome 1: NO
- One complete set consists of YES plus NO for that condition.

### Range brackets using independent binary questions

A user-facing market may contain:

- Below 4,500: YES/NO condition A
- 4,500–5,000: YES/NO condition B
- Above 5,000: YES/NO condition C

Each condition has its own $1 complete set. There is no single shared $1 pool across A, B, and C. Overlap and gap rules require approval because independent binaries do not enforce mutual exclusivity on-chain.

### Native categorical condition

A future native categorical question would use one condition with more than two outcome slots. This is not part of the first implementation and requires a separate collateral, UI, resolution, and liquidity review.

## 6. CTF condition preparation

1. Final market review freezes the question hash, oracle, and outcome count.
2. Create `ctf_conditions` as `PLANNED`.
3. Commit an outbox event for the relayer.
4. Relayer creates `blockchain_transactions` and calls CTF `prepareCondition`.
5. Store submitted hash and mark `SUBMITTED`.
6. Event indexer observes the event and stores a unique `blockchain_event`.
7. After finality, mark the condition `PREPARED`.
8. Derive and store each collection/position ID in `ctf_position_tokens`.
9. Recompute identifiers independently and fail if contract events disagree.

## 7. Order placement

1. Client requests an order payload containing market, token, side, price, quantity, expiry, nonce, and salt.
2. Client signs the EIP-712 typed data with the approved wallet.
3. API verifies:
   - Market and question are open.
   - Chain ID, exchange contract, and EIP-712 version match.
   - Signature is valid through EOA recovery or EIP-1271.
   - Nonce is not cancelled and typed-data hash is new.
   - Price and quantity use approved precision.
4. Lock the user's balance/position projection.
5. Create an `ACTIVE` hold for required USDC or position quantity.
6. Insert the order as `OPEN` with the hold in one transaction.
7. Insert an outbox event for the matcher.
8. Redis receives a rebuildable order-book projection.

If any step fails, the order is rejected and no hold remains.

## 8. Matching and trade creation

1. Matcher consumes orders in deterministic price-time order.
2. It locks both order rows using a single database transaction or processes a strictly sequenced partition.
3. Revalidate remaining quantity, expiry, cancellation, and holds.
4. Insert `order_matches` with a unique sequence.
5. Update filled quantities and statuses.
6. Capture or resize holds for the matched quantity; release unused holds when terminal.
7. Insert exactly one `trade` per match.
8. Insert fee components.
9. Create `settlement_items` and an outbox event.

The match is economically pending until on-chain settlement is final.

## 9. On-chain trade settlement

1. Settlement worker groups compatible items into a batch.
2. Verify signatures, nonce state, balances, and contract domain again.
3. Relayer reserves its transaction nonce in PostgreSQL.
4. Submit the exchange settlement call and record the transaction hash.
5. Mark batch/items `SUBMITTED`; do not finalize balances yet.
6. Index the mined receipt and decoded exchange/CTF transfer events.
7. If reverted, mark failure, release/rebuild holds, and route the trade according to the approved retry policy.
8. If mined, wait for configured confirmations.
9. On finality:
   - Mark settlement items and trades final.
   - Post fee and collateral ledger transactions exactly once.
   - Update rebuildable position projections from canonical events.
   - Release captured holds.
10. Reconcile event quantities with submitted settlement items.

## 10. Chain synchronization and reorganization handling

The indexer stores block number and block hash for every event.

1. Scan from the last known cursor with a configurable overlap.
2. Upsert logs using `(chain_id, tx_hash, log_index)`.
3. Mark new logs `OBSERVED`, not final.
4. Compare stored block hashes with the canonical RPC chain.
5. If a block is replaced:
   - Mark its events noncanonical and record `reverted_at`.
   - Roll back pending projections through deterministic compensating operations.
   - Return affected transactions/settlements to a recoverable state.
6. Advance `last_finalized_block` only after confirmation depth.
7. Apply finalized projections in block/log order.

Deep reorgs beyond the assumed finality window require an incident runbook and treasury reconciliation. The approved policy must say whether trading pauses automatically.

## 11. Market resolution

1. Market closes and rejects new orders.
2. Cancel remaining orders and release holds.
3. Authorized oracle/admin creates a resolution proposal with evidence and payout vector.
4. Validate outcome count, vector values, and sum required by CTF.
5. Enter the challenge window.
6. Record disputes and evidence without modifying the original proposal.
7. Required approvers confirm or reject the result.
8. Relayer submits CTF payout reporting.
9. Index the resolution event.
10. After finality, mark `market_resolutions` and `ctf_conditions` resolved.
11. Market enters `RESOLVED`, then `SETTLED` when reconciliation is complete.

## 12. Redemption and payout

1. User requests redemption with an idempotency key.
2. Verify condition finality and projected position quantity.
3. Reserve the position quantity.
4. Submit CTF redemption through the user wallet or approved relayer path.
5. Index burn and collateral transfer events.
6. After finality, mark the request complete and update projections.
7. If collateral enters a controlled treasury/escrow, post the matching user USDC ledger credit exactly once.
8. Reconcile redeemed quantity, payout vector, and received collateral.

## 13. USDC withdrawal to ABA/Bakong

1. Create `withdrawal_requests` with user idempotency key and approved destination reference.
2. Hold the user's USDC trading liability.
3. Obtain an FX quote and calculate expected KHR payout.
4. Run limits, compliance, treasury liquidity, and approval checks.
5. Post conversion/clearing ledger entries.
6. Create a unique provider payout attempt.
7. Verify provider result through authenticated evidence.
8. On success, capture the hold, post final balanced entries, and mark `PAID`.
9. On failure, reverse pending conversion entries and release the hold.
10. Reconcile provider payout totals with treasury and ledger balances.

## 14. Idempotency matrix

| Workflow | Idempotency boundary |
|---|---|
| Deposit creation | `(user_id, idempotency_key)` |
| Provider event | `(provider, provider_event_id)` or approved payload hash |
| Ledger posting | `(transaction_type, idempotency_key)` |
| Order submission | typed-data hash and `(wallet_id, client_order_id)` |
| Match | global match sequence plus execution tuple |
| Trade | unique `match_id` |
| Settlement | unique `trade_id` in `settlement_items` |
| Blockchain event | `(chain_id, tx_hash, log_index)` |
| Redemption | `(user_id, idempotency_key)` |
| Withdrawal | `(user_id, idempotency_key)` and provider attempt number |

## 15. Operational failure examples

### Provider callback arrives twice

The second provider event conflicts with the unique provider key, reads the already posted ledger transaction, and returns success without another credit.

### Relayer submits but crashes before saving the receipt

Transaction hash is already stored before/with submission state. The monitor queries by hash and resumes receipt processing.

### Settlement is mined and then reorganized

The event becomes noncanonical. Pending projections are reversed. Final financial posting must not have occurred before the confirmation threshold.

### Redis is lost

Rebuild the order book from PostgreSQL `OPEN` and `PARTIALLY_FILLED` orders. No financial or order history is lost.
