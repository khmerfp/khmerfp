# Coinbase open-source wallet evaluation

Stage 4.3R — 17 November 2026. Research and offline preparation only.

## Decision

The existing SDK wallet remains **BLOCKED** for deployment preparation. A separate wallet created through Coinbase's official factory is a practical, narrower route to real deployed-contract EIP-1271 testing after approval. Nothing was deployed or signed in this stage.

The separate wallet would test Coinbase's contract signature-validation logic with a known address owner. It would **not** verify the existing SDK universal account, Coinbase's hosted passkey flow, production account linking, or exchange compatibility.

## Sources and deployment evidence

Reviewed upstream commit: `a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da`.

- [CoinbaseSmartWallet.sol](https://github.com/coinbase/smart-wallet/blob/a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da/src/CoinbaseSmartWallet.sol): owner signature decoding and wallet execution.
- [CoinbaseSmartWalletFactory.sol](https://github.com/coinbase/smart-wallet/blob/a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da/src/CoinbaseSmartWalletFactory.sol): deterministic proxy creation and initialization.
- [ERC1271.sol](https://github.com/coinbase/smart-wallet/blob/a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da/src/ERC1271.sol): replay-safe signature validation.
- [MultiOwnable.sol](https://github.com/coinbase/smart-wallet/blob/a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da/src/MultiOwnable.sol): address and passkey owners.
- [Official deployments](https://github.com/coinbase/smart-wallet/blob/a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da/README.md) and [independent signature hash vector](https://github.com/coinbase/smart-wallet/blob/a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da/test/ERC1271.t.sol).

The Solidity source carries MIT notices. No upstream contracts or new dependencies were installed or copied into the application.

Previously captured Base Sepolia evidence identifies these v1.1 contracts:

| Object | Address |
| --- | --- |
| Factory | `0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842` |
| Implementation | `0x00000110dCdEdC9581cb5eCB8467282f2926534d` |

At block 59739120, the recorded factory runtime hash was `0xb60a629aa7c6af9b550871fd21b67ab84638156683cec68491049cb5d235ed2f`; implementation runtime hash was `0x136185896fc519277ec953c0b3d048fc0c9f607b8d04022e60f23ef8dbc6c4d5`. See `COINBASE_TESTER_WALLET_INSPECTION.md` and the public contract fixture under `tools/coinbase-deployment/fixtures/`. These are historical observations, not a fresh deployment approval. Recheck chain, code and factory implementation before execution. The reviewed upstream commit is source evidence; it does not by itself prove deployed bytecode equivalence.

## Two different goals

| Approach | Required inputs | What it proves | Current limit |
| --- | --- | --- | --- |
| Existing SDK account `0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC` | Supported account-specific SDK provisioning and fee evidence | Actual Coinbase SDK account integration | No code in recorded inspection; owners, nonce and exact first-use mechanism unverified |
| Separate official wallet with one known address owner | Approved public owner address and deliberately selected nonce | Official deployed wallet's address-owner EIP-1271 path | Requires later deployment and manual owner signature; does not test hosted passkeys |
| Separate wallet with a new passkey owner | Verified P-256 public key, credential handling and signing adapter | Official wallet's WebAuthn owner branch | More integration work; not the SDK's existing credential or universal account |

The factory cannot recover hidden initialization metadata. Its address calculation uses the encoded owner list and nonce. Guessing these cannot safely reproduce the existing SDK address. Empty account code also does not establish which provisioning model the SDK intends to use. Capability flags are not deployment or sponsorship guarantees.

## Separate test wallet plan

1. Obtain an approved tester-controlled public EOA address. Do not request or store its private key. Use a separate test account with no real assets.
2. Deliberately choose and record a factory nonce for this new wallet. This is a new test configuration, not a guess about the SDK wallet. Encode the single owner as `abi.encode(address)`.
3. Recheck Base Sepolia chain ID 84532, official factory code and implementation. Read `getAddress(owners, nonce)` at a recorded block. With ethers use `factory.getFunction('getAddress')(owners, nonce)` to avoid confusing the ABI function with Contract.getAddress().
4. Record the predicted address; reject substitution of the existing SDK account. Check whether code already exists there. If it does, stop and inspect its implementation and owners before reuse.
5. Prepare an unsigned, zero-value `createAccount(owners, nonce)` transaction to the existing factory. Review the full decoded call and account initialization. This creates an account with powerful owner permissions; it is not merely an empty self-call.
6. Obtain an account-specific gas estimate and fee quote, including Base transaction fee components, from a reviewed tool. This stage has no numeric quote. The fee payer needs Base Sepolia test ETH unless an explicitly reviewed sponsor pays. A direct factory transaction does not require an EntryPoint, bundler or paymaster.
7. Request separate approval before opening any transaction authorization. After approval only, the tester manually authorizes the factory transaction in their wallet. No submission path is provided by the new offline helper.
8. Verify the receipt, factory account-creation evidence, predicted address, nonempty code, proxy implementation and `ownerAtIndex(0)` against the planned owner bytes. Check Base Sepolia BaseScan and read-only RPC. Do not send funds to the implementation contract.

Factory creation is permissionless. The transaction sender need not be the owner; the explicit owner list controls the account. For the simplest test, use the approved owner EOA as fee payer. Deployment and initialization are atomic. Repeating creation for the same inputs does not provide authority to reinitialize the account. Address owners are individually powerful, not a multisig threshold: never add a backend or recovery owner silently.

## EIP-1271 verification and harness integration

The contract supports EIP-1271 by source inspection. Actual verification of a separately deployed wallet remains unexecuted.

For its address-owner path, Coinbase expects a replay-safe signature, not a raw signature of the inner KhmerFP digest:

1. Create a fresh KhmerFP ownership challenge using the existing shared protocol. Validate user/session binding, intended action, wallet, chain and expiry.
2. Compute its original EIP-712 digest.
3. Prepare Coinbase outer typed data with domain name `Coinbase Smart Wallet`, version `1`, chain ID 84532 and verifyingContract equal to the separate wallet. Its primary type is `CoinbaseSmartWalletMessage(bytes32 hash)`, containing the original digest.
4. After separate signing approval, have the known owner manually sign that outer typed data. Show the full inner challenge and digest before approval; a wallet popup showing only the outer hash is insufficient context.
5. ABI-encode the returned owner signature as `tuple(uint256 ownerIndex, bytes signatureData)`. Index zero follows from this explicitly defined single-owner initialization; it is not assumed for the existing SDK account.
6. Call `isValidSignature(originalKhmerfpDigest, wrappedSignature)` through read-only eth_call. Require exactly `0x1626ba7e`. Passing the outer digest instead would wrap twice and be incorrect.
7. Reject changed messages, wrong wallet/chain, expired challenges, malformed signatures and EIP-6492 signatures. Do not persist raw signatures.

Reuse the isolated harness's challenge and verifier core. Its current browser adapter deliberately requires the Coinbase SDK account. Merely changing its configured address will not connect the separate factory wallet. A future explicitly labelled test-only owner adapter is required; preserve the Coinbase browser guard and production authentication. No such live adapter or signing request was added here.

An EOA-owned Coinbase contract is still a smart wallet, but this test exercises its address-owner branch. It does not establish P-256 passkey support end to end, SDK account ownership, on-chain trading authorization or permission to spend tokens.

## Offline preparation and test evidence

`tools/coinbase-open-source/review.js` only builds review data: explicit owner/nonce factory calldata, replay-safe typed data and an owner-signature wrapper. It has no provider, connection, signing or submission method. Its address-separation check does not prove CREATE2 prediction or owner control.

Six offline tests cover:

- Exact factory calldata from explicit public inputs.
- Missing, invalid or overflowing nonce, wrong chain, zero owner and unexpected fields.
- Rejection of existing-account substitution.
- Replay-safe hashing against the pinned upstream independent static vector.
- Wallet/message binding and invalid digest rejection.
- Signature tuple encoding using fake bytes, without generating a signature.

Run from the worktree:

```powershell
npx.cmd --yes --package=node@22 node --test tools/coinbase-open-source/review.test.js
```

All six passed. These are encoding and hashing tests, not deployed-contract or real signature verification. Existing isolated harness regressions are reported separately in the task completion report.

## Approval and remaining blockers

Recommended next step: approve the separate address-owner test scope, supply only a public owner address, and choose an explicit new-wallet nonce. Then prepare a read-only prediction and reviewed gas quote. Deployment still requires a separate transaction approval; ownership signing requires another explicit manual approval after deployment checks.

The unresolved SDK/CDP dependency risks documented in `DEPENDENCY_SECURITY_REVIEW.md` remain. This research does not clear production release blockers or activate wallet linking. If the required result is specifically the existing Coinbase SDK passkey account, continue the supported SDK provisioning investigation or provide an already-deployed SDK-controlled account; the separate wallet cannot replace that evidence.
