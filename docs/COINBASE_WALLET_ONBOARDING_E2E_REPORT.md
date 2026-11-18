# Coinbase wallet onboarding browser E2E verification

Date: 18 November 2026. Repository: F:/khmerfp-matching-contract.

Result: all 13 existing Playwright scenarios EXECUTED and PASSED against disposable PostgreSQL 16.14. This verifies the local application flow with simulated wallets, not real Coinbase hosted signup, passkey signing or account deployment. Real original-account linking remains BLOCKED.

## Docker diagnosis and recovery

Earlier inspection found the Docker Desktop Linux engine named pipe missing. That established daemon unavailability at that earlier time, not a damaged installation or a proven WSL configuration fault.

At this run, Docker Desktop and com.docker.backend processes were already running. The desktop-linux context responded with Docker server 29.6.1. WSL reported docker-desktop Running under WSL2; the unrelated Ubuntu distribution was stopped. The Linux engine was available before tests started.

No recovery was necessary. No Docker restart, reinstall, context switch, WSL reset, volume deletion, system configuration change or unrelated container operation was performed. The earlier exact reason the daemon was unavailable cannot be established retrospectively from these checks alone.

## Isolated test environment

- Runtime: cached Node.js 22.23.5, with its directory first on the child PATH so test-server subprocesses also use Node 22.
- Browser: the existing Playwright 1.65.1 Chromium setup; no dependency installation or upgrade.
- Database image: postgres:16, PG_VERSION=16.14-1.pgdg13+1.
- Image ID: sha256:33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20.
- Newly created container: khmerfp-wallet-browser-pg16, labelled khmerfp.disposable=wallet-browser.
- Database: khmerfp_wallet_browser_e2e, on 127.0.0.1:55436 only.
- Frontend test server: 127.0.0.1:5187. Backend test server: 127.0.0.1:4017.
- The runner refused an existing same-name container; none existed. The test ports were checked before starting.
- The fixture checked container identity, image, label, loopback port, anonymous volume, PostgreSQL major version, dedicated database name and empty schema before running the nine existing Drizzle migrations in the new disposable database.
- The existing application login, cookies, routes, wallet-link service and PostgreSQL repository ran together. The Coinbase connection/signing adapter and contract RPC responses were simulated using isolated test signers.

No hosted database, real wallet signature, public blockchain transaction or original Coinbase account was used.

## Executed browser scenarios

One worker, no retries. Playwright reported 13 passed in 36.9 seconds. No scenario was merely collected or skipped in this run.

| # | Scenario | Executed result |
| --- | --- | --- |
| 1 | Login, challenge, simulated signature, PostgreSQL persistence, refresh, unlink and relink | PASS; connected-wallet marker explicitly asserted after linking |
| 2 | Rejected connection | PASS |
| 3 | Wrong network | PASS |
| 4 | Undeployed wallet blocks ownership verification | PASS; Setup unavailable and disabled signing explicitly asserted |
| 5 | Rejected signature | PASS |
| 6 | Invalid signature | PASS |
| 7 | RPC failure | PASS |
| 8 | Expired challenge | PASS |
| 9 | Expired session | PASS |
| 10 | Concurrent verification and replay have exactly one winner | PASS against the real disposable PostgreSQL repository |
| 11 | Mobile layout and keyboard connection | PASS |
| 12 | Local connection cancellation without ownership signing | PASS |
| 13 | New-account entry uses the hosted-flow adapter without automatic signing | PASS with test adapter; NOT real Coinbase account creation |

Synthetic users are registered through the existing app API, logged out, then logged in through the actual existing login UI. The new-user entry checks KhmerFP's onboarding entry and sequencing. Coinbase's remote signup screens and passkey account provisioning are outside this simulated test.

The unlink/relink scenario explicitly seeds fresh test step-up state; it does not prove real external-factor verification. EIP-1271 verification logic is exercised with injected contract/RPC responses, not an actual deployed Coinbase wallet. Code-presence readiness reads, account switching and stale-result behavior also remain covered by frontend unit tests.

## Regression and safety results

| Check | Result in this run |
| --- | --- |
| Full frontend suite | 143 passed, 12 files, no failures |
| Full backend suite | 337 passed, 17 skipped, no failures |
| Browser fixture rejects production, staging and development before database access | 3 executed, 3 passed |
| Browser test source JavaScript syntax | passed |
| git diff --check | passed, with existing LF/CRLF checkout warnings |
| Test container cleanup | verified absent after runner exit |
| Test listeners | ports 4017, 5187 and 55436 verified released |

The 17 skipped backend tests require separately configured integration environments. They are not counted as passed. The browser run independently executed its PostgreSQL-backed linking scenarios; it does not mean every separate backend integration test ran.

No application bug or browser assertion failure was found in this run. No application fix was needed. Two explicit assertions were added within existing scenarios so connected-wallet identification and the setup-unavailable label are directly tested. The scenario count remains 13.

## Production and secret isolation review

1. The browser runner was launched with an allowlisted operating-system environment, Node 22 PATH and NODE_ENV=test. Production URLs, vendor credentials, wallet secrets and database URLs were not inherited into that child process.
2. The test server loads no .env files. Its Vite config has envFile=false. It uses only the fixed loopback disposable PostgreSQL connection after verifying container identity, label and database state.
3. The fixture deletes production integration variables before importing the application. Production wallet-link flag stays false; the test-only app instance injects the enabled router/service after the test-environment guard. This is not production feature activation.
4. Backend regression child configuration excluded database URLs and integration opt-ins. No hosted database fallback was used.
5. Test-only signing routes require loopback host/peer and a random per-run token. Tokens and session credentials are not included in this report.
6. The mock wallet adapter is substituted only by the standalone Vite test configuration. Normal application entry points do not import it. Contract verification calls use an injected in-memory RPC implementation. Browser requests to non-local hosts are blocked by the scenarios.
7. Production/staging/development invocation rejection was executed again and passed. No production mock-verification switch was added.
8. Trace/video and automatic failure screenshots are disabled. The existing explicit mobile screenshot contains synthetic fixture data only and stays in ignored test output.

These checks support isolation of this controlled runner. They are not a general security audit of arbitrary future modifications or the host machine.

## Files changed in this task

- tools/wallet-browser-e2e/tests/wallet.spec.js: added the two assertions to existing scenarios; no new mock bypass or application logic change.
- docs/COINBASE_WALLET_ONBOARDING_E2E_REPORT.md: this executed-results report.
- docs/COINBASE_WALLET_COMPLETE_ONBOARDING.md: follow-up pointer clarifying that its earlier Docker-blocked browser result has now been superseded.

All unrelated local work was preserved. No migration, schema, dependency, production setting or application source changed in this task.

## Rerun

With Node.js 22 and Docker's Linux engine running, use the existing isolated runner from the repository root:

~~~powershell
node tools/wallet-browser-e2e/run.js
node --test tools/wallet-browser-e2e/safety.test.js
~~~

Run without production credentials or database configuration inherited into the child environment, as in this review. The runner creates and cleans only its verified disposable container. If its fixed container name or ports are occupied, inspect the owner before retrying; never remove another container or kill an unrelated service blindly.

## Remaining blockers

- The original Coinbase SDK passkey account's supported setup/delegation operation remains unverified. Real account creation, deployment, EIP-712 ownership signing and EIP-1271 proof were NOT executed.
- A live deployed SDK account and separately approved ownership signature are still needed for real-wallet acceptance. Simulated browser success cannot replace that evidence.
- Production database adoption, staging acceptance, dependency remediation, monitoring and release approvals remain governed by the existing production-readiness report.

The local browser/database verification is complete for these 13 scenarios. Production linking remains disabled. No real signatures, blockchain transactions, funding, deployment, production database changes, commits or pushes occurred.
