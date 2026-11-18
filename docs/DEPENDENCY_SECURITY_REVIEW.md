# Dependency security review

Stage 4.3G, 2026-11-16. Scope: the root npm workspace lockfile, including client,
server, packages/db and packages/contracts. Independent contracts/ and research
lockfiles are not remediated here. Their existing review requirements still apply.

## Stage 4.3K follow-up (2026-11-16)

The fresh before/after root audit remains **17 affected entries: 8 moderate, 7 high,
2 critical**. No supported non-breaking dependency fix was verified, so no package
versions, lockfiles or application behavior were changed. Zero findings were fixed
in this stage. The six passing CI jobs at 458516c remain the remote baseline; the
new full local regression run passed, but this is not a new remote CI result.

See [DEPENDENCY_SECURITY_REMEDIATION.md](DEPENDENCY_SECURITY_REMEDIATION.md) for
all 17 classifications, exact compatibility blockers, local test results and the
required next approvals. Machine-readable evidence is in
[DEPENDENCY_AUDIT_STAGE_4_3K.json](DEPENDENCY_AUDIT_STAGE_4_3K.json). Runtime wallet
and payment findings remain production release blockers. Critical Vitest/tinypool
findings remain development/CI risks. Router reachability requires further
investigation. No vulnerability was accepted or hidden by this classification.

## Result

The starting audit reported 22 affected package entries: 12 moderate, 8 high and
2 critical. These are not 22 independent exploits; several parents inherit the
same advisory. After the targeted fixes, npm audit reports **17 entries: 8 moderate,
7 high and 2 critical**. The audit is still failing. Passing tests do not clear it.

Applied changes:

- Client/server ethers 6.15.0 → 6.17.0. This stays on v6 and replaces its vulnerable
  ws 8.17.1 dependency with the upstream-pinned 8.21.0. No override was added.
- Workspace ESLint 10.13.0 → 10.15.0. Upstream supports Node 22.13+ and declares
  patched config-array/minimatch dependencies. The lock resolves config-array
  0.23.6 and minimatch 11.0.8. Client, server and shared-package manifests pin the
  reviewed ESLint release. Its transitive major was selected by upstream, not forced.
- No SDK downgrade, Zod override, major toolchain/router upgrade or audit fix was run.

The install used Node 22, explicit versions and --ignore-scripts. npm ci dry-run
accepted the manifests/lockfile. Application signature tests, frontend/backend
regressions, database suites and existing contract tests passed after the changes.
Real Coinbase proof remains unverified, as before.

## Each finding

Versions below identify the affected copy, not every installed copy with that
name. Reachability is a source/dependency review judgement, not an exploit test.
Where it is unresolved, do not assume the package is safe or unreachable.

| Package / affected installed version | Severity | Runtime or development | Reachability | Upgrade path and breaking risk | Action/status |
| --- | --- | --- | --- | --- | --- |
| @base-org/account 2.6.0 | High | Browser wallet runtime | Dynamic wallet SDK path; CDP/Zod entry-point exposure not disproved. Feature remains disabled. | Latest inspected SDK is 2.6.0. Audit suggests 2.5.5 downgrade, not a verified fix. Medium/high compatibility risk. | Deferred; require supported upstream remediation and passkey proof. |
| @coinbase/cdp-sdk 1.62.0 | High | Transitive browser runtime | Imported through Base SDK; no server-wallet secrets used. Validation path reachability unresolved. | Parent SDK has ^1.56.0; current copy pins abitype 1.0.6 and Zod ^3.25.76. No safe compatible fix established. | Deferred to reviewed SDK dependency update. |
| abitype 1.0.6 | High | Transitive wallet runtime | Parent finding inherits Zod; this copy peers on Zod 3. | A parent-supported newer abitype may avoid this graph; no tested compatible replacement established. Forcing peers is risky. | Deferred; no forced resolution. |
| zod 3.25.76 | High | Transitive wallet runtime | Oversized constrained collections can exhaust memory; exact SDK call path unresolved. | Patched advisory line is 4.6.6+. Major API change from 3; SDK/abitype currently require 3. | Deferred; review input bounds and supported SDK upgrade. |
| axios 0.24.0 | High | Backend Bakong dependency | Vulnerable helpers perform HTTP for deeplinks/account checks. No calls to those helpers were found in current server/client/api; QR generation uses generateIndividual and app HTTP uses fetch. Not proof of whole-SDK non-exposure. | Patched 0.33+ is outside the current 0.24 line; audit suggests old Bakong 1.0.7. Neither is a verified drop-in fix. | Deferred payment-SDK review; do not expose affected helper URLs. |
| bakong-khqr 1.0.20 | High | Backend runtime | Imported for QR generation; inherits Axios findings. Current QR path is different from its HTTP helpers. | Tested maintained parent update needed; downgrade could remove required QR/expiry behavior. High functional risk. | Deferred, separate payment regression review. |
| ws 8.17.1 (ethers copy) | High | Potential runtime WebSocket transport | No WebSocketProvider use found in the wallet-link server/client paths; fixed HTTP RPC is used. Other consumers still matter. | Upstream ethers 6.17.0 pins patched ws 8.21.0. Low protocol/API risk through supported parent. | Resolved in the root workspace graph. |
| ethers 6.15.0 | Moderate | Frontend/backend runtime | Audit parent of ws. EIP-712/EIP-1271 and local order code are exercised. | 6.17.0, same major; normal minor runtime compatibility risk requires tests. | Applied and regression-tested. |
| react-router 6.30.6 | Moderate | Frontend runtime | BrowserRouter is used; SSR hydration path is absent here. Untrusted navigation/open-redirect reachability still needs review. | Audit candidate 7.18.5; major routing/API migration. | Deferred; review navigation inputs and plan router tests. |
| react-router-dom 6.30.6 | Moderate | Frontend runtime | Inherits router advisory. Fixed wallet-menu path is not an attacker-controlled redirect. | Upgrade with router to a reviewed patched 7.x; major risk. | Deferred, no automatic major upgrade. |
| vite 5.4.21 | High | Development/build tooling | Dev-server and editor endpoints can be attacked under advisory conditions. Static production hosting differs; workstations/CI remain relevant. | Audit candidate 8.3.8; major Vite/plugin change. | Deferred toolchain upgrade; bind dev server to loopback. |
| vitest 2.1.9 | Critical | Test tooling | Affected UI/server endpoints can read/execute files. CI uses run mode, but that does not fix all inherited worker/mocker risks. | Audit candidate 4.1.12; major runner/plugin migration. | Deferred; no exposed UI, no production secrets in test jobs. |
| tinypool 1.1.1 | Critical | Test workers | Prototype-polluted/attacker-controlled worker options can lead to code execution. Not imported by wallet-link production handlers. | Patched 2.1.2+ through supported Vitest upgrade; forcing it into Vitest 2 is unverified. | Deferred major test-toolchain work. |
| @vitest/mocker 2.1.9 | Moderate | Test tooling | Manual-mock/redirect server paths are conditional attack surfaces. No public test server is configured. | Update with Vitest 4.1.12; major parent risk. | Deferred with test toolchain. |
| vite-node 2.1.9 | Moderate | Test/tool execution | Inherits Vite findings. | Update with supported Vite/Vitest pair; major parent risk. | Deferred. |
| esbuild 0.21.5 and nested 0.18.20 | Moderate | Build/Drizzle tooling | Affected serve mode allows cross-origin requests/readback. Build-only operation is different; nested copies remain. | Patched serve behavior needs >=0.25.0; both current parents constrain older lines. | Deferred parent upgrades; no standalone overrides. |
| @esbuild-kit/core-utils 3.3.2 | Moderate | Drizzle tooling | Inherits nested esbuild finding; not request-handler code. | Maintained Drizzle tooling path needed. No verified compatible leaf fix. | Deferred; preserve migration artifacts. |
| @esbuild-kit/esm-loader 2.6.5 | Moderate | Drizzle loader | Inherits core-utils/esbuild finding. | Update through supported parent; audit downgrade is not proven safe. | Deferred. |
| drizzle-kit 0.31.11 | Moderate | Schema/migration tooling | Inherits loader/esbuild findings. CI runs offline check; app does not import the kit. | Audit suggests 0.18.1 downgrade, incompatible-risk for current metadata. No safe in-range fix established. | Deferred separate tooling/migration compatibility review. |
| eslint 10.13.0 | Moderate | Developer/CI tooling | Crafted glob inputs through minimatch; untrusted configs/projects increase risk. | 10.15.0 stays on major 10, supports Node 22 and patched upstream graph. Low tooling risk. | Resolved; lint passed. |
| @eslint/config-array 0.23.5 | Moderate | Lint config loading | Inherits minimatch issue. | 0.23.6 through ESLint 10.15.0, no forced override. Low risk. | Resolved. |
| minimatch 10.2.6 | Moderate | Lint/tooling | Crafted patterns amplify resources; not an ownership-proof handler. | Patched >=11.0.1. ESLint officially selects ^11.0.5; lock resolves 11.0.8. | Resolved through supported parent. |

## Evidence and limits

- npm audit JSON and installed lockfile paths supplied the versions, severities,
  parent relationships and suggested fixes. npm view supplied supported Node and
  dependency ranges. A suggested fix is not automatically a safe upgrade.
- [ethers 6.17.0 release](https://github.com/ethers-io/ethers.js/releases/tag/v6.17.0)
  and [ws advisory](https://github.com/advisories/GHSA-96hv-2xvq-fx4p).
- [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).
- [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
- [Vitest UI advisory](https://github.com/advisories/GHSA-5xrq-8626-4rwp)
  and [Tinypool advisory](https://github.com/advisories/GHSA-85c8-ppgw-ccpr).
- [Axios absolute-URL advisory](https://github.com/advisories/GHSA-jr5f-v2jv-69x6).
- App evidence: server/src/payway/bakongKhqr.js, server/src/services/bakongClient.js,
  server/src/walletLinking/service.js, client/src/services/coinbaseWallet.js and
  client/src/main.jsx. Searches found no app calls to generateDeepLink,
  checkBakongAccount or WebSocketProvider. These are bounded call-path findings.

The separate contracts/ Hardhat project keeps its existing dev dependency versions;
its 40 tests passed, but that is not remediation of its independent dependency tree.
Research repositories are not shipped as wallet-link application code here.

CI execution approval is not launch approval. Remediate or explicitly assess the
remaining runtime findings before enabling wallets. Plan the major test/build
upgrades separately. Never use npm audit fix --force or a peer-breaking Zod override
to make the report green. The 17-entry audit failure must remain visible.


## CDP Embedded Wallet migration audit (2026-11-18)

Fresh root npm audit after adding the three official browser packages at 0.0.132: **34 affected package entries (2 critical, 18 high, 14 moderate)**. Production-only audit: **15 entries (0 critical, 7 high, 8 moderate)**. These counts are package/advisory propagation entries, not 34 independently demonstrated application exploits. The development checkpoint immediately before this change reported 27 entries. No pre-existing locked package version was upgraded or downgraded.

Seven additional entries are @coinbase/cdp-core (moderate), @coinbase/cdp-hooks (moderate), @coinbase/cdp-react (high), @solana/web3.js (moderate), jayson (moderate), stream-json (moderate), and uuid (moderate). The React package inherits findings through the retained optional @base-org/account peer and core/hooks. Core inherits the Solana dependency graph even though KhmerFP's new flow only uses EVM email onboarding/signing. Jayson inherits stream-json parsing/prototype-pollution advisories and uuid buffer-bound checks. Installed packages do not by themselves prove a reachable exploit in this EVM flow; that reachability has not been established. They must not be silently dismissed or treated as approved for production.

The two existing critical development entries remain Vitest/tinypool. Wallet/runtime and payment findings remain unresolved. No overrides, forced resolutions, audit fixes or unrelated dependency upgrades were applied. Real CDP project configuration is also currently blocked by HTTP 404, and neither a real CDP ownership proof nor production readiness is claimed. The new provider is development-gated, and backend production wallet linking remains disabled.
