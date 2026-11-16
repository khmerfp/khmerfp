# Wallet-linking final CI review

Stage 4.3H, reviewed on 2026-11-16.

## Review outcome

Ready for approval to commit and push for GitHub CI testing. Not approved for
wallet-linking activation, database adoption, deployment or release. No commit,
push or PR was created during this review. Remote CI has not run these changes.

Worktree: F:/khmerfp-matching-contract. Branch: feature/matching-contract-mvp.
Reviewed HEAD: a7d6d012d51280ad61ac0df22ce03d0ff5a274c4. The local tracking
reference shows no unpushed commits; remote freshness was not checked by fetch.

## Exact proposed scope

There are 49 intended files: 40 implementation/workflow/test/dependency files and
9 documentation files, including this report. The original diff has 18 modified
tracked files and 30 intended new files; this report is the 31st intended new file.
Preserve and exclude the unrelated empty file `console.log(r.result))`.

The implementation groups and prerequisites are listed in
[GITHUB_CI_READINESS.md](GITHUB_CI_READINESS.md). Include the uncommitted Coinbase
probe prerequisite together with the wallet-linking code. Include the pinned SQL
proposal as a test fixture, not as an additional migration to apply.

Approval snapshot for the 48 files other than this report:
`db78d8b06afc8ef2deac55ba0da96c13c242eb5b8b13b18f18d74ecba9f4f2e2`.
This is SHA-256 over sorted paths, each followed by NUL, its LF-normalized file
SHA-256 and NUL. Only CRLF-to-LF conversion is applied. Recheck the scope and diff
before committing if any files change.

Targeted content scans and manual review found no real credentials, private-key
files, environment files or unexpected generated artifacts in the proposed set.
The remote URL has no embedded credentials. A host-rejection test contains a dummy
PostgreSQL URL; CI uses public disposable test credentials. Environment files are
ignored. This review is not a guarantee against every possible secret pattern.

## Migration and disabled defaults

Migration 0008 is additive: wallet_link_challenges, its constraints/indexes and
protection function/trigger. Migrations 0000-0007, their snapshots and the original
eight journal entries remain unchanged. Nine journal entries are expected.

Canonical LF hashes:

- 0008 SQL: `03b61fc027ef3037230b744f6b8d2bac980ee2165e2a55eccdec53630a2be826`
- 0008 snapshot: `46fed37892e138fc546cc1d2285746f320b589ca9ec61bfaa79c87f9c100bf2a`

The final migration matches the pinned PostgreSQL-tested proposal at catalog level.
Drizzle generation reported no schema changes and created no extra migration.
No existing database was adopted or migrated.

Backend linking requires the explicit flag and development/test environment.
An isolated route check returned 503 with the flag absent and also in production
with the flag set. The frontend route/header require its explicit feature flag.
No environment file or activation setting was changed. Linking grants no trading,
settlement, transfer or backend user-signing permission. Undeployed/EIP-6492
wallets remain blocked.

## Final local results

Node.js 22 was used for the final checks.

| Check | Result |
| --- | --- |
| Frontend tests | 95 passed |
| Backend tests with disposable PostgreSQL | 373 passed, 3 intentional skips, 0 failed |
| Full migration/catalog runner | Passed; 9 migrations, 21 tables, strict security assertions, second run unchanged |
| Wallet-linking PostgreSQL suite | All 10 scenarios passed; 12 Node tests; actual container restart passed |
| CTF regression before/after 0008 | Passed on a separate fresh disposable database |
| Artifact validator and negative/LF-CRLF self-tests | Passed |
| Catalog normalization/transaction regressions | Passed |
| Shared CTF identifiers | 6 passed |
| Lint and frontend build | Passed |
| Drizzle check and generation drift check | Passed; no schema changes |
| Workflow YAML parsing and git diff --check | Passed |

The unchanged contract suite had 40 passing tests in Stage 4.3G; it was not rerun
in this final stage. Live Coinbase verification was not performed. Standalone
demo-chain/live-proof tests are opt-in; the wallet PostgreSQL suite was run
separately from the backend suite. SDK build warnings and a roughly 1 MB WASM
asset remain; disabled linking does not remove all SDK assets from the build.

## Security findings and blockers

The refreshed dependency audit still fails: 17 affected package entries,
8 moderate, 7 high and 2 critical. The critical entries are Vitest 2.1.9 and
tinypool 1.1.1 in development/test tooling. Their reported remediation requires
a reviewed major test-tool upgrade. Restricted CI permissions and run mode reduce
exposure but do not fix vulnerabilities. Runtime SDK and payment dependency risks
also remain. See [DEPENDENCY_SECURITY_REVIEW.md](DEPENDENCY_SECURITY_REVIEW.md)
for package-level evidence and remediation choices. No dependency changes were
made during this final review.

Release blockers remain: dependency remediation or explicit risk decision,
real deployed Coinbase EIP-1271 proof, separate existing-database adoption review,
and explicit feature activation approval. Local green tests do not establish
production readiness or a successful remote Linux workflow.

## Proposed commits

Do not execute until approved. Stage explicit paths only.

1. Keep all 40 code/workflow/dependency/test files together:
   `feat(wallet): add Coinbase ownership linking and migration 0008`
2. Commit the 9 documentation files:
   `docs(wallet): record CI evidence and security release blockers`

The first group must stay coherent: schema exports, migration metadata, validators,
shared signing protocol, lockfile and test-helper safety flags depend on each
other. This supersedes preliminary commit grouping in the earlier readiness note.

## Expected GitHub execution

A normal push to origin/feature/matching-contract-mvp should trigger these jobs:

| Workflow/job | Expected checks |
| --- | --- |
| ci / client | Node 22, locked install, lint, frontend tests and build |
| ci / server | Disposable PostgreSQL 16, guarded backend tests, lint/build checks, shared CTF tests |
| db baseline / validate-baseline | Artifact protection, negative tests, normalization, Drizzle check and targeted lint |
| db baseline / test-baseline-migration | Nine migrations, 21 tables, strict catalog/security checks, history and fingerprint no-op |
| db baseline / test-wallet-linking | Durable linking, replay, concurrency, session and rollback scenarios |
| db baseline / test-ctf-regression | Strict before/after migration 0008 comparison |

Both workflows use contents: read, have no repository-secret references, no deploy
steps, no pull_request_target and no ignored test failures. Installs use
npm ci --ignore-scripts. PostgreSQL credentials are disposable service credentials.
CI intentionally skips the local fixed-container restart subtest; it passed
locally. Live Coinbase proof remains opt-in and unverified.

Repository workflow review does not verify hosting-dashboard settings or external
webhooks. Confirm the feature branch cannot trigger a public hosting deployment
before approving a CI-only push. No PR creation is included in this approval.

## Approval requested

Approve the two proposed commits for the 49-file reviewed scope, excluding
`console.log(r.result))`, and a normal push to
origin/feature/matching-contract-mvp for CI execution only. Do not open a PR,
merge, deploy, run production migrations or enable wallet linking.
