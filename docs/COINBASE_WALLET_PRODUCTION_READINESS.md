# Coinbase wallet-linking production readiness

Stage 4.3Y - 17 November 2026. **Release decision: NO-GO. Keep wallet linking disabled.**

## Scope and evidence limits

Reviewed the local worktree on `feature/matching-contract-mvp`, HEAD `458516c1e1ac1f4094dfd1c0720582546e0a658a`, including the uncommitted UI, browser-test and research work. HEAD alone does not contain all audited changes. Latest local results are not evidence of a reviewed release commit or a new successful GitHub run.

This was a read-only source/configuration audit plus npm audit and registry metadata checks. No application code, dependency, migration, feature flag or infrastructure was changed. No hosted database, dashboard secret, real signature or deployment was accessed. Only this document was created. Earlier executed tests are cited as earlier evidence; the full regression suites were not rerun for this audit.

P0 blocks any production wallet-linking release. P1 must be completed before general availability; a limited pilot needs an explicit scope/risk decision. P2 can follow launch. These are implementation/readiness priorities, not claims that every finding is an exploitable vulnerability.

The scope is **account-to-wallet ownership linking only**. Linking grants no custody, token approval, order-signing or settlement permission. Real-money trading readiness requires a separate audit.

## Controls already implemented

| Control | Actual evidence | Limits |
| --- | --- | --- |
| Default-off backend | `server/src/routes/walletLinkRoutes.js:15` accepts the flag only in development/test; production returns 503 | No safe production rollout path exists yet; do not use NODE_ENV=development to bypass it |
| Opt-in frontend | `client/src/App.jsx:18` includes the account page only with VITE_WALLET_LINK_ENABLED | Build-time UI flag is not backend authorization |
| Existing authentication | `server/src/middleware/requireAuth.js:4`; wallet router derives actor from req.authUser and hashed session cookie | Hosted domain/cookie behavior still needs acceptance testing |
| Strong session tokens | `server/src/services/authSessionService.js:89`: 32 random bytes, SHA-256 storage; production cookies are HttpOnly, Secure, host-only, SameSite=None | Rotation/revocation exist; actual hosted proxy/security settings were not inspected |
| Bound challenge | `packages/domain/src/walletLinkProtocol.js:1`; `server/src/walletLinking/service.js:225`: exact typed-data shape, origin salt, user, wallet, chain, action, session binding, random nonce, 120-second TTL | Fixed Base Sepolia; synchronized application/database clocks required |
| Durable replay protection | `server/src/walletLinking/repository.js:98`: locked challenge row, conditional one-way consumption; migration 0008 protection trigger | Consumption, ownership and audit share a transaction; storage errors roll everything back |
| Real contract verification | `server/src/walletLinking/service.js:47`: deployed code, correct chain, exact EIP-1271 magic value, original digest, bounded gas/timeouts, same-block hash recheck | Latest-block check is not finalized-chain proof; no successful real Coinbase ownership signature yet |
| Undeployed-wallet refusal | Verifier rejects empty code and EIP-6492 wrappers; frontend blocks proof for undeployed accounts | Original SDK account is still undeployed; no hidden factory execution is supported |
| Ownership uniqueness | `packages/db/src/schema/userWallets.js:67`: unique chain/address; service refuses another user's identity and suspended/incompatible custody records | Lost-wallet and legitimate owner-transfer recovery policy remains unresolved |
| Unlink/relink protections | `server/src/walletLinking/service.js:131`: fresh wallet proof plus application step-up within five minutes; SQL write guards recheck session/step-up | Actual step-up route uses Telegram, not a generic password/passkey reauthentication |
| Atomic writes | Repository BEGIN/COMMIT/ROLLBACK with dedicated client, session/identity locks, query/lock timeouts and finally release | Locks remain held during network verification; needs capacity/load testing |
| Existing limits | Router: 30 requests/minute per process/IP. Service: 5 challenges/minute per user, max 10 non-revoked wallets per user/chain | Per-process limiter is not a distributed quota |
| Auditable changes | `service.js:359`: action/challenge/wallet identifiers, payload and signature hashes, verification block evidence; raw signature not saved | No wallet-specific operational metrics or alerting integration found |
| UI safeguards | `client/src/pages/WalletLinkPage.jsx:129`: explicit signing, account epoch checks, cancel-before-submit, progress/error states and post-response record refresh | Message-based 401 classification is brittle; UI is not security authority |
| Mock isolation | `tools/wallet-browser-e2e/server.js:13`: test-only opt-in, labelled empty database, loopback/token guards; normal entry points do not import the adapter | New tools are local/uncommitted and not wired into GitHub CI |

The verifier accepts a contract's signature policy; it does not prove that an address is a Coinbase-created wallet. Frontend SDK selection alone cannot establish backend provider provenance. There is no demonstrated signature bypass against a genuine Coinbase wallet in this audit.

## Prioritized checklist and effort

Estimates are engineering days for one experienced contributor, including focused tests and review preparation. They exclude external provider releases, infrastructure approval, real-wallet availability and reviewer waiting time. They are not calendar commitments. Do not add all rows mechanically: several validation tasks overlap.

### P0 - production release blockers

| ID | Outstanding task and exact evidence | Acceptance criteria | Estimate |
| --- | --- | --- | --- |
| R01 | Decide hosted testnet pilot versus Base mainnet release. Chain 84532 is fixed in the shared protocol and SDK; repository assertChain requires environment=testnet; router refuses production | Approved network/provider/custody scope; reviewed production-capable gating design defaulting off, with no NODE_ENV workaround; explicit kill switch and negative tests | 1-2 days for policy/design; 2-4 more if implementing mainnet support |
| R02 | Resolve dependency risks. Fresh audit: 17 affected entries, 2 critical/7 high/8 moderate; see remediation groups below | Supported compatible dependency tree and regression evidence, or narrowly documented security-owner risk decisions with expiry; no force overrides/downgrades merely to change counts | 8-15 days across groups; upstream fixes can block completion indefinitely |
| R03 | Approve existing-database adoption and controlled migration ownership. Runtime DDL remains in `server/src/server.js:107` and `api/index.js:18`; 0008 has not been verified against a production schema | Read-only schema/history report, tested backup restore, approved 0000-0007 adoption, 0008 staging rehearsal, separate migrator/app roles, runtime-DDL transition and startup read-only compatibility checks | 3-5 days, excluding approval/backup duration |
| R04 | Fix and verify reproducible deploy artifacts and release gates. Render files set rootDir=client/server and use npm install; shared protocol lives outside both roots. No explicit auto-deploy gate is recorded | Repository-root build access to shared packages; locked Node 22 build, explicit deployed commit/lockfile, test tools excluded from serving; approved manual or CI-gated hosting deployment; rollback rehearsal | 2-3 days |
| R05 | Complete real Coinbase and hosted staging acceptance. Stage 4.3V used mock wallet/RPC; tester reported an undeployed account | Approved deployed SDK-controlled account; actual manual passkey ownership proof and negative cases; real TLS origin/cookies, app step-up, two users, session rotation/recovery, backend restart and persistence evidence | 2-4 days after account and approvals are available |
| R06 | Replace fixed public RPC reliance with reviewed production configuration. Backend `service.js:67` and frontend `coinbaseWallet.js` use sepolia.base.org | Dedicated authenticated server RPC, approved public browser endpoint, chain allowlist, strict credential separation, timeouts/rate-limit/failure tests and provider budget | 1-3 days |
| R07 | Complete operational, secret and incident sign-off. Safe logging exists but wallet metrics/on-call/kill-switch drill and hosted secret inventory are unverified | Named owner, minimum alerts, log-redaction tests, secret rotation/access evidence, restore/disable runbook and staging incident exercise | 2-3 days |

Do not clear R01 by deleting the test-only guard, clear R03 by running CREATE statements against an existing database, or clear R05 with a separately deployed EOA-owned wallet. Those would not establish the required evidence.

### P1 - required before general availability

| ID | Task and evidence | Acceptance criteria | Estimate |
| --- | --- | --- | --- |
| R08 | Define provider provenance. Verifier accepts any deployed EIP-1271 account, while repository save labels every new record BASE_ACCOUNT_SDK (`repository.js:131`) | Either explicitly support generic smart-account policy with truthful metadata, or verify approved Coinbase provenance/implementation and upgrade rules server-side; direct API tests | 1-2 days |
| R09 | Define wallet ownership-change and lost-wallet recovery. Links remain ACTIVE after external owner changes; unlink needs wallet proof; cross-user relink is intentionally forbidden | Approved recovery/suspension procedure that does not silently transfer ownership; fresh verification requirements for future sensitive uses; human audit trail | 2-4 days |
| R10 | Validate distributed abuse/capacity controls. Process-local IP limiter; DB/session locks held through RPC; pool size 5 in config | Multi-instance per-user/IP quotas, proxy validation, DB/RPC concurrency budgets, timeout/deadlock/load tests with original one-winner guarantees | 2-3 days |
| R11 | Make latest browser tests and release artifact checks required CI. Workflows do not install/run tools/wallet-browser-e2e | Isolated no-secret browser job, path coverage, pinned package/browser install, production-build flag-on/off checks, required release-commit results and branch settings evidence | 1-2 days |
| R12 | Set challenge/audit retention and clock policy. Cleanup is only proposed in account-linking docs; TTL combines JS time and database clock_timestamp | Reviewed retention and deletion rules, indexes/volume tests, clock-skew monitoring and restore procedure that cannot revive usable challenges | 1-2 days |
| R13 | Define chain-evidence freshness. Latest-block hash reread is present, later reorg/owner-change invalidation is not | Approved confirmation/freshness policy; block-change tests and revalidation before any future financial authorization; ownership record is a point-in-time attestation | 1-2 days |
| R14 | Validate browser security on actual hosting. Production SameSite=None requires CSRF/origin controls; server CSP is for API responses and does not establish CDN headers | Reviewed HTTPS/CORS/cookie/Host/proxy settings and frontend CSP/popup/RPC allowlists; actual Coinbase popup test; no wildcard origins or exposed RPC secrets | 1-2 days |

### P2 - after-launch improvements

| ID | Task | Acceptance criteria | Estimate |
| --- | --- | --- | --- |
| R15 | Replace message-regex error classification with typed API reasons; localize wallet copy | Stable error enums, same security guards, Khmer/English copy and recovery tests | 1-2 days |
| R16 | Broaden accessibility and device regression | Automated accessibility/screenshot checks and wider Firefox/WebKit coverage; baseline real-device passkey tests belong to R05, not this deferral | 1-2 days |
| R17 | Add operational trend tooling beyond minimum release alerts | Quota/capacity reports and slow-query dashboards without sensitive payloads | 1-2 days |

## Dependency security review

Fresh npm audit on the existing lockfile reproduced **17 affected package entries**: 8 moderate, 7 high and 2 critical. This counts package entries, not independent exploits. The audit command changed no manifests or lockfiles. Earlier detailed evidence remains in `docs/DEPENDENCY_SECURITY_REMEDIATION.md` and `DEPENDENCY_AUDIT_STAGE_4_3K.json`.

| Group / installed versions | Severity and exposure | Safe remediation path | Effort within R02 |
| --- | --- | --- | --- |
| @base-org/account 2.6.0; @coinbase/cdp-sdk 1.62.0; abitype 1.0.6; zod 3.25.76 | High, SDK browser runtime when enabled; Zod resource-exhaustion advisory; complete reachability not proven | Maintained SDK/CDP dependency update compatible with patched validation library; test passkeys and signatures. Current CDP declares Zod 3 and abitype 1.0.6; forcing Zod 4 is not a verified safe fix | 2-4 days plus upstream wait |
| bakong-khqr 1.0.20; axios 0.24.0 | High, payment dependency; SSRF/credential/DoS advisories. App QR generation is reachable; vulnerable HTTP-helper reachability remains unresolved | Inventory actual SDK paths, use supported patched parent or separately reviewed replacement preserving KHQR behavior. Parent range ^0.24.0 does not cover reported patched 0.33.0 | 2-3 days |
| react-router / react-router-dom 6.30.6 | Moderate runtime; redirect advisory applies differently from SSR-only paths; app uses BrowserRouter | Review redirects and test supported Router 7 migration; do not assume SSR absence clears open-redirect risk | 1-2 days |
| vitest 2.1.9; tinypool 1.1.1; @vitest/mocker / vite-node 2.1.9 | Two critical and inherited moderate development/CI findings; affected server/worker prerequisites matter | Coordinated supported Vitest upgrade, not a forced worker override. Vitest 4.1.12 supports Node 22 and peers on Vite 6/7/8. Preserve non-public run-mode CI and no release secrets | 2-4 days with Vite work |
| vite 5.4.21; esbuild 0.21.5 and nested 0.18.20 | High/moderate development-server exposure, not equivalent to static production runtime | Supported Vite/tool upgrade with compatible React plugin; current plugin 4.7.0 peers through Vite 7, so Vite 8 needs a compatible plugin. Keep dev servers private | Included above plus 1 day if plugin changes |
| drizzle-kit 0.31.11; @esbuild-kit/esm-loader 2.6.5; core-utils 3.3.2 | Moderate tooling inheritance through deprecated loader | Supported tooling update/removal with immutable artifact parity and catalog regressions; a new top-level esbuild does not fix nested constrained copies | 1-2 days |

Registry metadata was rechecked for the installed SDK/CDP/Bakong ranges and Vitest/React-plugin compatibility. npm's suggested Base Account 2.5.5 and Bakong 1.0.7 downgrades are not established remediation. Drizzle's suggested 0.18.1 downgrade is not safe to apply to protected migration tooling without proof. No automatically suggested fix was installed or accepted.

Public SDK exposure is reduced while the feature is excluded from production builds, but that is not a plan for enabling it. Development/CI critical findings are not automatically exploitable on the production API; they still affect the trusted build environment and need a recorded release decision.

Primary references: [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [Tinypool advisory](https://github.com/advisories/GHSA-85c8-ppgw-ccpr), [Vitest UI advisory](https://github.com/advisories/GHSA-5xrq-8626-4rwp). No exploit was attempted.

## Migration 0008 and existing databases

`packages/db/migrations/0008_wallet_link_challenges.sql` is additive: one 13-column table, nonce uniqueness, three foreign keys, nine CHECK constraints, three indexes, one protection function and trigger. Its session-owner trigger, immutable challenge terms, expiry and one-way consumption are useful controls. It contains no balance updates, trading permissions or destructive edits to other tables.

Those properties do not make blind application safe. On an existing database, the table/function might already exist from runtime/proposal work, search_path may differ, roles may own different objects, or migrations 0000-0007 may have no approved Drizzle history. No hosted catalog/history/backup was inspected. The complete current-chain read-only adoption inspector is not present among this worktree's db scripts; Stage 1.6 work elsewhere must be reviewed rather than assumed available.

Required sequence for R03:

1. Approve an existing-database read-only inspection and compare all 21 tables, functions/triggers, sequences, constraints, indexes, schemas, roles and history against the nine-migration target. Identify any already-existing 0008 objects.
2. Capture and restore-test a backup of schema, data, history and grants using an approved isolated environment. Do not move production personal/payment data into ordinary dev fixtures.
3. Approve a controlled baseline/history adoption method for 0000-0007 without rerunning their CREATE statements. Do not invent manual history records during an interactive production session.
4. Rehearse the exact release migrator, lock/search_path settings, 0008 application and compatibility checks on staging. Keep feature flags off; bound lock waits and inspect failure/history state before retry.
5. Deploy an explicit migration job under a separate role. Transition Node and serverless startup away from DDL only after compatibility is established; keep the application role free of schema-change powers afterwards.
6. Roll back application code by disabling the feature and using compatible code. Retain the additive table/history; do not drop proof data or reset consumed_at. Before restoring older data, stop link writes, invalidate affected sessions via an approved procedure and let all restored challenge TTLs expire before re-enabling. Restores must not make an old proof reusable.

The existing `server` npm migrate command runs runtime auth/Bakong SQL, not the Drizzle nine-migration chain. Do not confuse the two. Runtime Bakong initialization includes data backfill, NOT NULL changes, function replacement and trigger replacement (`server/src/db/bakongSchema.js:32` onward). This is why an ordinary startup is not an acceptable production migration strategy.

See `docs/database/baseline-adoption.md` and the recovery section of `docs/COINBASE_WALLET_ACCOUNT_LINKING.md`; the original baseline document describes the older eight-table starting point, not proof that today's full target is adopted.

## Environment, secrets and RPC checklist

No secret values or .env contents were read. `git ls-files` found no currently tracked .env, PEM or key files in the checked patterns. This is not a complete Git-history leak scan, access audit or proof of credential rotation.

| Configuration | Current state | Required before release |
| --- | --- | --- |
| NODE_ENV | Render YAML uses production; wallet API refuses it | Keep production semantics; separately approve rollout gate design |
| WALLET_LINK_ENABLED | Default false; dev/test only | Stay false until release sign-off; fail closed if missing/invalid |
| VITE_WALLET_LINK_ENABLED | Build-time opt-in | Off in production release until approved; test both build variants |
| WALLET_LINK_APP_ORIGIN | Exact single origin required by service; missing in Render manifest/example | Reviewed HTTPS canonical origin, with deliberate www/alternate-domain behavior; no arbitrary frontend origin |
| APP_ORIGINS | Manifest names apex/www domains | Verify actual hosting settings, credentials CORS, proxy and CSRF behavior |
| VITE_API_URL | Public API URL, not a secret | Correct HTTPS API origin in immutable build; no test-control routes or localhost fallback in release artifact |
| RPC | Hardcoded public Sepolia URL in frontend/backend | Managed server endpoint in secret store, separate publishable browser transport and strict chain configuration; no secret RPC key in VITE variables |
| DATABASE_URL | Backend environment input | Application least-privilege role; migration credential separate; TLS/cert/connection budgets verified without logging URL |
| Session timeouts | Defaults 30 minutes idle / 7 days absolute | Approved risk policy, bounded numeric validation, real expiration/rotation tests |
| Existing provider secrets | Referenced through hosting configuration; values uninspected | Named owners, rotation/access evidence and environment separation; no CDP server wallet secret or user signing key needed for linking |
| Test-only flags/tokens | Present only in standalone harnesses | No test server, mock adapter, test keys, test database URL or tool build artifact in production routing |

Base documents its public endpoints as rate-limited/best-effort and unsuitable for production applications: [official network guidance](https://docs.base.org/get-started/connect-to-base). Keep server RPC credentials out of browser bundles and logs. A fallback must not silently switch chains or accept uncertain verification evidence.

## CI/CD and deployment audit

Current source workflows are `.github/workflows/ci.yml` and `db-baseline.yml`. They use Node 22, read-only contents permission, locked npm installs with scripts disabled, application checks and disposable PostgreSQL jobs. No deployment command, production secret reference or pull_request_target workflow was found. The DB workflow covers artifact negatives, normalization, metadata, catalog migration, wallet persistence and CTF regression. Restart testing is explicit in the local suite; the CI wallet job does not opt into container restart.

The new standalone Playwright suite is **not** a job in these workflows and its package is not installed by root npm ci. It needs its own isolated install and browser setup. Frontend CI currently builds the default flag-off variant; it does not establish that a deployable flag-on wallet page works. Worktree changes have not been committed or verified remotely in this audit. GitHub branch protection and required checks were not inspected.

There is no workflow deployment job, but that does **not** prove hosting auto-deploy is off. Render/Vercel dashboards, webhooks, linked branches and actual deployed commits are unverified. Neither Render YAML explicitly disables or CI-gates deployment. [Render supports manual or checks-pass deployment gates](https://render.com/docs/deploys); inspect and record the real settings before any push intended for release. Checks-pass also requires understanding skipped/neutral check handling, not merely seeing one green job.

Both manifests use service roots that exclude shared protocol imports: `client/render.yaml:5` and `server/render.yaml:5`. [Render states that files outside rootDir are unavailable](https://render.com/docs/monorepo-support). With these manifests used as written, shared workspace imports are incompatible. Actual dashboard overrides could differ, so this is a confirmed manifest defect rather than a claim about the currently running host. Replace it with an approved repository-root/workspace build or packaged shared artifacts, not duplicated protocol code. Use locked installs and an explicit release commit.

The server health check points to /api/health (process health). /api/ready checks database connectivity only; neither proves wallet tables/history, approved chain row or RPC readiness. Add a non-mutating wallet-readiness check for rollout gating without making an RPC outage trigger an endless process restart loop.

Server CSP headers (`server/src/middleware/securityHeaders.js`) do not establish the static frontend's actual headers. Verify SDK popup/frame/connect requirements on staging; do not loosen CSP blindly or claim the API CSP currently blocks the CDN frontend.

## Monitoring and incident response

Completed evidence is transactional database auditing, redacted operational logger fields, request IDs and safe public error messages. Rejected proof attempts after consumption receive audit events; failures earlier in the pipeline are not a complete operational audit stream. No wallet-specific metrics, alert rules, retention schedule or incident owner is established by the repository.

Minimum R07 deliverables:

- Counters by safe reason code: challenges, verification successes/failures, expiration/replay, conflicts, rate limits, DB/RPC failures and disable events.
- Latency and saturation: RPC p95/timeouts, connection-pool usage, lock waits, transaction duration and clock skew. Alert thresholds must be chosen from staging load tests, not invented here.
- Correlation through request/challenge IDs with role-restricted audit access. Never log session cookies, raw signatures, typed-data request bodies, full secrets or RPC credential URLs. Wallet/user identifiers are personal linkage data even when addresses are public.
- On incident: disable writes through an approved kill switch, revoke affected sessions if required, preserve audit evidence, investigate deployment/code/RPC changes, suspend affected links through an authorized process, rehearse recovery and require sign-off before reopening.
- Named responder, escalation route, notification policy and restore drills. Unlinking is not on-chain approval revocation; incident UI must not imply that it protects existing token approvals or orders.

## Staging and real-wallet acceptance still missing

Stage 4.3V local evidence: 12 Chromium scenarios, 115 frontend tests, 337 backend passes/17 environment skips, 13 separately executed PostgreSQL tests, 41 local contract tests, three harness-safety tests and complete migration/catalog checks. See `docs/COINBASE_WALLET_BROWSER_E2E_REPORT.md`. Those are earlier local results, not a new audit test run or remote CI result.

Browser tests exercise real login/cookies/API/database but simulate SDK signing and EIP-1271 RPC. They seed a fresh step-up timestamp. They do not prove Coinbase passkeys, actual Telegram step-up or real chain verification. The tester only reached the undeployed-wallet blocker. The latest earlier read-only deployment check also found no code at the previously reported SDK account; this audit requested no new chain interaction.

Required staging acceptance:

1. Real HTTPS frontend/API origins, HttpOnly/Secure cookies, CORS/CSRF, proxy and CSP under the intended production topology.
2. Approved deployed SDK-controlled Coinbase account, exact ownership challenge/signature format and actual EIP-1271 result; reject altered payloads, wrong chain, invalid/expired/replayed proofs and undeployed/6492 cases.
3. Two accounts, multiple devices, account/wallet switching, real step-up and session rotation, lost-wallet escalation and legitimate ownership-change policy.
4. Backend restart and multiple instances, concurrent verification, RPC outage/rate limits, failover, clock skew, DB lock contention and rollback without duplicate links.
5. Existing-database adoption rehearsal, real backup restore, feature disable drill and exact release artifact/CI evidence.

The separate EOA-owned open-source Coinbase wallet proposal can test the contract's address-owner branch; it cannot clear the original SDK passkey acceptance gate. No experimental wallet deployment is required to complete the source/configuration work in this roadmap.

## Implementation order and release sign-off

1. **Scope and reproducible release foundation:** R01, R04, R11. Agree network/pilot scope, record hosting gates, fix root/workspace packaging and add no-secret browser CI. Deliverable: reviewable immutable artifact and required checks. Keep flags off.
2. **Security and persistence:** R02 and R03, then R08/R09. Remediate dependency groups independently, rehearse adoption/restore and approve provider/recovery policy. Deliverable: compatible tested tree and migration/recovery evidence. No live migration follows automatically.
3. **Reliability:** R06/R07 with R10/R12/R13/R14. Implement managed RPC, capacity controls, retention, chain-evidence policy, hosted security and monitoring. Deliverable: staging failure/load and incident-drill results.
4. **Actual acceptance:** R05 using that exact staging artifact, then owner/security/operations approval. Deliverable: real SDK-controlled wallet evidence and product-approved scope. Real signatures remain a separate approval.
5. **Controlled rollout only after approval:** approve production inspection/migration separately; verify readiness with flags off; approve a limited enablement and rollback window. Mainnet/trading authorization is not implied. Complete all P1 work before general availability; schedule P2 separately.

Release checklist: [ ] scope/network approved; [ ] security decisions closed; [ ] database/adoption/restore approved; [ ] deterministic artifact and hosting gates verified; [ ] latest CI including browser passes; [ ] staging real-wallet/step-up passes; [ ] RPC/limits/monitoring ready; [ ] recovery and kill-switch drill passes; [ ] named final approvers sign off.

**Recommended first task:** R04/R11, prepare a repository-root, locked build and no-secret browser CI proposal, with wallet flags still off. This is useful production-readiness work that does not require a real wallet signature, a deployment experiment or access to financial data.
