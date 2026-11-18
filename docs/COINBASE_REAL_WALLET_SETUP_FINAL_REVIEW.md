# Original Coinbase wallet setup: final review

Date: 18 November 2026. Repository: F:/khmerfp-matching-contract.

Decision: BLOCKED. Preserve Setup unavailable. No executable setup integration is justified by the available evidence.

Target only: 0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC, Base Sepolia 84532. The separately proposed EOA-owned test wallet is not evidence for this account and is not used in this review.

## What this investigation adds

Earlier investigations established connection, no code and unknown setup details. This review adds a source-level explanation and an offline proof that the installed wallet_getCapabilities method reads cached SDK capabilities without a fresh RPC or popup request. Therefore repeated capability queries cannot fill the missing deployment evidence.

It also checks the installed wallet_connect response types: universal account address/capabilities are not an authenticated setup payload, and the factory/factoryData fields in the declared response belong to subaccount capabilities. No account-specific universal initialization/delegation object or fee quote was established from those types. A type definition cannot establish what the remote service will return for this tester.

Previous self-call drafts, send attempts, funding experiments and separate-wallet deployments were not repeated. One fresh read-only chain snapshot was taken to anchor this final review.

## Confirmed account facts

| Item | Confirmed result |
| --- | --- |
| Installed package | @base-org/account 2.6.0 |
| Application-selected SDK mode | universal account; subaccount creation and funding manual |
| Prior SDK connection | successful, from the tester's earlier manual report; not repeated here |
| Chain | Base Sepolia 84532, verified by eth_chainId |
| Account address | 0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC |
| Latest read time | 2026-11-17T23:02:07.237Z / 18 November 2026, 04:32:07 IST |
| Evidence block | 60173288 |
| Evidence block hash | 0x571bcbc4254262a73b81cc6cba2a20fc4aeb5cca9677bd43aba6497068f2c03f |
| Account code | 0x |
| Balance | 10100000000000000 wei / 0.0101 test ETH |
| Account transaction count | 0 |
| Ownership proof | not verified |

The RPC block hash was re-read and unchanged. Code was absent at that block, so there is neither deployed smart-wallet code nor an installed EIP-7702 delegation designator visible there. This does NOT identify what setup the hosted account is intended to use. Zero transaction count and prefunded balance do not distinguish an undeployed ERC-4337 account from an undelegated EOA. No private keys, browser session storage or opaque wallet account records were inspected.

## Wallet type and setup mechanism

Confirmed SDK classification: connected universal account, according to the existing integration and tester report.

Confirmed on-chain account implementation type: UNKNOWN. Passkey access in the hosted UI does not itself prove ERC-4337 factory ownership, an EOA delegation model or an implementation address.

| Candidate mechanism | Evidence required | Present for this exact account? |
| --- | --- | --- |
| ERC-4337 first-use deployment | authoritative factory/init payload, owner configuration or wallet-managed unsigned preparation, sender prediction and full operation quote | NO |
| EIP-7702 delegation/setup | authoritative account classification, delegation target, initialization/upgrade effects, authorization and transaction envelope, payer and quote | NO |
| Another supported hosted mechanism | official method plus account-specific prepared operation and expected resulting state | NO |

Known Coinbase factory addresses and runtime hashes do not bind this account to a factory. Guessing owner bytes or nonce could create a different address. Changing to mainnet, creating a subaccount or using a CDP server wallet would not establish this account's Base Sepolia setup.

## Installed SDK evidence

All paths below refer to node_modules/@base-org/account/dist/ in this worktree.

| Source | Finding |
| --- | --- |
| sign/base-account/Signer.js:173-174, 378-414 | wallet_getCapabilities checks account membership, reads account.capabilities from the SDK store, adds wildcard gasLimitOverride support and filters chain entries |
| sign/base-account/Signer.js:464-468 | capability values can be cached from a decrypted hosted-wallet response; the get-capabilities handler itself does not make a fresh setup-readiness request |
| core/rpc/wallet_connect.d.ts | declared universal account response has address and capabilities; optional factory/factoryData fields are inside subAccounts, not a universal-account provisioning proof |
| sign/base-account/Signer.js:189-192 | universal wallet_sendCalls is forwarded to the hosted popup; this local code does not construct this account's setup |
| sign/base-account/Signer.js:250-253 | unhandled universal methods fall back to the configured chain RPC, or fail when no RPC URL exists |
| core/rpc/wallet_prepareCalls.d.ts | preparation types exist, but their existence does not establish universal-account support or this account's fee quote |
| sign/base-account/utils/createSubAccountSigner.js:94-152, 181-204 | explicit prepare handling belongs to the subaccount path; combined sending also invokes owner.sign and wallet_sendPreparedCalls |
| sign/base-account/utils/createSmartAccount.js:75-78 | getFactoryArgs returns supplied factoryData; it does not derive missing universal initialization data |
| sign/base-account/utils.js:276 | helper constructs wallet_sendCalls version 1.0 |

Inspected Signer.js SHA-256, exact local file bytes: 86470964c9221bab24aa8cf6464d795d32580e772e9ddeac3d5473e8f062ac70. This records the examined installation, not a claim that every SDK release has identical behavior.

No experimental_requestInfo call or undocumented account extraction was attempted. No signing, permission, subaccount creation or send method was called.

### New offline capability proof

A one-off Node.js 22 test instantiated the actual installed Signer with an ephemeral, non-persistent store and this public address. Global fetch and popup access were replaced with throwing guards. It:

1. Seeded synthetic Base Sepolia atomic/paymaster capability flags in that temporary store.
2. Called wallet_getCapabilities and confirmed those flags were returned.
3. Removed the temporary stored chain capabilities and confirmed the chain entry disappeared.
4. Asserted zero fetch calls and zero popup calls for both requests.

Result: PASS. This establishes installed method behavior, not the live account's current flags or readiness. No real SDK session was opened or read. The tester's earlier capability report remains historical; it is not relabelled fresh.

## Official documentation review

Coinbase still recommends @base-org/account for the current wallet integration. The reviewed account-access and capability references do not establish a read-only universal setup/payer quote for this tester.

The wallet_sendCalls reference specifies version 2.0.0 and describes execution submission. The installed helper uses 1.0, and previous offline routing tests accepted both at a mocked boundary. This discrepancy alone does not demonstrate a runtime failure, identify the account type, or justify changing versions and sending. No live acceptance response was obtained.

The open issue #363 reports Base Sepolia provisioning refusal for some newly created EIP-7702 accounts. It remains a third-party report in the official repository, not maintainer confirmation that this account has the same issue. This tester has no captured approved setup operation or corresponding error response. We cannot label Coinbase's reported bug the exact root cause for this account.

No current official source reviewed here supplies the missing account-specific setup object. Generic first-use account-abstraction behavior does not fill that gap.

## Exact supported operation

NONE VERIFIED for this account under these restrictions.

- Intended chain: 84532.
- Required resulting account: exactly 0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC.
- Deployment versus delegation: unknown.
- Destination, initialization data, authorization and complete operation: unknown.
- Fee payer, sponsorship coverage, gas estimate and maximum total cost: unknown.
- Sufficient balance for setup: not determined. No additional funding is recommended.
- Signing/submission permission: not granted by this investigation.

There is no exact unsigned setup call to simulate or estimate. Estimating a plain self-transfer to today's empty address would omit account setup and provide a misleading quote. It was not done.

## Integration decision and precise blockers

The existing setup coordinator, deployed-code gate and backend EIP-1271 verifier remain unchanged. The UI continues to show Setup unavailable and a read-only retry. No ready-for-review state or transaction button is added.

To move beyond that state, all of the following must be established for THIS account:

1. The hosted account's actual setup model on Base Sepolia.
2. A documented method that supports that model on chain 84532.
3. Authentic account-specific initialization/delegation information and a guarantee of the expected resulting address.
4. A complete non-submitted setup operation describing calls, owner/delegation/upgrade effects and permissions.
5. Fee payer identity, full fee estimate, sponsor commitment if applicable and a reviewed cost budget.
6. An approval boundary that permits inspection before a signature or submission. If the wallet combines those steps, that limitation must be reviewed explicitly; an execution request must not be presented as a preview.

Another wallet's success, test simulations, capability flags, balance increases or switching request versions cannot satisfy these blockers.

## Next concrete step and approval boundary

No real Base Sepolia execution test is safe to start from the current evidence.

The next evidence-producing step is to obtain an authoritative account-specific setup description, rather than repeat wallet_getCapabilities. The tester can inspect the official Coinbase wallet interface manually for a non-submitting setup preview for this exact address and chain, if one is offered. Do not assume a button exists, and do not click Send, Enable/Upgrade approval, a signature confirmation or any final setup confirmation merely to discover effects. If no unsigned preview is available, that is the blocker, not permission to try a blind call.

Coinbase's current official SDK overview links a Join CDP Discord support channel. A manual question there can include only public information: SDK 2.6.0, target address, chain 84532, code 0x, nonce 0 and the request for an account-specific non-signing setup/quote path. Ask whether the account is ERC-4337 or EIP-7702, which operation provisions it on Base Sepolia, which address changes, and how fees can be reviewed first. No support message was sent by this task. No credentials or signatures should be shared.

Manual user approval is REQUIRED before any future setup signing or submission, but approval alone cannot replace the missing operation details. Once the account-specific operation and cost are established, review it concretely and request separate approval. This document does not request approval for an unknown transaction.

## Separate ownership verification, only after verified setup

After separately approved setup and independent chain-state verification:

1. Confirm the exact address, compatible deployed/delegated implementation, stable block and expected owner/control configuration; a nonempty-code read alone is insufficient evidence of correct setup.
2. Separately approve a real ownership-signature test in the isolated harness. Generate a fresh KhmerFP EIP-712 ownership challenge for the original account, chain, intended action, application origin, synthetic user/session binding and short expiration.
3. Ask the original Coinbase SDK wallet to sign only after explicit user action. Do not substitute an EOA test wallet or manually guess a signature wrapper for an unknown account type.
4. At a fixed canonical block, call the original account's isValidSignature(original challenge digest, actual returned signature) with eth_call, requiring exactly 0x1626ba7e. Preserve existing EIP-6492 rejection; unsupported wrapped formats must be reported, not stripped blindly.
5. Check altered message, wrong wallet/domain/chain, invalid signature and expiry/session cases. Application challenge replay rejection must be tested separately; EIP-1271 alone does not consume a digest.
6. Only after real cryptographic compatibility is proved, separately approve a disposable authenticated PostgreSQL linking test, persistence, refresh, replay, unlink and relink. Never enable production to run acceptance tests.

This plan is not an executed ownership test. The 13 successful browser scenarios use simulated wallets and remain separate evidence.

## Changes and validation

Only this report was created in this task. No application code, coordinator, migration, schema, dependency, feature flag or existing document was changed.

Executed: installed-SDK offline capability-cache proof and original-account read-only RPC snapshot, with chain and block consistency checks. No signing or send experiments were repeated. Documentation whitespace validation was performed. Full frontend/backend/E2E suites were not repeated because this task did not change application or test code; their earlier results are not presented as newly executed.

No transactions, UserOperations, deployments, transfers, real signatures, production database operations, commits or pushes occurred. Production linking remains disabled.

## Sources

- [Official SDK package recommendation](https://docs.cdp.coinbase.com/coinbase-wallet/overview)
- [Official wallet_getCapabilities reference](https://docs.cdp.coinbase.com/coinbase-wallet/reference/core/provider-rpc-methods/wallet_getCapabilities)
- [Official wallet_connect reference](https://docs.cdp.coinbase.com/coinbase-wallet/reference/core/provider-rpc-methods/wallet_connect)
- [Official wallet_sendCalls execution reference](https://docs.cdp.coinbase.com/coinbase-wallet/reference/core/provider-rpc-methods/wallet_sendCalls)
- [Reported account readiness issue, not account-specific proof](https://github.com/base/account-sdk/issues/363)
- [Previous deployment investigation](COINBASE_WALLET_DEPLOYMENT_RESOLUTION.md)
- [Executed simulated-wallet E2E report](COINBASE_WALLET_ONBOARDING_E2E_REPORT.md)
