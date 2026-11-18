# Stage 4.3K dependency remediation review

Reviewed on 2026-11-16 against commit
458516c1e1ac1f4094dfd1c0720582546e0a658a, branch
feature/matching-contract-mvp. This is a local review, not a new GitHub CI run.

## Outcome

No dependency versions were changed. No supported non-breaking security fix was
verified for any of the 17 remaining package findings. The audit remains failing:
8 moderate, 7 high and 2 critical, before and after this review. Zero findings were
fixed in Stage 4.3K. Earlier ethers/ESLint fixes remain in place.

This is a completed investigation with deferred remediation, not a clean security
result. Major upgrades, peer overrides and SDK downgrades were deliberately not
applied under this task's restrictions. Tests cannot prove vulnerable dependencies
are safe. Wallet linking remains disabled, and no production settings were changed.

## Evidence and compatibility checks

The root workspace lockfile and installed dependency tree were inspected. Fresh
npm audit JSON was captured before and after the review. The machine-readable
comparison is [DEPENDENCY_AUDIT_STAGE_4_3K.json](DEPENDENCY_AUDIT_STAGE_4_3K.json).
It records affected lockfile paths/versions, advisories, suggested fixes and the
classification below. Package entries may inherit the same advisory; 17 entries
does not mean 17 independent exploits. npm audit exits 1 while findings remain.

Registry metadata was checked with npm view for Base Account, CDP, Bakong, all
published Vite 5 / Vitest 2 / Router 6 versions, Drizzle Kit, Vitest 4.1.12 and
React plugin compatibility. The latest inspected Base Account is 2.6.0, CDP 1.62.0,
Bakong 1.0.20 and Drizzle Kit 0.31.11. Their existing parent ranges still select the
affected dependencies. The last inspected Vite 5, Vitest 2 and Router 6 versions
are the installed 5.4.21, 2.1.9 and 6.30.6.

- CDP declares zod ^3.25.76 and abitype 1.0.6; that abitype copy peers on Zod 3.
  The advisory's patched Zod 4.6.6 is a major API change, not an allowed override.
  npm's Base Account 2.5.5 suggestion is a downgrade, not verified remediation.
- Bakong declares axios ^0.24.0. Axios 0.33.0 is outside that pre-1.0 compatible
  range. Bakong 1.0.7 is an unverified downgrade; replacing a payment library also
  needs separate QR/expiry and provider compatibility review.
- Router's reported fix is on 7.18.0+ (audit suggests 7.18.5), outside v6.
- Vitest 4.1.12 supports Node 22 but is two major versions above the current runner.
  Its peer Vite ranges start at v6, and current Vite 6 remains affected by reported
  advisories. A coordinated Vite 7/8 and Vitest migration needs explicit review.
  The installed React plugin 4.7.0 declares support through Vite 7; a Vite 8 move
  needs a separately compatible plugin. No unsupported combination was installed.
- Drizzle Kit already uses patched esbuild 0.25.12 directly, but its deprecated
  esm-loader -> core-utils path still resolves esbuild 0.18.20. Vite resolves
  esbuild 0.21.5. Updating a top-level esbuild would not fix those constrained copies.
  Drizzle's audit suggestion 0.18.1 is a risky downgrade for the protected metadata.

## Every remaining finding

A production release blocker means remediate it or obtain a documented security
risk decision before release; it is not a claim that an exploit was reproduced.
Requires further investigation means reachability is unresolved, not accepted risk.

| Package and affected installed version | Severity | Classification | Evidence and required action |
| --- | --- | --- | --- |
| @base-org/account 2.6.0 | High | Production release blocker | Ships browser wallet code and inherits CDP findings. Disabled linking reduces exposure but does not remove all SDK assets. Require supported upstream repair and real passkey proof. |
| @coinbase/cdp-sdk 1.62.0 | High | Production release blocker | Inherits Zod/abitype findings; latest inspected parent still requires Zod 3. Review supported upstream change, not a forced peer override. |
| zod 3.25.76 | High | Production release blocker | Oversized collection validation can exhaust memory. Exact externally controlled SDK input path remains unresolved. Patched advisory line is 4.6.6+. |
| abitype 1.0.6 | High | Production release blocker | Inherits Zod finding and has Zod 3 peer contract. Do not generalize to every newer abitype copy. Upgrade through a supported SDK graph. |
| bakong-khqr 1.0.20 | High | Production release blocker | Payment runtime dependency, affected through Axios. Current generateIndividual QR path is not the SDK's HTTP helper path. Needs a supported parent or separately reviewed replacement. |
| axios 0.24.0 | High | Production release blocker | Bakong HTTP helper exposure is not enabled by app call sites found, but package remains installed in server runtime. Do not expose untrusted helper URLs. Review all payment SDK consumers before accepting risk. |
| react-router 6.30.6 | Moderate | Requires further investigation | BrowserRouter is used; no SSR hydration was found. Current navigate calls use fixed staff paths. Review all attacker-controlled navigation inputs and migrate to patched v7 with routing tests. |
| react-router-dom 6.30.6 | Moderate | Requires further investigation | Inherits router findings. Same migration and call-path review required; no automatic v7 change. |
| vitest 2.1.9 | Critical | Development/CI risk | UI/server and inherited worker/mocker findings. CI uses run mode, but the package is not patched. Plan supported 4.1.12+ migration with compatible Vite and all 95 frontend tests. |
| tinypool 1.1.1 | Critical | Development/CI risk | Worker-option prototype-pollution gadgets can lead to execution. Patched 2.1.2+ cannot be assumed compatible inside Vitest 2. Upgrade via supported parent. |
| @vitest/mocker 2.1.9 | Moderate | Development/CI risk | Manual mock registration and redirect endpoints. Update with Vitest; do not expose a test server. |
| vite-node 2.1.9 | Moderate | Development/CI risk | Inherits Vite advisory; replace through supported test-tool upgrade. |
| vite 5.4.21 | High | Development/CI risk | Dev server/editor and file-serving findings. Static hosting differs from the dev server. Plan supported major upgrade; bind local development explicitly to loopback. |
| esbuild 0.21.5 / 0.18.20 | Moderate | Development/CI risk | Vulnerable serve-mode copies under Vite and deprecated Drizzle loader. Build-only usage limits exposure, not package vulnerability. Upgrade both parent chains. |
| @esbuild-kit/core-utils 3.3.2 | Moderate | Development/CI risk | Inherits nested esbuild advisory. Needs supported parent removal/update. |
| @esbuild-kit/esm-loader 2.6.5 | Moderate | Development/CI risk | Deprecated loader inherits core-utils/esbuild. Do not delete from node_modules or patch lock metadata to hide it. |
| drizzle-kit 0.31.11 | Moderate | Development/CI risk | Inherits deprecated loader chain. Need supported future release or separately reviewed tooling change preserving migration behavior. |

### Axios call-path detail

npm ls resolves axios-retry 4.5.0's broad peer (0.x || 1.x) to root Axios 0.24.0.
That graph alone does not prove runtime use of that copy. The inspected retry ESM
entry has no Axios runtime import; CDP's _esm/openapi-client/cdpApiClient.js imports
its own Axios 1.21.1, creates an instance and passes it to axiosRetry. CDP's patched
Axios does not remediate Bakong's 0.24.0 copy. No extra unused Axios dependency or
forced deduplication was introduced simply to change audit presentation.

Application inspection found generateIndividual in server/src/payway/bakongKhqr.js
and no app calls to generateDeepLink/checkBakongAccount. Staff navigation uses
fixed paths; BrowserRouter is configured in client/src/main.jsx. These bounded
findings are not whole-program exploitability proofs. No exploit tests or live
Coinbase signing were performed.

## Local regression results

All executable application and contract tests used Node.js 22.23.5. An initial
npm wrapper dry run used host Node 25 and emitted engine warnings; the dry run was
repeated by invoking npm-cli.js explicitly with Node 22 and passed. No install,
upgrade or manifest/lockfile change resulted from either dry run.

| Check | Result |
| --- | --- |
| Frontend | 95 tests passed |
| Backend with disposable PostgreSQL | 373 passed; 3 intentional skips; 0 failed |
| Contract suite | 40 passed; official local CTF included |
| Shared CTF identifiers | 6 passed |
| Full disposable migration/catalog runner | Passed; 9 migrations / 21 tables / history and schema fingerprint unchanged on second run |
| Wallet-linking PostgreSQL | All 10 scenarios; 12 Node tests passed, including actual container restart |
| CTF before/after migration 0008 | Passed; strict trigger and CHECK behavior preserved |
| Offline validator and negative/line-ending tests | Passed |
| Catalog normalization/transaction regression tests | Passed |
| Workspace lint and targeted DB lint | Passed |
| Frontend build and backend syntax/build checks | Passed |
| Drizzle check and generation drift check | Passed; no schema changes, no migration generated |
| Node 22 npm ci --ignore-scripts --dry-run --audit=false | Passed; this is a lockfile dry run, not a fresh install |
| npm ls dependency tree | Passed; no invalid peer errors reported |
| git diff --check | Passed |

The backend skips are standalone demo-chain, real Coinbase proof and wallet PG
suite, with the PG suite executed separately. The existing build's upstream PURE
annotation warnings and roughly 1 MB SDK WASM remain. No tests were disabled.

A fresh postgres:16 container was created only on 127.0.0.1:55434, labelled
khmerfp.disposable=wallet-link, with distinct migration, wallet, CTF and backend
test databases. No hosted database or application data was used. Historical
migrations, schema definitions, workflows and financial/security rules are unchanged.

The independent contracts/ and research dependency trees are outside the 17-entry
root audit comparison. Forty passing contract tests are not a clean audit of
those independent trees.

## Next work and approval gates

1. Approve a separate Vitest/Vite major migration. Choose patched supported versions,
   review the migration guides and plugin peers, then preserve all tests and CI jobs.
   Do not force leaf versions or merge this as a routine patch.
2. Obtain a supported Base/CDP dependency fix, or perform a focused SDK input-boundary
   review with a written security decision. Do not claim server-side body limits
   automatically protect the SDK's own RPC/network parsing.
3. Review a maintained Bakong update/replacement and payment regression fixtures.
   Keep payment processing unchanged until that work is approved.
4. Review Router v7 migration and navigation boundaries, then Drizzle loader removal
   in a separate compatibility change. Preserve all migration hashes and snapshots.

The branch remains functionally ready for CI; its six jobs passed at the verified
baseline. Stage 4.3K ran locally only, with no new remote run or security-clean
release claim. Current changes are documentation/evidence only. No commit or push.

Before real Coinbase verification: review the unresolved wallet dependency risks,
use an approved isolated development setup and an already deployed user-controlled
Base Sepolia account, obtain a fresh domain/user/action-bound test signature, and
run the existing explicit read-only proof test. Never create server wallet secrets,
spend funds, deploy an account or enable the feature to make the test pass.
The existing test checks EIP-1271 proof only; it does not establish trading
compatibility, finality, migration adoption or production readiness. Undeployed
wallets remain blocked pending separate EIP-6492 approval.

## Sources

- npm audit JSON and npm view metadata, captured 2026-11-16; exact affected versions
  and suggested parent fixes are in the accompanying comparison JSON.
- [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
- [Tinypool worker advisory](https://github.com/advisories/GHSA-85c8-ppgw-ccpr).
- [Vitest UI advisory](https://github.com/advisories/GHSA-5xrq-8626-4rwp).
- [Router SSR advisory](https://github.com/advisories/GHSA-337j-9hxr-rhxg).
- [Vitest migration guide](https://vitest.dev/guide/migration/).
- [Vite migration guide](https://vite.dev/guide/migration).
- [Router v6 upgrade guide](https://reactrouter.com/upgrading/v6).
