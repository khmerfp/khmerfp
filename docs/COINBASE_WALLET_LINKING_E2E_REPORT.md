# Coinbase wallet-linking local test report

Latest browser coverage is recorded in [COINBASE_WALLET_BROWSER_E2E_REPORT.md](COINBASE_WALLET_BROWSER_E2E_REPORT.md), Stage 4.3V. The earlier browser-automation gap below is historical.

## Latest result ? Stage 4.3T, 17 November 2026

**Disposable PostgreSQL and HTTP/API/database verification passed. A complete real-browser E2E run is still not established.** No Playwright, Cypress or equivalent browser E2E suite was found in this repository. The frontend tests below run in jsdom with test-only wallet/API mocks; they do not drive a browser connected to the test HTTP server. No browser automation dependency was installed.

### Docker diagnosis and recovery

Docker was already working when this stage inspected it. No system setting, service configuration, WSL installation or Docker context was changed.

- Docker Desktop processes and backend were running.
- Active context: `desktop-linux`, endpoint `npipe:////./pipe/dockerDesktopLinuxEngine`.
- Docker Desktop 4.82.0, Linux Engine 29.6.1; client and server connected successfully.
- WSL default version 2; `docker-desktop` running on WSL2. The stopped Ubuntu distribution is not required for these Docker tests.
- Windows `com.docker.service` was stopped/manual while the daemon worked. Its state alone is not evidence of a broken engine.

The previous missing-pipe failure is historical. This inspection cannot prove why Docker was unavailable then or who restored it. No repair was required now.

If the same pipe error returns:

1. Open Docker Desktop manually and wait for its engine to finish starting.
2. Run `docker context ls`, `docker --context desktop-linux version`, `wsl --status` and `wsl --list --verbose`.
3. If `desktop-linux` works but another context is selected, use the explicit `--context desktop-linux` argument for local commands. Review before changing the default context.
4. If Desktop reports a WSL or virtualization failure, record that exact message and request approval before installing/updating WSL, enabling Windows features or changing system settings. Do not reset Docker or delete distributions/volumes as a troubleshooting shortcut.

### Actual disposable test execution

Created only the documented labelled container `khmerfp-wallet-link-pg16`, image `postgres:16`, bound to `127.0.0.1:55434`, with disposable credentials and an anonymous volume. Existing unrelated containers were not reused, stopped or modified. The runner verified container identity, label, image, mount, database name, PostgreSQL major version, search path and empty database before applying migrations.

Databases inside that container:

- `khmerfp_wallet_link_test`: guarded wallet-link persistence suite.
- `khmerfp_migration_test`: independent fresh database for the complete migration/catalog/CTF runner.

The database reported PostgreSQL 16.14. After testing, the identity-checked disposable container was stopped; its --rm policy removed the container and anonymous database volume. No test database is left running.

All nine immutable migrations applied through Drizzle. The complete migration runner passed: catalog assertions, CTF integrity/negative tests, nine migration-history records, second-run no-op and unchanged schema fingerprint. The public schema contains 21 application tables.

### Passed tests

| Suite | Actual result |
| --- | --- |
| Wallet-link PostgreSQL suite | **13 Node tests passed, zero failed or skipped**: 11 scenarios plus the parent suite and target-safety test |
| Added real HTTP-to-PostgreSQL scenario | Passed success, stored link listing, replay, concurrent one-winner verification, cross-user rejection, wrong network, invalid signature, expiry, unlink/relink, step-up, session revocation and challenge rate limit |
| Complete migration/catalog/CTF runner | Passed against a separate empty disposable database |
| Frontend regression | **106 passed**, including 18 wallet-linking component tests |
| Backend regression without database environment | **336 passed, 17 skipped**, zero failures; PostgreSQL was executed separately above |
| Focused HTTP route regressions | **3 passed**, including the new production-disabled assertion |

The persistence suite also passed injected rollback, immutable challenge constraints, session expiration during verification, cross-repository concurrency, duplicate wallet ownership and actual database restart persistence.

### Test-only changes and corrections

`server/test/walletLinkPostgres.test.js` now exercises the real Express router, service and PostgreSQL repository over a loopback HTTP server. Its authentication lookup reads the isolated test sessions; it is not the complete production login/session-refresh implementation. Signature evidence is injected only in this test and does not call a real Coinbase wallet or prove an on-chain signature.

Two fixture issues were found during development and corrected before the final passing run:

- A frozen JavaScript clock treated fresh PostgreSQL step-up timestamps as future values, correctly causing 403. The test now uses a running clock plus an explicit expiry offset.
- A sixth challenge correctly hit the existing five-per-minute limit (429). The test now asserts that limit and uses a separate test user for the remaining revocation scenario. No rate limit was relaxed.

`server/test/walletLinkRoutes.test.js` now explicitly proves that production returns 503 even when `WALLET_LINK_ENABLED=true`, before reaching injected verification evidence. Existing production code, flags, migrations and schemas remain unchanged. No environment-controlled mock verifier or mock SDK was added to the application.

Focused test lint, JavaScript syntax checks and git diff --check passed.

### Remaining verification boundaries

- A real-browser login ? account page ? HTTP API ? PostgreSQL test is still missing. The repository has component, API and database coverage, not an existing combined browser automation suite. A separate browser test runner and isolated test composition are needed before claiming that result.
- Frontend rejection/network/session states passed simulated component tests. Persistence and HTTP tests passed separately. They are not evidence of actual Coinbase SDK/passkey behavior.
- Real Coinbase EIP-1271 verification remains pending an approved deployed account and separately approved manual signature. Nothing in this stage deploys a wallet or sends a public-chain transaction.
- SDK dependency risks remain as documented in the dependency review. Production linking remains disabled.

### Reproduce safely

Follow the guarded setup in `WALLET_LINKING_POSTGRES_VERIFICATION.md`. Use a fresh empty disposable database each time; never point these commands at an application or hosted database.

```powershell
# server/; supply only the dedicated local disposable test URL
$env:NODE_ENV = 'test'
$env:WALLET_LINK_TEST_DISPOSABLE = 'true'
$env:WALLET_LINK_TEST_DATABASE_URL = '<dedicated loopback khmerfp_wallet_link_test URL>'
$env:WALLET_LINK_TEST_RESTART_CONTAINER = 'khmerfp-wallet-link-pg16'
npx.cmd --yes --package=node@22 node --test test/walletLinkPostgres.test.js
```

Do not leave the database URL environment set for an unrelated backend regression run. The complete migration runner separately requires `MIGRATION_TEST_DATABASE_URL` naming `khmerfp_migration_test`.

No commits, pushes, production changes, real signing or public transactions occurred.

---

## Historical Stage 4.3S report

The results and Docker blocker below describe the earlier stage; the Stage 4.3T results above supersede its database-pending status.


Stage 4.3S — 17 November 2026.

## Result

The existing `/account/wallets` interface was improved and its simulated-wallet coverage expanded. This stage does not establish complete browser-to-PostgreSQL end-to-end success. Docker Desktop's Linux engine is unavailable, so fresh database execution remains blocked. No hosted database was used instead.

Wallet linking remains disabled by default. No real Coinbase connection, signature, transaction or deployment was requested. No migration, backend verification rule or feature flag changed.

## Changes

- `client/src/pages/WalletLinkPage.jsx`: connection and verification progress, linked-wallet loading and empty states, Base Sepolia label, clearer rejected-request handling, session-expiration cleanup, wrapping action buttons and mobile padding. Linked records use readable status rows. A changed account after verification cannot refresh the previous user's records.
- `client/src/pages/WalletLinkPage.test.jsx`: expanded from 7 to 18 component tests using test-only module mocks.
- `contracts/test/WalletLinkOwnership.test.js`: local Hardhat mock-contract test using the real shared KhmerFP ownership EIP-712 type.
- This report.

Existing authentication, challenge issuance, EIP-1271 verifier and PostgreSQL repository are reused. No mock provider or signature verifier was introduced into production code.

## What the tests demonstrate

| Scenario | Evidence and scope |
| --- | --- |
| Sign-in required | Component and existing HTTP authentication tests; sign-in modal uses existing authentication |
| Connect, deployed status, network label | Simulated Coinbase connection in component tests |
| Connection or signature rejected | UI resets loading and allows retry; verification is not submitted |
| Wrong network or undeployed wallet | Connection error displayed or proof action blocked |
| Fresh challenge and signed ownership proof | Component validates actual shared protocol, with mocked signing and API transport |
| Invalid signature, replay, RPC failure | UI displays server rejection without reporting success; existing service tests separately assert actual policy |
| Expired challenge | Rejected before the simulated signing call |
| Wallet or application user changes | In-flight proof discarded; connection cleared |
| Session expires during verification | Server 401 clears connection and displayed ownership records |
| Unlink and relink | Separate action challenges and signatures; existing service tests require step-up and fresh proof |
| Duplicate clicks and concurrent verification | UI submission lock plus existing serialized service tests; real PostgreSQL concurrency rerun pending |
| Refresh | Server records refetched on component remount; no automatic signing or wallet connection |
| Real contract signature check | In-process Hardhat Mock1271Wallet accepts the shared digest, rejects changed user/chain data and another signer |
| Multiple users and unauthorized requests | Existing service and HTTP regression suites; not a new two-browser database E2E run |

The Hardhat test uses only local test signers. It deploys the existing mock contract to the in-process test chain, not a public wallet. Its typed data uses the application's Base Sepolia domain; this does not change the local chain ID or test the production RPC chain guard. It does not model Coinbase's replay-safe signature wrapper or passkey branch. The existing backend verifier tests retain network, deployment, EIP-6492 rejection and timeout checks.

## Executed validation

Under Node.js 22:

- Frontend: **106 passed**, including **18 wallet-linking component tests**.
- Backend: **336 passed, 17 skipped, zero failed**. Skips are environment-dependent PostgreSQL, local demo and real-wallet checks; they are not successes.
- Contracts: **41 passed**, including all original 40 tests and the new isolated ownership test.
- Frontend lint passed.

Offline migration validation, all negative artifact self-tests, Drizzle consistency, frontend build and git diff --check passed. The build emitted third-party ox comment-annotation warnings; these did not fail the build. No dependencies were changed.

No fresh PostgreSQL integration was executed. Earlier PostgreSQL results in `WALLET_LINKING_POSTGRES_VERIFICATION.md` remain historical evidence, not this stage's execution result.

## Database and complete E2E blocker

Docker reported:

```text
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified
```

Start Docker Desktop, select Linux containers and wait for its engine to become ready. Verify `docker info` before proceeding. Use only the labelled disposable wallet-link container and the dedicated `khmerfp_wallet_link_test` database described in the existing verification instructions. The database test requires `NODE_ENV=test`, `WALLET_LINK_TEST_DISPOSABLE=true` and `WALLET_LINK_TEST_DATABASE_URL`; it must never fall back to DATABASE_URL.

Rerun the existing PostgreSQL suite with all nine migrations on a fresh disposable database, including challenge consumption, concurrent verification, cross-user ownership, step-up unlink/relink, expiry, rollback, session revocation and restart persistence. Then exercise the browser, real HTTP session middleware, repository and local contract verifier together in an explicitly isolated test setup. That combined browser/database/contract run is still pending. Component mocks, service tests and independent contract tests do not replace it.

Responsive utility classes are included, but no desktop/mobile browser screenshot or automated real-browser layout test was executed. A login-modal component simulation is not proof of a complete real login workflow.

## Safe workflow in simple English

1. In an approved local test environment, sign in to KhmerFP and open Account Wallets.
2. Connect Coinbase. The page checks the network and shows whether account code exists. Connection alone does not link ownership.
3. For a deployed account, request a fresh challenge and approve its ownership signature manually. Unlink/relink also require fresh application step-up authentication.
4. The backend checks the session, challenge and real smart-wallet signature before saving a link. Only a successful server response refreshes the displayed identities.
5. Unlinking changes the ownership record. It does not cancel orders or revoke on-chain token approvals.

During this stage those browser wallet actions were simulated in tests; users were not asked to perform them live.

## Still required before real-wallet verification

Provide an approved deployed Coinbase Smart Wallet address on Base Sepolia, resolve or explicitly review the outstanding SDK dependency risks, and review the isolated verification plan. Deployment and manual ownership signing require separate approval. Real EIP-1271 magic-value verification, invalid-message rejection and expiry checks must run against that actual account before claiming Coinbase passkey compatibility. Keep production linking disabled until persistence, security and real-wallet evidence are approved.

No commits or pushes were made. Unrelated Stage 4.3K–4.3R research files were preserved.
