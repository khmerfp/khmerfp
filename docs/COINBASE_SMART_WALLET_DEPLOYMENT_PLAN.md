# Coinbase Smart Wallet deployment plan

Stage 4.3N, reviewed 17 November 2026 (Asia/Calcutta).
Worktree: F:/khmerfp-matching-contract. Branch: feature/matching-contract-mvp.

## Stage 4.3O correction: wallet-managed deployment

The earlier plan treated raw owners/nonce metadata as a prerequisite for every
deployment route. That was too strict. Those inputs are required if KhmerFP
constructs or independently predicts a direct factory deployment. They are not
fields required from the app by wallet_sendCalls: the wallet may manage its own
account creation and fees internally. We will not reconstruct that metadata.

This does not prove automatic first-use deployment for the exact tester account.
Installed SDK 2.6.0 forwards universal-account calls to the hosted wallet; the
open-source forwarding layer does not expose the hosted deployment implementation.
The target account and its Base Sepolia readiness remain unverified. No live
connection/submission was performed. Capability support alone is not proof.

A pure, non-executable zero-value self-call draft and six additional offline tests
are now in tools/coinbase-deployment/firstUseRequest.js and firstUseRequest.test.js.
All preparation guards still reject submission. See
[COINBASE_WALLET_DEPLOYMENT_RESOLUTION.md](COINBASE_WALLET_DEPLOYMENT_RESOLUTION.md)
for the evidence, distinction, remaining blocker and exact conditional manual steps.
This section supersedes any blanket raw-metadata prerequisite below; the original
factory evidence and direct-factory warnings remain applicable.

## Decision

**Read-only preparation is implemented. Deployment remains blocked.**

The official v1.1 factory and implementation were checked on Base Sepolia with
read-only RPC. No tester account was connected, signed for, funded or deployed.
The tester's actual owners, deployment nonce, expected-address derivation and
UserOperation fee quote are still unavailable. No values were guessed. Missing raw
metadata blocks a direct factory construction, not inherently wallet-managed execution.

A separate local preview shows these missing items as blockers and has a disabled
deployment button. There is no transaction or UserOperation submission endpoint.
It cannot be turned into a deployment tool by checking a box or setting a flag.
A separately approved implementation change is required before any submission.
The existing isolated EIP-1271 harness is unchanged.

## How deployment would work

Use Coinbase's existing wallet system, not a new KhmerFP wallet contract. For a
confirmed factory-based account, the wallet's approved first operation can deploy
and initialize its account proxy through the factory, with the actual SDK owner
configuration. We do not deploy another factory or implementation.

The installed @base-org/account 2.6.0 provider handles wallet_sendCalls and passes
universal-account requests to the hosted Coinbase wallet popup. That is the
candidate user-authorized submission method for the later stage. It is not a
read-only preparation call and is deliberately blocked in this preview.
There is no reviewed sdk.deployWallet() or wallet_deployAccount method here.

A minimal first operation could be a zero-value, empty-data call to the account
itself. That is only a proposed no-transfer call; the account type, deployment
context, simulation and fee quote must first be verified. The SDK/wallet must
supply its own actual account/UserOperation data. We must not fabricate an initCode,
owner list, salt, nonce or transaction to make deployment work.

Preparation-only request shape from the installed SDK's own helper:

~~~js
// future reviewed flow only; this request is never forwarded by this preview.
{
  method: 'wallet_sendCalls',
  params: [{
    version: '1.0',
    chainId: '0x14a34',
    from: connectedWallet,
    atomicRequired: true,
    calls: [{ to: connectedWallet, value: '0x0', data: '0x' }],
  }],
}
~~~

The wallet popup is external code, so supporting this request does not prove that
this specific account can deploy on Base Sepolia. If it proposes an EIP-7702
upgrade, another account type or a different chain, stop for a separate review.
Do not downgrade the SDK or switch to a subaccount merely to bypass the blocker.

## Verified factory and implementation

| Item | Verified value |
| --- | --- |
| Network | Base Sepolia, chain ID 84532 / 0x14a34 |
| Official factory version | Coinbase Smart Wallet v1.1 |
| Factory | 0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842 |
| Factory implementation() | 0x00000110dCdEdC9581cb5eCB8467282f2926534d |
| Factory runtime code hash | 0xb60a629aa7c6af9b550871fd21b67ab84638156683cec68491049cb5d235ed2f |
| Implementation runtime code hash | 0x136185896fc519277ec953c0b3d048fc0c9f607b8d04022e60f23ef8dbc6c4d5 |
| Final read block | 59728741 |
| Block hash | 0xbad87057e6862730185c81665b51728f1f34cacdc24650646570c91a2f750a18 |
| Checked at (UTC) | 2026-11-16T22:20:17.265Z |

Evidence was cross-checked against:

1. The [official Coinbase deployment list](https://github.com/coinbase/smart-wallet#deployments),
   which identifies the v1.1 factory; the older v1 address is different.
2. Installed SDK constants at
   node_modules/@base-org/account/dist/sign/base-account/utils/constants.js,
   which select the same v1.1 address.
3. [Base Sepolia BaseScan factory source](https://sepolia.basescan.org/address/0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842#code),
   marked exact-match verified, with constructor implementation 0x00000110dCdEdC9581cb5eCB8467282f2926534d.
4. Fresh eth_chainId, eth_getCode, implementation() eth_call and stable-block reads
   against https://sepolia.base.org. No write methods were used.

Public bytecode snapshots and block evidence are in
[public-contracts.json](../tools/coinbase-deployment/fixtures/public-contracts.json).
These are offline test fixtures, not deployment output, wallet secrets or a new
contract. The preview compares current code and implementation to these pins;
any difference fails closed and requires review, not an automatic pin update.

This verifies that factory/implementation pair at a sampled block. It does not
prove that the connected universal account uses this factory. That association
must be established from authentic SDK deployment data for the exact account.

## Owners, deployment nonce and expected address

The existing integration requests a universal, user-controlled account, with
manual subaccount creation and manual funding. The public connection returns an
address, not proof of ownership or its factory initialization inputs.

Installed SDK findings:

- core/rpc/wallet_connect.d.ts exposes factory/factoryData under subaccount
  capability responses. These describe that subaccount, not the universal parent.
- createSmartAccount.js accepts supplied factoryData; getFactoryArgs() echoes it
  and contains a TODO for constructing missing data. It does not discover the
  universal account's initialization owners or nonce.
- wallet_prepareCalls types/internal subaccount flow exist. Their presence is not
  a supported universal-account deployment-preview API: the reviewed universal
  Signer dispatch does not expose that method as an equivalent public flow.
- eth_requestAccounts / wallet_getCapabilities alone do not supply the actual
  universal account owners/nonce. No supported public method supplying them was
  established in this review. The hosted wallet may know more; we do not scrape
  private storage or call undocumented popup internals to retrieve it.

Therefore actual owners, deployment nonce and predicted address remain UNKNOWN.
The SDK connection itself has not been performed in this stage. No assumption is
made about nonce zero, owner index zero or an EOA owner. A factory deployment nonce
is also different from an EOA transaction nonce or ERC-4337 UserOperation nonce.
eth_getTransactionCount cannot substitute for it.

When a documented supported SDK flow supplies the exact factory and createAccount
calldata for the selected universal account, the prepared compareSdkFactoryData
utility can decode those actual owners/nonce, require canonical encoding and the
verified factory, and compare the factory's getAddress result with the SDK address.
Its tests use synthetic metadata only; they do not verify the tester's identity.
Passkey public-key control and provenance still need review even if an address
matches. The helper's encoding bounds are not full elliptic-curve key validation.

For a real prediction read with ethers, use the ABI function explicitly:

~~~js
const predicted = await factory.getFunction('getAddress')(
  actualSdkOwners,
  actualSdkDeploymentNonce,
  { blockTag: reviewedBlock },
)
~~~

Do not accidentally call ethers Contract.getAddress(), which returns the factory
instance's address rather than executing this ABI function. Require the predicted
account to equal the exact SDK account. Missing metadata or a mismatch means stop.
Do not substitute another wallet, infer owners from the address or create a new
account with guessed values. A supported Coinbase metadata flow or an already
verified factory-based account is the next required input.

## Local read-only interface

New standalone files are under tools/coinbase-deployment. No application API,
database, dependency, exchange contract or production feature flag was changed.
The page displays wallet/network, account-code status, verified factory and
implementation, block/hash, available test balance, metadata blockers and unknown
fee/sponsorship fields. Missing estimates are not displayed as zero.

Start the preview manually from the worktree, with Node 22:

~~~powershell
cd F:\khmerfp-matching-contract
$env:COINBASE_DEPLOY_PREVIEW_ENABLED = 'true'
npx.cmd --yes --package=node@22 node tools/coinbase-deployment/server.js
~~~

Open http://127.0.0.1:5185 in a clean test browser profile. Startup only builds
assets in memory and listens; it does not connect a wallet or read the chain.
The server does not load .env files. Stop with Ctrl+C, then remove the preview
flag from that shell. Do not set either production wallet-linking flag.

You can enter a public address and click Read deployment status, or explicitly
click Connect for read-only preparation. The latter opens the official SDK's
connection popup, checks 84532 and reads capabilities; it never requests signing.
Select Base Sepolia manually in the wallet if needed. No wallet connection was
executed by the implementation run.

Use only the local test profile; do not use production users or cookies. The page
is not a production frontend route. Compiled assets are served only from an
in-memory allowlist. HTTP requires the exact host, POST origin and in-memory CSRF
token, no-store headers, a small JSON body and serialized reads. Its RPC transport
has only chain, block, code, balance and limited factory eth_call methods. Its SDK
wrapper allows only accounts, chain ID and wallet capabilities. All signing,
submission, permission, subaccount creation and automatic switching requests fail.

The deployment button is permanently disabled. /submit is not implemented. This
preview has no hidden auto-deploy action, even if future prerequisites are met.
The wrapper constrains our requests, not compromised internal SDK/hosted-wallet
code. Cancel any unexpected funding, deployment, transaction or signing prompt.

## Gas, test ETH and sponsorship

No actual transaction/UserOperation or fee quote exists yet. Values shown now:

| Field | Current status |
| --- | --- |
| Transaction/UserOperation details | Unavailable; no operation prepared or submitted |
| Estimated gas and maximum fee | Unknown; includes deployment and ERC-4337 overhead, not a 21,000-gas guess |
| Test funding required | Unknown until the actual payer, deposit and quote are known |
| Sponsorship | Unknown; a reported paymaster capability is only supported-not-quoted |
| Payment/trading permissions | None requested or granted |

A zero-value call still costs gas. Without sponsorship or an adequate existing
gas deposit, the approved gas payer needs enough Base Sepolia test ETH. Sponsorship
must be explicitly confirmed for this exact operation, with its service, terms,
limits and validity time. We configured no paymaster credentials or sponsorship.
Do not interpret capability support, test balance or a successful read as coverage.

A plain eth_estimateGas on an empty undeployed account does not estimate the full
wallet deployment/UserOperation. The actual wallet/bundler preparation flow must
supply deployment/verification/call overhead and fresh fees. We did not call an
estimator or send test ETH to obtain a number for this report.

## What you would click to authorize deployment

There is nothing to authorize on the current page; the button is disabled. Once
exact account/chain first-use support, intended account type, simulation, gas and
sponsorship are reviewed, a separate approved change may add a wallet-managed
submission action. Direct factory construction additionally requires authentic metadata.

The later sequence would be:

1. Connect the expected Coinbase passkey account on Base Sepolia.
2. Review the expected account, confirmed factory or other account path,
   wallet-managed setup, single no-transfer call and complete fee/funding quote.
   Direct factory construction additionally requires authentic owners/nonce;
   the proposed wallet-managed route does not reconstruct them.
3. Give explicit execution approval naming that account and a maximum test fee,
   or the verified sponsorship terms. Owner changes invalidate this approval.
4. Click a distinct Review and authorize deployment action. Only then may the
   supported wallet_sendCalls request open the wallet's transaction/UserOperation
   confirmation. Review network, account, call and maximum fee there too.
5. Manually approve the wallet passkey prompt. Never give this project a private
   key, seed phrase, CDP wallet secret or permission to sign later operations.
6. Track submission and receipts. A request ID is not proof of deployment. No
   automatic retries after uncertain submission; reconcile the receipt and code first.

Do not call createAccount with hand-written owners/nonce from an unrelated EOA.
Do not enable mainnet, pay real ETH, grant spend permissions, deploy an exchange or
perform a transfer merely to force a wallet to appear deployed.

## Confirming success on BaseScan

After a separately approved later execution:

- Open https://sepolia.basescan.org/tx/<confirmed-transaction-hash>, not the mainnet
  explorer. For a UserOperation, resolve the bundler/wallet request ID to the
  actual transaction receipt first. Require successful receipt and expected chain.
- For this v1.1 factory path, inspect the official factory's AccountCreated event
  and compare the account, initial owner bytes and deployment nonce to the approved
  SDK data. If already deployed, inspect the original creation instead; no new
  creation event is guaranteed on a repeated createAccount call.
- Open https://sepolia.basescan.org/address/<sdk-wallet-address>#code and use
  read-only RPC eth_getCode at the receipt block. Require nonempty expected proxy
  code and the correct implementation, not merely a positive balance.
- Check the proxy implementation/storage using the verified ABI/EIP-1967 layout
  and compare actual owner configuration to the approved one. An explorer's
  automatic proxy label alone is insufficient. Owner additions/upgrades require review.
- Re-read the receipt block/hash and apply an agreed confirmation policy. Inclusion
  is not absolute Base finality. Reverted/unknown/reorganized results stay pending.
- Only after deployment identity/control review may a separately approved Stage 4.3M
  ownership-signature test run. Deployment alone does not prove EIP-1271 compatibility,
  KhmerFP login or exchange-order support.

## Testing and limits

Offline tests use captured public bytecode plus mocked RPC/SDK responses. They
check factory/implementation hash drift, chain mismatch, deployment status,
timeouts/cleanup, metadata/prediction mismatches, unsupported owner encoding,
wrong account, sponsorship uncertainty, blocked signing/submission and protected
HTTP routes. No tester account is fabricated by these fixtures.

Commands:

~~~powershell
npx.cmd --yes --package=node@22 node --test tools/coinbase-deployment/preview.test.js tools/coinbase-deployment/server.test.js tools/coinbase-verification/harness.test.js tools/coinbase-verification/server.test.js
~~~

Actual result: 28 passed, zero failed/skipped: 12 new preview tests plus all 16
unchanged ownership-harness tests. The preview browser bundle is checked with an
offline write:false build. Node/browser lint and syntax/whitespace checks are run
before completion. No application or database schema changes need migration.
The preview was not started in a real connected browser. No actual deployment,
UserOperation simulation, account prediction, fee estimation or real signature
compatibility test is claimed.

The existing SDK audit remains unresolved, as documented in
[DEPENDENCY_SECURITY_REMEDIATION.md](DEPENDENCY_SECURITY_REMEDIATION.md). A separate
security decision is required for live use. The reported upstream
[Base Sepolia delegation issue](https://github.com/base/account-sdk/issues/363)
concerns earlier versions/accounts; it is a warning to check actual account type,
not proof that this user's installed 2.6.0 flow fails in the same way.

## Required approval and next step

First confirm that the exact tester account supports wallet-managed first use on
Base Sepolia, or obtain an officially supported alternative from Coinbase. Confirm
the account address, intended account type, operation and complete fee/funding
review. Authentic owners/factory nonce and matching prediction are additional
requirements only if we construct the factory deployment ourselves. That direct
route is not proposed for execution. This plan is not deployment approval.

After those prerequisites and a separate reviewed submission implementation:

> Approve one Coinbase Smart Wallet deployment/first operation on Base Sepolia
> 84532 for the specified account, verified factory/implementation and exact
> reviewed request. Permit manual passkey approval and at most the specified
> test-ETH gas fee, or the named sponsorship. No real funds, mainnet, additional
> calls, permissions, production access, activation, commit or push.

Preparation approval is not transaction authorization. No deployment was executed.

## Sources and source limits

- [Official Coinbase factory deployments](https://github.com/coinbase/smart-wallet#deployments).
- [Official factory source](https://github.com/coinbase/smart-wallet/blob/main/src/CoinbaseSmartWalletFactory.sol).
- [Factory Base Sepolia verified source and constructor](https://sepolia.basescan.org/address/0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842#code).
- [Coinbase web SDK quickstart](https://docs.cdp.coinbase.com/coinbase-wallet/quickstart/web).
- [Official SDK request type](https://github.com/base/account-sdk/blob/master/packages/account-sdk/src/core/rpc/wallet_sendCalls.ts).
- Installed 2.6.0 Signer.js, wallet_connect.d.ts, wallet_sendCalls.d.ts,
  createSmartAccount.js and createSubAccountSigner.js were the implementation
  evidence. Upstream default-branch pages may change; runtime identity is pinned
  above, and the installed package remains locked. No new dependency was installed.
