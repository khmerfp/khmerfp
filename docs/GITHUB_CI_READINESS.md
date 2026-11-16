# Coinbase wallet-linking CI readiness

Stage 4.3G, 2026-11-16. Worktree F:/khmerfp-matching-contract,
branch feature/matching-contract-mvp.

## Decision

**Ready for reviewed GitHub test execution. Not ready for public wallet activation.**
Local validation passed, including real disposable PostgreSQL. No commit, push,
PR creation, production migration or deployment was performed. Remote Linux
GitHub Actions results still need checking after approval. The dependency audit
remains failing with 17 affected entries, including two critical development-tool
entries. See [DEPENDENCY_SECURITY_REVIEW.md](DEPENDENCY_SECURITY_REVIEW.md).

## Reviewed implementation

- Existing application users/sessions remain the login authority. Challenges bind
  user, session, address, chain, origin, nonce, action and two-minute expiry.
- Deployed smart accounts require EIP-1271. SDK connection is not ownership proof.
  Undeployed/6492 accounts remain blocked, with no factory call or funds movement.
- Durable consumption, identity changes and audit use one transaction. Locks and
  existing chain/address uniqueness prevent duplicate ownership. Unlink/relink
  require fresh application step-up and a new wallet proof.
- No wallet_authorizations, order-signing, settlement or token-transfer permission
  is created. Neither wallet-link feature flag was enabled.
- Migration 0008 adds only the challenge table, indexes, function and trigger.
  It matches the pinned PostgreSQL-tested proposal in catalog metadata. All prior
  migrations/snapshots/journal entries stay protected; no schema drift was found.
- Review tightened origin configuration to HTTPS or explicitly local HTTP only;
  FTP/WS loopback URLs are rejected, with a new unit test.

## Changes included for review

| Area | Files/groups |
| --- | --- |
| Coinbase frontend | client/src/pages/WalletLinkPage*, client/src/services/coinbaseWallet.js and walletLinkApi*, App.jsx, Header.jsx |
| Connection prerequisite | Existing uncommitted Coinbase probe/compatibility files under client/src/demo, main.jsx and SDK dependency; these must not be omitted when assembling this branch |
| Ownership backend | server/src/routes/walletLinkRoutes.js, server/src/walletLinking/*, server/src/app.js, wallet-link tests |
| Shared signing protocol | packages/domain/src/walletLinkProtocol.js |
| Database | walletLinkChallenges.js/export, 0008 SQL/snapshot, appended journal entry, artifact/catalog validators and integration runners |
| Reference fixture | packages/db/proposals/wallet_link_challenges.sql; required by the pinned catalog-parity test, not another migration to execute |
| CTF regression | Corrected fixture and testCtfSlotCount.js, preserving both trigger and named CHECK assertions |
| Security dependencies | Client/server ethers 6.17.0, workspace ESLint 10.15.0, matching manifests/root lockfile |
| Existing backend test setup | server/test-support/testDatabase.js and testDatabaseConfig.test.js; verified disposable pool initialization, shared app pool and guarded cleanup |
| CI/docs | Both workflows, implemented ERD, wallet verification/recovery docs, CTF/security/readiness reports |

Do not stage `.env`, temporary proof files/signatures, build/cache output, node_modules,
generated local deployments or unrelated work. In particular, preserve but exclude
the unrelated untracked file named `console.log(r.result))`. Do not use git add .
without reviewing every file.

## CI workflows

ci.yml now installs the root lockfile with npm ci --ignore-scripts, uses Node 22,
runs frontend tests (previously missing), frontend lint/build, backend lint/tests/
syntax and shared CTF identifier tests/lint. Its backend database remains the
isolated PostgreSQL 16 angkor_payment_test service.

The first CI-equivalent backend run exposed an existing helper defect: opening
a raw pool neither initialized tables nor attached the application service pool,
and no-argument cleanup did not match the helper signature. The test-only helper
now verifies the dedicated name, loopback target, explicit disposable opt-in and
actual database before initializing the existing backend schema. It refuses a
pre-existing app pool, rejects target changes, and only closes its verified active
pool. No backend initialization or authentication implementation was changed.
The CI server job explicitly sets TEST_DATABASE_DISPOSABLE=true. Local test runs
that set TEST_DATABASE_URL must now supply that opt-in too.

db-baseline.yml keeps the existing artifact and full-catalog jobs and adds:

- Artifact negative/line-ending tests, normalization/transaction tests, targeted
  database lint and offline Drizzle consistency.
- A separate PostgreSQL 16 wallet-linking job for migration history, catalog
  parity, replay, concurrent verification, ownership, expiry, revocation and rollback.
- A separate PostgreSQL 16 CTF job comparing the same strict cases before/after 0008.

Database checks run on relevant pushes/PR paths and manual workflow_dispatch.
Service credentials are public, disposable test values, not repository secrets.
Each job has an isolated database; no production URL or migration command is used.
Both workflows use read-only repository permissions and have no deploy step.

The wallet CI job deliberately does not set the local Docker restart opt-in:
its service is GitHub-managed, so the restart subtest is explicitly skipped there.
Local verification ran that subtest successfully. Do not report this as a CI
restart test or weaken the runner's container identity checks to enable it.
Real Coinbase verification remains opt-in and is not faked in CI.

## Local evidence

| Check | Result |
| --- | --- |
| Manifest/lockfile install | npm ci --ignore-scripts dry-run passed; targeted installs succeeded |
| Frontend | 95 tests passed; lint and default-disabled production build passed |
| Backend with disposable PostgreSQL | 373 tests passed, 3 intentionally skipped, zero failures |
| Wallet PostgreSQL integration | All ten scenarios passed; 12 Node tests, zero skips/failures, including actual restart |
| Full migration/catalog/CTF runner | Passed; nine history rows and unchanged whole-schema fingerprint after repeat migration |
| Before/after CTF comparison | Passed; original oracle fixture failure was identical before/after 0008 |
| Shared CTF identifiers | Six independent/reference-vector tests passed |
| Existing local Solidity suite | 40 passed on in-process Hardhat; no public network/deployment |
| Artifact validation | Nine-migration validation, negative tests and LF/CRLF checks passed |
| Catalog normalization/transactions | Passed |
| Drizzle consistency | Passed; offline generation reports no schema changes |
| Workflow YAML | Parsed successfully; remote Actions validation still pending |

Backend skips are the standalone demo-chain test, real Coinbase proof and the
separately executed wallet PostgreSQL suite. Frontend build retains upstream ox
annotation warnings and an unused SDK WASM asset; build succeeds, but this is not
a claim that all SDK assets are excluded from production output.

## Commit and PR plan

1. Review the exact allowlist and all untracked prerequisites; preserve unrelated work.
2. Approve commit/push explicitly. A sensible grouping is the account-link feature
   and migration/tests, followed by security/test-helper/CI preparation. If splitting,
   review overlapping manifest/test-runner hunks so each commit is coherent.
3. Push normally to feature/matching-contract-mvp; never force-push. Inspect an
   existing matching PR before creating another. Target the agreed integration
   branch (normally development), not an immediate production release.
4. Require actual green frontend, backend, baseline, wallet and CTF CI jobs. Record
   the restart skip and unresolved audit findings honestly. No test job has been
   marked continue-on-error and no prior assertion was removed.
5. Resolve/assess dependency risk, prove a real deployed Coinbase signature, and
   approve schema adoption/backup/recovery before any feature activation. Merging
   code is a separate approval from production migrations and wallet activation.

No production secrets were changed. No audit gate was removed; a security-clean
release must not be inferred from functional CI. Current approval requested is
review/commit/push for CI execution only, not deployment or real funds.
