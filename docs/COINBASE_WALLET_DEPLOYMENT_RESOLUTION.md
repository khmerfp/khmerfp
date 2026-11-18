# Coinbase wallet-managed deployment investigation

Latest status: **BLOCKED**. See [Current compatibility determination](#current-compatibility-determination---17-november-2026). Offline tests establish local forwarding of both request formats; no live-account request format, full setup operation or quote has been verified.

Stage 4.3O, 17 November 2026. Worktree F:/khmerfp-matching-contract.
No live wallet connection, signature, transaction, UserOperation or deployment.

## Finding

**Use wallet-managed first use if Coinbase supports it for the exact account on
Base Sepolia. Do not hand-build deployment inputs. Exact-account support is still
unverified, so execution remains blocked.**

The previous raw-owner/nonce requirement confused two different routes:

| Route | Who constructs account initialization? | Does the app need raw owners/factory nonce? |
| --- | --- | --- |
| Direct createAccount factory transaction | The app/deployment caller | Yes; also independent address prediction and owner-control review |
| Wallet-managed wallet_sendCalls | Coinbase wallet/backend/bundler | Not required in the app request; wallet owns its deployment/account setup |

An undeployed ERC-4337 account can be created during its first authorized operation
when the wallet supplies valid initialization data. That protocol behavior is not
a guarantee that every Coinbase account type or network currently supports it.
The application must not supply invented initCode, owners, nonces or signatures.

## Official and installed evidence

1. [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792) defines an app-level request
   containing chain, sender and calls; it does not require the app to provide
   factory owners/nonce. It also permits rejection and does not promise deployment.
2. [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) describes first-use sender
   creation from account initialization data. This is protocol context, not proof
   of this tester's hosted-wallet support.
3. Installed @base-org/account 2.6.0 Signer.js dispatches universal wallet_sendCalls
   to sendRequestToPopup. The hosted wallet, not the dapp-facing source, chooses
   account preparation. The [official SDK source](https://github.com/base/account-sdk/blob/master/packages/account-sdk/src/sign/base-account/Signer.ts)
   provides corroborating source, but the installed version was reviewed directly.
4. core/rpc/wallet_sendCalls.d.ts defines sender, chain, calls and capabilities;
   sign/base-account/utils.js builds version '1.0', atomicRequired true requests.
   [Official request type](https://github.com/base/account-sdk/blob/master/packages/account-sdk/src/core/rpc/wallet_sendCalls.ts).
   Current EIP-5792 examples use a newer envelope; we retain the installed SDK's
   helper shape for the unexecuted draft, not an assumed hosted-wallet acceptance.
5. The internal subaccount implementation prepares/signs/sends its own operation.
   That demonstrates separation of duties, not support for changing this universal
   account into a subaccount. We do not invoke that code path or access its secrets.
6. [Coinbase's current quickstart](https://docs.cdp.coinbase.com/coinbase-wallet/quickstart/web)
   recommends @base-org/account and its provider. It does not establish successful
   first-use deployment of the unknown tester address on Base Sepolia.

Some previous Base documentation URLs redirect to a migration notice; this review
uses current Coinbase guidance, the official provider types and installed source.
No current official source inspected gives an unconditional Base Sepolia deployment
guarantee for an arbitrary new universal account. No live call was made to resolve
that uncertainty. We therefore cannot honestly answer 'yes, this exact wallet will
automatically deploy' or 'the SDK can never deploy a wallet.'

### Account-type limitation

[Upstream issue #363](https://github.com/base/account-sdk/issues/363) reports that
some newly created EIP-7702 accounts were refused on Base Sepolia even while chain
capabilities indicated support. It is a user report for particular versions/accounts,
not an official universal prohibition or proof that installed 2.6.0 has the same
behavior. It explains why capability advertisement alone is insufficient.

If Coinbase returns an upgrade/delegation requirement or unsupported-network error,
stop. The supported next step is official Coinbase clarification/support for that
exact account type and Base Sepolia, or a documented supported onboarding path.
No confirmed alternative for deploying the exact unknown account was established.
Using a server wallet, EOA, different passkey, newly created subaccount, mainnet,
manual factory initialization or SDK downgrade changes the task and is not a fix.
An already deployed tester-controlled Coinbase account can unblock ownership
testing, but does not deploy this requested account and must not be substituted
silently. No workaround was implemented.

## Prepared minimal request and effects

firstUseRequest.js is a pure builder: no provider import, network, signature,
private key, persistence or submission function. It requires the selected SDK
address to equal an explicitly reviewed expected address and chain 84532. It
rejects extra owner, nonce, recipient, funding, signature or capability inputs.
Its deeply frozen draft has executionEnabled false.

~~~js
{
  method: 'wallet_sendCalls',
  params: [{
    version: '1.0',
    chainId: '0x14a34',
    from: reviewedSdkWallet,
    atomicRequired: true,
    calls: [{ to: reviewedSdkWallet, value: '0x0', data: '0x' }],
  }],
}
~~~

The preparation provider still rejects this method before forwarding it. The UI's
deployment button remains disabled, and no submission endpoint exists. Producing
a draft is not permission to send it.

Offline request-effect checks prove:

- Exactly one explicit call, from and to the same reviewed wallet on Base Sepolia.
- Zero explicit ETH value and empty calldata: no explicit ERC-20/ERC-1155 transfer,
  approval, owner change, exchange action or arbitrary recipient in this request.
- No caller-supplied initCode, factoryData, owner list, nonce or signature.

They do not prove the complete transaction has no other effects. Deployment,
wallet initialization, bundler/payer activity, fees and possibly an account upgrade
are managed by the wallet. atomicRequired can entail upgrading atomicity under the
standard; an unexpected upgrade must be rejected under the current approval scope.
A funded/delegated account can also process a self-call without deploying the
expected factory proxy. Receipt and post-code checks are essential.

No onchain simulation or actual effects were executed/verified. The self-call is a
candidate first operation, not a universally guaranteed deployment-only API.
The reviewed v1.1 factory/implementation evidence remains in
[the deployment plan](COINBASE_SMART_WALLET_DEPLOYMENT_PLAN.md); wallet-managed
requests do not force that factory, so confirm the account path with Coinbase.

## Exact next manual steps

These are a future approval-gated procedure, not instructions to execute now.

1. Obtain the public address of the tester's existing Coinbase passkey account.
   Keep the same account throughout. Do not provide a private key or seed phrase.
2. Approve only the clean-profile read-only connection/preflight first. Use the
   existing preview at 127.0.0.1:5185, explicitly connect the expected account,
   confirm chain 84532 and read its code. Nothing in this stage connected it.
   Empty code does not distinguish a counterfactual factory account from an
   undelegated EOA; it is not sufficient account-type proof.
3. Establish through a documented Coinbase account flow or official support that
   this exact account supports first-use wallet-managed execution on Base Sepolia.
   Ask whether it uses a factory proxy or needs EIP-7702 delegation. A capability
   response alone does not settle this. If unsupported or unclear, STOP and obtain
   Coinbase's supported path; do not improvise a deployment.
4. Review the selected wallet, intended account type, exact self-call draft and
   all wallet-managed setup/fee effects. Decide whether only classic factory
   deployment is acceptable. No new delegation, owner changes or permissions are
   approved by the draft. Keep raw owners/nonce inside the wallet for this route.
5. Obtain a fee quote and verified sponsorship/funding terms through the supported
   wallet confirmation/preparation flow. Do not submit a request merely to measure
   gas, and do not treat pressing wallet_sendCalls as read-only: it can submit
   after authorization. No trustworthy quote is available in the current preview.
6. Approve a separate reviewed submission implementation and one operation for the
   exact address, chain, call and maximum test fee or sponsorship. The current
   preview deliberately cannot submit. No approval flag silently unlocks it.
7. Only then click a distinct manual deployment/first-operation action. Review the
   wallet popup's account, Base Sepolia network, setup effects and fee. Approve the
   passkey prompt yourself, or cancel if anything differs. The wallet constructs
   its own initialization and operation. Never construct owners/nonce ourselves.
8. Resolve the returned batch ID through the wallet's supported status method and
   transaction receipt. A request/batch ID is not an onchain deployment proof.
   Unknown or partial status means reconcile, not automatic resubmission.
9. Verify the same SDK address now has the expected account code using eth_getCode
   at the successful receipt block, as below. Confirm expected implementation and
   factory provenance where applicable. Do not accept an unrelated delegated
   account as the planned classic proxy. Then separately approve EIP-1271 testing.

Steps 3-6 are not currently complete. If the exact account cannot be supported,
this procedure ends there. No alternative changes the account or uses real funds.

## Gas and sponsorship

The self-call's zero value does not make execution free. The wallet's first
operation can include creation, verification, execution and network overhead.
The wallet/bundler constructs those terms. A regular estimate for sending to an
empty address does not estimate the full deployment.

Without a confirmed paymaster or adequate existing gas deposit, the selected gas
payer needs Base Sepolia test ETH. With verified sponsorship for this exact
operation, the tester may not need test ETH. We cannot determine which applies
without that account's wallet quote; no amount is guessed here.

paymasterService.supported means capability, not a commitment to pay. No paymaster
was configured, no sponsor URL/key was added and no funding was requested. Do not
use Coinbase real balances, bridges, mainnet funding or Magic Spend to bypass a
testnet error. Any test-ETH funding/sponsorship setup requires separate approval.

## Post-deployment read-only check

Use the exact SDK address recorded before requesting execution, not a newly
returned address or a guessed CREATE2 address. Against the reviewed Base Sepolia
RPC, verify eth_chainId = 0x14a34, a successful receipt, stable receipt-block hash
and eth_getCode(expectedAddress, receipt.blockNumber) != 0x. Require the wallet
provider still reports that same account on that same chain.

Preparation-only RPC request shape:

~~~json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "eth_getCode",
  "params": ["<EXACT_REVIEWED_SDK_ADDRESS>", "<CONFIRMED_RECEIPT_BLOCK_HEX>"]
}
~~~

Both placeholders intentionally prevent this example from being an executable
verification. The existing inspectDeployment() utility can also read current
status, but a latest-block code read alone does not bind it to the submitted
operation. Code existence is not proof of Coinbase provenance or tester control.
Require the expected proxy/implementation identity, creation provenance and later
EIP-1271 proof; a 0xef0100 delegation prefix is a different account path requiring
review. Inspect https://sepolia.basescan.org/address/<exact-sdk-address>#code and
the resolved transaction receipt. Do not treat inclusion as finality or activate
production wallet linking as a side effect.

## Offline results and change scope

Added firstUseRequest.js and firstUseRequest.test.js; clarified blockers in the
read-only preview and corrected the earlier blanket metadata prerequisite in the
plan. No signing/submission guard was relaxed. No factory pins, verification
harness, dependencies, production app, payment logic or migrations were changed.

All 34 offline tests passed: 6 new request tests, 12 deployment-preview tests and
16 ownership-harness tests. They cover fixed effects, wrong chain/address,
forbidden extra fields, immutability, no forwarding and the installed request
envelope, plus existing mock RPC/HTTP/signature rejection cases. They do not prove
hosted-wallet automatic deployment. Lint, syntax, in-memory preview build and
whitespace checks are run before completion. No live verification is claimed.

Run offline from the worktree:

~~~powershell
npx.cmd --yes --package=node@22 node --test tools/coinbase-deployment/firstUseRequest.test.js tools/coinbase-deployment/preview.test.js tools/coinbase-deployment/server.test.js tools/coinbase-verification/harness.test.js tools/coinbase-verification/server.test.js
~~~

The unresolved SDK vulnerabilities remain documented. Before any later live
experiment, the tester must accept those isolated-test risks explicitly. There
were no live connections/signatures, transactions, deployments, commits or pushes
in Stage 4.3O.

## Current Coinbase documentation and preview update - 17 November 2026

The official Base migration page now directs Smart Wallet documentation to [Coinbase Wallet SDK](https://docs.cdp.coinbase.com/coinbase-wallet/overview). It still recommends @base-org/account; no package replacement was made.

The current [wallet_sendCalls reference](https://docs.cdp.coinbase.com/coinbase-wallet/reference/core/provider-rpc-methods/wallet_sendCalls) specifies version 2.0.0 and describes submission, not a non-submitting deployment preview. Installed SDK 2.6.0 still builds version 1.0 in its existing helper. This is an unresolved compatibility question, not proof that either version fails for the universal account. No live request was made to test it. The attempted documentation path for wallet_prepareCalls was unavailable; no supported universal-account unsigned quote method was established by this review.

The separate local inspector at http://127.0.0.1:5185 now includes a deployment review panel. It requires a fresh SDK connection to the exact previously reviewed account, chain 84532, matching contract pins and undeployed status before showing a documentation-only self-call draft. That draft uses the current documented version and is explicitly not a wallet-prepared or quoted operation. It is never sent to the SDK. The preparation provider still blocks send, sign, prepare, network-switch and permission methods.

No exact deployment/init/delegation effects, gas estimate, fee maximum or sponsorship promise are available. A zero-value call does not establish zero fees or absence of account-setup effects. Capability flags still do not prove deployment or sponsorship. The deployment button remains disabled. Do not call wallet_sendCalls merely to discover whether deployment works.

Files added: tools/coinbase-deployment/deploymentReview.js and deploymentReview.test.js. Existing browser main.js and index.html render the review. All 29 deployment-tool tests passed under Node.js 22, including strict no-forwarding, account/network mismatch and HTTP write rejection. No production code, dependencies, database or existing signing harness changed.

Next evidence needed: authoritative Coinbase confirmation of first-use support for this account and SDK version, plus an account-specific non-submitting preparation/quote route or a separately reviewed authorization flow. If none exists, stop and seek Coinbase support or use an already-deployed SDK-controlled test account; do not substitute server wallets or guessed factory owner data.

## Current compatibility determination - 17 November 2026

**Result: BLOCKED.** No signing, submission, deployment, additional funding or production activation occurred. No commit or push was made.

This section supersedes any interpretation that the request-version difference alone is a demonstrated SDK failure. It also does not claim that this account can deploy on testnet simply because the SDK can forward a request.

### Confirmed account evidence

The tester's supplied inspection at 02:39:59 UTC confirmed SDK connection to `0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC`, chain 84532, capability availability, no deployed code and a balance of 10,000,000,000,000,000 wei (0.01 test ETH). The reported atomic/paymaster flags do not include a request-version negotiation or a fee commitment.

A fresh guarded public RPC inspection at **12:21:08 IST on 17 November 2026** (06:51:08 UTC) confirmed:

| Read | Result |
| --- | --- |
| Chain | Base Sepolia 84532 |
| Block | 59881993 |
| Block hash | `0xa165e0c3ecb9e85e235c820a80294ec41e36f27e2346698d7462c48e62811989` |
| Account code | Empty, NO_CODE |
| Balance | 10000000000000000 wei / 0.01 test ETH |
| Reviewed factory | `0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842` |
| Factory implementation | `0x00000110dCdEdC9581cb5eCB8467282f2926534d` |

The inspector matched the previously pinned factory/implementation runtime hashes and rechecked the block hash. This verifies infrastructure identity, not that the undeployed account belongs to that factory. No new connection or signature was requested during this investigation.

### Installed SDK versus official documentation

Installed package: `@base-org/account` **2.6.0**, as recorded in its package.json.

| Evidence | Finding | What it does not prove |
| --- | --- | --- |
| `dist/core/rpc/wallet_sendCalls.d.ts` | Version is typed as string | Any particular version is accepted by the hosted account |
| `dist/sign/base-account/utils.js`, createWalletSendCallsRequest | Existing helper constructs version 1.0 | Version 2.0.0 is rejected by the provider |
| `dist/sign/base-account/Signer.js`, universal-account request switch | wallet_sendCalls is forwarded to sendRequestToPopup; no local version rejection in this route | Hosted wallet validation, simulation, fee quotation or execution success |
| Current official send-call reference | Specifies request version 2.0.0 | A safe unsigned preparation method or account-specific first-use support |
| Current official capabilities examples | Still show version 1.0 | Authoritative negotiation of the tester's accepted request versions |
| Installed return type versus current reference | SDK declares a hex return; reference illustrates an object | The exact live response shape for this account |

Sources: [Coinbase Wallet SDK overview](https://docs.cdp.coinbase.com/coinbase-wallet/overview), [wallet_sendCalls reference](https://docs.cdp.coinbase.com/coinbase-wallet/reference/core/provider-rpc-methods/wallet_sendCalls), [wallet_getCapabilities examples](https://docs.cdp.coinbase.com/coinbase-wallet/reference/core/provider-rpc-methods/wallet_getCapabilities).

The reference schema for a future reviewed request is 2.0.0. The installed helper's 1.0 format is also evidenced by Coinbase examples. We cannot name a **live-account-supported** format under the current restrictions: no account acceptance response has been obtained. Do not upgrade/downgrade the SDK, change formats and submit, or treat documentation inconsistency as a demonstrated account failure.

### Offline compatibility verification

Added `tools/coinbase-deployment/sdkCompatibility.test.js`. It instantiates the actual installed Signer with an ephemeral in-memory store and replaces the popup boundary with a local callback. Real popup access throws; fetch is denied and must not be used. No real provider is connected.

Four tests establish:

1. Version 1.0 reaches that mocked boundary unchanged.
2. Version 2.0.0 reaches it unchanged.
3. A universal wallet_prepareCalls request has no explicit popup handler in this installed dispatcher; without a configured chain RPC it fails before network access.
4. KhmerFP's preparation guard refuses both send-call versions before forwarding anything.

This tests SDK routing, not account deployment compatibility. Test success is not a transaction simulation, sponsorship decision or live wallet result.

### First-use account type and setup effects

Empty code does not distinguish an ERC-4337 counterfactual factory account from an EOA awaiting EIP-7702 delegation. A funded address also does not distinguish those cases. The provider's universal-account selection is not proof of the underlying on-chain provisioning model.

Potential paths require different evidence:

| Possible path | Evidence needed before approval | Effects requiring review |
| --- | --- | --- |
| ERC-4337 factory creation | Authentic factory data/owners/nonce or authoritative wallet-managed preparation; predicted sender matches the connected address | Proxy deployment, owner initialization, account execution and gas/prefund handling |
| EIP-7702 setup | Authoritative account classification, delegation target, authorization and supported testnet setup flow | Delegation code/authorization, possible setup or upgrade calls, fee payer and future execution authority |
| Already-deployed account | Actual deployed code and approved implementation/owner state | Not applicable to the current NO_CODE result |

No path has been established for this exact account. No owner, factory nonce, initialization payload, delegation authorization or upgrade is guessed. Calling the known factory directly could create a different wallet and is not a fix for the existing SDK account.

The [open upstream issue #363](https://github.com/base/account-sdk/issues/363) reports testnet provisioning refusal for some accounts despite positive capabilities, for earlier tested SDK versions. It is corroborating evidence that flags are insufficient, not proof that the tester uses that account type or has the same bug in 2.6.0. Do not work around it using mainnet, another user's wallet or a CDP server wallet.

### Non-submitting preparation or simulation

No officially documented, verified universal-account unsigned deployment preparation/quote route was established.

- wallet_sendCalls is an execution request, not a preview. Opening it merely to discover fees may trigger setup, signing or submission and is excluded here.
- The SDK contains wallet_prepareCalls types and explicit internal subaccount handling. The combined subaccount send path prepares, calls owner.sign and submits; it must not be invoked under these restrictions.
- Unknown methods in the universal dispatcher fall back to chain RPC. Configuring an arbitrary endpoint or trying undocumented methods does not establish a supported wallet preparation API.
- A plain eth_estimateGas for the zero-value self-call against today's empty address would omit wallet-managed deployment/delegation and is not a reliable full quote. It was not used to manufacture an estimate.

A valid future quote needs the actual complete unsigned setup/operation and sender/payer context, without a signing side effect. If Coinbase offers only a combined authorization flow, its behavior and approval boundary must first be documented and separately approved. Do not label it non-submitting without evidence.

### Fee payer, sponsorship and the 0.01 test ETH

**Fee payer: UNKNOWN. Gas estimate: UNKNOWN. Maximum total cost: UNKNOWN. Sponsorship: NOT CONFIRMED. Balance sufficiency: NOT DETERMINED.**

The account's 0.01 test ETH may be usable in a supported wallet-managed flow, but it does not identify an EOA deployment payer, guarantee counterfactual prefunding support, or commit a paymaster to fees. A paymaster-capable flag is not a sponsorship offer.

Before determining sufficiency, obtain the exact deployment/delegation/operation payload, fee-payer identity, gas limits, current fee parameters, Base L1 data charges and any other applicable fees, plus explicit sponsor coverage or a bounded total charge. Then compare the payer's actual available balance with that maximum. Do not compare the wallet balance to a guessed 21,000-gas transfer estimate.

No additional funding is recommended or requested. There is no evidence that lack of balance is the current blocker.

### Expected address

The review target remains exactly `0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC`. Setting it as from/to in a draft does not prove deployment will create or initialize that address.

For a factory path, authentic init data must produce that address through the correct factory prediction. For a delegation path, verify that the authorization modifies that exact account with an approved target and preserves expected ownership. Those account-specific proofs are missing. Post-execution code/receipt checks would be required later but cannot replace pre-approval operation review.

### Resolution table and next evidence

| Question | Current result |
| --- | --- |
| Does the installed SDK locally route both formats? | YES, offline mocked-boundary tests |
| Which format does this live account accept? | UNKNOWN; no prohibited live send used to test it |
| Is the first-use mechanism for this account proven? | NO |
| Is a supported unsigned preparation/quote method proven? | NO |
| Are setup, delegation or upgrade effects fully identified? | NO |
| Is a fee payer/sponsor and maximum quote available? | NO |
| Is 0.01 test ETH sufficient? | UNKNOWN |
| Is exact resulting-address identity proven? | NO |
| May execution proceed? | NO |

The next step is authoritative Coinbase SDK/support clarification, using only the public account address, chain, SDK version and sanitized capability report. Ask for: supported first-use provisioning for this account; accepted EIP-5792 version and response shape; a non-signing prepare/simulation method; actual setup/delegation payload; sender-address guarantee; fee payer and sponsorship/quote terms. This document prepares those questions; no message was sent externally.

If that evidence cannot be supplied, stop or select an already-deployed tester-controlled SDK account for EIP-1271 testing. A separate factory wallet is a different acceptance test. Only after the missing operation and fee evidence is reviewed should separate signing/transaction approval be requested. This report does not authorize execution.
