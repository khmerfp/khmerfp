# Coinbase wallet browser verification

Stage 4.3V ? 17 November 2026. Local implementation and testing only.

## Result

**The isolated browser-to-API-to-PostgreSQL wallet-linking flow passes with simulated wallet signing and RPC responses. Real Coinbase connection reaches the undeployed-wallet blocker, as reported by the tester. Real Coinbase ownership verification remains untested.**

No production feature was activated. No real wallet signature, transaction, UserOperation or public-chain deployment was requested. No existing migration, schema, payment code or backend verification rule was changed. No commit or push was made.

## UI changes

The existing `/account/wallets` page retains KhmerFP colors and dark-theme support. It now shows explicit connection, rejection, wrong-network, undeployed, signature-waiting, verification, linked, failure and session-expiration states. Wallet address, Base Sepolia chain, wallet type and backend ownership status are separate fields.

The verified badge requires an active backend record on the correct chain with VERIFIED ownership status. A connected SDK address is not a verified link. Successful linking is shown only after the verification request succeeds and wallet records are refreshed from the backend.

Retry is explicit. Local cancellation discards in-flight connection/signature results using the existing account epoch guard; it does not claim to close a Coinbase popup. Cancellation is not offered after verification has been submitted because a server write cannot safely be cancelled from the page. Unlink/relink still require fresh wallet proof and recent application step-up authentication.

Signature-specific HTTP 401 errors now show verification failure rather than incorrectly claiming the application session expired. Actual authentication/session errors clear the connection and offer sign-in again.

Scoped CSS includes wrapping addresses, responsive cards, mobile actions, keyboard focus outlines and reduced-motion support. Previously removed descriptions remain removed. The connect button retains the requested gray text.

## Real Coinbase connection evidence

The installed SDK remains `@base-org/account` **2.6.0**. The actual connection module still creates the Coinbase universal-account provider and requests accounts only after the user clicks Connect. It does not use a server wallet, request private keys, or automatically request an ownership signature.

The existing helper checks the wallet chain, uses a fixed Base Sepolia read-only RPC, verifies the RPC chain and calls eth_getCode. This stage adds a bounded HTTP request timeout, rejects a zero address, and rechecks wallet address/network after the deployment read. RPC providers are destroyed after use. No new deployment or transaction method was added.

The tester manually used the real local page and reported:

> Wallet not deployed. Linking is blocked; no deployment or funds will be requested.

That confirms the tester reached the undeployed-account UI state. The current public address and raw RPC/block evidence were not supplied in this response, so this report does not independently reconfirm the earlier tester address or claim a recorded account-specific chain proof. The connection code requires chain ID 84532 before returning deployment status. Ownership signing remained blocked. No real signature was requested.

## Isolated Playwright design

Playwright Test **1.65.1** is pinned with its own lockfile under `tools/wallet-browser-e2e/`. It is not added to the application workspaces, root lockfile or production dependencies. Its installation audit reported zero vulnerabilities in this separate four-package tree; this does not clear existing application dependency findings.

The suite follows Playwright's [local web-server setup](https://playwright.dev/docs/test-webserver) and [Chromium installation guidance](https://playwright.dev/docs/browsers).

The runner creates a new labelled `postgres:16` container on `127.0.0.1:55436`. The fixture verifies container identity, image, label, loopback binding, anonymous volume, dedicated database name, PostgreSQL major version and empty schema. It runs the existing offline artifact validator before applying all nine existing migrations through Drizzle. It never loads .env files or falls back to DATABASE_URL.

The browser uses `127.0.0.1:5187`; the isolated backend uses `127.0.0.1:4017`. Non-local browser requests are blocked. The actual page, existing login form, password service, HttpOnly session cookie, authentication middleware, challenge protocol, linking service and PostgreSQL repository run together.

Only the standalone Vite test configuration replaces the Coinbase adapter. The normal application Vite configuration and Express entry points do not import that adapter. The actual backend verifier is exercised with an in-memory RPC/contract simulation returning EIP-1271 magic values after checking signatures from ephemeral test signers. These are not Coinbase passkeys or the official Coinbase replay-safe signature format. This proves application flow and persistence, not real smart-wallet cryptography or public-chain compatibility.

Unlink/relink tests seed a fresh application step-up timestamp in the disposable fixture. They do not automate or prove real Telegram factor verification. Each case starts a fresh app instance with its unchanged request limiter; authentication rate-limit fixture rows are reset between cases. No production rate limit was relaxed.

## Browser results

**12 Chromium tests passed, zero failed or skipped**, using Node.js 22:

| Scenario | Result |
| --- | --- |
| Login, challenge, signature approval, verification, persistence, refresh, unlink and relink | Passed |
| Connection rejected | Passed |
| Wrong network | Passed |
| Undeployed wallet blocks proof | Passed |
| Signature rejected | Passed |
| Invalid EIP-1271 result | Passed |
| Verification RPC failure | Passed |
| Expired challenge | Passed |
| Expired session | Passed |
| Concurrent verification and replay: exactly one winner | Passed |
| Mobile 390px layout, no horizontal overflow, keyboard connection | Passed |
| Local connection cancellation without ownership signing | Passed |

The main scenario asserts the waiting-for-signature and verifying-ownership states before success. Linked identities survive a page reload through real HTTP session recovery and database reads. An explicit synthetic mobile screenshot was inspected locally; browser screenshots and result folders are ignored by Git.

An initial suite attempt hit the real request limit because cases shared its in-memory state. Fresh per-case app instances fixed that test-isolation problem. Another test-file issue involved a non-ASCII selector and BOM handling in Vitest; selectors now reuse the actual translation dictionary and the test source uses UTF-8 without BOM. These corrections changed test infrastructure, not database security assertions.

## Regression results

- Frontend suite: **115 tests passed**, including 20 wallet page tests and 7 read-only connection tests.
- Backend suite without database opt-ins: **337 passed, 17 skipped**, zero failed. Skips remain explicitly environment-dependent; they are not successes.
- Separately configured real PostgreSQL wallet suite: **13 passed, zero skipped**, including restart, concurrency, replay, HTTP/database actions and rollback.
- Complete PostgreSQL migration/catalog/CTF runner: passed on a separate empty disposable database, with nine history rows and unchanged schema fingerprint on repeat migration.
- Local Hardhat contracts: **41 passed**. These are local regression tests, not Coinbase deployments or public-chain verification.
- Browser fixture safety: **3 passed**; production, staging and development invocations are refused before database access.
- Focused frontend/tool lint, JavaScript syntax checks, artifact negative self-tests, Drizzle consistency and git diff --check: passed.
- Local opt-in frontend build: passed; third-party ox comment warnings and the SDK chunk-size warning remain. No unrelated dependency upgrade was attempted.

## Safety boundaries

There is no production mock-provider or mock-verifier environment switch. The separate fixture requires NODE_ENV=test, an explicit standalone opt-in, verified disposable container identity and a random per-run token. Its control routes require that token and a loopback host and peer. The existing production router regression still proves verification is disabled even with its feature flag set.

Test keys exist only in memory and are never returned to the browser. Raw signatures and credentials are not saved by the harness. Playwright tracing, video and automatic failure screenshots are off. Test output may contain synthetic account names and public fixture addresses; result directories are ignored. No tester wallet credentials are used.

The browser runner stops its own servers and removes its identity-checked container after completion. The separately created regression database was also removed after verification. Existing local UI/backend services and unrelated containers were preserved.

## Run locally

Keep the normal read-only account page separate from the simulated browser suite.

For the real local page, use the already-running frontend at `http://127.0.0.1:5173/account/wallets`. Sign in and click Connect manually. If the account is undeployed, stop there. Do not approve ownership signing or deployment during this stage. The normal backend's wallet-linking flag remains disabled.

For the automated suite, start Docker Desktop with its Linux engine, use Node.js 22, and run from the repository root:

```powershell
npm ci --prefix tools/wallet-browser-e2e --ignore-scripts
npx.cmd --yes --package=node@22 node tools/wallet-browser-e2e/node_modules/playwright/cli.js install chromium
npx.cmd --yes --package=node@22 node tools/wallet-browser-e2e/run.js
npx.cmd --yes --package=node@22 node --test tools/wallet-browser-e2e/safety.test.js
```

Ports 55436, 5187 and 4017 must be free. The runner refuses an existing test container rather than overwriting it. If forcibly interrupted, inspect the container ID and label before cleanup. Do not expose the test servers or reuse a hosted database.

## Files in this stage

- `client/src/pages/WalletLinkPage.jsx` and `.css`: connection states, metadata, retry/cancellation and session recovery.
- `client/src/pages/WalletLinkPage.test.jsx`: additional rejection/cancellation coverage.
- `client/src/services/coinbaseWallet.js` and `.test.js`: bounded read-only connection checks and test-only SDK simulations.
- `tools/wallet-browser-e2e/`: standalone pinned Playwright package, runner, fixture, adapter, browser/safety tests, lint configuration and README.
- This report; the earlier E2E report links here for the newer browser result.

## Still blocked

A deployed tester-controlled Coinbase account, an approved fresh manual ownership signature and actual Base Sepolia EIP-1271 validation are still needed. A separately factory-deployed EOA-owned test wallet would not prove the existing universal-account passkey flow. See the earlier deployment feasibility and real-wallet verification plans.

Existing SDK/CDP and tooling security findings remain subject to their separate remediation review. This stage does not establish production readiness, activate wallet linking, grant token approvals, or grant trading/settlement permissions.
