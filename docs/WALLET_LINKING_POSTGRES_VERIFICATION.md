# Wallet-linking PostgreSQL verification

Stage 4.3G CI preparation and the current 17-entry dependency audit are documented
in [GITHUB_CI_READINESS.md](GITHUB_CI_READINESS.md). The earlier 22-entry assessment
below is preserved as historical evidence.

Stages 4.3D–4.3F, branch `feature/matching-contract-mvp`.

## Stage 4.3F combined database result

The legacy CTF blocker below is resolved by a test-fixture correction. The original
fixture omitted its required oracle deployment and failed identically before and
after 0008. Supplying the matching oracle reaches the named slot-count CHECK; a
separate assertion still verifies the missing-oracle trigger rejection.

The complete nine-migration runner now passes locally on fresh PostgreSQL 16,
including all catalogs, CTF tests, nine history rows and an unchanged whole-schema
fingerprint after repeat migration. All ten wallet-linking scenarios also passed
again, including restart. No migration or security rule changed. See
[CTF_SLOT_COUNT_REGRESSION.md](CTF_SLOT_COUNT_REGRESSION.md) for evidence.
GitHub Actions has not run; commit/push remains unapproved.

## Stage 4.3E final migration result (historical blocker resolved in 4.3F)

Migration `0008_wallet_link_challenges.sql` is generated and implemented locally.
It adds one table with 13 columns, three indexes, three foreign keys, a unique
nonce constraint, nine checks, a protection function and trigger. It creates no
balances, trading permissions or authorization rows. The original proposal is
retained unchanged as the pinned Stage 4.3D reference.

The generated table/constraint/index catalog matches that reference exactly.
The function body, language, configuration and trigger metadata also match.
Explicit DESC NULLS FIRST was needed in Drizzle to preserve the tested index
ordering. This was corrected before finalizing 0008; no prior migration changed.

On fresh disposable PostgreSQL 16.14, Drizzle's normal migrator applied all nine
migrations. All ten wallet-linking scenarios passed (12 Node tests, zero failures
or skips). Nine ordered history rows matched SQL hashes and journal timestamps.
A second migrator call preserved history and the challenge catalog fingerprint.
Database restart preserved pending/consumed challenges and replay rejection.

The broader existing migration runner also applied all nine migrations to a
second empty disposable database, verified all table catalogs and protection
objects, then failed an existing CTF negative test:

```text
invalid outcome slot count failed with P0001, expected ctf_conditions_outcome_slot_count_check
```

That INSERT omits oracle_contract_deployment_id while its market question has an
oracle reference. The unchanged CTF BEFORE trigger can reject the fixture before
the intended CHECK. This separate test fixture issue was not bypassed or changed
in this stage. The full runner did not reach its final whole-schema second-run
fingerprint assertion; the focused wallet suite's second-run checks did pass.
Do not report the full legacy suite or GitHub CI as passing.

Original 0000–0007 SQL/snapshots and journal entries remain pinned and unchanged.
The validator protects all nine migrations, snapshot lineage and the single-table
delta, with negative tests for modified/missing 0008 artifacts and trigger changes.
Drizzle consistency checks passed. Feature flags remain unchanged. Review the
recovery/adoption section in COINBASE_WALLET_ACCOUNT_LINKING.md before rollout.

## Historical Stage 4.3D proposal result

**Disposable PostgreSQL verification passed on 2026-11-16.** After Docker Desktop
became available, the full runner executed against a newly created, labelled
PostgreSQL 16 container on 127.0.0.1:55434. PostgreSQL reported version 16.14.
All 10 database scenarios passed; Node reported 12 tests including the safety
test and parent suite, with zero failures and zero skips.

The initial attempt was blocked by a missing Docker Linux-engine pipe. That
blocker is resolved. No hosted or application database was used as a fallback.

The proposal remains `packages/db/proposals/wallet_link_challenges.sql`, outside
the approved migration chain. Migrations 0000–0007 and their snapshots/journal
are unchanged. Wallet linking has not been enabled.

All eight approved migrations applied successfully. The candidate table, indexes,
function and trigger were applied only inside the disposable database. Final
counts were 21 public application tables and eight Drizzle migration-history
rows. The proposal was not recorded as an approved ninth migration.

The first database run exposed a test-fixture error: a cross-user RELINK test
expected ownership rejection (409) without first satisfying fresh step-up, so
the service correctly returned 403. The fixture now supplies fresh step-up for
that user before testing ownership rejection. The first container was discarded;
the complete corrected suite passed on a new empty container. No service,
proposal SQL, historical migration or schema change was needed.

Dependencies were restored with Node.js 22 and `npm ci --ignore-scripts
--no-audit --no-fund`, using the existing lockfile. A first attempt encountered
a Windows esbuild file lock; the verified local Vite/esbuild processes were
stopped, the retry succeeded (549 packages), and the frontend was restarted at
http://127.0.0.1:5173. Install scripts were not executed. No versions were upgraded.
The offline Drizzle consistency check passed. Backend regression results:
334 passed, 17 optional tests skipped, zero failed. Database/live-wallet tests
are among those skips; those counts are not PostgreSQL integration evidence.

## Start the disposable environment

1. Open Docker Desktop from the Windows Start menu.
2. Select Linux containers and ensure the WSL 2 backend is available if Docker
   reports a WSL/virtualization error. Wait until the engine is running.
3. In PowerShell run `docker info` and confirm a Server section is returned.
4. Check that port 55434 and the container name below are unused. Do not reuse an
   unknown existing container, database or volume.
5. From the repository, create the isolated database:

```powershell
docker run --detach --rm --name khmerfp-wallet-link-pg16 --label khmerfp.disposable=wallet-link --publish 127.0.0.1:55434:5432 --env POSTGRES_DB=khmerfp_wallet_link_test --env POSTGRES_USER=wallet_link_test --env POSTGRES_PASSWORD=disposable_local_only postgres:16
docker exec khmerfp-wallet-link-pg16 pg_isready -U wallet_link_test -d khmerfp_wallet_link_test
```

This public password is for an isolated local test only. Do not use it outside
the disposable container. No bind mount or reusable named volume is configured.

Before any schema write, the runner requires an explicit disposable opt-in,
loopback URL, the exact database name, PostgreSQL 16, expected search path and
an empty database with no application tables, history or user routines. It
never loads server/.env or falls back to DATABASE_URL.

```powershell
$env:NODE_ENV = 'test'
$env:WALLET_LINK_TEST_DISPOSABLE = 'true'
$env:WALLET_LINK_TEST_DATABASE_URL = 'postgresql://wallet_link_test:disposable_local_only@127.0.0.1:55434/khmerfp_wallet_link_test'
$env:WALLET_LINK_TEST_RESTART_CONTAINER = 'khmerfp-wallet-link-pg16'
cd server
node --test test/walletLinkPostgres.test.js
```

Use Node.js 22. The restart opt-in additionally checks the container image,
disposable label, database configuration, volume arrangement and loopback port
mapping before restarting it. No arbitrary shell command or container name is
accepted. Without that opt-in, restart verification is explicitly skipped.

The current test validates immutable artifacts and applies all nine migrations
through Drizzle. It compares final challenge objects against the historical
proposal in a rollback-only reference schema, verifies nine history rows and
repeats the migrator without changes. It no longer applies the proposal as extra
public-table setup. The eight-row result above is historical Stage 4.3D evidence.

After testing, inspect failures before cleanup. Stop only the test container:
`docker stop khmerfp-wallet-link-pg16`. Its anonymous data volume is removed by
Docker with `--rm`. Remove the four WALLET_LINK_TEST_* environment variables and
restore NODE_ENV to its previous value. Each full run requires a fresh empty
database. Do not weaken that requirement to rerun on the app database.

## Proposal review and test coverage

The additive proposal contains one table, three lookup indexes, a PL/pgSQL
function and a BEFORE INSERT/UPDATE trigger. It does not alter user identities,
wallet balances, payment tables or wallet_authorizations.

| Protection | Design | Real PostgreSQL result |
| --- | --- | --- |
| Challenge identity | UUID primary key, unique nonce, immutable fields | Passed covered immutability tests; not every check tested individually |
| Session binding | Existing FKs plus active session/user trigger check | Passed |
| Expiration | Two-minute maximum, service and write-time checks | Passed expiry rejection, including in-flight session expiry |
| One-time use | Locked row, conditional consumption, one-way trigger | Passed |
| Ownership | Existing unique chain/address identity and immutable owner | Passed duplicate-owner tests |
| Concurrent verification | Session/challenge locks and advisory locks across repository instances | Passed; exactly one winner |
| Cross-user attempts | Server-bound user/session and ownership policy | Passed |
| Unlink/relink | Fresh step-up, separate signed actions, same original user | Passed after fixture correction |
| Session revocation/expiry | Rechecked active session before consumption/write | Passed |
| Rollback | Ownership, consumption and audit share one transaction | Passed injected post-write audit failure |
| Restart | Pending/consumed rows survive actual container restart; used proof still rejected | Passed actual Docker restart |

Tests use mocked EIP-1271 evidence to isolate persistence. They are not evidence
of a real Coinbase signature or blockchain finality. Real-wallet proof remains a
separate opt-in test documented in COINBASE_WALLET_ACCOUNT_LINKING.md.

No database compatibility correction was required. Proposal application,
covered trigger behavior, concurrent locking and restart durability were tested
on PostgreSQL 16. This suite does not perform exhaustive catalog equality for
every new column/index or test a generated ninth Drizzle migration. Those remain
requirements of the later approved migration stage.

## Dependency security assessment

The audit reports **22 affected package entries**, not 22 independent exploits:
12 moderate, 8 high and 2 critical. Several parent entries repeat the same
transitive advisory. These are conditional exposure assessments based on source
and the dependency graph, not penetration-test results. No exploit was executed.
No dependency was upgraded and no audit fix was applied.

| Package entry | Severity | Exposure and exploitability | Required remediation |
| --- | --- | --- | --- |
| @base-org/account | High | Browser wallet feature; inherits CDP/zod advisories. Actual vulnerable input path not proven unreachable. | Review resolved SDK tree and patched compatible SDK; rerun passkey/signature tests. |
| @coinbase/cdp-sdk | High | Transitive browser SDK; zod/abitype validation may process external data. Not used as a server wallet here. | Verify patched upstream dependency graph; no automatic API-key/server-wallet migration. |
| abitype | High | SDK dependency inherits zod resource-exhaustion risk. Browser execution can still affect the user. | Review actual bundled version and SDK input limits; test a compatible fix. |
| zod | High | Oversized constrained collections may exhaust memory. Exact SDK call-site reachability remains unresolved. | Select patched compatible version through reviewed upstream changes; bound external inputs. |
| axios | High | Transitive Bakong dependency; audit includes SSRF, credential leakage, prototype-pollution gadgets and DoS. The app's own Bakong HTTP client uses fetch, but SDK exposure is not disproved. | Inventory SDK HTTP helpers and reachable arguments; test a maintained compatible SDK/HTTP dependency. |
| bakong-khqr | High | Imported in backend QR generation; inherits axios findings. Imported code does not prove every HTTP helper is executed. | Review reachable QR/HTTP paths separately and test payment regression before any change. |
| ws | High | ethers dependency; WebSocket peer/framing-dependent DoS and disclosure. Wallet linking uses fixed HTTP JSON-RPC, so that path does not establish WebSocket reachability. | Inventory all WebSocketProvider use; evaluate patched compatible ethers/ws and retest. |
| vite | High | Development server/editor tooling; malicious requests/paths can expose files or invoke affected editor behavior. Not the static production bundle, but developer workstations remain exposed. | Keep dev server loopback-only, avoid untrusted pages/projects and test a supported patched toolchain. |
| vitest | Critical | Test/UI tooling; audit includes arbitrary file read/execution when affected server/UI paths are reachable. Current scripts use run mode, not proof of universal non-exposure. | Keep UI/API private or disabled; plan and test a supported Vitest upgrade with all frontend tests. |
| tinypool | Critical | Test worker dependency; prototype-polluted or attacker-controlled worker options can lead to code execution. No production wallet server import was found in this feature. | Resolve through tested Vitest/worker versions; do not run untrusted tests or feed untrusted worker configuration. |
| @vitest/mocker | Moderate | Test mocking server; redirect/manual mock paths can allow reads or injection under advisory conditions. | Keep test endpoints private; upgrade together with Vitest. |
| vite-node | Moderate | Test/tool execution inherits Vite vulnerabilities. | Upgrade with the tested Vite/Vitest combination. |
| esbuild | Moderate | Tooling/development HTTP server may let websites request/read development resources. Build-only use differs from serving mode. | Identify nested copies and server use; use patched compatible toolchain versions. |
| @esbuild-kit/core-utils | Moderate | Drizzle tooling inherits nested esbuild advisory; not application wallet-link execution. | Review maintained Drizzle tooling path and nested dependency resolution. |
| @esbuild-kit/esm-loader | Moderate | Drizzle loader inherits core-utils/esbuild. | Replace through supported compatible Drizzle tooling; do not blindly downgrade to audit suggestion. |
| drizzle-kit | Moderate | Migration-generation tooling inherits loader/esbuild. Not needed in production request handling. | Test a supported toolchain update against immutable snapshots and generated SQL. |
| minimatch | Moderate | Crafted glob patterns can amplify resource use. Primarily lint/config tooling in this tree. | Evaluate patched compatible resolution; rerun lint and check config compatibility. |
| @eslint/config-array | Moderate | Inherits minimatch issue while loading lint configurations. | Review compatible ESLint/config dependency patches. |
| eslint | Moderate | Developer/CI tooling inherits minimatch issue; untrusted project/config inputs increase risk. | Test compatible lint-tool updates; isolate untrusted PR execution from secrets. |
| ethers | Moderate | Audit parent entry inherits ws. Wallet ownership verifier uses HTTP and bounded calls. | Review compatible patch and rerun EIP-712/EIP-1271/order tests; do not infer all providers are safe. |
| react-router | Moderate | Browser routing: attacker-controlled navigation can enable redirects; SSR hydration advisory has different prerequisites. This frontend uses BrowserRouter, not SSR. | Audit navigation/redirect inputs; test compatible patched router before upgrade. |
| react-router-dom | Moderate | Runtime frontend parent entry inherits react-router findings. | Upgrade with router after navigation/auth regression tests. |

Representative upstream advisories returned by npm audit:

- [Zod collection memory exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
- [Axios absolute-URL SSRF/credential leakage](https://github.com/advisories/GHSA-jr5f-v2jv-69x6)
- [ws fragmented-message memory exhaustion](https://github.com/advisories/GHSA-96hv-2xvq-fx4p)
- [Vitest UI file read/execution](https://github.com/advisories/GHSA-5xrq-8626-4rwp)
- [Tinypool worker-option code execution](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)
- [esbuild development-server cross-origin reads](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
- [minimatch amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249)
- [React Router open redirect](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6)

Audit's suggested SDK/Bakong/Drizzle downgrades or major tool upgrades are not
proof of a safe fix. An override may violate upstream API/version expectations.
Remediation needs separate reviewed changes, lockfile resolution and regression
testing. Public wallet-linking activation remains blocked by that assessment.

## Recommendation

The migration and local combined database checks are ready for review. Require
actual passing GitHub CI after approved commit/push before integration.
Existing-database adoption, real Coinbase proof and dependency/security review
still block feature activation. No commit, push, hosted database operation or
funds movement is part of this stage.
