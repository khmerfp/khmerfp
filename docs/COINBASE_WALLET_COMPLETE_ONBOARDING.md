# Coinbase wallet onboarding and account linking

Review date: 18 November 2026. Worktree: F:/khmerfp-matching-contract.

Status: local onboarding improvements and offline regression checks complete. Real end-to-end linking is BLOCKED for the original undeployed Coinbase SDK account. This is not a production-ready release or a completed wallet deployment.

## User workflow

1. Sign in to the existing KhmerFP account. Coinbase connection does not replace KhmerFP authentication.
2. Open /account/wallets. Existing users choose Connect Coinbase wallet on Base Sepolia. New users can choose New to Coinbase? Continue with Coinbase. Both open the same official installed SDK provider.
3. Sign in, choose an account, or use any account-creation option offered by Coinbase's hosted window. KhmerFP does not receive Coinbase credentials, collect a recovery phrase, or create a custom registration form. A connected address is not proof that signup, deployment or ownership verification completed.
4. The app checks the selected address, wallet chain, RPC chain and deployed code. It requires Base Sepolia 84532. Account/network changes discard the result.
5. If code is absent, show Setup unavailable with a read-only retry. A supported account-specific setup operation, costs and effects are still unknown, so no executable setup operation exists.
6. If code exists, the user may explicitly request an ownership proof. This only permits attempting verification; code presence alone does not prove the contract is a particular Coinbase implementation or that the user controls it.
7. The authenticated backend issues a fresh, single-use EIP-712 challenge. The browser validates its user, wallet, action and application context before asking for an ownership signature.
8. The backend verifies the signature with the wallet contract's EIP-1271 isValidSignature method. It requires the exact magic value 0x1626ba7e, deployed code, correct chain and stable block evidence. Undeployed/EIP-6492 signatures remain rejected.
9. Only a successful backend transaction consumes the valid challenge and saves the link together. Invalid attempts are handled by the existing one-use policy. The page refreshes persisted records and shows success after the backend returns successfully. A failed response is never displayed as success; on uncertain persistence, reload records before retrying a fresh challenge.
10. The linked list marks the currently connected address. ACTIVE/REVOKED is the account-link status, not on-chain token approval. Disconnecting the SDK is different from unlinking the database record.
11. Unlink/relink requires a fresh wallet proof and application step-up authentication within five minutes. Existing uniqueness rules prevent cross-user takeover. The backend returns a generic refusal for cross-account conflicts to avoid revealing other users' accounts. A user should sign in to the correct KhmerFP account or request support; the UI must not silently transfer wallet ownership.

## Architecture and API flow

~~~text
existing KhmerFP session
  -> official Coinbase SDK hosted account access
  -> read-only setup coordinator
       -> no code / unknown result: setup unavailable, stop
       -> code present: manual ownership proof may be attempted
  -> POST /api/wallet-links/challenges (authenticated user/session)
  -> validate exact EIP-712 challenge in browser
  -> explicit user ownership signature
  -> POST /api/wallet-links/verify
  -> Base Sepolia code + EIP-1271 eth_call + canonical block check
  -> locked PostgreSQL transaction: challenge consumption + wallet record + audit
  -> GET /api/wallet-links
  -> linked-wallet display
~~~

The existing routes list records, issue challenges and verify LINK/UNLINK/RELINK actions. There is no deployment API. Cookies carry the existing KhmerFP session; no demo authentication or CDP server-wallet secret is introduced.

### Files and responsibilities

| File | Role | Change in this task |
| --- | --- | --- |
| client/src/services/coinbaseWallet.js | official SDK connection and explicit ownership signing | cancellation checks, empty-account handling, cleanup-error preservation, direct undeployed-signing refusal |
| client/src/pages/WalletLinkPage.jsx | authenticated account interface | shared hosted onboarding entry, new-user guidance, abort on cancel/account/session cleanup, connected-record marker |
| client/src/services/coinbaseWallet.test.js | simulated SDK/RPC regression tests | six additional hosted-flow and safety cases |
| client/src/pages/WalletLinkPage.test.jsx | simulated UI regression tests | five additional onboarding, cancellation, conflict, persistence and connected-record cases |
| client/src/services/walletLinkApi.test.js | cookie/API and signing guard tests | existing network fixture now declares deployed: true; the network assertion is unchanged |
| tools/wallet-browser-e2e/tests/wallet.spec.js | isolated browser/API/database scenarios | new hosted-onboarding entry scenario, pending execution |
| docs/COINBASE_WALLET_COMPLETE_ONBOARDING.md | this report | new |

Reused without changing behavior in this task: coinbaseWalletSetup.js, walletLinkApi.js, packages/domain/src/walletLinkProtocol.js, server/src/routes/walletLinkRoutes.js, server/src/walletLinking/service.js and repository.js. Database schemas and migrations are unchanged. All earlier unrelated local changes are preserved.

## Existing database and security controls

- Existing users and sessions remain the authentication authority.
- user_wallets stores persistent user-to-chain/address identities with existing ownership uniqueness rules. Multiple user wallets are supported subject to the existing service limit.
- wallet_link_challenges (migration 0008) stores immutable challenge terms, session/user binding, expiration and one-way consumption. Repository row/advisory locks and one transaction protect replay/concurrency.
- wallet_authorizations remains separate. Linking does not create transfer, order-signing, settlement or token-spending permission.
- Existing origin, session, challenge lifetime, rate limit, step-up and backend EIP-1271 checks are preserved.
- Production activation remains prohibited by the existing development/test-only route gate, even if the enabling flag is mistakenly set in production. The default stays disabled.
- No migration, DB connection, real signature, chain submission, permission grant or deployment occurred in this task.

## Official SDK and setup evidence

Installed @base-org/account is 2.6.0. Coinbase currently recommends this package; no package replacement is needed. Its documented eth_requestAccounts opens user account-access authorization and returns selected account addresses. Both app entry buttons call this same supported method; they do not invoke an undocumented account-creation method. Hosted signup options and actual new-account completion have not been exercised against a live tester in this task.

First-use initialization remains unresolved for the original account. Empty code does not identify ERC-4337 factory deployment versus EIP-7702 delegation. Capability flags, ETH balance and SDK connection do not establish a setup method, fee payer, setup effects or deployment readiness. No blind self-call is implemented. wallet_sendCalls is an execution request, not a safe unsigned setup quote. An upstream testnet readiness report is relevant context but is not a confirmed diagnosis for this exact account.

The original account 0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC was previously observed with no code and 0.0101 test ETH. That observation is historical, not a fresh read performed in this task. The separately proposed EOA-owned factory wallet is not substituted for it.

## Actual validation results

All commands used Node.js 22.23.5. No dependencies were installed or upgraded.

| Check | Result in this task |
| --- | --- |
| Full frontend Vitest suite | 143 passed across 12 files |
| Backend Node test suite | 337 passed, 17 skipped, 0 failed; database URLs and integration opt-ins removed from child environment |
| Offline migration artifact validator and negative self-tests | passed, including LF/CRLF integrity checks and protections for migrations 0000-0008 |
| Browser fixture production/staging/development rejection tests | 3 passed |
| Playwright scenario collection | 13 scenarios listed successfully; NOT executed |
| Targeted frontend lint | passed |
| Frontend production-bundle build | passed locally; no deployment |
| Browser test JavaScript syntax | passed |
| git diff --check | passed; Git reported existing LF/CRLF checkout warnings |
| Disposable PostgreSQL integration | BLOCKED, not executed in this task |
| Browser/API/PostgreSQL E2E | BLOCKED, not executed in this task |
| Real Coinbase hosted sign-in/new account creation | not executed in this task |
| Real deployed SDK wallet EIP-712/EIP-1271 linking | BLOCKED, not executed |

The first full frontend run exposed an older network test fixture without deployed: true, after the signing helper gained its explicit precondition. The fixture was corrected; its original wrong-network rejection assertion was kept. The full rerun passed. Build warnings concern dependency pure annotations; tests also report a Tailwind content configuration warning. Neither is reported as a security clearance.

Docker was checked both inside and outside the sandbox. The escalated check failed because the Docker Desktop Linux engine pipe was absent:

~~~text
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
~~~

No hosted database fallback was used. Start Docker Desktop manually and wait for its Linux engine to become ready before rerunning the isolated runner. No system settings or software were changed.

### Local rerun commands

Run with Node.js 22 active, from F:/khmerfp-matching-contract unless otherwise stated:

~~~powershell
node node_modules/vitest/vitest.mjs run --root client
node packages/db/scripts/validateBaseline.js --self-test
node --test tools/wallet-browser-e2e/safety.test.js
docker version
node tools/wallet-browser-e2e/run.js
~~~

The last command creates only its labelled disposable loopback PostgreSQL container, applies reviewed migrations there, runs the isolated mock-wallet browser suite and checks identity before cleanup. Do not invoke it against an existing database or change its target to hosted PostgreSQL. If the named test container already exists, inspect it rather than deleting it blindly. This runner tests persisted linking with simulated wallet verification, not Coinbase's live account service.

## Manual real-wallet acceptance procedure

1. Separately approve an isolated development environment with the reviewed full migration chain in a disposable PostgreSQL database. Do not reuse a hosted database or a legacy-only local database missing user_wallets/0008. Keep production disabled. If /api/wallet-links returns the feature-disabled response, do not enable it in production to work around that response.
2. Sign in using the existing KhmerFP authentication and open /account/wallets. Confirm the testnet label.
3. Click a Coinbase connection entry. In Coinbase's own hosted window, sign in to the existing account or use its offered new-account path. Stop on any unexpected signature, transaction, upgrade or funding prompt. Capture only the public selected address and chain.
4. Check Base Sepolia 84532 and readiness. If undeployed, expect Setup unavailable. Use Check setup again only for read-only retry. STOP: there is no approved original-account setup operation in this implementation.
5. To unblock this stage, obtain official account-specific setup evidence: mechanism, request format, expected address, effects/permissions, fee payer and bounded cost. Review and separately approve setup before any operation is implemented or sent. After confirmation, verify the correct resulting contract state; code presence is only one part of that review.
6. Only after a compatible deployed SDK account is established, separately approve an ownership signature. Request a fresh challenge from the authenticated backend. Inspect the KhmerFP Wallet Ownership domain, chain, current user/action, wallet address, application origin and expiry. It must not be an exchange order or spending permission.
7. Approve the ownership signature manually. Verify real EIP-1271 evidence and successful PostgreSQL persistence before calling the link successful. Record only the public wallet/chain, verification block/hash, method and persisted status, not signature bytes or session cookies.
8. Reload the page and confirm the persisted identity. Replay the prior proof in the isolated test context and require rejection. Test cross-user conflict, expired challenge and account/network changes without bypassing any checks.
9. Complete fresh KhmerFP step-up authentication and separately approved fresh wallet challenges for unlink/relink. Confirm other users cannot claim the identity and no token approvals or trading permissions change.

## Remaining release blockers

1. Original SDK account setup is unknown; live signup, signing and deployed-wallet compatibility remain unverified. Real end-to-end linking is BLOCKED.
2. Docker must be restored and the 13 browser/database scenarios rerun for the updated page. Current offline/route tests do not replace PostgreSQL concurrency evidence for this revision.
3. Existing hosted database adoption, backup/recovery and migration 0008 rollout require separate approvals. Runtime schema initialization and deployment sequencing remain subject to the Stage 1.6 adoption plan.
4. Outstanding dependency risks remain in the existing security review; no package change or security clearance was made here.
5. Staging HTTPS/cookie/origin/RPC configuration, operational monitoring, rate-limit scaling, incident handling and release approvals remain subject to the production readiness audit.
6. An EIP-1271-valid contract proves control according to that contract; backend provider labels are not independent cryptographic proof of Coinbase SDK provenance. Preserve the separate provider/implementation assurance review before claiming stronger identity guarantees.

Production linking remains disabled. No commit, push, contract deployment, funding or production database change occurred.

## References

- [Coinbase SDK overview and current package recommendation](https://docs.cdp.coinbase.com/coinbase-wallet/overview)
- [Official account access method](https://docs.cdp.coinbase.com/coinbase-wallet/reference/core/provider-rpc-methods/eth_requestAccounts)
- [wallet_sendCalls executes operations](https://docs.cdp.coinbase.com/coinbase-wallet/reference/core/provider-rpc-methods/wallet_sendCalls)
- [Upstream account readiness report](https://github.com/base/account-sdk/issues/363)
- [Setup coordinator review](COINBASE_WALLET_SETUP_INTEGRATION.md)
- [Deployment investigation](COINBASE_WALLET_DEPLOYMENT_RESOLUTION.md)
- [Production readiness audit](COINBASE_WALLET_PRODUCTION_READINESS.md)

## Follow-up: browser execution completed, 18 November 2026

The earlier Docker-blocked browser result above is historical. Docker was already available on the follow-up run, and all 13 scenarios executed successfully against disposable PostgreSQL 16.14. See [the executed-results report](COINBASE_WALLET_ONBOARDING_E2E_REPORT.md) for exact coverage, cleanup and isolation evidence. Real Coinbase SDK wallet deployment/signing and production readiness remain blocked; the browser uses simulated wallets.
