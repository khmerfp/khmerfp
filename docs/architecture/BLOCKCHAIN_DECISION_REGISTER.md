# KhmerFP Blockchain Architecture Decision Register

Status: Decisions proposed for approval before Stage 2 implementation

Register date: 2026-11-11

Decision states:

- `BLOCKING`: implementation would likely be redesigned if the decision changes.
- `PRODUCTION BLOCKING`: a testnet prototype may proceed, but real value must remain disabled.
- `NON-BLOCKING FOR BINARY MVP`: record the boundary now and decide before the affected later phase.

Recommendations below are design advice, not recorded approvals.

## D-01 — Custody location and ownership

- **Decision required:** Where USDC and CTF positions are held while orders are open and trades settle.
- **Options:** User smart wallets; exchange escrow contract; platform omnibus wallet with internal liabilities; hybrid by workflow.
- **Recommended option:** User smart wallets with a narrowly scoped audited exchange/escrow contract for active trading. Use platform treasury custody only for explicitly allocated prefunded USDC, with per-user liabilities in the ledger.
- **Reason:** It limits unrestricted platform control while allowing enforceable reservations and atomic settlement.
- **Risks:** Smart-contract loss, allowance abuse, recovery complexity, or insolvency if omnibus assets and liabilities diverge.
- **Affected:** `user_wallets`, ledger tables, reservations, orders, positions, settlement, redemption, treasury, withdrawal workflows.
- **Status:** `BLOCKING`.

## D-02 — Wallet provider, signing, recovery, and upgrades

- **Decision required:** Privy or Coinbase Smart Wallet; EOA or smart account; who can recover or upgrade it; whether KhmerFP can initiate user transactions.
- **Options:** User-only signing; provider-assisted recovery; platform co-signing; fully custodial signing.
- **Recommended option:** Smart account with user authorization, provider-assisted disclosed recovery, platform gas sponsorship, and no unrestricted platform signing key.
- **Reason:** Supports EIP-1271 and gasless UX without silently turning every wallet into platform custody.
- **Risks:** Provider lock-in, upgrade-key compromise, recovery takeover, EIP-1271 behavior changes.
- **Affected:** `user_wallets`, `wallet_authorizations`, orders, redemption, relayer, admin/security audit.
- **Status:** `BLOCKING`.

## D-03 — Exchange execution model

- **Decision required:** Whether matching supports secondary position transfer, complementary YES/NO orders that mint complete sets, or both.
- **Options:** Secondary trading only; complementary minting only; both as explicit execution types.
- **Recommended option:** Support both eventually, but implement one explicit execution type per settlement path. Start with the contract path that can be proven atomically on testnet; never infer execution type from buyer/seller fields.
- **Reason:** Mint/split and transfer paths have different inputs, counterparties, collateral legs, and events.
- **Risks:** Incorrect collateral accounting, unmatched token supply, settlement contract ambiguity.
- **Affected:** `orders`, `order_matches`, `trades`, `settlement_items`, CTF positions, ledger postings, exchange contract.
- **Status:** `BLOCKING`.

## D-04 — EIP-712 domain, nonce, and cancellation policy

- **Decision required:** Domain name/version, chain ID, verifying contract, order type hash, nonce scope, individual cancellation, bulk cancellation, salt, expiry, and EIP-1271 rules.
- **Options:** Monotonic nonce; minimum nonce by scope; bitmap/nonces; signed off-chain cancellation plus on-chain cancellation where required.
- **Recommended option:** Versioned domain bound to chain and exchange contract, unique salt/order hash, per-wallet scoped minimum nonce for bulk cancel, explicit individual cancellation, and settlement-time verification.
- **Reason:** Prevents cross-chain, cross-contract, and old-version replay while allowing practical cancellation.
- **Risks:** Replay, impossible cancellation, invalid orders after contract upgrades, mutable EIP-1271 validity.
- **Affected:** `order_nonces`, `orders`, blockchain transactions, settlement contract and workflow.
- **Status:** `BLOCKING`.

## D-05 — Chain asset identity and amount precision

- **Decision required:** How USDC is identified per environment and how raw units, prices, fees, and rounding are represented.
- **Options:** Text asset codes; contract deployment roles; dedicated chain-asset registry.
- **Recommended option:** Add a chain-asset registry keyed by chain and token address, with decimals and activation history. Store token quantities in raw integer units and price in an approved fixed scale; define rounding per operation.
- **Reason:** `USDC_BASE` text cannot distinguish test tokens, upgrades, bridged variants, or decimals.
- **Risks:** Paying or accounting with the wrong token, rounding leakage, inconsistent CTF IDs.
- **Affected:** Markets, ledger accounts/entries, CTF positions, orders, trades, treasury, conversions, settlement.
- **Status:** `BLOCKING`.

## D-06 — Ledger scope and source of truth

- **Decision required:** Which balances are platform liabilities and which are on-chain projections only.
- **Options:** Ledger everything; ledger only controlled assets/liabilities; use blockchain alone for trading assets.
- **Recommended option:** Ledger all platform-controlled assets, user liabilities, fees, clearing, FX, and treasury movements. Treat self-custodied tokens as on-chain assets with rebuildable projections, not ledger liabilities.
- **Reason:** Avoids double counting and keeps accounting aligned with legal/technical control.
- **Risks:** Insolvency hidden by duplicate representations, incorrect withdrawals, irreconcilable statements.
- **Affected:** All ledger, wallet, position, payment, treasury, settlement, redemption, and withdrawal records.
- **Status:** `BLOCKING`.

## D-07 — Reservation model and available balance

- **Decision required:** How open orders reserve USDC and CTF positions, including partial fills, fees, expiry, and concurrent orders.
- **Options:** Ledger-only holds; position-specific reservations; general typed asset reservations; on-chain escrow only.
- **Recommended option:** Ledger holds for internal USDC liabilities and wallet/custody-scoped position reservations for CTF quantities, both linked through an order-reservation relation. Define available balance by account normal side.
- **Reason:** The proposed `balance_holds.account_id` cannot reserve ERC-1155 positions.
- **Risks:** Overselling, negative availability, stuck holds, double capture.
- **Affected:** `balance_holds`, orders, position projections, missing reservation concept, settlement and cancellation.
- **Status:** `BLOCKING`.

## D-08 — CTF identifier and categorical model

- **Decision required:** Supported CTF position kinds and the exact derivation data stored.
- **Options:** Binary atomic positions only; all atomic categorical positions; arbitrary composite collections.
- **Recommended option:** Store collateral asset, parent collection, index set, collection ID, position ID, and outcome mapping now. Support atomic binary positions first, atomic categorical later, and reject composite trading until reviewed.
- **Reason:** Preserves categorical compatibility without implementing unnecessary composite complexity.
- **Risks:** Irreproducible IDs, wrong token mapping, incompatible later migration.
- **Affected:** `market_outcomes`, `ctf_conditions`, `ctf_position_tokens`, orders, settlement, redemption.
- **Status:** `BLOCKING` for schema; categorical launch is non-blocking.

## D-09 — Finality, reorg detection, and emergency pause

- **Decision required:** Confirmation depth, canonical block storage, maximum automatic rollback, deep-reorg behavior, and which operations pause.
- **Options:** Fixed confirmations; safe/finalized RPC tags; hybrid policy with a minimum confirmation count.
- **Recommended option:** Use Base safe/finalized signals plus an approved minimum depth, store a rolling canonical block-header window, and automatically pause settlement/redemption on a reorg beyond the tested window.
- **Reason:** Event-only scanning misses blocks with no relevant logs and mined is not final.
- **Risks:** Double settlement, incorrect positions, unavailable funds, unsafe continuation during RPC disagreement.
- **Affected:** `blockchain_events`, `chain_sync_cursors`, missing `chain_blocks`, transactions, settlement, positions, resolution, redemption, ledger timing.
- **Status:** `BLOCKING`.

## D-10 — Relayer signer and transaction recovery

- **Decision required:** Signer storage, nonce allocation, replacement policy, fee escalation, and crash recovery.
- **Options:** One managed signer; HSM/KMS signer pool; smart-account bundler; third-party relayer.
- **Recommended option:** Environment-scoped managed signer in KMS/HSM or approved provider, durable sender/nonce allocation, pre-signed transaction hash persisted before broadcast, and explicit replacement lineage.
- **Reason:** Database commit and RPC submission are not atomic.
- **Risks:** Nonce collision, duplicate economic action, stuck transactions, key compromise.
- **Affected:** `blockchain_transactions`, settlement batches/items, CTF preparation, resolution, redemption, treasury operations.
- **Status:** `BLOCKING` for on-chain execution.

## D-11 — Trade finality and failed-settlement policy

- **Decision required:** When a match becomes a trade, when users see it as final, and whether failed items reopen orders, rematch, or cancel.
- **Options:** Trade at match with pending state; trade only after chain finality; retry fixed settlement; cancel and release.
- **Recommended option:** Persist an immutable match and pending trade immediately, finalize only from canonical chain events, and use an explicit retry/cancel policy that never increases signed quantity or passes expiry.
- **Reason:** Database matching and blockchain execution fail independently.
- **Risks:** Duplicate fills, reopened expired orders, indefinite locked funds, misleading balances.
- **Affected:** Orders, matches, trades, reservations, settlement items/batches, ledger entries, position projections.
- **Status:** `BLOCKING`.

## D-12 — Oracle authority and dispute governance

- **Decision required:** Proposer, reviewers, on-chain oracle signer, evidence standard, challenge window, dispute decider, invalid-market handling, and emergency cancellation.
- **Options:** Single authorized oracle; multi-approval platform oracle; external optimistic/dispute oracle.
- **Recommended option:** Multi-person platform approval for the binary MVP with separate proposer, approver, and on-chain submitter roles; immutable evidence and terms hash. Define a real challenge window or state clearly that none exists.
- **Reason:** A single hidden admin can redirect all payouts.
- **Risks:** Insider resolution, key compromise, ambiguous evidence, late cancellation, legal disputes.
- **Affected:** Oracle tables, approval tables, market terms, CTF conditions, blockchain transactions, redemption.
- **Status:** `BLOCKING` for resolution.

## D-13 — Resolution payout representation

- **Decision required:** Whether payout values remain JSON or are normalized per outcome and denominator.
- **Options:** JSONB only; child payout rows; both canonical rows and a hashed JSON/ABI vector.
- **Recommended option:** One immutable payout row per outcome plus a canonical vector hash used for the contract call.
- **Reason:** Relational checks can enforce outcome coverage, uniqueness, ordering, and exact sum.
- **Risks:** Wrong outcome order, malformed vector, database/contract disagreement.
- **Affected:** `oracle_resolution_proposals`, `market_resolutions`, `market_outcomes`, resolution workflow.
- **Status:** `BLOCKING` for oracle schema.

## D-14 — Binary range and native categorical product policy

- **Decision required:** Whether brackets may overlap/gap and whether native categorical CTF will be launched.
- **Options:** Independent binaries with disclosed overlap/gaps; mutually exclusive range rules; native categorical condition.
- **Recommended option:** Start with ordinary binary questions. If range sets launch, validate non-overlap/gap policy at product level and clearly disclose that each binary has its own $1 complete set. Defer native categorical launch.
- **Reason:** The products have different collateral and user expectations.
- **Risks:** Misleading prices, impossible combined payout assumptions, fragmented liquidity.
- **Affected:** Markets, questions, outcomes, CTF conditions, UI, resolution rules.
- **Status:** `NON-BLOCKING FOR BINARY MVP`.

## D-15 — Treasury ownership and FX policy

- **Decision required:** Legal operator, source of USDC, quote source, spread, expiry, rounding, slippage, prefunding limits, and loss allocation.
- **Options:** Platform conversion; licensed partner conversion; fixed treasury rate; pass-through market quote.
- **Recommended option:** Use an approved regulated conversion arrangement, immutable expiring quotes with rational rates, explicit spread/rounding, per-operation limits, and independently reconciled prefunded USDC.
- **Reason:** A KHR deposit is not automatically USDC and creates market and custody exposure.
- **Risks:** Unlicensed conversion, treasury loss, under-collateralized liabilities, unfair rates.
- **Affected:** FX, conversion, treasury, deposit, ledger, wallet allocation, withdrawal workflows.
- **Status:** `PRODUCTION BLOCKING`.

## D-16 — Withdrawal, payout, and compliance policy

- **Decision required:** Eligible destination ownership, limits, KYC/AML checks, approval thresholds, provider finality, reversals, and privacy retention.
- **Options:** Same-name account only; verified allowlist; manual approval; automated risk tiers.
- **Recommended option:** Verified destination allowlist, risk-based limits, dual approval above thresholds, encrypted destination references, and evidence-based provider finality.
- **Reason:** Payout is irreversible and handles sensitive financial data.
- **Risks:** Fraud, account takeover, sanctions exposure, privacy breach, double payout.
- **Affected:** Withdrawal tables, attempts, approvals, holds, FX, treasury, ledger, audit.
- **Status:** `PRODUCTION BLOCKING`.

## D-17 — Fees, rounding, and self-trade policy

- **Decision required:** Maker/taker fees, fee asset, rounding direction, minimum order size, dust, self-trading, and cancellation charges.
- **Options:** Zero-fee MVP; one flat fee; maker/taker schedule; self-trade reject/cancel/decrement.
- **Recommended option:** Zero-fee technical MVP, reject self-trades, define raw-unit rounding and dust now, then add a versioned fee schedule before production.
- **Reason:** Fees alter holds, signed amounts, settlement legs, and accounting.
- **Risks:** Balance leakage, unexpected user cost, wash trading, unrecoverable dust.
- **Affected:** Orders, matches, trades, `trade_fees`, reservations, ledger, exchange contract.
- **Status:** `BLOCKING` for production trading; zero-fee prototype may proceed.

## D-18 — Existing database adoption and legacy balances

- **Decision required:** When each environment adopts Drizzle history and when ledger projections replace `wallets` balances.
- **Options:** New database only; parity-and-baseline existing database; staged shadow ledger and dual reads.
- **Recommended option:** Complete Stage 1.6 read-only parity inspection, backup/restore rehearsal, approved history adoption, then shadow ledger, reconciliation, feature-flagged reads, and delayed write cutover.
- **Reason:** Runtime DDL and real payment records may differ from the verified empty-database chain.
- **Risks:** Duplicate table creation, missing constraints, double credit, lost balances, unrecoverable rollback.
- **Affected:** Existing nine tables, all new migrations, ledger transition, deposit/payment workflows, deployment order.
- **Status:** `BLOCKING` for applying Stage 2 migrations to an existing environment.

## Approval summary

### Product-owner approval

Required for D-01, D-03, D-12, D-14, D-15, D-16, and D-17 because they define custody, product behavior, user payout rights, fees, or regulatory responsibility.

### Security and engineering approval

Required for D-02, D-04, D-05, D-07, D-08, D-09, D-10, D-11, and D-13.

### Finance/legal/compliance approval

Required for D-01, D-06, D-12, D-15, D-16, D-17, and the production portion of D-18.

### First decisions to close

Close D-01 through D-11 before implementing trading schemas. D-12 and D-13 must close before oracle schemas. D-15 and D-16 must close before any real fiat or payout integration is enabled.
