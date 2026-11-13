# KhmerFP integration gaps

Reference revisions and executed tests are recorded in [EXCHANGE_COMPARISON.md](EXCHANGE_COMPARISON.md). Estimates below assume one experienced engineer and local mock-fund development. They exclude legal approval, independent audits and production operations.

## Shared requirements

Base Sepolia (84532) and Base mainnet (8453) need their own deployments, verified addresses, chain-specific signatures and confirmation policies. Polygon addresses are not reusable evidence of Base deployment. Local execution demonstrates EVM compatibility only; compiler opcode support, gas, contracts and smart-wallet provider behavior must be tested on the chosen chain before release.

All options can fit an off-chain CLOB and a Node.js relayer. Express and PostgreSQL/Drizzle do not need replacement. They need versioned ABI/order adapters, stable order hashes, reservations, settlement tracking and an event reconciler. No finalized orders/trades schema was found in the implemented schema set; preserve the existing wallet/CTF registry foundation and design forward changes after choosing the exchange.

Existing evidence: `docs/architecture/BLOCKCHAIN_MVP_DECISION_PACKAGE.md` D-01 through D-08; `packages/db/src/schema/userWallets.js`, `walletAuthorizations.js`, `ctfConditions.js`, `ctfPositionTokens.js`; `packages/contracts/src/ctfIdentifiers.js`. The architecture starts with secondary transfers and defers complementary trading. An exchange's ability to mint/merge does not approve enabling those routes.

ABA/Bakong payments remain separate. A confirmed fiat deposit is not evidence of on-chain collateral. Ledger ownership, FX, treasury allocation and withdrawal controls remain required regardless of exchange choice. Exchange fill events must never directly credit fiat balances without idempotent financial reconciliation.

## V1 adapters and blockers

| Work | Required change | Security consequence | Rough effort |
| --- | --- | --- | --- |
| Typed orders | Add salt, signer, taker, signatureType, feeRateBps, epoch nonce; change domain | Existing KhmerFP signatures cannot be converted or reused; users must sign again | 2–4 days |
| Fill/accounting adapter | BUY remaining uses collateral offered, SELL uses outcome tokens; track actual receipt, refunds and fees separately | A BUY can receive surplus outcome tokens beyond its requested minimum; current custom design caps outcome quantity | 3–5 days |
| Wallet adapter | Use type 3 with maker=signer=deployed smart account; test actual provider | Do not use Polymarket proxy/Safe modes for arbitrary Privy/Coinbase wallets; no undeployed wallet support proven | 2–4 days |
| Operator/governance | Admin multisig, restricted relayer operator, pause, key recovery | Admin can add operators; role and callback compromise matter | 2–4 days |
| Token registry | Verify actual CTF condition and collateral derivation before registerToken | Registry stores supplied pairs; it does not independently prove correct IDs | 1–3 days |
| Rounding | Choose and enforce acceptable lot sizes or review a narrowly scoped contract correction | Off-chain checks alone cannot enforce strict signed-price guarantees against a compromised authorized operator | 3–7 days plus review |
| Approvals | Explicit wallet allowances/operator approval; review max exchange-to-CTF allowance | Unmodified V1 grants CTF unlimited allowance over exchange-held collateral; conflicts with a blanket bounded-approval requirement | 1–3 days |
| Events/reconciliation | Decode OrderFilled, OrdersMatched, FeeCharged, refunds and CTF transfers; deduplicate | Reported offered amount is not always actual net spend; require balance/event reconciliation and reorg recovery | 3–6 days |

Overlapping work makes a local adapter prototype about 2–4 engineer-weeks. Real-money readiness takes longer and cannot be inferred from this estimate.

V1's tiny-fill probe demonstrates a real behavioral mismatch with Stage 3.2's strict per-fill limits. A price/lot policy needs analysis for every partial fill, not just original order quantities. Zero-fee tests do not establish fee rounding safety. V1 also temporarily holds tokens and calculates surplus using entire exchange balances: donated or stranded balances and asset contamination need dedicated tests. Do not use it as treasury storage.

The POC's zero proxy/Safe factory parameters are research settings, not approved deployment configuration. Polymarket modes can revert or misbehave if called with those settings; production must explicitly define supported signature modes.

## V2 adapters and blockers

V2 requires a separate commercial/legal decision before production. Its signed format replaces V1 expiration/nonce/taker/fee fields with timestamp/metadata/builder. A timestamp is not an enforced expiry. The reviewed code has user pause and operator preapproval invalidation, rather than V1's user cancelOrder/nonce epoch behavior. This conflicts with current KhmerFP requirements for enforceable expiry and cancellation unless an approved design closes the gap.

Preapproval validates the original signature, but later permits an empty signature for the preapproved hash. Smart-wallet owner/policy changes may not automatically revoke that cached approval. Test lifecycle/recovery and revocation before using that path. The lack of a reentrancy guard requires careful operator-contract/callback analysis; do not assume operator restrictions remove every risk.

Review whether direct USDC + official CTF configuration is sufficient or wrappers/adapters are needed. Different CTF collateral changes position IDs and treasury accounting. Include fee receiver, factory approvals and wrapper redemption risks if wrappers are used. No V2 configuration was compiled or executed here.

Estimate: 4–8 engineer-weeks for a licensed local integration and requirement-gap evaluation, excluding negotiation and audit. Neither license price nor permission is known.

## Retaining custom

Custom keeps the existing signing format and strict Stage 3.2 accounting. It still needs market allowlisting, emergency policy, broader callback/invariant testing, dependency remediation and independent review. Complementary mint/merge would be a separate feature with new security analysis. Estimate 1–2 weeks for better local hardening and test coverage, excluding an external audit; a full production exchange has no reliable estimate from this MVP alone.

No option removes custody, ledger, available-balance, oracle governance, chain finality or fiat solvency responsibilities.
