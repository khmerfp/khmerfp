# Coinbase open-source ownership verification plan

Stage 4.3W - 17 November 2026. Research and preparation only.

## Decision and current readiness

A separate Coinbase Smart Wallet created through the existing official factory is technically feasible for **contract-level EIP-1271 testing with a known address owner**. We do not need to develop or deploy another wallet implementation or factory.

**Execution is blocked.** The tester has not prepared a separate EOA address or selected a factory nonce. There is therefore no confirmed new-wallet address, deployment calldata tied to approved inputs, gas estimate, funding amount or deployment approval. Nothing in this document authorizes a transaction or signature.

This separate test does not replace verification of the original Coinbase SDK universal account or its hosted passkey flow. The full KhmerFP signing architecture remains unchanged.

## Official source review

Reviewed source commit: `a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da`.

- [CoinbaseSmartWalletFactory.sol](https://github.com/coinbase/smart-wallet/blob/a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da/src/CoinbaseSmartWalletFactory.sol): prediction and atomic creation/initialization through an ERC-1967 proxy.
- [CoinbaseSmartWallet.sol](https://github.com/coinbase/smart-wallet/blob/a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da/src/CoinbaseSmartWallet.sol): address/passkey verification, owner index and signature wrapper.
- [ERC1271.sol](https://github.com/coinbase/smart-wallet/blob/a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da/src/ERC1271.sol): wallet-specific replay-safe hashing.
- [Official deployment list](https://github.com/coinbase/smart-wallet#deployments): factory version 1.1.

The contracts carry MIT notices. The pinned wallet source uses Solidity 0.8.23. Its actual signature wrapper uses a uint256 owner index; use the contract ABI rather than the older uint8 example in the repository README. This stage does not build new contracts or change dependencies.

## Fresh read-only Base Sepolia check

The existing guarded deployment inspector checked public RPC data on chain **84532** at **06:18:47 IST, 17 November 2026** (00:48:47 UTC). Only read methods were used.

| Item | Confirmed value |
| --- | --- |
| Official v1.1 factory | `0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842` |
| Factory implementation() result | `0x00000110dCdEdC9581cb5eCB8467282f2926534d` |
| Block | 59773292 |
| Block hash | `0x97401ab62155f4139be22b9fa05f82475826a7380430ea43f4ff9a4bfdbf9df5` |
| Factory runtime keccak256 | `0xb60a629aa7c6af9b550871fd21b67ab84638156683cec68491049cb5d235ed2f` |
| Implementation runtime keccak256 | `0x136185896fc519277ec953c0b3d048fc0c9f607b8d04022e60f23ef8dbc6c4d5` |

Both code hashes matched the existing reviewed pins. The block hash was rechecked for consistency. The official factory address alone is not proof of network: chain ID must also match. Historical v1 factory `0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a` must not be silently substituted.

The earlier tester address `0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC` still returned no code at this block. This read does not prove control of that address. Its exact owners, factory nonce and provisioning model remain unverified.

The Base Sepolia explorer page was not accessible through the web research tool in this stage. Fresh RPC identity checks succeeded, but a new reproducible source-to-bytecode build was not performed. Recheck explorer-verified source, implementation and runtime pins before deployment approval.

## Prepare a test-only EOA safely

An EOA is a normal Ethereum address controlled by a signer, rather than a wallet contract. It will own the separate smart wallet; it is not itself the Coinbase smart wallet being tested.

1. Use trusted wallet software or a hardware wallet that explicitly supports a standard Ethereum EOA. Create a **new test-only account**, preferably in a separate test profile. Do not import publicly known Hardhat keys or reuse an account holding real funds.
2. Complete any recovery backup privately using the wallet's own secure process. Never put a private key or recovery phrase in KhmerFP, chat, a terminal command, a screenshot, a repository or the verification report.
3. Select Base Sepolia (84532). Copy only the public address. Confirm the wallet identifies this as an EOA whose signer you control. Empty eth_getCode alone does not prove EOA status: the original undeployed SDK smart wallet also has empty code.
4. Keep this account test-only, without mainnet assets. Creating the local wallet account need not send an on-chain transaction. No software installation, wallet creation or connection is performed automatically by this plan.
5. Supply only the public owner address for preparation. Control is not considered cryptographically proven until a separately approved manual signature passes the deployed smart wallet's verification.

For the simplest setup, use exactly one EOA owner and the same EOA as the deployment fee payer. No backend, recovery or extra owner is added. Coinbase owners can act independently, so extra owners are powerful permissions rather than a multisig threshold.

A new P-256/passkey owner is also possible, but requires verified credential/public-key data and a separate WebAuthn signing adapter. That is more work and does not reveal or recreate the original SDK passkey.

## Select the factory nonce

The factory nonce is a caller-chosen uint256 used to derive an address. It is **not** the EOA transaction count, the ERC-4337 UserOperation nonce, or the KhmerFP ownership challenge nonce.

Choose a non-negative integer below 2^256 and record its exact decimal value with the owner list and network. Zero is a valid candidate for a new test configuration, but no value has been selected or assumed here. Check the resulting prediction before accepting the choice. If it points to an existing contract or unexpected account, stop and inspect it rather than treating it as a fresh wallet.

Once the public owner and nonce are approved, keep their exact encodings unchanged through prediction, gas estimation and transaction review.

## Confirm the predicted address before deployment

All steps in this section are read-only preparation, after public inputs are supplied:

1. Recheck chain 84532, factory code hash, implementation() and implementation code hash at a recorded block.
2. Encode the sole owner as the 32-byte `abi.encode(address)` value. Do not confuse this with a packed 20-byte address or passkey public-key bytes.
3. Call the official factory's `getAddress(bytes[] owners, uint256 nonce)` with those exact inputs. In ethers use `factory.getFunction('getAddress')(owners, nonce, { blockTag })`; Contract.getAddress() without that ABI lookup returns the factory's own address instead.
4. Independently compare the CREATE2 formula using the factory's read-only initCodeHash():

```text
salt = keccak256(abi.encode(owners, factoryNonce))
predicted = getCreate2Address(factoryAddress, salt, factory.initCodeHash())
```

The factory's own prediction and independent formula must match. Do not guess proxy bytecode. The existing narrow RPC allowlist would need an explicitly reviewed initCodeHash view allowance for this extra check; do not weaken it to arbitrary contract calls.

5. Read eth_getCode at the predicted address. Require no code for the proposed fresh deployment and investigate any unexpected existing balance or history. An existing deployment requires a separate ownership/implementation review.
6. Record the public owner, encoded owner bytes, selected factory nonce, chain, factory, implementation, block/hash, prediction and unsigned calldata hash. Show the full checksum address to the tester for review.

The owner address and factory nonce are still missing, so **no concrete prediction has been made**. Existing `tools/coinbase-open-source/review.js` builds a non-executable calldata draft only after explicit inputs; its separation check is not a substitute for the factory prediction.

CREATE2 does not inherently include chain ID. Similar deployment inputs on another chain can yield the same address; that does not establish deployment or ownership on Base Sepolia.

## Proposed deployment transaction ? not submitted

After a separate approval, the EOA's trusted wallet would send a normal transaction:

| Field | Required value |
| --- | --- |
| Chain | Base Sepolia, 84532 |
| From / fee payer | Approved tester EOA, still unassigned |
| To | The verified v1.1 factory above |
| Value | Zero ETH |
| Call | createAccount([abi.encode(approvedOwner)], explicitlyChosenFactoryNonce) |
| Expected result | Official proxy at the previously confirmed address, initialized with that sole owner |

The existing factory is permissionless: its caller pays fees but the explicit owner list determines control. Factory deployment and initialization happen atomically. No new implementation, factory, EIP-7702 delegation, token approval, exchange call or UserOperation is needed for this route.

Before authorizing, review decoded calldata and fees in the tester's wallet. If the wallet shows another network, owner list, target, ETH value or unexpected additional call, reject it. Someone else deploying the exact same deterministic inputs does not become the owner, but any unexpectedly existing deployment must still be inspected before reuse.

After a separately approved deployment, verify a successful receipt, AccountCreated evidence for a fresh account, predicted address, nonempty code, proxy implementation, ownerAtIndex(0), owner count and the wallet's EIP-712 domain. Recheck the receipt block before treating it as stable. Record only public evidence. A repeat createAccount call may return an already-created wallet without a new event; it must not be mistaken for a fresh initialization.

## Test ETH, gas and sponsorship

**No numeric gas quote or funding amount is available yet.** Inventing one before the sender and exact calldata are known would be misleading.

A direct factory transaction normally requires **Base Sepolia test ETH at the fee-payer EOA**. It does not require real ETH, USDC, funds in the new smart wallet, an EntryPoint deposit or a paymaster. Any faucet funding would itself be a separate later action; none was requested or performed here.

After inputs are approved, obtain eth_estimateGas for the exact unsigned call and a current fee quote. Estimation may require a funded sender. Review L2 execution fees plus L1 data/security fees and any applicable current network charges. A simple gas-units times gas-price calculation is not a complete Base quote. Follow [Base's official fee guidance](https://docs.base.org/specifications/transactions/network-fees), record the quote block and expiry, and obtain approval for a bounded maximum total test-ETH cost.

Coinbase SDK paymaster capability flags do not sponsor this independent direct factory transaction. An explicitly approved alternate fee payer could call the factory for the same owner, but no sponsor or sponsorship commitment is configured. Do not claim gasless deployment.

After deployment, off-chain ownership signing and read-only EIP-1271 eth_call do not spend wallet gas or require tokens. RPC service quotas may still apply.

## Real EIP-712 and EIP-1271 procedure

Use a fresh challenge from the existing isolated harness and shared KhmerFP protocol. Keep the normal application linking feature disabled.

The inner challenge uses the existing KhmerFP domain and fields unchanged: challengeId, action, userId, wallet, sessionBinding, appOrigin, nonce, issuedAt and expiresAt. It expires after 120 seconds. Verify all bindings before requesting any signature.

Coinbase adds an outer replay-safe EIP-712 message for its address-owner path:

```text
domain:
  name: Coinbase Smart Wallet
  version: 1
  chainId: 84532
  verifyingContract: confirmedSeparateWalletAddress
primary type: CoinbaseSmartWalletMessage(bytes32 hash)
message.hash: originalKhmerfpOwnershipDigest
```

After separate signing approval only:

1. Show the full inner ownership terms and digest, wallet address and outer domain to the tester. An opaque hash in a wallet popup is insufficient context by itself.
2. Ask the known owner to manually approve only that outer typed-data signature. Do not use personal_sign on the original digest or ask to sign a deployment, order, transfer or UserOperation.
3. ABI-encode the owner signature as `tuple(uint256 ownerIndex, bytes signatureData)`, using index zero only after checking this deliberately configured single-owner wallet. Raw r/s/v bytes alone are not the wallet's full signature wrapper.
4. Pass the **original KhmerFP digest** and wrapped signature to the deployed wallet's isValidSignature(bytes32,bytes) using eth_call. The wallet computes its own outer replay-safe hash. Passing that outer hash as the original digest would wrap twice and fail.
5. Require exactly 0x1626ba7e at a recorded block and recheck its hash. Other values, reverts or RPC uncertainty are failures, not ownership proof.
6. Consume the challenge once in the isolated harness. Do not persist the raw signature or application session credentials.

EIP-1271 itself does not enforce KhmerFP challenge expiration, session binding or one-time consumption. A signature can remain cryptographically valid after its application challenge expires. Those protections must remain in the harness and backend; do not confuse the two layers.

## Connect this to the existing isolated harness

Reuse the challenge, digest validation, single-use handling and real deployed-contract verifier in `tools/coinbase-verification/`. Keep its fixed chain, deployed-code checks, magic-value requirement, timeouts and EIP-6492 rejection.

The current browser adapter connects the Coinbase SDK's universal account. It cannot simply select the separately factory-created EOA-owned wallet. A small, separately reviewed **test-only owner adapter** is needed to connect the EOA signer, show the target smart wallet, build the outer message and wrap the approved signature. Do not replace the production Coinbase adapter or weaken the expected-address guard.

That adapter is not implemented or enabled in this preparation stage. The existing pure helpers `replaySafeOwnershipData`, `replaySafeOwnershipHash` and `wrapEoaOwnerSignature` can be reused. Stage 4.3V browser mocks must not be used as real verification evidence; the actual public Base Sepolia verifier must be used for this test.

## Acceptance evidence and limits

| Test | Required evidence | What it proves |
| --- | --- | --- |
| Factory identity and prediction | Correct network/code hashes, matching predictions, agreed public inputs | Prepared deployment identity, not owner control |
| Deployment | Stable successful receipt, exact address, implementation and owner state | Correct test contract was created |
| Valid ownership proof | Fresh manual owner signature; actual deployed wallet returns exact magic value | Address-owner contract-level control for these challenge terms |
| Changed message or signature | Reuse the valid proof with altered input; contract rejects or reverts | Tampered proof rejected; no additional real signing needed |
| Wrong wallet/network | Harness rejects mismatch before signing or RPC; preserve domain binding | Application boundary protection; not an unexecuted cross-chain experiment |
| Expired/replayed challenge | Harness rejects despite any underlying signature validity | Application expiry and single-use behavior |
| Undeployed account or EIP-6492 proof | Existing guards refuse it | No hidden factory execution or deployment during verification |

A second deployed-account replay experiment would require its own approved account. Do not claim it was performed from offline hash tests alone.

This plan would establish neither the original SDK account's control nor its WebAuthn/passkey signature format, credential recovery, automatic deployment, paymaster support, trading signatures or settlement permissions. Those remain separate integration tests.

## Checks completed in this stage

- Reviewed official factory, wallet and replay-safe signature source at the pinned commit.
- Confirmed official factory listing and fresh on-chain factory/implementation identity through guarded reads.
- Rechecked the previously reported SDK account: no deployed code at block 59773292.
- Reran all six existing offline open-source preparation tests under Node.js 22: passed. These include the independent upstream static replay-safe hash vector and invalid-input/wrapper tests.
- No account-specific prediction, gas estimate, owner-control proof or live EIP-1271 call was performed because the new public inputs and execution approvals are absent.

## Approval gates and next task

1. **Public-input preparation:** tester creates or selects a test-only EOA and explicitly chooses the new factory nonce. No secrets are provided. Prepare the read-only prediction and exact unsigned draft.
2. **Deployment review:** approve the public owner, confirmed address, factory/implementation, decoded zero-value call, fee payer and bounded test-ETH quote. Only then may a manual deployment transaction be requested.
3. **Signature review:** after deployment checks and the test-only owner adapter are reviewed, explicitly approve one fresh ownership signature and read-only real verification. This does not enable product account linking.

Next small task: obtain those public inputs and produce the read-only prediction/fee review sheet. The original SDK account remains blocked on its own supported provisioning and deployed-account verification. Do not guess its owners or nonce or silently replace it with this separate wallet.
