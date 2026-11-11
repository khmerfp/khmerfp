# KhmerFP Architecture Audit

**Audit date:** 2026-11-05  
**Scope:** Read-only review of the repository at `F:\khmerfp`  
**Status:** Architecture audit only; no application source, dependencies, database, or deployment state was changed.

## 1. Executive summary

KhmerFP currently contains two materially different systems:

1. A reusable Vite/React product prototype with bilingual market discovery, market detail, simulated order books, simulated positions, and a simulated staff console.
2. A substantially more mature Node.js/Express/PostgreSQL authentication and ABA PayWay sandbox integration with server-side sessions, multiple identity providers, payment signing, callback authentication, provider-side status verification, idempotent payment-state transition, rate limiting, and tests.

The repository is **not yet a blockchain prediction market**. There are no smart contracts, Base integration, Gnosis Conditional Tokens Framework (CTF) integration, embedded wallets, EIP-712 orders, EIP-1271 verification, CLOB service, relayer, indexer, oracle workflow, durable markets/orders/fills/positions, WebSocket market data, or double-entry ledger. Current markets, balances, order books, fills, resolution, and payouts live in React memory and disappear on reload. This distinction must remain explicit in product and compliance discussions.

The safest strategy is incremental: keep the working authentication and carefully reuse the ABA verification pipeline, preserve the useful UI components, replace browser-authoritative financial and administrative behavior, and build a small binary-market vertical slice behind feature flags. Do not start with categorical markets or a highly optimized Go/Rust matching engine. Establish custody, accounting, contract, and settlement invariants first.

### Highest-priority findings

- **Critical — tracked credential exposure:** `server/.env.example` is tracked and contains a credential-bearing PostgreSQL connection string rather than a placeholder. Treat the credential as compromised: rotate/revoke it, review provider and Git history/access logs, then replace it with a non-secret example in a separately approved change. This report intentionally does not reproduce the value.
- **Critical — staff authorization is client-side only:** `client/src/pages/StaffLogin.jsx` contains hard-coded demo credentials and `client/src/pages/StaffDashboard.jsx` trusts a `sessionStorage` flag. Anyone can inspect or set it. Market creation/deletion/resolution is only local browser state, but this design must be replaced before any privileged server or on-chain action exists.
- **Critical — no financial ledger or deposit ownership:** `transactions` has no `user_id`; checkout preparation accepts browser-supplied name/account data; paid callbacks change only a payment row. The `wallets.balance_minor` field is not credited by ABA reconciliation. There is no auditable link from payer to user, no journal, no withdrawal reservation, and no treasury liability reconciliation.
- **High — simulated trading can be mistaken for real trading:** `client/src/state/AppContext.jsx`, `client/src/lib/orderbook.js`, and `client/src/components/DetailPanel.jsx` generate and mutate books, balances, fills, positions, results, and payouts in browser memory. Client polling and random fallback prices are also used to resolve some rounds.
- **High — custody implementation details remain unresolved:** the hybrid model is confirmed: ABA PayWay accepts KHR deposits recorded in an append-only PostgreSQL double-entry ledger, while USDC trading settles on Base through embedded smart wallets and gasless EIP-712 orders matched by an off-chain CLOB. Wallet provider, detailed on-chain asset ownership/segregation, FX policy, treasury controls, and recovery remain pending and require a formal custody/accounting ADR and threat model before implementation.
- **High — schema management is not production-grade:** startup code creates/alters tables using `CREATE TABLE IF NOT EXISTS` and `ALTER ... IF NOT EXISTS` in `server/src/config/database.js` and `server/src/db/authSchema.js`. There is no versioned migration history, down/forward plan, schema lock, or deployment gate.

### Overall disposition

- **KEEP:** authentication foundations, session model, origin checks, security headers, audit logging, provider verification, ABA request signing, callback HMAC verification, check-transaction verification, conditional payment status transition, operational request IDs, and the majority of presentational UI components.
- **REFACTOR:** database migrations, payment ownership and accounting, session/step-up policy for financial actions, API boundaries, market data state, deployment topology, rate limiting, observability, and client API duplication.
- **BUILD:** all blockchain, CLOB, settlement, wallet, oracle, ledger, treasury, withdrawal, durable market, admin authorization, WebSocket, monitoring, recovery, and reconciliation capabilities.
- **REPLACE:** browser-authoritative balances/trading/settlement/admin authorization and the single mutable `wallets.balance_minor` model as the financial source of truth.

### Confirmed architecture decisions

The following decisions were confirmed after the initial audit. They describe the intended target and do **not** indicate that the functionality is implemented:

- **Hybrid custody architecture:** ABA PayWay accepts KHR deposits; PostgreSQL records user liabilities in an append-only double-entry ledger; trading collateral is USDC on Base L2; embedded smart wallets authorize gasless EIP-712 orders; an off-chain CLOB matches orders; settlement occurs on-chain.
- **Embedded wallet direction:** use Privy or Coinbase Smart Wallet. Provider selection remains pending.
- **Initial market model:** begin with binary YES/NO CTF conditions.
- **Future range-market proposal:** represent each range bracket as an independent binary YES/NO condition. Each condition has its own `$1.00` USDC complete-set collateral relationship (`YES + NO = $1.00`). The separate sub-markets do not share one `$1.00` pool.
- **Sprint 1 foundation:** rotate exposed credentials, remove insecure demo staff authentication, adopt Drizzle ORM with versioned PostgreSQL migrations, implement user-owned ABA deposit intents and an append-only double-entry ledger, and guarantee exactly one atomic ledger posting per verified ABA payment.

### Pending architecture decisions

- Selection between Privy and Coinbase Smart Wallet and the associated recovery/export model.
- Whether settled CTF/USDC assets are held directly by each user smart wallet or partly through a disclosed omnibus/prefunded custody arrangement.
- KHR-to-USDC conversion timing, rate sources, quote validity, spread, fees, and rounding.
- Treasury ownership, segregation, hot/warm/cold controls, reserve policy, and reconciliation limits.
- Exact Base network, canonical USDC and CTF deployment addresses, oracle/dispute mechanism, relayer signer controls, and production hosting topology.
- Whether later mutually exclusive and exhaustive range products continue as independent binaries or add a single categorical CTF condition after liquidity, capital-efficiency, and UX evaluation.

## 2. Current architecture

### 2.1 Repository and runtime topology

The root `package.json` defines npm workspaces for `client` and `server`, Node 22, shared development scripts, and a client-only production build command.

| Area | Evidence | Current behavior |
|---|---|---|
| Client | `client/package.json`, `client/vite.config.js` | React 18 single-page application built with Vite, not Next.js. React Router handles client routing. |
| API | `server/package.json`, `server/src/app.js`, `server/src/server.js` | Express 5 JSON API with PostgreSQL, CORS allow-listing, security headers, request IDs, and global error handling. |
| Serverless adapter | `api/index.js`, `server/src/server.js`, `server/src/index.js` | Multiple API entry patterns exist (Vercel adapter and traditional/Render server), with some duplication. |
| Database | `server/src/config/database.js`, `server/src/db/authSchema.js` | PostgreSQL pool; schema is created/altered during startup. |
| CI | `.github/workflows/ci.yml` | Separate client lint/build and server lint/test jobs; PostgreSQL 16 service for server tests. |
| Hosting | `client/render.yaml`, `server/render.yaml`, `server/vercel.json` | Render configurations plus partial Vercel support. The intended production topology is not singularly documented. |

The root dependency graph contains no blockchain libraries, Solidity toolchain, WebSocket framework, queue, cache, or observability SDK. `server/package.json` contains Express, CORS, dotenv, Google auth, and PostgreSQL only.

### 2.2 Frontend architecture and reusable components

`client/src/App.jsx` defines routes for the home page, rounds, market-round detail, legal/learn content, and staff pages. `client/src/main.jsx` composes `BrowserRouter`, `AuthProvider`, and `AppProvider`.

Reusable UI assets include:

- Market discovery and display: `client/src/components/MarketCard.jsx`, `FeaturedCard.jsx`, `CategoryRail.jsx`, `DetailPanel.jsx`, `PriceChart.jsx`, and `PositionsPanel.jsx`.
- Shell and navigation: `client/src/components/Header.jsx`, `Footer.jsx`, and `AuthModal.jsx`.
- Auth UI: `client/src/components/auth/EmailPasswordForm.jsx`, `GoogleSignIn.jsx`, `FacebookSignIn.jsx`, and `PhoneOtpForm.jsx`.
- Funding UI: `client/src/components/TopUpModal.jsx`.
- Localization and formatting: `client/src/lib/i18n.js`, `format.js`, `schedule.js`, and `gold.js`.
- Static product content: `client/src/content/learn.js` and legal pages under `client/src/pages/`.

`client/src/state/AppContext.jsx` is currently a monolithic simulation engine. It seeds markets from `client/src/data/markets.js`, creates synthetic price series and order books, polls public price endpoints directly from the browser, randomly walks unavailable prices, closes rounds, resolves outcomes, and modifies in-memory balances and positions. This is useful for UX prototyping but is not reusable as a financial state machine.

`client/src/lib/orderbook.js` creates and mutates synthetic books. `client/src/components/DetailPanel.jsx` debits an in-memory balance and credits an in-memory position immediately. `client/src/components/TopUpModal.jsx` adds money directly to the in-memory balance. None of these actions are durable or authoritative.

There are two client API layers, `client/src/lib/api.js` and `client/src/services/authApi.js`, with different base-URL fallback behavior. Consolidation is advisable.

### 2.3 Backend APIs and services

`server/src/app.js` exposes:

- `GET /api/health`
- `GET /api/ready`
- Authentication routes under `/api/auth`
- Payment routes under `/api/payments`

There are no API routes for markets, outcomes, order books, orders, fills, positions, balances, ledger entries, withdrawals, oracle proposals, disputes, settlement, redemption, wallets, or administration.

The backend follows a reasonable route/controller/service/model split for payments:

- Routes: `server/src/routes/paymentRoutes.js`
- Controller boundary: `server/src/controllers/paymentController.js`
- Validation: `server/src/validation/paymentValidation.js` and `callbackValidation.js`
- Signing/authentication: `server/src/payway/`
- Persistence: `server/src/models/transaction.js`
- Reconciliation: `server/src/services/paymentReconciliationService.js`

Authentication services are separated by provider under `server/src/services/`, with session and audit behavior shared across providers.

### 2.4 Authentication and authorization

Verified server-side authentication capabilities include:

- Google ID-token verification with issuer, audience, email, and verified-email checks in `server/src/services/googleAuthService.js`.
- Facebook token debugging against the configured app, profile retrieval, and authorization-code exchange in `server/src/services/facebookAuthService.js`.
- Email/password authentication using salted `scrypt` hashes in `server/src/services/passwordService.js` and `emailAuthService.js`.
- Phone OTP hashing, attempt/expiry tracking, and SMS delivery integration in `server/src/services/phoneAuthService.js`.
- Telegram login/factor HMAC validation and freshness checks in `server/src/services/telegramFactorService.js` and `telegramLoginService.js`.
- Opaque random session tokens stored only as SHA-256 hashes, idle/absolute expiry, revocation, and step-up timestamps in `server/src/services/authSessionService.js`.
- Origin checks on state-changing auth endpoints in `server/src/routes/authRoutes.js`.
- Database-backed per-route/per-IP auth throttling and auth audit logs.

Important limitations:

- There is no role/permission model in `users`, and no server-side admin authorization.
- Telegram factor enrollment is checked before checkout preparation, but the checkout guard checks enrollment, not a recent `step_up_at`. A verified factor is not equivalent to fresh step-up authentication.
- Financial actions will require policy-based authorization: role checks, recent-auth checks, wallet ownership, transaction limits, device/risk signals, and immutable audit events.
- Production cookies use `SameSite=None` because client/API are intended to be cross-origin. Origin checks reduce CSRF risk, but every future cookie-authenticated mutation must consistently enforce them; a deliberate CSRF strategy and tests are required.

### 2.5 ABA PayWay integration and webhook security

What exists and is valuable:

- Strict environment selection and an explicit production-checkout block in `server/src/config/payway.js`.
- Server-side purchase signing in `server/src/payway/purchaseSigning.js`.
- Generated transaction IDs and protected status tokens whose hashes are stored in PostgreSQL.
- Callback HMAC-SHA512 verification with constant-time comparison in `server/src/payway/callbackSignature.js`.
- Strict callback field validation in `server/src/validation/callbackValidation.js`.
- A second server-to-server check-transaction call in `server/src/services/checkTransactionService.js`.
- Amount, currency, transaction ID, status, approval, and discount consistency checks before marking a transaction paid.
- A conditional `PENDING -> PAID` update and duplicate callback handling in `server/src/services/paymentReconciliationService.js`.
- Checkout, callback, status, signing, persistence, headers, and rate-limit tests under `server/test/`.

Gaps and risks:

- `transactions` has no `user_id`, deposit account, quote, ledger event, or wallet link. A signed-in user could prepare a checkout, but the durable payment is not owned by that user.
- Checkout fields still originate from browser-supplied `name` and `accountNumber`; ownership is not derived from the authenticated principal.
- Successful reconciliation does not post an accounting journal entry or credit any user liability.
- No withdrawal/payout flow exists. ABA deposit support is sandbox-only and production is intentionally disabled.
- There is no asynchronous retry queue, callback receipt/inbox table, dead-letter workflow, scheduled reconciliation, or provider statement reconciliation.
- Callback authenticity depends on a configured separate callback secret and a custom serialization implementation. This must be verified against ABA's current official integration specification and sandbox fixtures before production. **Unverified assumption:** the inspected repository does not include the provider contract/specification needed to independently validate the exact callback signing format and header.
- Callback rate limiting and upstream network restrictions are absent. Signature verification is the primary control; provider IP allow-listing may be additive only if ABA publishes stable ranges.
- Status and checkout rate limiters are in-memory maps, so limits are per process and reset on deployment; this is unsuitable for horizontally scaled production.

### 2.6 Database schemas and migrations

Current tables:

- `transactions` in `server/src/config/database.js`
- `users`, `wallets`, `sessions`, `user_factors`, `auth_rate_limits`, `auth_audit_logs`, and `phone_otps` in `server/src/db/authSchema.js`

Positive properties include database checks, unique provider identities, hashed session/OTP/status tokens, foreign keys for auth-owned records, and conditional transaction updates.

Material gaps:

- No versioned migration files or migration metadata table.
- Startup mutates schema, which makes rollout order, rollback, lock duration, and failure recovery unpredictable.
- `server/src/db/migrate.js` applies only `AUTH_SCHEMA_SQL`; the payment table is created elsewhere at startup.
- `wallets.balance_minor` is a mutable aggregate, not a double-entry ledger. It is KHR-only while the target trading collateral is USDC.
- No deposit ownership, unique provider-event record, journal, journal lines, holds/reservations, withdrawals, FX quotes, treasury accounts, reconciliation runs, markets, outcomes, orders, fills, positions, chain transactions, or oracle events.
- Monetary JavaScript conversion through `Number(...)` in `server/src/models/transaction.js` is safe for the currently constrained KHR test amounts but should not be the general ledger representation. Use database integers/numerics and explicit bounded conversions.

### 2.7 Existing blockchain or trading functionality

There is **no verified blockchain functionality**. No contract source, deployment manifest, ABI, Base chain configuration, RPC client, key management, block indexer, or chain test exists.

There is **no production trading functionality**. The following are simulations:

- Seed markets: `client/src/data/markets.js`, `metals.js`, `social.js`
- Books and price levels: `client/src/lib/orderbook.js`
- Balances, positions, fills, round state, resolution, and payouts: `client/src/state/AppContext.jsx`
- Trade actions: `client/src/components/DetailPanel.jsx`
- Top-ups: `client/src/components/TopUpModal.jsx`
- Staff market mutation/resolution: `client/src/pages/StaffDashboard.jsx`

The UI supports binary and multi-option representations, but these are display models, not CTF conditions or durable market definitions.

### 2.8 Environment, deployment, and operations

- `.github/workflows/ci.yml` provides useful baseline CI but has no contract, end-to-end, security, dependency, migration, or deployment checks.
- `client/render.yaml` and `server/render.yaml` configure separate Render services; `api/index.js` and `server/src/server.js` also contain Vercel paths. Select and document one production architecture.
- Server startup automatically initializes schema. Replace this with a separately authorized migration job before production.
- Health/readiness endpoints exist, but there is no metrics endpoint, trace propagation, alerting, error tracking, queue health, chain/RPC health, signer balance monitoring, or reconciliation dashboard.
- Logging is structured in some paths (`server/src/logging/operationalLogger.js`) but plain console logging remains elsewhere. No documented retention/redaction/tamper-evidence policy exists.

## 3. Target architecture

### 3.1 Recommended bounded architecture

Start as a modular monolith for business APIs and financial accounting, plus isolated specialist services where correctness or runtime characteristics justify separation:

1. **Web client:** existing React UI, fed only by authenticated APIs and WebSocket/SSE streams; no authoritative financial computation.
2. **Core API (Node/TypeScript recommended):** identity linkage, market catalogue, user portfolio views, admin workflows, deposit/withdrawal orchestration, risk checks, and read APIs.
3. **Financial ledger (PostgreSQL):** append-only double-entry journal, holds, KHR liabilities, later approved FX conversions, fees, and reconciliation. This is the confirmed off-chain money source of truth and will use Drizzle ORM with versioned migrations.
4. **Matching engine:** initially a correctness-first single-writer service with deterministic price-time priority and a write-ahead event log. Keep the protocol language-neutral so Go/Rust can be introduced when load warrants it.
5. **Blockchain gateway/relayer (Viem):** validates the confirmed gasless EIP-712 order authorization model, supports EIP-1271 smart-wallet verification, simulates transactions, submits through controlled signers, tracks nonce/replacement/finality/reorgs, and emits normalized chain events.
6. **Contracts on Base:** audited adapter/exchange around established CTF contracts, explicit collateral allow-list, pause controls, settlement rules, and minimal upgrade authority.
7. **Indexer:** consumes finalized contract events, handles reorgs, maintains chain-derived projections, and reconciles expected versus observed state.
8. **Oracle/resolution service:** proposal, evidence, review, dispute window, finalization, and CTF condition reporting. Admin UI invokes governed server workflows, never direct unaudited resolution.
9. **Payments/treasury:** ABA provider adapter, deposit inbox, withdrawal state machine, FX quote service, treasury inventory, and daily internal/provider/on-chain reconciliation.
10. **Realtime gateway:** authenticated public/private channels for books, trades, order state, positions, and settlement notices with sequence numbers and snapshots.

### 3.2 Sources of truth

Define these before implementation:

| Domain | Authoritative source |
|---|---|
| Identity, roles, policy | PostgreSQL core/auth tables |
| KHR received/paid through ABA | Provider-confirmed events plus immutable ledger postings |
| User fiat/USDC liabilities | Double-entry ledger |
| Open-order availability | Ledger/position holds plus matching-engine state |
| Order sequencing and fills | Matching-engine append-only event stream, reconciled to settlement |
| CTF token ownership after settlement | Finalized Base events |
| Market definition and resolution policy | Versioned market record plus governed oracle evidence |
| Redeemable outcome | Finalized CTF condition resolution on Base |

The `wallets.balance_minor` cache may eventually be retained as a derived read model, but never as the source of truth.

## 4. KEEP / REFACTOR / BUILD / REPLACE matrix

| Component | Classification | Evidence | Rationale / required change |
|---|---|---|---|
| React/Vite application shell and routes | KEEP | `client/src/App.jsx`, `client/src/main.jsx` | Good foundation; the project is Vite rather than stated Next.js. Add protected routes and server data incrementally. |
| Market/display components | KEEP | `client/src/components/MarketCard.jsx`, `FeaturedCard.jsx`, `PriceChart.jsx`, `CategoryRail.jsx` | Reusable presentation; replace mock props with typed API models and explicit loading/error/stale states. |
| Auth UI/provider | KEEP | `client/src/auth/AuthProvider.jsx`, `client/src/components/auth/` | Reuse with modest policy/UX additions for wallet enrollment and step-up. |
| Client API modules | REFACTOR | `client/src/lib/api.js`, `client/src/services/authApi.js` | Consolidate URL/error/credentials behavior and add typed domain clients. |
| In-memory app state engine | REPLACE | `client/src/state/AppContext.jsx` | It is browser-authoritative and mixes UI, market simulation, pricing, settlement, and financial state. Split UI preferences from server state and realtime projections. |
| Synthetic order book | REPLACE | `client/src/lib/orderbook.js` | Keep only as Storybook/demo fixtures; production books come from the matching engine. |
| Seed market data | REFACTOR | `client/src/data/markets.js`, `metals.js`, `social.js` | Move to durable admin-managed records. May remain test/fixture data. |
| Trade ticket/UI | REFACTOR | `client/src/components/DetailPanel.jsx` | Preserve interaction design; replace local debit/fill with quote, wallet signature, order lifecycle, and error handling. |
| Top-up UI | REFACTOR | `client/src/components/TopUpModal.jsx` | Preserve modal; call user-bound deposit intents and show durable provider/reconciliation state. Never credit locally. |
| Positions UI | REFACTOR | `client/src/components/PositionsPanel.jsx` | Feed from ledger/indexer projections; distinguish available, held, pending settlement, settled, and redeemable. |
| Staff login | REPLACE | `client/src/pages/StaffLogin.jsx` | Hard-coded browser credential is not authentication. Use existing server auth plus roles and step-up. |
| Staff dashboard UI | REFACTOR | `client/src/pages/StaffDashboard.jsx` | Forms can be reused, but every operation needs server-side RBAC, validation, maker-checker approval, immutable audit, and governed oracle workflow. |
| Express middleware/API shell | KEEP | `server/src/app.js` | Solid baseline. Add route-level authorization, schema validation, idempotency, and domain modules. |
| Authentication services | KEEP | `server/src/services/*AuthService.js`, `authSessionService.js` | Strong reusable base. Add roles, policy engine, recent step-up enforcement, recovery, and security review. |
| Auth schema/audit | REFACTOR | `server/src/db/authSchema.js` | Preserve entities but move to versioned migrations; add admin roles/permissions and stronger factor constraints. |
| Mutable wallet balance | REPLACE | `server/src/db/authSchema.js` (`wallets`) | Replace as source of truth with double-entry ledger and holds. Optionally retain a transactionally maintained read projection. |
| ABA configuration/signing | KEEP | `server/src/config/payway.js`, `server/src/payway/` | Good sandbox foundation; verify with official current spec and secret rotation/control procedures. |
| ABA callback reconciliation | REFACTOR | `server/src/services/paymentReconciliationService.js` | Preserve verification logic; add receipt inbox, user ownership, idempotent ledger posting, retry queue, settlement states, and provider-statement reconciliation. |
| Payment transaction model | REFACTOR | `server/src/models/transaction.js`, `server/src/config/database.js` | Add authenticated owner, deposit intent, provider event uniqueness, ledger link, and richer state machine. |
| Payment status token | KEEP | `server/src/payway/statusAccessToken.js`, `paymentStatusService.js` | Sensible capability-token design; user authentication should become the primary access control for owned deposits. |
| In-memory payment rate limits | REPLACE | `server/src/middleware/statusRateLimit.js`, `checkoutRateLimit.js` | Use shared Redis/gateway limits with user/IP/device keys and bounded storage. |
| DB-backed auth rate limiting | REFACTOR | `server/src/middleware/authRateLimit.js` | Correct cross-process direction but may become a hot table; move to dedicated shared rate-limit storage at scale. |
| Startup schema initialization | REPLACE | `server/src/config/database.js`, `server/src/db/migrate.js` | Use ordered, immutable, reviewed migrations executed separately from app startup. |
| CI | REFACTOR | `.github/workflows/ci.yml` | Keep baseline; add migrations, contracts, integration, E2E, security, and reproducible installs (`npm ci`). |
| Deployment definitions | REFACTOR | `client/render.yaml`, `server/render.yaml`, `api/index.js`, `server/vercel.json` | Choose a supported topology; add worker/relayer/indexer/matcher and private networking. |
| Gnosis CTF/contracts | BUILD | No repository evidence | Entirely absent. |
| CLOB/matching engine | BUILD | No server-side implementation | Entirely absent; client mock is not reusable as engine code. |
| EIP-712/EIP-1271 order verification | BUILD | No repository evidence | Entirely absent. |
| Relayer and chain monitor | BUILD | No repository evidence | Entirely absent. |
| Embedded wallets/key lifecycle | BUILD | No repository evidence | Entirely absent. |
| Oracle/disputes | BUILD | No repository evidence | Entirely absent. |
| Double-entry ledger/treasury | BUILD | No repository evidence | Entirely absent. |
| WebSocket market data | BUILD | No repository evidence | Entirely absent. |
| Monitoring/recovery | BUILD | Only basic logs and health endpoints | Requires full operational design. |

## 5. Missing features and technical gaps

### 5.1 Gnosis Conditional Tokens Framework

Required work:

- Pin audited CTF contract addresses and collateral token address per Base network; do not deploy arbitrary forks without a reason.
- Define `questionId`, oracle address, `outcomeSlotCount`, condition ID, collection IDs, position IDs, and deterministic mapping to internal market/outcome IDs.
- Implement prepare condition, split position, merge positions, report payouts, and redeem positions workflows.
- **Confirmed binary prototype:** use a two-slot YES/NO condition with payout vector `[1,0]`, `[0,1]`, or explicitly governed invalid-market handling. One complete set has a `$1.00` USDC collateral relationship, subject to fees and exact contract mechanics.
- **Confirmed proposed range-market approach:** model each future bracket as its own independent YES/NO condition. Every bracket therefore has its own complete set and its own `$1.00` collateral relationship. The brackets do **not** share a single `$1.00` pool.
- Independent bracket markets can be easier to launch incrementally and permit bracket-specific liquidity and probability, but they fragment liquidity, duplicate collateral requirements, and may price inconsistently across brackets. Resolution rules must make boundaries non-overlapping and precise; even if exactly one bracket is factually true, independent binary books do not automatically enforce that their YES prices sum to `$1.00` across the range product.
- A single categorical condition with `N` mutually exclusive/exhaustive slots provides one shared complete set, stronger cross-outcome consistency, and potentially better capital efficiency, but requires more complex liquidity, order-book, invalid/tie, and UX handling. It remains a future alternative, not the selected Sprint 1 design.
- Specify collateral decimals (USDC uses six), rounding/dust policy, fees, minimum order, and payout invariants.
- Add local-fork/Base testnet integration tests and invariant/fuzz tests before mainnet.

**Unverified assumptions:** exact CTF deployment availability/addresses on the chosen Base environment, USDC contract/version, and any exchange contract to be adopted are not present in the repository and must be verified from primary deployment records before coding.

### 5.2 CLOB matching engine

Required properties:

- Deterministic price-time priority, integer price/quantity units, and no floating-point accounting.
- Single-writer sequencing per market or partition; monotonic sequence numbers and append-only event log.
- Order validation against market state, expiry, tick/lot size, signer, nonce, balance/position availability, and risk limits.
- Atomic holds/reservations to prevent overspending or double-selling across concurrent orders.
- Partial fills, maker/taker fees, self-trade prevention, cancellation, replace, market halt, and recovery from snapshots plus log replay.
- Public snapshots/deltas and private order/fill streams with gap detection.
- Settlement batching with an explicit state machine: matched, settlement-submitted, confirmed, finalized, failed/retry, compensated.

For the prototype, correctness and deterministic replay are more important than language. A Go/Rust service can follow after the order protocol, invariants, and load targets are proven.

### 5.3 Exchange settlement contract and signed orders

Build a narrowly scoped, audited settlement path rather than putting the order book on-chain. It must support:

- EIP-712 domain separation including name, version, chain ID, and verifying contract.
- Order fields including maker, market/condition, outcome token, side or asset pair, price, quantity, expiry, fee cap, salt/nonce, and custody mode.
- EOA recovery and EIP-1271 contract-wallet validation, including gas/revert-safe validation behavior.
- Fill tracking by order hash, partial-fill bounds, cancellation/nonces, deadline checks, replay protection across chains/contracts/versions, and reentrancy protection.
- Atomic collateral/CTF token transfers, complementary minting if supported, fees, and events sufficient for independent reconstruction.
- Pause and constrained emergency controls with multisig/timelock governance.

### 5.4 Relayer and transaction monitoring

Use Viem in a dedicated service with:

- HSM/KMS/MPC-backed relayer keys; no raw production key in application environment variables.
- Preflight simulation, gas policy, per-account nonce serialization, replacement rules, and idempotency keys.
- Receipt/finality tracking, reorg handling, revert decoding, RPC failover, and alerting.
- Persisted `chain_transactions` and attempt history linking business operation to calldata hash, nonce, tx hash, block, confirmations, and final state.
- Reconciliation between matcher fills, ledger postings, contract events, and chain balances.

### 5.5 Wallet integration and hybrid custody

Required capabilities:

- One durable wallet/account record per user and chain, with provider identifier, address, wallet type, recovery state, and terms/consent version.
- Embedded-wallet provider selection only after evaluating key custody, export/recovery, social login binding, EIP-1271 support, Base/USDC support, sanctions/geographic controls, and incident procedures.
- Clear segregation of user-owned on-chain assets from platform omnibus/prefunded treasury assets.
- Spending authorization and revocation model; never infer wallet authority from a web session alone.
- Lost-account and identity-link recovery that cannot silently transfer on-chain ownership.

### 5.6 Oracle and dispute management

Build durable market lifecycle states: draft, approved, open, paused, closed, proposed, disputed, resolved, finalized, cancelled/invalid, redeemed.

Each market needs immutable resolution criteria, timezone/deadline, primary and fallback sources, oracle adapter, dispute window, invalid-market policy, and evidence hashes. Admin resolution requires RBAC, recent step-up, maker-checker approval, append-only audit, and ideally multisig/timelock enforcement for production. A single staff browser action must never directly determine payouts.

### 5.7 Double-entry ledger and treasury reconciliation

Minimum ledger model:

- Accounts scoped by owner, asset, purpose, and custody location.
- Immutable journals with balanced debit/credit lines per asset.
- Idempotency key and external reference uniqueness.
- Available/held/pending/settled projections derived transactionally.
- Entries for ABA deposits, FX conversion, fees/spread, USDC allocation, order holds, releases, fills, withdrawals, reversals, chargebacks/adjustments, gas subsidy, and redemptions.
- No mutation/deletion of posted entries; corrections use reversal and replacement journals.

Daily reconciliation must prove:

`ABA bank assets + on-chain treasury assets + in-flight assets = user liabilities + platform equity/fees`, per asset and custody location, with explained breaks and dual-controlled adjustments.

### 5.8 ABA deposits, KHR/USDC conversion, and payouts

Add a deposit intent owned by the authenticated user; bind provider transaction ID, expected amount/currency, expiry, status capability, and ledger reference. On verified payment, atomically insert the unique provider event and post the KHR liability journal.

KHR-to-USDC requires an explicit quote object: source, KHR/USDC rate, timestamp, expiry, spread/fee, rounding direction, expected USDC, and acceptance. Decide whether conversion occurs at deposit, trade, or withdrawal. Treasury inventory and price risk must be visible; do not silently present KHR as USDC.

Withdrawals need beneficiary verification, step-up, limits/risk review, approval policy, ABA payout idempotency, state machine, provider polling, ledger reservation, final posting/release, retry, and manual exception handling. No payout implementation is present today.

### 5.9 Admin dashboard and WebSocket market data

Admin APIs must enforce server-side RBAC and separation of duties. Suggested roles: support-readonly, market-editor, market-approver, oracle-proposer, oracle-approver, treasury-operator, treasury-approver, and security-admin.

Realtime channels should provide:

- Public book snapshot/delta/trades/market-state channels.
- Private authenticated orders/fills/holds/positions/deposits/withdrawals channels.
- Sequence numbers, resubscription, snapshot recovery, authorization per channel, backpressure, and connection/rate limits.

### 5.10 Security, monitoring, and recovery

Missing controls include threat models, key-management policy, dependency/SAST/secret scanning, contract audit, bug bounty, WAF/DDoS plan, database PITR drills, signer compromise procedure, chain/RPC failover, treasury limits, reconciliation alerts, withdrawal kill switch, market halt/runbook, and incident communications.

## 6. Security and financial risks

| Severity | Risk | Evidence / impact | Required mitigation |
|---|---|---|---|
| Critical | Tracked database credential | `server/.env.example` contains a credential-bearing URL and is tracked. Unauthorized database access is possible if still valid. | Rotate immediately; audit access; scrub only through an approved history-remediation plan; add secret scanning. |
| Critical | Fake admin security boundary | `StaffLogin.jsx` hard-codes credentials; dashboard trusts `sessionStorage`. | Remove from production surface; implement server RBAC, step-up, maker-checker, and audit before admin APIs. |
| Critical | No ledger/deposit ownership | `transactions` lacks `user_id`; paid callback does not post ledger entry. | Implement owned deposit intents and atomic double-entry posting before real deposits. |
| Critical | Client-authoritative money and settlement | `AppContext.jsx`, `DetailPanel.jsx`, `TopUpModal.jsx` mutate financial state locally. | Treat as demo only; replace with server/chain authoritative flows and clearly label/disable for production. |
| High | Partially unresolved custody/key model | Hybrid KHR-ledger/Base-USDC architecture is confirmed, but no wallet/key/treasury implementation exists and detailed ownership remains pending. | Complete wallet-provider and ownership/treasury ADRs, legal/compliance review, threat model, and key ceremonies first. |
| High | Oracle/admin unilateral control risk | Resolution exists only as browser mutation. | Governed oracle workflow, immutable criteria, disputes, dual control, and on-chain finalization. |
| High | Schema drift/startup mutation | App startup runs DDL. | Versioned migrations, backward-compatible deploys, migration CI, backups and rollback/runbook. |
| High | Cross-process rate-limit bypass | Checkout/status limits are in memory. | Shared limiter/gateway and abuse telemetry. |
| High | Financial action does not require fresh step-up | Checkout checks factor enrollment only. | Require recent `step_up_at`, bind action intent, enforce limits and replay protection. |
| High | Price/oracle manipulation in prototype | Browser fetch/random fallback drives round resolution. | Server-side signed/independent data sources, observation windows, circuit breakers, and dispute process. |
| High | No chain settlement failure model | No relayer/indexer/reconciliation. | Persisted state machine, idempotency, finality/reorg handling, retries, and alerts. |
| Medium | Deployment ambiguity | Render and Vercel entry patterns coexist. | Select, document, and test a single production topology and disaster-recovery target. |
| Medium | Provider identity/account-link complexity | Multiple providers and placeholder Facebook emails increase recovery/linking complexity. | Formal account-link and recovery policy; verified re-authentication; security review and user notifications. |
| Medium | Operational audit fragmentation | Structured logger is not universal; admin/financial audit absent. | Central structured logs, immutable financial/admin audit, retention/redaction/access policy. |
| Medium | UI character-encoding artifacts | Several inspected JSX/data strings render mojibake-like text. | Normalize source to UTF-8 and add Khmer/English visual regression tests. |

Regulatory, licensing, tax, AML/KYC, sanctions, consumer protection, and gambling/prediction-market classification are outside what source code can verify. They are **unverified and blocking external workstreams**, not assumed solved.

## 7. Critical architecture decisions requiring approval

### ADR-001: Hybrid custody and fund ownership — partially confirmed

The hybrid architecture is confirmed:

- ABA PayWay accepts KHR deposits.
- A verified KHR deposit creates a user-owned off-chain KHR liability in an append-only PostgreSQL double-entry ledger.
- Trading uses USDC on Base L2.
- Users authorize gasless EIP-712 orders through embedded smart wallets; Privy and Coinbase Smart Wallet are the provider candidates.
- An off-chain CLOB matches orders and an on-chain settlement path transfers collateral/CTF positions.

The detailed ownership model remains pending: determine whether users own CTF/USDC directly in their smart wallets throughout the lifecycle or whether some stages use a disclosed omnibus/prefunded treasury with sub-ledger claims. An accepted FX conversion must create explicit USDC-denominated accounting and treasury obligations; KHR must never be silently treated as USDC. Document insolvency treatment, withdrawal rights, wallet recovery/export, key control, reconciliation, and platform/relayer outage behavior.

### ADR-002: Binary and range-market CTF structure — confirmed direction

Use one two-slot YES/NO CTF condition for the first binary market. For future multi-range products, the proposed and confirmed direction is one independent binary YES/NO condition per bracket. Each bracket maintains its own `$1.00` USDC complete-set relationship; there is no single `$1.00` pool shared across all brackets.

This approach trades categorical capital efficiency and automatic cross-outcome consistency for simpler binary mechanics and independently tradable liquidity. Bracket boundaries and resolution evidence must be mutually exclusive and exhaustive if the product promises exactly one factual winning bracket. A later single categorical `N`-slot condition remains an explicit alternative if fragmented liquidity, duplicated collateral, inconsistent cross-bracket pricing, or UX become unacceptable.

### ADR-003: Complementary matching versus secondary trading

Choose supported fill types:

- Complementary primary match: YES bids and NO bids whose prices sum to collateral mint a complete set.
- Secondary transfer: existing outcome tokens move between sellers and buyers.
- Merge/burn: complementary inventory is merged back into collateral.

The engine, order schema, holds, contract calls, and liquidity display differ for each. Recommended prototype: support one clearly specified path first, preferably complementary minting plus simple secondary sale only if inventory accounting is already proven.

### ADR-004: Off-chain execution and on-chain settlement boundary

Define when a match becomes binding, what users sign, whether fills are individually or batch settled, who bears failed-settlement risk, and when UI balances become available. Recommended: signed order authorization, deterministic off-chain match, immediate reservation, atomic on-chain settlement batch, and availability only after configured confirmations/finality. Failed batches return to a deterministic retry/compensation state.

### ADR-005: Prefunded USDC treasury

Define treasury owner, omnibus versus segregated addresses, hot/warm/cold limits, refill approvals, gas sponsorship, allowed USDC contract, minimum reserve, reconciliation cadence, and emergency withdrawal. Prefunding improves UX but creates custody, counterparty, theft, and FX inventory risk.

### ADR-006: KHR-to-USDC exchange rate

Select rate source(s), refresh frequency, quote validity, spread/fees, rounding, slippage owner, weekend/outage behavior, and when conversion legally/economically occurs. Persist every accepted quote and its source evidence. Do not use a live rate retrospectively to reinterpret a completed KHR payment.

### ADR-007: Cancellation, partial fills, nonces, and replay protection

Recommended starting model:

- Per-maker nonce space with order salt and expiry.
- On-chain fill amount by EIP-712 order hash.
- Explicit signed cancellation and nonce invalidation; optional off-chain cancellation is not final until the settlement trust model guarantees it.
- Matching engine serializes fills and never exceeds signed quantity.
- Domain binds chain ID, verifying contract, and version.
- Replacement creates a new order; it does not mutate signed fields.

The exact model must be consistent across client, matcher, database, relayer, and contract.

## 8. Recommended project structure

An incremental target layout, not a mandate to rewrite existing code:

```text
khmerfp/
  apps/
    web/                    # existing client, migrated gradually
    api/                    # existing Express API, modularized gradually
    admin/                  # optional; can initially remain routes in web
  services/
    matcher/                # deterministic CLOB service
    relayer/                # Viem submission and tx lifecycle
    indexer/                # Base event ingestion/reorg handling
    realtime/               # WS gateway; can start inside API
    reconciliation/         # scheduled ABA/ledger/chain/treasury checks
  packages/
    domain/                 # IDs, states, integer money/order types
    db/                     # Drizzle schema, versioned migrations, repositories
    ledger/                 # posting rules and invariants
    authz/                  # roles, policy, recent-auth checks
    contracts/              # ABIs, addresses, generated bindings
    observability/          # logs, metrics, traces, redaction
  contracts/
    src/                    # only custom minimal settlement/adapters
    test/                   # unit, fuzz, invariant, fork tests
    script/                 # reviewed deployment scripts
    deployments/            # chain-specific manifests, no secrets
  docs/
    adr/
    runbooks/
    threat-models/
```

Do not perform a big-bang move. New modules can be created alongside `client/` and `server/`; move code only when a bounded feature requires it.

Suggested database domains:

- Identity: users, identities, sessions, factors, roles, role grants, auth audit.
- Markets: markets, outcomes, rules versions, lifecycle events, oracle proposals/disputes/finalizations.
- Trading: orders, cancellations, fills, holds, engine offsets/snapshots.
- Chain: wallets, wallet authorizations, conditions, position tokens, chain transactions/attempts, indexed events/checkpoints.
- Finance: ledger accounts, journals, journal lines, balance projections, deposit intents, provider events, FX quotes/conversions, withdrawal intents, treasury/reconciliation runs/breaks.

## 9. Step-by-step implementation roadmap

### Phase 0 — Security containment and decisions

**Dependencies:** audit approval; product/legal stakeholders.  
**Deliverables:**

- Rotate the exposed database credential and audit access.
- Remove the insecure demo client-side staff credential and `sessionStorage` authorization mechanism; disable the staff route from production until server authorization exists.
- Record the confirmed hybrid custody, binary CTF, independent binary range-market, gasless EIP-712, off-chain CLOB, on-chain settlement, Drizzle migration, and ledger decisions in ADRs.
- Complete the still-pending parts of ADRs 001–007, data-flow diagrams, threat model, regulatory counsel checkpoint, detailed asset-ownership/custody matrix, and financial invariants.
- Select Privy or Coinbase Smart Wallet, Base environment, canonical USDC and CTF deployments, oracle approach, detailed FX/treasury policy, and production hosting topology.
- Define SLOs, transaction limits, recovery objectives, and launch gates.

**Acceptance criteria:** no valid secrets in tracked files; insecure demo staff authentication is absent from the production surface; security review signs off on the custody diagram; every asset/state has one named source of truth; binary prototype scope is frozen; unresolved ownership, FX, wallet-provider, and treasury items are explicitly tracked rather than assumed.

### Phase 1 — Financial foundation and durable market catalogue

**Dependencies:** confirmed hybrid architecture plus Phase 0 decisions needed for ledger account ownership; detailed production FX and treasury policy may remain deferred if Sprint 1 records KHR only.  
**Deliverables:**

- Adopt Drizzle ORM and ordered, versioned PostgreSQL migrations; remove runtime DDL only after safe migration parity and deployment coverage exist.
- Append-only double-entry ledger, holds, idempotency, and invariant tests.
- User-owned ABA deposit intents and unique provider-event inbox.
- Exactly one atomic verified-payment-to-ledger posting per ABA payment, with no automatic USDC representation unless an accepted FX quote exists.
- Durable binary markets/outcomes/rules/lifecycle tables and read-only market APIs.
- Server roles and protected admin read APIs.

**Acceptance criteria:** every journal balances per asset; one verified ABA payment produces exactly one balanced user-owned KHR journal despite duplicate or concurrent callbacks; a failed journal transaction leaves neither a partially posted provider event nor partial lines; deposits belong to the authenticated user; replay/concurrency tests pass; UI reads a durable market without client seed authority.

### Phase 2 — Binary CTF contract prototype on a non-production network

**Dependencies:** verified CTF/USDC addresses; contract threat model.  
**Deliverables:**

- One binary market mapped deterministically to one two-outcome CTF condition.
- Minimal settlement adapter/exchange contract only where CTF does not supply the required function.
- EIP-712 order schema, EOA/EIP-1271 verification, partial fills, cancellation/nonces, expiry, and replay protection.
- Contract unit/fuzz/invariant tests and deployment manifest.

**Acceptance criteria:** collateral conservation, no overfill, no replay across chain/contract/version, correct split/merge/redeem, reentrancy tests, and independent contract review completed.

### Phase 3 — Embedded wallet, relayer, indexer, and one end-to-end order

**Dependencies:** Phase 2 contracts; wallet provider decision.  
**Deliverables:**

- Authenticated user wallet enrollment/recovery linkage.
- Client EIP-712 signing and server validation.
- Viem relayer with simulation, KMS/HSM signer, nonce queue, persisted attempts, receipt/finality/reorg monitoring.
- Chain indexer with checkpoints and replay.
- One user can place/cancel a limit order; two compatible users can create one fill and see finalized positions.

**Acceptance criteria:** no raw signer key in app config; relayer restart is safe; duplicate submission is idempotent; indexer rebuild produces the same projection; failed settlement releases or retains holds exactly per documented state machine.

### Phase 4 — Correctness-first CLOB and realtime data

**Dependencies:** signed order/settlement semantics stable.  
**Deliverables:**

- Deterministic matching core, persistent event log, snapshots, recovery, and market partitioning.
- Limit orders, partial fills, cancel/replace, self-trade policy, and holds.
- Public/private WebSocket streams with snapshots, deltas, sequences, and gap recovery.
- Adapt existing `DetailPanel`, `PriceChart`, and `PositionsPanel` to authoritative APIs.

**Acceptance criteria:** deterministic replay yields identical books/fills; property tests prove no overfill/overspend; reconnect recovers gaps; load target is met with p95/p99 latency and zero invariant violations.

### Phase 5 — Governed oracle, resolution, redemption, and admin

**Dependencies:** durable markets, roles, CTF condition.  
**Deliverables:**

- Market draft/review/open/close/propose/dispute/finalize lifecycle.
- Evidence storage/hashing, maker-checker approvals, step-up, audit, pause controls, and dispute policy.
- On-chain payout reporting and user redemption.
- Replace demo staff authentication and local mutations with protected APIs.

**Acceptance criteria:** no single ordinary admin can create and finalize a market; immutable rule version is visible to users; disputed market cannot finalize early; redemption matches payout vector and ledger/chain reconciliation.

### Phase 6 — ABA FX, treasury, and withdrawals in controlled pilot

**Dependencies:** ledger, compliance approvals, treasury controls, production ABA certification.  
**Deliverables:**

- Durable FX quotes/conversions, KHR and USDC accounts, disclosed fees/spread.
- Treasury inventory/limits, ABA statement and on-chain balance reconciliation.
- Withdrawal/payout workflow with beneficiary checks, step-up, risk/approval, reservation, retries, and exception queue.
- Restricted pilot limits and manual operational runbooks.

**Acceptance criteria:** daily reconciliation closes to zero or approved explained breaks; duplicate payout requests cannot pay twice; outage/retry/chargeback tests pass; treasury and signer limits alert and halt correctly.

### Phase 7 — Multi-range markets and production hardening

**Dependencies:** binary pilot stability and audited outcomes.  
**Deliverables:** independent binary YES/NO bracket conditions, precise non-overlapping range rules, per-condition complete-set accounting, cross-bracket pricing/risk monitoring, liquidity semantics, invalid/tie policy, horizontal scaling, multi-RPC/provider resilience, penetration test, contract audit remediation, backup/PITR and disaster-recovery drills. Reassess a single categorical CTF condition if independent binaries cause unacceptable liquidity fragmentation, collateral duplication, inconsistent pricing, or UX.

**Acceptance criteria:** every binary bracket independently conserves its own complete-set collateral; no documentation or UI implies a shared `$1.00` pool across brackets; boundaries deterministically resolve according to published rules; recovery objectives are demonstrated; external security findings are closed or formally accepted; launch checklist is signed.

## 10. Testing strategy

### Existing baseline to retain

The server has 29 test files covering ABA signing/callbacks/status/reconciliation, authentication persistence/providers/factors, rate limiting, security headers, logging, and database configuration. Preserve these tests and extend them. The client currently has no test script in `client/package.json`.

### Required layers

1. **Unit tests:** validation, money/decimal conversion, EIP-712 hashing, nonce logic, state machines, price-time priority, FX rounding, and ledger posting rules.
2. **Property/invariant tests:** journals balance; no negative available balance; holds never exceed assets; fills never exceed quantity; outcome payouts conserve collateral; duplicate external events have one effect.
3. **Database integration tests:** real PostgreSQL, migrations from empty and previous versions, concurrent callback/order/hold/withdrawal cases, unique idempotency, transaction isolation, and rollback.
4. **Contract tests:** Solidity unit, fuzz, invariant, malicious token/wallet/reentrancy cases, EIP-1271 behavior, pause/governance, gas limits, and Base fork tests.
5. **Service contract tests:** client/API, matcher/relayer, provider adapters, WebSocket schemas, backward compatibility, and version negotiation.
6. **End-to-end tests:** sign in, enroll wallet, verified sandbox deposit, accept FX quote, sign order, match, settle, resolve, redeem, and withdraw; include duplicate, timeout, reorg, and provider outage variants.
7. **Security tests:** SAST, dependency and license scan, secret scan, IaC scan, DAST, authorization matrix, CSRF/CORS, session fixation/rotation, webhook forgery/replay, signer compromise tabletop, and external penetration test.
8. **Performance/soak tests:** matcher throughput and latency, hot market fan-out, WebSocket reconnect storm, database/queue backpressure, relayer nonce pressure, and long-running deterministic replay.
9. **Operational tests:** backup restore, PITR, matcher snapshot restore, indexer full rebuild, RPC failover, ABA reconciliation break, paused withdrawals, key rotation, and disaster-recovery exercise.
10. **Frontend tests:** component and accessibility tests, trade-confirmation semantics, stale/reconnecting states, Khmer/English visual regression, and no local mutation masquerading as confirmed financial state.

CI release gates should include reproducible dependency installation, lint, unit/integration tests, migration checks, contract invariants, generated ABI drift detection, secret scan, and deploy-manifest validation. Mainnet/prod promotion should require human approval and artifact provenance.

## 11. Recommended next development task

After this audit is reviewed, execute the confirmed **Phase 0 / Sprint 1 user-bound ABA deposit ledger vertical slice** before contracts or the CLOB:

1. Rotate the exposed credential, audit access, and replace the tracked value with a non-secret placeholder.
2. Remove the hard-coded staff credential and client-controlled `sessionStorage` authorization; keep the production staff surface disabled until server-side RBAC exists.
3. Record the confirmed hybrid/binary architecture and explicitly defer detailed wallet ownership, provider selection, FX, and treasury choices that Sprint 1 does not need.
4. Adopt Drizzle ORM with ordered, versioned PostgreSQL migrations and prove parity before removing runtime schema initialization.
5. Add immutable ledger accounts, journals, journal lines, and balance/hold projections.
6. Add a `deposit_intent` owned by `user_id` and bind the ABA transaction to it.
7. Make verified callback handling atomically record the unique provider event and post exactly one balanced user-owned KHR deposit journal.
8. Expose an authenticated deposit-status/balance read model; do not yet convert KHR to USDC or enable production checkout.
9. Add concurrency, duplicate-callback, ownership, rollback, and reconciliation invariant tests.

This task reuses the strongest existing code—the auth/session system and ABA verification pipeline—while closing the most dangerous gap: accepting a verified payment without an owned, auditable financial liability. It also creates the accounting foundation required by wallets, orders, settlement, treasury, withdrawals, and the first binary CTF prototype.

### Explicit non-goals for the first task

- No production ABA enablement.
- No on-chain custody or mainnet contract deployment.
- No simulated client balance credit.
- No multi-range independent-binary or categorical markets.
- No optimized Go/Rust matcher.
- No withdrawal flow until ledger, authorization, risk, and reconciliation controls are proven.

## Audit limitations and unverified assumptions

- This was a static repository audit. No database migration, deployment, network call, package installation, build, or application test was executed.
- Runtime environment values, cloud configuration, current database contents, ABA merchant configuration, provider dashboards, deployed artifacts, and Base addresses were not inspected.
- Legal/regulatory status, ABA contractual permissions, treasury banking arrangements, wallet-provider terms, and operational staffing are unverified.
- The repository date and UI content reference future/current market data, but market truth and resolution sources were not independently verified.
- Absence means no evidence was found in the inspected repository; a separately deployed private service may exist but was not provided for audit.
