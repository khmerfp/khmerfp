# Real Coinbase Smart Wallet verification plan

Stage 4.3L, 2026-11-16. Repository F:/khmerfp-matching-contract,
branch feature/matching-contract-mvp. Preparation and review only.

## Current decision

**Not ready to execute.** The tester confirmed that no deployed Base Sepolia
Coinbase Smart Wallet address is available yet. Use `<TESTER_DEPLOYED_WALLET>` as
a deliberately invalid placeholder, not a zero address or an invented account.
No live RPC code check, signature request or EIP-1271 verification was performed
in this stage. No wallet was deployed and no blockchain transaction was sent.

The earlier screenshot reported an undeployed account. Neither that screenshot nor
an SDK-connected address establishes deployment or ownership now. Once the tester
supplies a public address, perform the read-only preflight below. If it has no code,
stop; obtaining a deployed wallet is outside this stage's approval.

A bounded isolated experiment is possible in principle, but it is not risk-free.
It requires a named tester, a verified deployed account, a reviewed isolated
harness and explicit acceptance of the remaining SDK risks. Production wallet
linking stays disabled. This plan does not approve execution or accept those risks.

## Code reviewed

- client/src/services/coinbaseWallet.js: Base Account provider, explicit Base Sepolia,
  manual funding/subaccount settings, account/network checks before and after
  typed-data signing. The current exported signing function relies on its caller
  to validate the challenge first; do not call it with arbitrary provider data.
- packages/domain/src/walletLinkProtocol.js: exact domain/type/message validation,
  120-second lifetime, wallet/user/action/origin binding and UUID/nonce checks.
- server/src/walletLinking/service.js: challenge issuance and durable application
  consumption; fixed Base Sepolia RPC and deployed-account EIP-1271 verification.
- server/src/routes/walletLinkRoutes.js: explicit enable flag plus development/test
  guard. No flags or configuration files were changed for this plan.
- server/test/walletLinkCoinbase.test.js: existing opt-in positive read-only proof
  runner. It is skipped without explicit real-proof configuration.
- node_modules/@base-org/account/dist/sign/base-account/Signer.js and
  utils/createSmartAccount.js: typed-data requests go to the wallet popup; internal
  account signing uses replay-safe hashing and variable-length wrapped signatures.

The existing live-proof runner is useful for the positive case, but does not
issue a fresh challenge, request a passkey, consume durable application state or
execute every negative scenario. It must not be reported as end-to-end linking.
Stage 4.3L specified the missing isolated coordinator. Stage 4.3M now implements
it under tools/coinbase-verification, as described below; the main application
and its wallet-linking routes are unchanged.

## Security risks and isolation

The Stage 4.3K root audit remains 17 entries: 8 moderate, 7 high, 2 critical.
The wallet graph includes @base-org/account 2.6.0, @coinbase/cdp-sdk 1.62.0,
abitype 1.0.6 and zod 3.25.76. The Zod resource-exhaustion finding is unresolved;
its externally controlled SDK input path has not been disproved. No supported
non-breaking fix was established. SDK isolation limits impact, not the vulnerability.
See [DEPENDENCY_SECURITY_REMEDIATION.md](DEPENDENCY_SECURITY_REMEDIATION.md).

Required environment for a later approved experiment:

- Dedicated browser profile or disposable OS user/VM, with no production sessions,
  passwords, wallet extensions, unrelated tabs, customer data or application secrets.
  The tester still uses their passkey explicitly; never export it to the harness.
- A dedicated local origin, for example http://127.0.0.1:5184, with a strict port.
  Do not use the main application's origin, routes, cookies, local storage or API.
- A separate minimal entry point containing only the existing signing adapter and
  shared protocol. Do not import App.jsx, main.jsx, the exchange demo or Express.
  The current app/probe pages are not substitutes for this isolated entry point.
- Node.js 22.23.5, existing lockfile, no dependency upgrades and no exposed Vitest UI.
  Loopback-only development server; no tunnels, LAN binding or public hosting.
- No DATABASE_URL, production .env, server wallet secret, API private key, bundler,
  paymaster or token approvals. No database is required for this signature-only test.
- Allow only account discovery, chain reads, explicit testnet switching, typed-data
  signing and read-only RPC. Reject sendTransaction, sendCalls, user operations,
  permissions, deployment, funding and approval requests. Review this method
  allowlist before running; SDK hosted infrastructure is external, not local.
- Manual funding/subaccount settings and disabled optional telemetry, as in the
  existing adapter. If the wallet asks for deployment, funding, spend permission,
  login to the main app or a transaction, cancel and stop.

## Read-only deployment preflight

Only after receiving a real public address, use https://sepolia.base.org. Validate
address syntax and reject the zero address and placeholder before any request.
The preparation itself does not make these calls.

1. eth_chainId must return 0x14a34 (84532).
2. eth_getBlockByNumber('latest', false): retain the returned number and hash.
3. eth_getCode(address, that block number): require non-empty code.
4. Re-read that numbered block and require the same hash.
5. Record checkedAt, chainId, blockNumber, blockHash, codePresent and codeHash.
   Do not record session material. Code existence proves neither Coinbase provenance
   nor tester control. Confirm the tester obtained this account through the official
   Coinbase passkey flow; inspect proxy/implementation identity if ambiguous.
6. RPC errors, rate limits, unexpected chain or changed block mean INCONCLUSIVE,
   not DEPLOYED or VERIFIED. No funds or gas are required for these reads.

A 0xef0100 delegation prefix or an unfamiliar implementation requires separate
account-type review. Do not treat arbitrary contract code as a verified Coinbase
account. Recheck deployment and account identity immediately before signing.

## Exact KhmerFP EIP-712 challenge

Import the constants and walletLinkTypes from packages/domain/src/walletLinkProtocol.js;
do not maintain a second type definition in an executable harness.

Domain fields (there is intentionally no verifyingContract in this ownership domain):

| Field | Value |
| --- | --- |
| name | KhmerFP Wallet Ownership |
| version | 1 |
| chainId | 84532 |
| salt | ethers.id(reviewed isolated application origin) |

primaryType: WalletLink. Ordered message fields:

| Field | EIP-712 type | Value and purpose |
| --- | --- | --- |
| challengeId | string | Fresh UUID v4, identical to outer challengeId |
| action | string | LINK for this experiment; never an order or transfer |
| userId | uint256 | String form of a dedicated synthetic test identity, e.g. '1' |
| wallet | address | The tester-supplied, preflight-checked smart wallet |
| sessionBinding | bytes32 | id(userId + ':' + syntheticSessionHash + ':' + nonce) |
| appOrigin | string | Exact reviewed isolated origin, no path or trailing slash |
| nonce | bytes32 | Fresh cryptographic random 32 bytes |
| issuedAt | uint64 | Current Unix seconds, integer |
| expiresAt | uint64 | issuedAt + 120, integer |

Synthetic identity/session binding matches the protocol format but is not a genuine
KhmerFP login. This test must not claim authenticated account linking. A subsequent
application test needs a real disposable authenticated user/session and the existing
durable challenge service, with separate activation approval.

Preparation-only Node pseudocode for the in-memory issuer (do not run now):

```js
import { randomBytes, randomUUID } from 'node:crypto'
import { TypedDataEncoder, getAddress, id } from 'ethers'
import {
  WALLET_LINK_NAME, WALLET_LINK_VERSION, WALLET_LINK_CHAIN,
  WALLET_LINK_TTL_SECONDS, walletLinkTypes, assertWalletLinkChallenge,
} from './packages/domain/src/walletLinkProtocol.js'

// memory only; this identity is never inserted into an application database.
const origin = 'http://127.0.0.1:5184'
const wallet = getAddress('<TESTER_DEPLOYED_WALLET>') // intentionally blocked today
const userId = '1'
const sessionHash = randomBytes(32).toString('hex')
const nonce = `0x${randomBytes(32).toString('hex')}`
const challengeId = randomUUID()
const issuedAt = Math.floor(Date.now() / 1000)
const challenge = {
  challengeId,
  typedData: {
    domain: {
      name: WALLET_LINK_NAME, version: WALLET_LINK_VERSION,
      chainId: WALLET_LINK_CHAIN, salt: id(origin),
    },
    types: walletLinkTypes,
    primaryType: 'WalletLink',
    message: {
      challengeId, action: 'LINK', userId, wallet,
      sessionBinding: id(`${userId}:${sessionHash}:${nonce}`),
      appOrigin: origin, nonce, issuedAt,
      expiresAt: issuedAt + WALLET_LINK_TTL_SECONDS,
    },
  },
}
const expected = { origin, wallet, userId, action: 'LINK', domainSalt: id(origin) }
const data = assertWalletLinkChallenge(challenge, expected)
const digest = TypedDataEncoder.hash(data.domain, data.types, data.message)
// keep challenge, expected and digest together in a one-use in-memory record.
// do not log sessionHash, challenge, signature or passkey data.
```

The coordinator must compare the returned challenge to its original stored record,
including sessionBinding and nonce, not merely validate attacker-supplied fields.
Use a single-process atomic one-use state machine: ISSUED -> VERIFYING -> USED or
FAILED. Set VERIFYING synchronously before awaiting RPC; retries need a new
challenge. This in-memory mechanism is only for the isolated experiment, not a
replacement for PostgreSQL challenge consumption across application instances.

## Prepared signing and verification harness

This is the reviewed implementation contract for the later isolated coordinator.
The existing opt-in live test remains unchanged and was not executed.

1. Connect through the existing connectUserCoinbaseWallet adapter only on an
   explicit click. Check the returned wallet equals the expected address and
   deployed is true; do not accept an injected-provider substitution.
2. Issue the fresh challenge only when the tester is ready. Freeze its exact
   bytes/fields in coordinator memory. Display action, synthetic identity, wallet,
   chain, origin and expiration for the tester to review.
3. Before any signing request, use assertWalletLinkChallenge against expected
   values, recompute the digest, and check current SDK account/network/deployment.
4. The tester clicks Sign ownership test. Only this click may call the existing
   signWalletOwnership(connection, typedData). The wallet's passkey approval is
   manual. No automated approval, secret entry or private-key request is allowed.
5. Recheck account and chain afterward. If expired, switched or cancelled, discard
   the attempt and mark it failed. Never silently change the signed payload.
6. Return the signature to the loopback coordinator in memory, bound to the
   original challengeId; enforce same Origin, JSON content type, no CORS wildcard,
   no-store responses and a small body limit. No persistent proof storage by default.
7. Revalidate exact original challenge, expected wallet, local lifetime and nonce,
   and atomically claim the one-use record. Do not let the browser select an RPC,
   contract address, digest or substitute user/session terms.
8. Call the existing verifier exactly as follows, without recoding account recovery:

```js
// after explicit execution approval, validation and one-use claim only
const evidence = await verifyContractWalletControl({
  chainId: 84532,
  wallet: expected.wallet,
  digest: originalStoredDigest,
  signature: returnedSignature,
})
```

9. Recheck expiration after RPC. Mark success only if the exact EIP-1271 result was
   accepted and account/session context remains unchanged. Consume failed attempts
   too; do not repeatedly try a proof against different accounts until one accepts.
10. Record only an allowlist: test case, pass/fail/inconclusive, SDK/package versions,
    chainId, blockNumber, blockHash, codeHash, signature byte length, whether a 6492
    suffix was observed, and whether magic value matched. Do not record raw signatures,
    typed payload/session binding, session cookies, passkey assertions, headers,
    full RPC errors or SDK diagnostics. Public address/digest are linkable metadata;
    omit them from shared reports by default. Keep the wallet only in test memory.

The verifier uses fixed https://sepolia.base.org; requires RPC chain 84532; pins code
and eth_call to one block; calls isValidSignature(bytes32,bytes) with gas limit
500000; accepts only bytes4 0x1626ba7e; and checks the block hash again. It has a
4-second RPC request timeout and 10-second outer timeout, then destroys the provider.
Errors/reverts/bad ABI/non-magic results never establish control. Signature input
must be 1-4096 bytes of hex. An EIP-6492 suffix is rejected, even on a deployed
address. Do not strip that suffix or execute a factory as a workaround.

Expiry is enforced by the application protocol; an account's isValidSignature
need not understand the challenge's expiration. A magic value for an expired
payload must not make the complete harness pass. Likewise repeated eth_call can
still return magic: replay protection belongs to the one-use coordinator/service.

## SDK compatibility assessment

Static evidence supports a candidate path, not verified live compatibility:

- SDK supports eth_signTypedData_v4 via its wallet popup and the adapter uses
  ethers BrowserProvider.signTypedData. Requests retain the existing WalletLink type.
- Coinbase smart accounts can return a wrapped, variable-length WebAuthn signature,
  not a 65-byte EOA signature. The verifier accepts opaque bytes within its limit;
  it does not use ecrecover or try to recover a passkey owner address.
- SDK internal account code applies a replay-safe hash and a signature wrapper.
  Submit the original KhmerFP EIP-712 digest to isValidSignature. Let the wallet
  implementation handle its own wrapping; do not manually double-wrap or alter it.
- Hosted popup behavior and deployed wallet implementation may differ from the
  inspected internal SDK helper. Whether the real returned bytes pass EIP-1271,
  fit the 4096-byte bound and avoid 6492 remains UNVERIFIED.
- If the deployed account returns 6492 or the method fails, stop and report the
  format/compatibility blocker. Do not switch to an EOA or relax checks to pass.
- EIP-1271 success establishes signature acceptance at a sampled block, not chain
  finality, ownership forever, exchange compatibility, transfer authority or login.

## Negative-test plan

Run offline/mocked cases before requesting a signature. After execution approval,
reuse one genuine signature only for designated read-only altered-digest tests
in separate test records; never submit altered messages for another signing popup.
Use fresh challenges for each normal attempt. Nothing below grants live execution now.

| Case | Prepared input | Required result |
| --- | --- | --- |
| Wrong chain | domain chain 8453/31337, or verifier chain != 84532 | Protocol/pre-signing/verifier rejects; no popup/call for invalid context |
| RPC chain mismatch | Mock network response != 84532 | 503/inconclusive; never success |
| Wrong wallet | Connected wallet or message.wallet differs from expected | Reject before signing; never retarget the proof |
| Cross-account signature | Original digest/signature evaluated on a second confirmed deployed test account, only if separately supplied | Must not count as expected-wallet proof; unexpected magic requires investigation, not weakened tests |
| Modified challenge | Change nonce, origin, userId, sessionBinding, action or wallet | Original-record/digest comparison rejects; modified digest with original signature must fail account verification |
| Expired | now >= expiresAt, including expiry during RPC | Reject at both boundaries regardless of magic value |
| Invalid signature | Malformed hex, 0x, too long, or flip an actual signature byte | Syntax rejection, revert or non-magic; never verified |
| Undeployed | Mock getCode = 0x | 422; no eth_call/factory/deployment |
| Wrapped 6492 | Signature ends with 6492 repeated 16 times | 422; do not unwrap or execute |
| Replay/concurrent submission | Submit same in-memory record twice | Exactly one verification attempt claimed; second rejected |
| Account/chain switch | Change SDK context before or during passkey prompt | Discard proof and require new challenge |
| RPC failure/block change | Timeout, revert, invalid ABI or different hash on block reread | Fail or inconclusive, never pass |

No second real wallet or real undeployed address is required for offline negatives.
Do not invent an address and label it a Coinbase wallet. Existing mocked tests are
not evidence that all proposed live negatives have passed.

## Evidence and gates

Stage 4.3L performed source review only. Stage 4.3M adds the offline-tested
isolated harness; deployed-account discovery and live signature verification
remain unperformed. Keep any optional proof file outside Git and browser storage; the existing
WALLET_LINK_REAL_* test configuration must remain unset during preparation.

Before an approved later run, review the implemented coordinator described
below, rerun its offline negative cases, confirm the local origin and account code,
and show the exact payload to the tester. Do not enable the normal wallet-linking
routes to obtain the test challenge. The existing ownership proof test can consume
a deliberately exported short-lived test proof only after explicit approval; it
still does not validate durable application linking.

Required approval wording, after a deployed address and harness are available:

> Approve one isolated Base Sepolia ownership-signature experiment for the specified
> deployed tester wallet and reviewed loopback origin. I accept the documented SDK
> risks for this experiment. Permit one manually approved EIP-712 passkey signature
> and read-only code/EIP-1271 calls, including the reviewed negative cases. No wallet
> deployment, transaction, funds, production access, linking activation, commit or push.

Approval to supply/check a public address is not approval to request a signature.
If no deployed wallet exists, stop and request a separate decision; do not deploy
one under this plan.

## Sources

- Existing KhmerFP files listed above; installed SDK 2.6.0 source inspected locally.
- [Official Coinbase smart-wallet source](https://github.com/coinbase/smart-wallet/blob/main/src/CoinbaseSmartWallet.sol)
  describes wrapper/owner-specific signature handling; it is not proof of the
  implementation at an unprovided tester address.
- [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) defines contract signature validation.
- [ERC-6492](https://eips.ethereum.org/EIPS/eip-6492) covers predeploy signatures;
  that validation/deployment path is not approved here.

## Stage 4.3M: implemented isolated harness

The harness is implemented and offline-tested, but has not been started with a
real wallet address. No public RPC request, passkey request or live EIP-1271 call
was made. The placeholder is still invalid, and live execution remains blocked.
This section supersedes the Stage 4.3L implementation-preparation notes above.

Files under tools/coinbase-verification:

| File | Purpose |
| --- | --- |
| harness.js | Opt-in configuration, guarded public RPC, preflight, fresh challenge and one-use verification |
| walletGuard.js | Wallet method allowlist and exact EIP-712 payload/digest checks |
| server.js | Standalone loopback HTTP server and in-memory isolated browser bundle |
| browser/index.html | Explicit risk/approval checkbox and separate manual action buttons |
| browser/main.js | Coinbase connection, payload review, manual signing and sanitized results |
| harness.test.js | Mocked RPC/wallet negative and positive tests |
| server.test.js | Loopback-only HTTP isolation and request security tests |
| README.md | Short local usage reference |

No root package script, production route, existing application code, dependency,
wallet permission or migration was changed. The Node harness imports only the
existing protocol and verifier utilities, not Express or database initialization.
It does not load dotenv or application environment files. The browser bundles the
existing signWalletOwnership utility, not the application entry point or its API.

The server builds assets in memory and serves only those exact map entries. No
repository files, .env, app routes or arbitrary files are served. It binds only
127.0.0.1:5184, refuses a busy port, validates Host and POST Origin, uses an
in-memory random anti-CSRF token, requires JSON, limits proof bodies to 16 KiB and
sets no-store/no-referrer/frame-denial headers. It serializes API actions and
holds only one challenge. It never logs signatures, payloads or RPC errors.
Its temporary build directory is empty and removed at shutdown; no proof is
written there. Closing the process forgets all attempts.

The public RPC endpoint is configured only at startup, never by browser input.
Only HTTPS DNS hostnames without URL credentials/query/port are accepted. The
operator must still review that hostname and its DNS as public and trustworthy;
syntactic checks cannot prove remote infrastructure or prevent a malicious DNS
administrator. Default endpoint: https://sepolia.base.org. Four RPC methods are
allowed: eth_chainId, eth_getBlockByNumber, eth_getCode, eth_call. Code/calls must
target the configured wallet and calls must use the isValidSignature selector.
Transaction, raw-transaction, user-operation and arbitrary contract calls are blocked.

The existing EIP-1271 verifier's rpcFactory injection supplies this guarded provider
without changing the application's fixed RPC configuration. It retains the shared
verifier's signature bounds, magic-value, deployment, timeout and block-hash checks.
A second protocol expiry check runs after RPC. Even failed proofs consume the
one-use attempt. Parallel submissions cannot claim the same attempt twice.

The wallet wrapper allows only eth_requestAccounts, eth_accounts, eth_chainId and
eth_signTypedData_v4. It checks approval and the complete typed payload, including
EIP712Domain fields, before forwarding signing. Numeric string encoding from
ethers is compared by typed digest, not by loosening the signed terms. The wrapper
does not automatically switch chains; select Base Sepolia in the wallet interface
and reconnect if necessary. Account/network changes discard the local challenge.

These guards constrain harness calls, not every internal action of a compromised
third-party SDK or its hosted popup. SDK vulnerabilities and external infrastructure
remain unresolved risks. Decline any wallet deployment, funding, permissions or
transaction prompt. The checkbox is an execution reminder, not authentication or
a substitute for the owner's approval.

### Offline checks (safe to run now)

From F:/khmerfp-matching-contract, with Node 22:

~~~powershell
npx.cmd --yes --package=node@22 node --test tools/coinbase-verification/harness.test.js tools/coinbase-verification/server.test.js
~~~

Actual Stage 4.3M local results:

- 16 harness tests passed, zero failed/skipped. They use mocks plus local loopback
  HTTP only, with no public RPC. Cases include all requested negatives, non-magic
  returns, replay/concurrency, RPC timeout/provider cleanup, expiration during RPC,
  EIP-712 domain types, wrong signing payloads and blocked transaction methods.
- Isolated browser bundle built successfully with write:false; no server was started.
- Existing frontend: 95 tests passed.
- Existing backend offline run: 336 passed, 17 intentional skips, zero failed.
  Database/demo-chain/real-wallet cases were not enabled in this stage. This is
  not a new PostgreSQL integration result; Stage 4.3K records the previous full run.
- Offline migration validator/self-tests and catalog normalization tests passed.
- Node/browser lint, JavaScript syntax and whitespace checks passed.
- Existing local contract suite: 40 tests passed, using local mock funds and official CTF.

An initial HTTP test used fetch, which did not preserve the custom Host needed for
an ephemeral test port. It now uses node:http with explicit headers; the real Host
check was preserved. A browser top-level-await build issue was fixed by using an
async entry function. No validation was weakened.

### Manual execution (after separate approval only)

Do not execute this block during preparation. Replace the placeholder only with
the public address of an already-deployed Coinbase account controlled by the tester.
A wallet address is not its private key. No passkey, wallet secret or seed is an
environment variable.

~~~powershell
cd F:\khmerfp-matching-contract
$env:COINBASE_PROBE_ENABLED = 'true'
$env:COINBASE_PROBE_ACK = 'ISOLATED_TEST_ONLY'
$env:COINBASE_PROBE_CHAIN_ID = '84532'
$env:COINBASE_PROBE_MAGIC = '0x1626ba7e'
$env:COINBASE_PROBE_RPC_URL = 'https://sepolia.base.org'
$env:COINBASE_PROBE_WALLET = '<TESTER_DEPLOYED_WALLET>'
npx.cmd --yes --package=node@22 node tools/coinbase-verification/server.js
~~~

Startup rejects the placeholder or missing opt-in before opening a port. With
valid configuration it builds the standalone assets and listens; startup itself
makes no chain request and does not connect a wallet. It does not enable either
production linking flag.

1. Use the clean, isolated browser profile described above. Open only
   http://127.0.0.1:5184. All action buttons begin disabled.
2. After obtaining execution approval, check the explicit risk/approval checkbox.
3. Click Read deployment status. This is the first public RPC operation. Require
   the correct chain, deployed code and stable block evidence. Missing code,
   delegated accounts, errors or unconfirmed provenance mean stop.
4. Click Connect Coinbase passkey account. This is a separate user action; use
   the tester's existing deployed account, select Base Sepolia and reject account
   mismatch. Connection still does not prove ownership.
5. Click Create fresh challenge. Inspect the displayed origin, synthetic user 1,
   LINK action, wallet and 120-second expiration. No real KhmerFP account is linked.
6. Click Review, sign and verify ownership only after reviewing that payload.
   Approve the wallet's passkey prompt manually. This click sends the signature
   only to the loopback verifier for the reviewed EIP-1271 eth_call. It never asks
   for a private key, allowance, transfer or transaction.
7. Read sanitized verification evidence. A revert, wrong magic, account/chain
   change, expiry or wrapped 6492 proof is a failure, not a reason to bypass checks.
   Create a new challenge for another attempt. Real browser/passkey behavior and
   the signature's compatibility are still unverified until this run occurs.
8. Stop with Ctrl+C, close the isolated profile and remove the six COINBASE_PROBE_*
   variables from that shell. Do not export browser diagnostics or raw proof data.

Evidence contains only chain/method, checked block/hash, deployment code hash for
preflight, signature byte count and accepted magic. It grants no account link,
trading, transfer or settlement permission. Do not label this test as production
login, finality or exchange-order compatibility.

Required execution approval remains: a named deployed public address, reviewed
public RPC and isolated origin, explicit acceptance of unresolved SDK risks, and
permission for manual passkey signing plus read-only preflight/EIP-1271 calls.
No deployment, transaction, funds, production access, feature activation, commit
or push is included.
