# Separate Coinbase test wallet: deployment review

Latest evidence: block 60175874, Wednesday, 18 November 2026 at 04:40:46 GMT+5:30. Use the final Current manual execution checklist section; earlier quotes are historical only.


Status: PREPARATION COMPLETE; FUNDING AND DEPLOYMENT NOT APPROVED. Latest review: see Approval checkpoint - 18 November 2026 below. Older quotes are historical only.

This is a separate EOA-owned Coinbase v1.1 contract wallet, not the original Coinbase SDK passkey account. No original-account compatibility is claimed. Public owner control has not yet been cryptographically proven.

## Read-only evidence

Inspected 2026-11-17T15:49:18.243Z on Base Sepolia, chain 84532.
Block: 60043439. Block hash: 0xf25d154d8be0f0b15e4ed8e7a8799933f6ba24f28f22dcecbe39e53a435f7510.

- Owner and intended transaction sender/payer: 0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b.
- Owner balance: 0 wei. Owner code: 0x. Transaction nonce at this block: 0.
- Factory: 0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842.
- Factory runtime keccak256: 0xb60a629aa7c6af9b550871fd21b67ab84638156683cec68491049cb5d235ed2f.
- Implementation returned by the factory: 0x00000110dCdEdC9581cb5eCB8467282f2926534d.
- Implementation runtime keccak256: 0x136185896fc519277ec953c0b3d048fc0c9f607b8d04022e60f23ef8dbc6c4d5.
- Both code hashes match the existing reviewed pins. Factory source reference: a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da.
- Predicted wallet: 0xE5b9A38c37acEE4E51920540bF7085352AF057C1. Code: 0x.

Factory getAddress(owners, 0) and local EIP-1014 CREATE2 calculation agree. Owners contains exactly one abi.encode(address), the supplied owner. Factory nonce 0 is an account-address input, separate from the sender's transaction nonce.

CREATE2 salt = keccak256(abi.encode(bytes[] owners, uint256(0))):
0xa7d934bc5106ff714890a26fe0f3999e29fb74558cd2a78fd365a7da569ee061

initCodeHash() returned by the hash-verified factory:
0xa53d9968113cdf38ec78edc985b30bcb1a274ddaa221624c1d15604f70b0761a

Local address = last 20 bytes of keccak256(0xff || factory || salt || initCodeHash). The initialization hash was read from the verified factory, not independently rebuilt from proxy bytecode.

## Exact unsigned transaction draft

Method: createAccount(bytes[] owners, uint256 nonce).
Zero value: 0 wei. No account funding, token transfers, approvals, delegation or trading permission requests are included. Expected effects are proxy creation, sole owner initialization and AccountCreated event. The owner can later exercise wallet owner/upgrade powers; this is not a passkey owner.

~~~json
{
  "type": "0x2",
  "chainId": "0x14a34",
  "from": "0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b",
  "to": "0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842",
  "nonce": "0x0",
  "value": "0x0",
  "data": "0x3ffba36f000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000200000000000000000000000008e4e1bb851b1c110f6b1d6a31f0f43c056efaa5b",
  "gas": "0x3a370",
  "maxFeePerGas": "0xa7d8c0",
  "maxPriorityFeePerGas": "0xf4240",
  "accessList": []
}
~~~

This is review data only, not a signed transaction or an executable approval. Recheck transaction nonce immediately before any approved execution.

## Gas and fee results

eth_estimateGas used the exact from/to/value/data at block 60043439, without a state override, alternative funded sender, or balance injection. It succeeded despite the zero balance. This does not imply the sender can pay or that submission would succeed.

| Item | Result |
| --- | --- |
| Estimated execution gas | 198,706 |
| Proposed gas limit, rounded up with 20% headroom | 238,448 |
| Block base fee | 5,000,000 wei/gas |
| RPC suggested priority fee | 1,000,000 wei/gas |
| RPC gas price | 6,000,000 wei/gas |
| Proposed max priority fee | 1,000,000 wei/gas |
| Proposed max fee, 2 x observed base fee + priority | 11,000,000 wei/gas |
| L2 execution estimate at observed gas price | 1,192,236,000,000 wei (0.000001192236 ETH) |
| L2 execution cap with proposed gas limit and max fee | 2,622,928,000,000 wei (0.000002622928 ETH) |
| GasPriceOracle L1 base fee | 13 wei |
| GasPriceOracle blob base fee | 1 wei |
| Signed transaction size upper envelope for this exact draft | 309 bytes |
| getL1FeeUpperBound(309), at the evidence block | 255 wei |
| getOperatorFee(198706) and getOperatorFee(238448) | 0 wei |

The oracle is 0x420000000000000000000000000000000000000F. Fee reads were pinned to the same evidence block. Base/priority RPC suggestions are observations, not inclusion guarantees. The 309-byte envelope was obtained by serializing the exact type-2 draft with full-width synthetic signature fields solely for size calculation. No cryptographic signing occurred; those synthetic bytes are not an authorized transaction and were not submitted or saved as a signed transaction.

Conditional budget = gasLimit x maxFeePerGas + 2 x observed L1 upper bound + observed operator fee:
2,622,928,000,510 wei = 0.00000262292800051 test ETH.

A rounded preparation recommendation is 0.000003 Base Sepolia test ETH in the OWNER address, conditional on fresh fee/estimate checks before funding approval and execution. This is for this deployment only, not future wallet operations, and excludes any funding sender's own transaction cost. No sponsorship is configured or assumed.

IMPORTANT: the L2 cap does not cap future L1 or operator charges. The conditional budget is not a guaranteed maximum total charge at a future block. Recompute all components before approval, and stop if the reviewed budget or fee parameters change. The owner currently cannot submit because it has zero ETH. Do not use mainnet ETH or fund the predicted wallet instead of the deployment payer.

## Required approval and execution checks

1. Review the sole owner, separate-wallet scope, factory nonce, predicted address and transaction above.
2. Obtain explicit approval before any test ETH funding. No faucet or transfer has been performed.
3. Refresh chain, runtime hashes, implementation, owner balance/code, sender nonce, predicted-address code, gas estimate and complete fees.
4. Obtain separate explicit approval before any signing or deployment submission. Confirm the wallet shows the exact Base Sepolia sender, factory, zero value and approved fee limits. Unexpected delegation, approvals or calls must stop the process.
5. After an approved deployment, verify receipt success, factory event, wallet code, ERC1967 implementation and sole owner. Obtain separate ownership-signature approval before EIP-1271 testing.

No signatures, transactions, UserOperations, funding, production changes, feature activation, commits or pushes occurred. No application code, migration or schema changed. Ownership verification and linking remain pending.

## Sources

- [Pinned Coinbase factory source](https://github.com/coinbase/smart-wallet/blob/a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da/src/CoinbaseSmartWalletFactory.sol)
- [Official Coinbase deployments](https://github.com/coinbase/smart-wallet#deployments)
- [Base fee components and GasPriceOracle methods](https://docs.base.org/specifications/transactions/network-fees)

## Funding preparation refresh - 17 November 2026

Approval scope: funding PREPARATION only. Funding execution, signing and deployment remain unapproved.

Read-only refresh at 2026-11-17T15:57:24.227Z (21:27:24 IST), Base Sepolia 84532, block 60045862, hash 0xadc195a8f65f6b82a4549484647a1768d47666748aabbd570ce7938b2aafa5bd.

- Confirmed recipient / deployment payer: 0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b.
- Balance: 0 wei; code: 0x; transaction nonce: 0.
- Factory and implementation hashes still match the reviewed pins.
- Factory getAddress and local CREATE2 still agree on 0xE5b9A38c37acEE4E51920540bF7085352AF057C1; this wallet remains undeployed.
- Exact reviewed calldata still encodes one supplied owner and factory nonce 0; deployment value remains zero.
- eth_estimateGas: 198706; proposed 20% headroom gas limit: 238448.
- Observed base fee: 5000000 wei/gas; suggested priority fee: 1000000 wei/gas. Proposed max fee: 11000000 wei/gas. Separately sampled RPC gas price: 6012532 wei/gas.
- Oracle L1 base fee: 13 wei; blob base fee: 1 wei. L1 upper estimate for the 309-byte signed-size envelope: 255 wei. Operator fee at the proposed gas limit: 0 wei.
- Conditional budget: 2622928000510 wei = 0.00000262292800051 ETH.
- Proposed funding: 3000000000000 wei = 0.000003 ETH.
- Remaining headroom: 377071999490 wei = 0.00000037707199949 ETH.

The proposed amount is sufficient at these observed parameters. It is not a guarantee at a future block: L1/operator charges can change and are outside the L2 fee cap. Refresh fees immediately before execution; stop if the reviewed budget exceeds the available balance. A funding transaction's sender pays its own separate network fee.

### Manual funding instructions - do not execute yet

Preferred source: the Coinbase Developer Platform faucet linked by [Base's official Get Funds guide](https://docs.base.org/get-started/get-funds). Open the [CDP faucet](https://portal.cdp.coinbase.com/products/faucet) and sign in to the existing developer account. Do not create a server-controlled wallet, supply wallet secrets, or use a mainnet withdrawal/bridge.

1. Choose Base Sepolia, chain ID 84532, and ETH (test ETH).
2. Enter the OWNER recipient exactly: 0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b. Do not use the predicted smart-wallet address or original Coinbase SDK address.
3. If the faucet permits a custom amount, prepare 0.000003 ETH. If the amount is fixed, record the offered amount and obtain separate approval for that exact amount before claiming. Base documents a faucet limit, not a guaranteed selectable payout. No claim amount or availability was verified behind the login page.
4. Stop before clicking any final claim/send/request-funds button. Funding execution has not been approved. Never approve a wallet signature, token permission or transaction as part of this preparation.
5. After explicit funding approval and a manual claim, retain the public transaction hash. Verify success and recipient on Base Sepolia BaseScan and re-read the owner's balance through the chain-ID-checked RPC. Faucet request acceptance alone is not funding confirmation.
6. Deployment still needs its own approval after fresh preflight and fee review. Receiving test ETH does not deploy the wallet or verify its ownership.

Alternative: a tester-controlled EOA already funded with Base Sepolia test ETH may manually send exactly 0.000003 ETH to the owner after separate approval. Confirm chain 84532, recipient, amount and sender's fee before signing. This alternative requires a real testnet transaction and therefore must not be initiated during preparation. The undeployed original Coinbase SDK account is not assumed able to send its balance.

No faucet was claimed, no funds moved, no signatures requested, and no deployment, transaction, UserOperation, production change, commit or push occurred.

## Approval checkpoint - 18 November 2026

This latest review supersedes earlier fee quotes. Only preparation is authorized. Separate test wallet only; the original Coinbase SDK passkey account remains out of scope.

Evidence time: 2026-11-17T19:15:15.388Z (Wednesday, 18 November 2026 at 00:45:15 GMT+5:30). Block 60105221; hash 0xcb1c5565629feb57e4f2087f8dce878da76720e1b8705a013f41e0efdb42604e. Full public evidence and exact unsigned transaction: [COINBASE_TEST_WALLET_APPROVAL_EVIDENCE.json](COINBASE_TEST_WALLET_APPROVAL_EVIDENCE.json).

### Identity and calldata

- Network: Base Sepolia 84532.
- Sole proposed owner and intended deployment payer: 0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b. Code: 0x; balance 0 wei. Supplied by the tester; signing control is not yet proven.
- Factory 0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842; runtime hash 0xb60a629aa7c6af9b550871fd21b67ab84638156683cec68491049cb5d235ed2f, matching the reviewed pin.
- Factory implementation 0x00000110dCdEdC9581cb5eCB8467282f2926534d; runtime hash 0x136185896fc519277ec953c0b3d048fc0c9f607b8d04022e60f23ef8dbc6c4d5, matching the reviewed pin and official deployment listing.
- Factory nonce 0; owner transaction nonce 0; pending nonce 0. These are distinct nonce concepts.
- Predicted wallet 0xE5b9A38c37acEE4E51920540bF7085352AF057C1: code 0x; not deployed. Factory getAddress and local CREATE2 agree. The CREATE2 calculation uses initCodeHash from the hash-verified factory, not a separately rebuilt proxy.
- Decoded method: createAccount(bytes[] owners, uint256 nonce). Owners is a single abi.encode(address): 0x0000000000000000000000008e4e1bb851b1c110f6b1d6a31f0f43c056efaa5b. Factory nonce 0.
- Value is exactly 0 wei. Calldata keccak256: 0xf15b0b3ce14d778bfe9d3333779c431bb3deb4659b670a8c773143a141fa2b89. It exactly matches the previously reviewed call. No extra calls, approvals, delegation or asset transfer.
- Non-persistent eth_call of this exact createAccount call returned 0xE5b9A38c37acEE4E51920540bF7085352AF057C1. This simulates creation/initialization without persisting code or creating a transaction. It does not prove the owner can pay or sign.

### Refreshed fee review

| Item | Value |
| --- | --- |
| eth_estimateGas, intended owner sender, no state override | 198706 gas |
| Proposed gas limit, 20% rounded-up headroom | 238448 gas |
| Base fee | 5000000 wei/gas |
| Suggested priority fee | 1000000 wei/gas |
| Proposed max fee per gas | 11000000 wei/gas |
| L2 fee cap: gas limit x max fee | 2622928000000 wei |
| L1 fee upper estimate at this block, 309 byte envelope | 638 wei |
| Operator fee at proposed gas limit | 0 wei |
| Conditional total budget: L2 cap + twice L1 upper estimate + operator fee | 2622928001276 wei = 0.000002622928001276 ETH |
| Proposed owner funding | 0.000003 Base Sepolia test ETH |
| Headroom after proposed funding | 0.000000377071998724 ETH |

The gas estimate succeeded with zero owner balance. This is not a submission or affordability test. There is no paymaster or sponsorship: the intended owner pays gas directly. The signed-size envelope uses synthetic full-width signature fields solely for size estimation; no signing occurred and no synthetic signed transaction is included in the evidence file.

There is no guaranteed maximum future total charge: the L2 execution cap is bounded by the signed limits, but L1/operator fees vary separately. The displayed total is a conservative budget under observed parameters. Refresh the full estimate immediately before signing; stop for a revised review if this budget, calldata, sender, chain, nonce, code or identity checks change. An included reverted transaction can still spend gas.

### Manual funding and deployment instructions

1. FUNDING CHECKPOINT: owner is still unfunded. Obtain separate approval for the exact source, recipient, amount and network. Use free Base Sepolia test ETH only. A faucet may pay a fixed amount; review that amount before claiming. The original Coinbase account balance is unrelated and is not assumed spendable. Do not bridge or buy real ETH.
2. Recipient for funding is 0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b, not 0xE5b9A38c37acEE4E51920540bF7085352AF057C1. Proposed receipt is 0.000003 test ETH; any transfer sender pays its own fee separately. Do not claim or transfer under this preparation approval. The CDP portal link previously returned 404 for the tester. Use a functioning source linked from Base's official Get Funds guide; no faucet eligibility or availability is guaranteed.
3. After separately approved funding, verify the receipt, network and owner balance by read-only RPC. Re-run the deployment preflight with current confirmed/pending nonce and current fee components.
4. DEPLOYMENT CHECKPOINT: obtain explicit approval for the one createAccount call in the evidence file. The wallet to connect for this separate test is the owner EOA, not the original Coinbase passkey account.
5. Use a reviewed manual contract-call interface. If using Base Sepolia BaseScan's factory Write Contract page, first confirm its verified ABI/source and exact factory address. Select createAccount, enter the one encoded owners element shown above and nonce 0; payable value must be 0. If verified write support is unavailable, stop and prepare a reviewed local manual interface; do not use an unreviewed third-party deployment site or paste signing code into a console. No submit interface was built or executed here.
6. A connection/network-switch prompt must refer only to the selected owner and Base Sepolia 84532. A separate final transaction confirmation must show sender 0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b, destination 0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842, zero ETH value, reviewed calldata and fee limits. Some wallets do not decode owners; compare raw calldata hash locally with the evidence rather than guessing.
7. Reject any mainnet request, EIP-7702 upgrade/delegation, token approval, spending permission, additional owner, replacement address, unexpected batch, unlimited fee or UserOperation. Direct factory deployment does not require those. Wallet default gas settings must be reviewed, not assumed equal to this sheet.
8. Do not send ETH through a plain Send screen to the factory or wallet. This is a zero-value method call with calldata, not an ETH transfer. No transaction may be signed or sent until separate deployment approval.

### Post-deployment checks, after future approval only

- Receipt status must be success; transaction chain, sender, factory, value and calldata must match this approval. Retain the public transaction hash.
- Require a new AccountCreated event from the reviewed factory naming 0xE5b9A38c37acEE4E51920540bF7085352AF057C1, exact owners and nonce 0. An already-existing account or absent event requires a separate review.
- Read nonempty code at that exact wallet and verify its ERC1967 implementation slot 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc points to 0x00000110dCdEdC9581cb5eCB8467282f2926534d. Recheck implementation code hash.
- Verify ownerAtIndex(0) equals the encoded owner, isOwnerAddress(owner) is true, nextOwnerIndex is 1 and removedOwnersCount is 0. Verify no unexpected owners/upgrade evidence and expected domain information.
- Verify receipt block hash remains canonical and wait for the agreed testnet confirmation policy before ownership testing. RPC success or a submitted hash alone is not confirmation or finality. No production finality policy is approved here.
- Record actual gasUsed, effectiveGasPrice and available L1/operator receipt fields. Reconcile actual test ETH spent. Deployment does not itself link any KhmerFP account or grant trading permissions.

### Subsequent real EIP-1271 test plan

This is a separate EOA-owned Coinbase contract test, not original SDK passkey verification. The existing isolated browser harness is wired to the Coinbase SDK account and exact ownership payload. It cannot silently connect an EOA in place of the smart wallet. A separately reviewed, test-only owner-signing adapter is a prerequisite; do not bypass its wallet guard or production wallet-type policy. No adapter is implemented by this documentation task.

1. Verify deployed wallet/implementation/sole owner as above. Obtain separate approval for an ownership signature. Never request a private key or seed phrase.
2. Generate a fresh isolated KhmerFP WalletLink EIP-712 challenge for the SMART WALLET address, Base Sepolia, reviewed local application origin, synthetic user/session binding, fresh nonce and short expiry. Do not reuse a stored challenge.
3. Hash the exact original challenge. Build Coinbase's replay-safe typed message CoinbaseSmartWalletMessage(bytes32 hash), with domain name Coinbase Smart Wallet, version 1, chain 84532, verifyingContract 0xE5b9A38c37acEE4E51920540bF7085352AF057C1. The owner EOA must explicitly approve signing this outer typed message via the reviewed test adapter. No transaction is needed.
4. Wrap the owner's signature using abi.encode(tuple(uint256 ownerIndex, bytes signatureData)) with ownerIndex 0. Use the existing reviewed replaySafeOwnershipData and wrapEoaOwnerSignature helpers; do not double-wrap or sign a modified challenge.
5. At a stable block, call wallet.isValidSignature(ORIGINAL_CHALLENGE_DIGEST, WRAPPED_SIGNATURE) using eth_call. Require exactly 0x1626ba7e, then recheck block hash. EIP-1271 is read-only and does not consume an application challenge. Do not log/persist raw signatures.
6. Negative tests: altered challenge, wrong wallet/domain/chain, wrong owner/invalid signature, expired challenge and undeployed wallet. Expiry, session binding and one-use replay rejection belong to the harness/application; the wallet contract alone does not reject reusing the same valid digest.
7. The isolated harness uses synthetic context and no database link. Successful cryptographic testing does not prove authenticated account persistence, unlink/relink, or the original SDK account. Any later application/database test requires its own approved disposable environment and provider provenance review; never label this EOA-owned test wallet as a verified SDK passkey account.

### Approval requested; nothing executed

- Funding approval must identify the exact test-only source and actual offered amount for 0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b on Base Sepolia. No claim or transfer is approved here.
- Deployment approval must separately cover the zero-value factory call, sole owner, nonce 0, predicted wallet, refreshed transaction nonce, gas limit and fees. It remains blocked until the owner is funded and the manual interface is reviewed.
- Ownership-signature approval is separate again, after deployment checks and test adapter review.

No funds moved; no wallet connection, signing, transaction, UserOperation or deployment was requested. Production remains disabled. No application source, migration, dependency, commit or push changed.

## Current manual execution checklist - block 60175874

Reviewed Wednesday, 18 November 2026 at 04:40:46 GMT+5:30; RPC timestamp 2026-11-17T23:10:46.988Z. Only this separate EOA-owned wallet is covered, not the original Coinbase SDK passkey account. This is preparation, not execution approval.

### Fresh public evidence and exact unsigned transaction

~~~json
{
  "checkedAt": "2026-11-17T23:10:46.988Z",
  "chainId": 84532,
  "block": 60175874,
  "blockHash": "0xc644f5db1fbce7bafc35feb0a2e243e54c628c2eb4c87489682c24fa25f8e56a",
  "owner": "0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b",
  "ownerCode": "0x",
  "ownerBalanceWei": "0",
  "wallet": "0xE5b9A38c37acEE4E51920540bF7085352AF057C1",
  "walletCode": "0x",
  "factory": "0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842",
  "factoryCodeHash": "0xb60a629aa7c6af9b550871fd21b67ab84638156683cec68491049cb5d235ed2f",
  "implementation": "0x00000110dCdEdC9581cb5eCB8467282f2926534d",
  "implementationCodeHash": "0x136185896fc519277ec953c0b3d048fc0c9f607b8d04022e60f23ef8dbc6c4d5",
  "factoryNonce": "0",
  "transactionNonce": "0",
  "pendingNonce": "0",
  "encodedOwner": "0x0000000000000000000000008e4e1bb851b1c110f6b1d6a31f0f43c056efaa5b",
  "initCodeHash": "0xa53d9968113cdf38ec78edc985b30bcb1a274ddaa221624c1d15604f70b0761a",
  "salt": "0xa7d934bc5106ff714890a26fe0f3999e29fb74558cd2a78fd365a7da569ee061",
  "calldataHash": "0xf15b0b3ce14d778bfe9d3333779c431bb3deb4659b670a8c773143a141fa2b89",
  "estimateGas": "198706",
  "estimateError": null,
  "baseFeePerGasWei": "5000000",
  "priorityFeePerGasWei": "1000000",
  "maxFeePerGasWei": "11000000",
  "unsignedTransaction": {
    "type": "0x2",
    "chainId": "0x14a34",
    "nonce": "0x0",
    "from": "0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b",
    "to": "0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842",
    "value": "0x0",
    "data": "0x3ffba36f000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000200000000000000000000000008e4e1bb851b1c110f6b1d6a31f0f43c056efaa5b",
    "gas": "0x3a370",
    "maxFeePerGas": "0xa7d8c0",
    "maxPriorityFeePerGas": "0xf4240",
    "accessList": []
  },
  "submissionEnabled": false,
  "gasLimit": "238448",
  "signedSizeUpperBytes": 309,
  "l1FeeUpperBoundWei": "474",
  "operatorFeeWei": "0",
  "l2ExecutionCapWei": "2622928000000",
  "conditionalBudgetWei": "2622928000948",
  "conditionalBudgetETH": "0.000002622928000948",
  "recommendedOwnerBalanceETH": "0.000003",
  "additionalFundingRequiredETH": "0.000003"
}
~~~

Chain 84532, both pinned code hashes, implementation() and both factory/local CREATE2 predictions were checked at the stated block. The local CREATE2 formula uses initCodeHash() read from the hash-verified factory. The encoded call has exactly one owner, factory nonce 0 and zero ETH value, and matches the previously reviewed calldata byte-for-byte. No signature was generated. Synthetic fixed-width signature bytes were used only to calculate the serialized size for the fee oracle; they were not submitted or saved as a signed transaction.

### Fee and funding decision

Execution estimate: 198706 gas. Proposed gas limit: 238448, with 20% rounded-up headroom. Max fee: 11000000 wei/gas; priority cap: 1000000 wei/gas. L2 cap: 2622928000000 wei. Current L1 size-based upper estimate: 474 wei. Operator fee at the proposed gas limit: 0 wei.

Conditional budget = L2 cap + twice the current L1 upper estimate + operator fee = 0.000002622928000948 test ETH. Recommended owner balance, rounded up to the next 0.000001 ETH: 0.000003 test ETH. Additional funding required at this snapshot: 0.000003 test ETH. Existing owner balance: 0.0 ETH. No sponsorship is assumed.

The safety margin covers a higher execution gas limit, max fee set to twice the observed base fee plus tip, twice the current L1 upper estimate and rounded funding headroom. This is not a guaranteed future total maximum: L1/operator parameters vary independently of the L2 signed fee cap. Recheck all components before funding/deployment approval. A changed quote, code, nonce or calldata requires review again. An included reverted transaction can still consume gas.

### Manual funding steps - require separate approval

1. Recipient is the EOA OWNER 0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b. Do not fund the predicted wallet 0xE5b9A38c37acEE4E51920540bF7085352AF057C1 for this direct deployment, and do not substitute the original SDK account.
2. Use free Base Sepolia ETH only, chain ID 84532. Choose a faucet linked from https://docs.base.org/get-started/get-funds or an already-funded tester-controlled EOA. Do not use mainnet, paid bridging, or a public Hardhat private key. The CDP portal previously returned 404 for this tester; do not assume that link now works.
3. Prepare the additional amount above. If a faucet has a fixed payout, record that actual amount and obtain separate approval before claiming; do not assume it accepts an exact custom amount. Stop before Claim/Send. Never share a private key or recovery phrase.
4. After separately approved manual funding, verify a successful Base Sepolia receipt and this exact owner's current balance using read-only RPC. A faucet success message alone is insufficient. A funding sender pays a separate fee.

### Manual deployment through a trusted wallet - separate approval

1. This operation requires the owner EOA's trusted wallet. It is NOT sent through the original Coinbase passkey account or the production KhmerFP wallet page. Confirm the selected checksum owner and Base Sepolia. Refresh pending nonce, factory/implementation identities, target code, gas and total fee budget.
2. Review the JSON call above with the user. Before signing, obtain explicit approval for this chain, sender, sole owner, factory nonce 0, predicted wallet, destination, zero value and current fee limits. No operation is approved by this checklist.
3. A manual option is the official explorer factory contract page https://sepolia.basescan.org/address/0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842#writeContract. Only use Write Contract after independently confirming its verified source/ABI matches the reviewed factory. If that interface is unavailable or unverified, stop; a reviewed local manual-submit interface is needed first. No submit interface is implemented by this documentation task.
4. Select createAccount(bytes[] owners,uint256 nonce). The owners array has ONE bytes element: 0x0000000000000000000000008e4e1bb851b1c110f6b1d6a31f0f43c056efaa5b. Enter factory nonce 0, payable ETH value 0. Do not confuse this factory nonce with the owner's current transaction nonce. Connect the owner wallet and review the proposed method call. A plain wallet Send ETH transfer is not equivalent.
5. The final wallet confirmation must show sender 0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b, destination 0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842, chain 84532, value zero and the exact reviewed calldata. Compare the raw data if owners are not decoded. Verify gas limit and max-fee/priority-fee settings. Wallet defaults are not automatically approved.
6. Reject unexpected delegation/upgrade prompts, token approvals, spending permissions, extra owners/calls, mainnet, UserOperations or replacement addresses. Direct factory createAccount requires none of those.
7. Only after explicit deployment signing/broadcast approval may the tester manually confirm. Retain the public transaction hash. Do not treat submission as successful deployment.

### Post-deployment verification - only after approved execution

- Require a successful receipt on chain 84532 and confirm transaction from/to/value/calldata. Check the canonical receipt block hash and the agreed testnet confirmation policy; no production finality policy is implied.
- Require the factory's AccountCreated event for 0xE5b9A38c37acEE4E51920540bF7085352AF057C1, exact owner bytes and nonce 0 for a fresh deployment. If it already exists, stop and inspect rather than calling it newly deployed.
- Read code at 0xE5b9A38c37acEE4E51920540bF7085352AF057C1; it must be nonempty. Verify the ERC1967 implementation slot 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc points to 0x00000110dCdEdC9581cb5eCB8467282f2926534d, whose code hash must match the approved implementation.
- Verify ownerAtIndex(0) equals the encoded EOA, isOwnerAddress(0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b) is true, nextOwnerIndex() is 1 and removedOwnersCount() is 0. Check domain/control configuration and absence of unexpected owner/upgrade events.
- Record actual gasUsed, effectiveGasPrice and available L1/operator receipt fees. Reconcile actual test ETH cost. No token approvals, exchange access or linked KhmerFP user is created by this deployment.
- Code/owner reads do not prove EIP-1271 signature compatibility. First obtain SEPARATE ownership-signature approval and review a test-only EOA-owner adapter. The existing Coinbase SDK passkey harness cannot silently be used as that adapter.
- Prepare a fresh original KhmerFP ownership digest for THIS smart-wallet address. The EOA signs CoinbaseSmartWalletMessage(bytes32 hash) using the Coinbase Smart Wallet replay-safe domain (version 1, chain 84532, verifyingContract this wallet). ABI-wrap the actual owner signature with ownerIndex 0 using the reviewed helper. Call isValidSignature(original ownership digest, wrapped signature) via eth_call; require 0x1626ba7e at a stable block. Do not double-wrap or guess another account's signature format.
- Negative checks must reject altered digest, wrong owner, wrong domain/wallet/chain and invalid signature. Challenge expiry/session binding and replay consumption are application checks, not automatic EIP-1271 features. Test them separately in an approved disposable linking environment. Do not log raw signatures or session credentials.

### Stop point and exact next approval

Next action requiring approval: a MANUAL test-only funding receipt to 0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b on Base Sepolia for 0.000003 ETH, from a specified test source. A fixed faucet amount needs its own exact-amount approval. Funding is not deployment approval.

No funding, signing, broadcast, deployment, public-chain mutation, production service change, feature activation, commit or push occurred. Only this review document was updated; unrelated local work is preserved.

## Funded owner: final approval review - block 60193423

This is the newest snapshot; it supersedes previous quotes and the earlier zero-balance finding.

~~~json
{
  "checkedAt": "2026-11-18T00:09:16.679Z",
  "block": 60193423,
  "blockHash": "0x552bf4c4fc1417fa59e61bbf06a63ff6dd38e7439d2b5e1a52bae8c1e69d8c9b",
  "owner": "0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b",
  "balanceETH": "0.0001",
  "wallet": "0xE5b9A38c37acEE4E51920540bF7085352AF057C1",
  "factory": "0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842",
  "implementation": "0x00000110dCdEdC9581cb5eCB8467282f2926534d",
  "identitiesMatch": true,
  "estimatedGas": "198706",
  "gasLimit": "238448",
  "maxFeePerGasWei": "11000000",
  "maxPriorityFeePerGasWei": "1000000",
  "l1FeeUpperBoundWei": "659",
  "operatorFeeWei": "0",
  "l2ExecutionCapETH": "0.000002622928",
  "conditionalBudgetETH": "0.000002622928001318",
  "calldataHash": "0xf15b0b3ce14d778bfe9d3333779c431bb3deb4659b670a8c773143a141fa2b89",
  "unsignedTransaction": {
    "type": "0x2",
    "chainId": "0x14a34",
    "nonce": "0x0",
    "from": "0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b",
    "to": "0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842",
    "value": "0x0",
    "data": "0x3ffba36f000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000200000000000000000000000008e4e1bb851b1c110f6b1d6a31f0f43c056efaa5b",
    "gas": "0x3a370",
    "maxFeePerGas": "0xa7d8c0",
    "maxPriorityFeePerGas": "0xf4240",
    "accessList": []
  },
  "signingApproved": false,
  "submissionApproved": false
}
~~~

The owner is now funded and the separate predicted wallet remains undeployed. Factory and implementation identities, exact calldata and both address predictions match. The operation only creates and initializes a Coinbase proxy with this sole EOA owner and factory nonce 0, with zero ETH value. It does not deploy the original passkey account, approve tokens or grant trading permissions.

The budget is gas limit x max fee plus twice the current L1 upper estimate plus operator fee. It is not a guaranteed future total cap; L1/operator fees can vary. Refresh immediately before any separately approved execution, and stop for review if fee settings, budget, nonce, code, address or calldata changes. No further funding is required at this snapshot.

Await explicit approval for MANUAL signing and broadcasting of this single Base Sepolia createAccount call after confirming the trusted submission interface. Do not interpret the preceding review approval as signing approval. Future ownership signing requires separate approval after receipt, code, implementation and owner checks. No signing or submission occurred.

## Manual signing-stage preflight - block 60194260

The tester approved proceeding to manual signing-stage review. No automatic broadcast is authorized.

~~~json
{
  "checkedAt": "2026-11-18T00:12:04.576Z",
  "block": 60194260,
  "blockHash": "0x0878bbdd66bc1be9702eaeea902ccb14a077e5e0044c27daa2a5cb7be6038449",
  "ownerBalanceETH": "0.0001",
  "predictedWallet": "0xE5b9A38c37acEE4E51920540bF7085352AF057C1",
  "checks": "factory, implementation, chain, code, nonce, calldata and prediction match",
  "estimatedGas": "198706",
  "gasLimit": "238448",
  "maxFeePerGasGwei": "0.011",
  "priorityFeePerGasGwei": "0.001",
  "l1FeeUpperBoundWei": "469",
  "operatorFeeWei": "0",
  "l2ExecutionCapETH": "0.000002622928",
  "conditionalBudgetETH": "0.000002622928000938",
  "calldataHash": "0xf15b0b3ce14d778bfe9d3333779c431bb3deb4659b670a8c773143a141fa2b89",
  "encodedOwner": "0x0000000000000000000000008e4e1bb851b1c110f6b1d6a31f0f43c056efaa5b",
  "unsignedTransaction": {
    "type": "0x2",
    "chainId": "0x14a34",
    "nonce": "0x0",
    "from": "0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b",
    "to": "0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842",
    "value": "0x0",
    "data": "0x3ffba36f000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000200000000000000000000000008e4e1bb851b1c110f6b1d6a31f0f43c056efaa5b",
    "gas": "0x3a370",
    "maxFeePerGas": "0xa7d8c0",
    "maxPriorityFeePerGas": "0xf4240",
    "accessList": []
  },
  "manualStageApproved": true,
  "automaticBroadcastAllowed": false,
  "metamaskAccountConfirmed": false,
  "signatureRequested": false,
  "transactionSubmitted": false
}
~~~

Public-chain checks match the reviewed transaction. Current L1 fee estimates fluctuate and are presented for fresh review, not silently treated as a fixed future maximum. No final transaction was sent to a wallet or signed. MetaMask-selected account access has NOT been confirmed because this agent cannot inspect the tester's browser/provider. The supplied public address and its balance alone do not prove control. Next: the tester must connect the trusted wallet to a verified manual contract-call interface, confirm selected account 0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b, chain 84532 and exact call details before clicking any write/confirm action. The explorer Write Contract page could not be loaded by this agent's web tool; its current UI/verified ABI must be checked manually rather than claimed verified here. Stop on any mismatch.

Full unsigned review: COINBASE_TEST_WALLET_MANUAL_TRANSACTION.json. The transaction has value zero and creates only the separately reviewed wallet, not the original SDK passkey account. After manual submission, obtain the public hash and independently verify receipt, canonical block, proxy implementation and sole owner before a separately approved real ownership signature test.
