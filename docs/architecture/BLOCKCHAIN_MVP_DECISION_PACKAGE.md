# KhmerFP Blockchain MVP Decision Package

Status: Proposed for product-owner and technical approval

Date: 2026-11-11

Scope: Minimum decisions required before the first blockchain database schema and the first end-to-end binary-market prototype.

Nothing in this document is approved automatically. Each selected recommendation must be recorded in an approved architecture decision record (ADR).

## 1. MVP boundary

The recommended MVP is a technical testnet prototype with:

- One binary YES/NO market at a time.
- Base Sepolia as the only chain.
- A mock ERC-20 collateral token with 6 decimals.
- Gnosis Conditional Tokens Framework (CTF) for outcome positions.
- One user smart-wallet path behind a provider-neutral adapter.
- User-signed EIP-712 orders.
- An off-chain deterministic price-time CLOB.
- On-chain atomic settlement through a versioned exchange contract.
- An authorized, multi-person-reviewed market resolution.
- CTF redemption back to mock collateral.
- No real ABA, Bakong, KHR, USDC treasury, FX, withdrawal, or production custody.

The MVP proves correctness and recovery. It is not a real-money launch and must be visibly labelled testnet-only.

## 2. Decision timing

Stage 2.1 is the decision and ADR gate. No blockchain schema should be generated until the “must decide” group is approved. The second group must close before order, matcher, or settlement schemas are frozen. The third group can wait because real money remains disabled.

### Must decide before completing Stage 2.1 — 10 decisions

| ID | Decision | Why it is needed now |
|---|---|---|
| D-01 | Custody location and ownership | Determines whether balances represent wallet assets, escrow assets, or platform liabilities. |
| D-02 | Wallet provider, signing, recovery, and upgrades | Determines wallet identity, authorization references, and EIP-1271 behavior. |
| D-03 | Exchange execution model | Determines order, trade, CTF inventory, and settlement relationships. |
| D-05 | Chain asset identity and precision | Determines collateral keys, decimals, amount checks, and CTF position derivation. |
| D-06 | Ledger scope and source of truth | Prevents the same mock/real asset from being counted as both on-chain ownership and a platform liability. |
| D-08 | CTF identifier and categorical model | Determines the keys and derivation fields for conditions, collections, and positions. |
| D-09 | Finality, reorg detection, and emergency pause | Determines blockchain event, block, cursor, and finality fields. |
| D-12 | Oracle authority and dispute governance | Market terms must identify who may resolve and approve before a question opens. |
| D-13 | Resolution payout representation | Determines whether resolution uses normalized rows, JSON, and a canonical vector hash. |
| D-18 | Existing database adoption and legacy balances | Stage 2 migrations cannot safely target an existing environment until Stage 1.6 adoption is approved. |

### Can decide before trading implementation — 6 decisions

These decisions do not block the first chain/asset/market schemas, but they block order, matcher, relayer, or settlement implementation.

| ID | Decision | Latest safe approval point |
|---|---|---|
| D-04 | EIP-712 domain, nonce, and cancellation policy | Before defining `orders` and `order_nonces`. |
| D-07 | Reservation model and available balance | Before accepting any open order. |
| D-10 | Relayer signer and transaction recovery | Before submitting CTF or exchange transactions. |
| D-11 | Trade finality and failed-settlement policy | Before defining match/trade state transitions. |
| D-14 | Binary range and native categorical policy | Before allowing multi-question range products; ordinary binary MVP may proceed. |
| D-17 | Fees, rounding, and self-trade policy | Before matcher arithmetic and signed settlement amounts are frozen. |

### Can defer until real-money launch — 2 decisions

| ID | Decision | Why it may wait |
|---|---|---|
| D-15 | Treasury ownership and FX policy | The prototype uses faucet-issued mock collateral and performs no KHR conversion. |
| D-16 | Withdrawal, payout, and compliance policy | The prototype has no ABA/Bakong payout and no redeem-to-fiat path. |

Although D-15 and D-16 may be deferred, no real deposit, prefunded USDC allocation, withdrawal, or production treasury feature may start before they are approved.

## 3. Recommended choices for Stage 2.1 blockers

### D-01 — Custody location and ownership

- **Simple explanation:** Decide who controls assets while a user is trading.
- **Recommended choice:** The user controls a smart wallet. Assets committed to active trading move to or are authorized for a narrowly scoped exchange/escrow contract. KhmerFP may sponsor gas and coordinate settlement but does not hold an unrestricted user signing key.
- **Alternative:** A platform omnibus wallet with internal user balances.
- **Main trade-off:** Smart-wallet plus escrow reduces unrestricted platform custody but adds contract, allowance, recovery, and settlement complexity. Omnibus custody is simpler operationally but creates greater legal, security, and solvency risk.
- **Exact dependency:** `user_wallets`, wallet ownership fields, chain asset ownership, reservations, position projections, orders, settlement contract, redemption, and future ledger/treasury boundaries.

For the mock MVP, escrow contains test assets only. Production custody requires a separate security and legal approval.

### D-02 — Wallet provider, signing, recovery, and upgrades

- **Simple explanation:** Decide which wallet integration is used and who can recover or upgrade a wallet.
- **Recommended choice:** Use a provider-neutral wallet adapter with one approved smart-wallet provider for the MVP. Require EIP-1271 support, explicit user authorization, disclosed provider recovery, gas sponsorship, and no unrestricted platform signing authority.
- **Alternative:** Embedded EOA controlled through a provider, or a fully custodial platform wallet.
- **Main trade-off:** Smart accounts improve gasless UX and policy controls but introduce provider, upgrade-key, and EIP-1271 dependencies.
- **Exact dependency:** `user_wallets`, optional `wallet_authorizations`, signer verification, recovery audit events, EIP-712 verification, redemption, and relayer behavior.

The provider remains unselected until product and security owners approve Privy, Coinbase Smart Wallet, or another reviewed option.

### D-03 — Exchange execution model

- **Simple explanation:** Decide whether trades transfer existing positions or create new YES/NO positions from collateral.
- **Recommended choice:** Use secondary position transfer for the first CLOB settlement path. A controlled test-liquidity wallet creates complete sets by splitting mock collateral before trading. Add complementary YES/NO mint matching later as a separate execution type.
- **Alternative:** Match complementary YES and NO buyers and atomically split collateral during every settlement.
- **Main trade-off:** Secondary transfer is easier to verify but requires seeded inventory and is less capital-efficient. Complementary minting improves primary liquidity but makes order, match, and settlement accounting more complex.
- **Exact dependency:** `orders`, `order_matches`, `trades`, settlement items, exchange contract methods/events, position reservations, CTF split operations, and liquidity workflow.

### D-05 — Chain asset identity and precision

- **Simple explanation:** Identify exactly which token is collateral and how amounts are counted.
- **Recommended choice:** Add a chain-asset registry. The MVP collateral is one mock ERC-20 deployed on Base Sepolia with 6 decimals. Store quantities in raw integer units. Store prices in millionths from `0` through `1_000_000`. Record address, decimals, activation block, and contract version.
- **Alternative:** Store only a text value such as `MOCK_USDC` or infer the token from a contract role.
- **Main trade-off:** A registry adds one foundational model but prevents test/production tokens and decimal rules from being confused.
- **Exact dependency:** Chain and asset schemas, market collateral FK, CTF position derivation, order arithmetic, trades, settlement, future ledger accounts, and treasury.

### D-06 — Ledger scope and source of truth

- **Simple explanation:** Decide which balances PostgreSQL accounts for and which balances come only from Base.
- **Recommended choice:** During the developer MVP, finalized Base state is authoritative for mock collateral and CTF ownership; PostgreSQL stores rebuildable projections. Implement the double-entry ledger before any platform-controlled, prefunded, fiat-derived, fee, or real USDC balance is exposed. The future ledger records only platform-controlled assets and obligations, not arbitrary self-custodied wallet assets.
- **Alternative:** Build a full internal mock-collateral ledger before the first market.
- **Main trade-off:** Deferring the ledger shortens the technical prototype, but the prototype cannot claim a production trading balance or connect real payments. Implementing it now proves accounting earlier but increases the first milestone substantially.
- **Exact dependency:** Ledger tables, balance holds, user-visible balances, order reservations, settlement accounting, deposits, treasury, redemption credits, and withdrawals.

This recommendation does not conflict with the approved requirement for a double-entry ledger: it delays it only while collateral is valueless testnet material.

### D-08 — CTF identifier and categorical model

- **Simple explanation:** Store every input needed to reproduce an outcome token ID.
- **Recommended choice:** Record chain asset/collateral, CTF contract, oracle, question ID, outcome slot count, parent collection ID, index set, collection ID, and position ID. Support atomic binary positions first. Keep arbitrary composite positions disabled. Preserve outcome-index-based design so atomic categorical outcomes can be added later.
- **Alternative:** Store only condition ID, outcome ID, collection ID, and position ID.
- **Main trade-off:** Additional derivation fields make validation stronger and future categorical support safer, at the cost of a slightly larger registry.
- **Exact dependency:** `market_outcomes`, `ctf_conditions`, corrected `ctf_position_tokens`, CTF identifier tests, orders, position projections, settlement, and redemption.

### D-09 — Finality, reorg detection, and emergency pause

- **Simple explanation:** Decide when a Base result is final and how replaced blocks are handled.
- **Recommended choice:** Store a rolling canonical block-header window including number, hash, and parent hash. Use Base safe/finalized signals plus an approved minimum confirmation count. Automatically pause settlement, resolution, and redemption when RPC sources disagree or a reorg exceeds the tested window.
- **Alternative:** Use a fixed confirmation count and inspect only blocks containing relevant events.
- **Main trade-off:** Block-header tracking and pause controls add worker logic but prevent silent state corruption when a replaced block contains no KhmerFP event.
- **Exact dependency:** Recommended `chain_blocks`, `blockchain_events`, `chain_sync_cursors`, transaction finality, position projections, settlement, resolution, redemption, and incident runbooks.

The exact confirmation number remains an environment setting that must be approved during the ADR; it must not be guessed in a schema default.

### D-12 — Oracle authority and dispute governance

- **Simple explanation:** Decide who may propose, approve, and submit a winning outcome.
- **Recommended choice:** For the MVP, use an authorized platform oracle with separate proposer, second reviewer, and on-chain submitter roles. Freeze evidence source and resolution rule before opening. Use an explicit review period; do not advertise a public dispute process that is not implemented.
- **Alternative:** A single admin signer, or an external optimistic/dispute oracle.
- **Main trade-off:** Multi-person platform review is practical for a prototype but remains more centralized than an external dispute oracle.
- **Exact dependency:** Market terms, admin roles, approval records, resolution proposals/payouts, CTF reporting transaction, emergency cancellation, and redemption.

### D-13 — Resolution payout representation

- **Simple explanation:** Store the payout in a form that cannot change outcome order accidentally.
- **Recommended choice:** Store one immutable payout row per outcome and a canonical ordered vector hash. For a binary winner, numerators are `[1,0]` or `[0,1]` with denominator `1`. Validate coverage, uniqueness, order, nonnegative values, and exact sum before submission.
- **Alternative:** Store only a JSON payout vector.
- **Main trade-off:** Normalized rows add a small table but allow strong foreign keys and constraints; JSON alone is simpler but easier to misorder or under-validate.
- **Exact dependency:** Resolution proposal schema, final market resolution, outcome ordering, contract calldata, evidence/audit hash, and redemption calculations.

### D-18 — Existing database adoption and legacy balances

- **Simple explanation:** Decide how new schemas reach databases that already contain runtime-created tables.
- **Recommended choice:** Finish Stage 1.6 read-only catalog inspection and parity approval before applying Stage 2 migrations to any existing environment. Test new migrations from empty PostgreSQL and a sanitized restore. Do not change legacy balance authority during the blockchain prototype.
- **Alternative:** Use a separate clean prototype database and postpone existing-environment adoption.
- **Main trade-off:** A clean database isolates development but postpones integration. Existing-database adoption provides realism but requires backup, parity, migration-history, and rollback controls.
- **Exact dependency:** Migration ordering, deployment environment, existing nine tables, runtime DDL retirement, future ledger cutover, and rollback procedure.

Using a separate clean prototype database is acceptable only if it is clearly isolated and does not bypass the Stage 1.6 gate for later integration.

## 4. Decisions required before trading implementation

These recommendations should be recorded now when possible, but their schemas do not belong in the first chain/market migration.

### D-04 — EIP-712 orders

Recommend a versioned domain bound to Base Sepolia chain ID and the exact exchange contract. Use a unique order hash/salt, wallet-scoped minimum nonce for bulk cancellation, explicit individual cancellation, expiry, maximum fill quantity, and settlement-time EOA/EIP-1271 verification.

Alternative: one strictly increasing nonce per wallet. It is simpler but makes concurrent orders and selective cancellation awkward.

### D-07 — Reservations

Recommend wallet/escrow-scoped position reservations for sell orders and collateral reservations for buy orders, linked through an order-reservation relation. For the mock MVP without a ledger, these are trading reservations backed by confirmed escrow balances, not accounting entries.

Alternative: rely only on settlement-time balance checks. This is acceptable for an internal experiment but causes avoidable failed matches and is not acceptable for a public MVP.

### D-10 — Relayer recovery

Recommend one Base Sepolia signer stored in an approved KMS/provider, durable sender/nonce allocation, signed transaction hash persisted before broadcast, and explicit replacement lineage. Never store a private key in PostgreSQL.

Alternative: a third-party relayer/bundler, which reduces key operations but adds dependency and recovery constraints.

### D-11 — Trade finality

Recommend immutable match plus pending trade at CLOB execution, and final trade only after canonical settlement events reach finality. Failed settlement cancels or retries only within the original signed expiry and remaining quantity; it never silently rematches more quantity.

Alternative: create trades only after finality. This keeps the trade table simpler but loses a clear durable record of pending economic intent.

### D-14 — Categorical policy

Recommend ordinary binary markets only in the MVP. Independent range binaries may be designed later with explicit overlap and gap rules. Native categorical conditions remain disabled, while outcome-index and CTF derivation fields stay compatible with future atomic categorical positions.

Alternative: implement native categorical CTF now, which expands UI, liquidity, payout validation, and settlement scope without helping prove the first binary path.

### D-17 — Fees, rounding, and self-trading

Recommend zero trading fees for the technical MVP, deterministic integer rounding, a minimum raw-unit order size, explicit dust handling, and rejection of self-trades. Add a versioned maker/taker fee schedule only before production.

Alternative: implement production fees immediately, which proves accounting earlier but changes signatures, reservations, settlement legs, and ledger postings.

## 5. Coherent MVP architecture

### Identity and wallet

- Reuse existing `users` and authentication.
- Create one active Base Sepolia smart-wallet mapping per user.
- Store provider references and policy metadata only; never store signing or recovery secrets.
- Verify signatures through EOA recovery or EIP-1271 according to wallet type.

### Chain, collateral, and contracts

- Register Base Sepolia, the mock 6-decimal collateral, CTF, exchange/escrow, and oracle contract deployments.
- Pin contract versions, activation blocks, ABI hashes, and EIP-712 domain version.
- Deploy or select a reviewed CTF instance for the environment and record its exact address; do not assume an address.

### Market and CTF

- One market contains one binary question for the first prototype.
- The question has exactly two immutable ordered outcomes.
- Freeze a market-terms hash before opening.
- Prepare one CTF condition and derive two atomic position IDs from stored inputs.
- A controlled test-liquidity wallet splits mock collateral into complete sets to seed secondary trading.

### Trading and settlement

- Users sign orders; the API validates the domain, signature, nonce, expiry, market, precision, and available escrow inventory.
- PostgreSQL is the durable source for open orders, reservations, matches, pending trades, and outbox work.
- Redis is a disposable order-book and WebSocket projection.
- The CLOB uses deterministic price-time priority.
- The exchange contract atomically moves mock collateral and the selected CTF position for a secondary trade.
- Canonical indexed events, not an API response alone, finalize the trade and position projections.

### Resolution and redemption

- An authorized proposer submits evidence and normalized payouts.
- A different reviewer approves the resolution.
- The oracle submitter reports the payout vector on-chain.
- After finality, users redeem winning positions to mock collateral.
- Event-derived projections are rebuilt and reconciled against Base.

## 6. End-to-end prototype workflow

### User → Wallet

1. Existing authentication identifies the user.
2. The wallet adapter creates or links a Base Sepolia smart wallet.
3. `user_wallets` records address, wallet type, provider reference, ownership mode, and status.
4. The user receives faucet mock collateral and deposits or authorizes only the amount required by the approved exchange/escrow design.

### Wallet → Market

1. An authorized admin creates a draft binary market.
2. The market stores one question, two ordered outcomes, collateral asset, closing time, resolution source, and immutable terms hash.
3. A separate reviewer approves it.
4. The market opens only after its contracts, collateral, and resolution policy are valid.

### Market → Order

1. The client receives a canonical EIP-712 order payload.
2. The wallet signs market, position token, side, price, quantity, nonce, salt, and expiry under the pinned domain.
3. The API verifies the signature and confirms escrow inventory/reservation capacity.
4. The order and reservation commit atomically in PostgreSQL, with an outbox event.

### Order → Match

1. The CLOB processes open orders in deterministic price-time order.
2. It locks/revalidates orders and reservations.
3. It records one immutable match and one pending trade.
4. It creates one settlement item and outbox event.

### Match → CTF

1. The traded asset is an already-created atomic YES or NO CTF position.
2. The settlement worker independently recomputes the expected condition and position identifiers.
3. It verifies original signatures, remaining fill quantity, nonces, expiry, and contract domain again.

### CTF → Settlement

1. The relayer allocates a sender nonce, signs, persists the expected hash, and broadcasts.
2. The exchange contract atomically transfers the CTF position and mock collateral.
3. The indexer stores block headers, receipt, and unique logs.
4. The trade remains pending while mined.
5. After approved finality, canonical events finalize the trade and rebuild position/collateral projections.
6. A revert or reorg follows the explicit retry/cancel policy and never creates a second fill.

### Settlement → Resolution

1. Closing stops new orders and releases unmatched reservations.
2. The oracle proposer records evidence and one payout per outcome.
3. A separate reviewer approves the exact ordered vector.
4. The relayer reports payouts to CTF.
5. Canonical final events mark the condition and market resolved.

### Resolution → Redemption

1. The user submits an idempotent redemption request.
2. The system verifies final resolution and available winning position quantity.
3. The wallet or approved relayer executes CTF redemption.
4. Canonical burn and collateral-transfer events finalize the request.
5. Projections reconcile with the user wallet/escrow and total CTF supply.

## 7. Conflicts with previously approved architecture

No recommendation changes the previously confirmed direction.

| Previous direction | Compatibility assessment |
|---|---|
| Hybrid custody | Consistent. This package proposes a concrete smart-wallet plus narrowly scoped exchange/escrow interpretation, but it still requires approval. |
| Base L2 and USDC collateral | Consistent. Base Sepolia and mock 6-decimal collateral are test-only substitutes before production Base/USDC. |
| Gnosis CTF | Consistent. The package strengthens position-ID derivation and limits the MVP to atomic binary positions. |
| Binary markets first | Consistent. Native categorical trading remains deferred. |
| Independent binary range sub-markets | Consistent. Each retains its own complete-set collateral relationship. |
| Off-chain CLOB and on-chain settlement | Consistent. The package makes pending/final states and recovery explicit. |
| EIP-712 gasless orders | Consistent. Domain, nonce, cancellation, and EIP-1271 rules still need approval. |
| Append-only double-entry ledger | Consistent. The ledger remains mandatory before real or prefunded value; it may be deferred only for valueless mock collateral. |
| ABA/Bakong and prefunded treasury | Consistent but outside the testnet MVP. D-15 and D-16 block enabling these real-money paths. |
| Wallet provider pending | Consistent. The adapter is provider-neutral; no provider is selected automatically. |

The only scope reduction is secondary-transfer-only matching for the first settlement path. Complementary matching remains a planned later execution type rather than being removed.

## 8. Deferred decisions and prohibited scope

Until D-15 and D-16 are approved, the prototype must not:

- Accept real KHR deposits into a blockchain trading balance.
- Allocate production USDC from treasury.
- Present mock collateral as redeemable money.
- Pay ABA/Bakong withdrawals.
- Create production treasury accounts or signer limits.
- Claim KYC/AML, FX, or payout readiness.

Until the six pre-trading decisions close, the project may design chain, asset, admin, market, and CTF registry schemas, but it must not freeze order/trade schemas or expose public trading.

## 9. Product-owner approval checklist

Check each item explicitly; unchecked means not approved.

- [ ] Approve the testnet-only MVP boundary and confirm that no real money is used.
- [ ] Approve user smart wallets plus narrowly scoped exchange/escrow as the target hybrid-custody model.
- [ ] Select or authorize security review of the embedded smart-wallet provider.
- [ ] Approve secondary position transfer as the first CLOB execution model.
- [ ] Approve Base Sepolia and one 6-decimal mock collateral asset.
- [ ] Approve deferring the double-entry ledger only for valueless mock collateral.
- [ ] Approve atomic binary CTF positions and defer composite/native categorical trading.
- [ ] Approve multi-person authorized oracle governance for the MVP.
- [ ] Approve normalized payout rows plus a canonical vector hash.
- [ ] Approve the finality/reorg pause policy being defined before relayer work.
- [ ] Confirm Stage 1.6 remains a gate for existing-database deployment.
- [ ] Confirm real ABA/Bakong, FX, treasury USDC, and withdrawals are out of MVP scope.
- [ ] Assign owners and approval dates for D-04, D-07, D-10, D-11, D-14, and D-17 before trading implementation.

Approval should record reviewer name, role, date, decision IDs, and any conditions in ADRs. Editing this checklist alone is not sufficient evidence of approval.

## 10. Next implementation task after approval

After the Stage 2.1 decision package and required ADRs are approved, implement one small database foundation milestone:

1. Define the Drizzle schemas for `chains`, the approved `chain_assets` concept, and `contract_deployments`.
2. Add strict chain ID, address/byte, decimals, environment, activation-block, and one-active-version constraints.
3. Generate one forward migration without executing it.
4. Extend offline artifact validation and disposable PostgreSQL 16 catalog tests.

Do not include markets, wallets, orders, CTF conditions, ledger, payments, or settlement in that first coding task. This keeps the first migration small and gives every later blockchain table an unambiguous chain, collateral, and contract reference.
