# Real Coinbase test wallet: deployment verification and EIP-1271 plan

Date: 18 November 2026. Separate wallet only: 0xE5b9A38c37acEE4E51920540bF7085352AF057C1.
Expected registered owner: 0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b.

## Result and stop point

Deployment receipt, Coinbase implementation and sole registered owner checks PASSED. Real positive ownership-signature verification has NOT passed because no new signature was requested.

IMPORTANT: execution differed from the reviewed plain-owner direct type-2 factory call. The actual transaction is type 4, submitted by a relayer to a different outer destination, and introduced EIP-7702 delegation on the owner address. Stop before any ownership signing, additional transaction, revocation or feature activation until that changed owner execution model is reviewed. This report does not treat the deviation as approved, and it does not claim the owner is compromised.

The original SDK passkey account 0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC is not this wallet and is not verified by these results.

## Transaction and actual network fee

| Field | Verified result |
| --- | --- |
| Chain | Base Sepolia 84532 |
| Transaction | 0xe254dc65a14a464c8a62558cc26f9ff09db4eae2484bdb8a866ad83f01c82a3f |
| Receipt | SUCCESS |
| Deployment block | 60198174 |
| Deployment block hash | 0x9efb1dea456a4f49229a698fc2dde14d8616afee0dc925bcf97e289f3332c413 |
| Verification block | 60200033 |
| Verification block hash | 0x37e47ab669a5354bcac8acbfed1210ace8dfd63c4c842f1df3336727385d445c |
| Observed confirmations | 1860 at that snapshot; not a claim of protocol finality |
| Transaction type | 0x4, EIP-7702 |
| Outer transaction sender / network fee payer | 0xB42F812A44c22cc6b861478900401ee759EbEAD6 |
| Outer destination | 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3 |
| Outer ETH value | 0 wei |
| Gas used, entire relayed transaction | 369280 |
| Effective gas price | 6000001 wei/gas |
| L2 execution fee | 2215680369280 wei |
| Receipt L1 fee | 968 wei |
| Operator fee, oracle at receipt block and gas used | 0 wei |
| Total network fee | 2215680370248 wei = 0.000002215680370248 ETH |

Receipt block hash was checked against the canonical block. The fee total is gasUsed x effectiveGasPrice + receipt l1Fee + operator fee. This is the fee for the entire outer transaction, including its extra execution overhead, not an isolated createAccount estimate. It was paid by the relayer at protocol level. Any separate owner reimbursement or wallet service charge needs a trace/accounting review; it must not be equated to this network fee without evidence.

The first narrowly filtered factory log-range request failed with RPC HTTP 413. Rather than broaden it or guess a transaction hash, the review located the first owner nonce change after the prior preflight by read-only binary search, inspected that block, and verified the candidate transaction's receipt and factory event. No send or signing method was used.

Full sanitized public evidence: [COINBASE_DEPLOYED_TEST_WALLET_EVIDENCE.json](COINBASE_DEPLOYED_TEST_WALLET_EVIDENCE.json). Public transaction: https://sepolia.basescan.org/tx/0xe254dc65a14a464c8a62558cc26f9ff09db4eae2484bdb8a866ad83f01c82a3f.

## Wallet identity and owner verification

- Exactly one AccountCreated event from factory 0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842 names 0xE5b9A38c37acEE4E51920540bF7085352AF057C1, the exact one-element encoded owner array, and factory nonce 0.
- The outer input contains the reviewed factory createAccount calldata, but is NOT byte-for-byte equal to the approved standalone factory transaction. Matching the nested bytes alone does not audit every other call in the outer execution.
- Nonempty ERC1967 proxy runtime code exists at the expected wallet. Runtime keccak256: 0xaaa52c8cc8a0e3fd27ce756cc6b4e70c51423e9b597b11f32d3e49f8b1fc890d.
- Proxy implementation slot 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc points to 0x00000110dCdEdC9581cb5eCB8467282f2926534d.
- Implementation runtime hash: 0x136185896fc519277ec953c0b3d048fc0c9f607b8d04022e60f23ef8dbc6c4d5, matching the existing reviewed pin. Factory runtime identity also matched its existing pin.
- ownerAtIndex(0): 0x0000000000000000000000008e4e1bb851b1c110f6b1d6a31f0f43c056efaa5b.
- isOwnerAddress(expected owner): true.
- ownerCount(): 1; nextOwnerIndex(): 1; removedOwnersCount(): 0.

These read-only results prove the wallet's registered control address and implementation at the evidence block. They do not by themselves prove the tester can now provide a valid challenge signature or fully describe all authority inside a delegated owner account.

## Unexpected owner delegation

The owner was reviewed with code 0x before deployment. It now has:

~~~text
0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b
~~~

The EIP-7702 marker points to 0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B. Target code hash at the verification block: 0x83805f9ac7395294043b10c3b7c1839b7e4582a3e693028c36df84978b09d4e2.

The transaction's public authorization signature was recovered read-only to 0x8e4e1bB851b1C110F6B1D6a31f0f43c056eFaA5b, with chain ID 84532, authorization nonce 0 and that delegation target. This is not a new signature request. Delegation is a persistent account-code change; it is not just a Coinbase wallet link or an off-chain approval.

The relayed transaction therefore cannot be described as the earlier reviewed direct type-2 createAccount call. The source/identity and signing rules of the owner delegation target have NOT been independently matched to a pinned implementation in this task. Product branding must not be inferred from its address alone. No code removal or corrective transaction is proposed automatically.

Before further signing, review the tester's wallet confirmation history and the delegate's verified implementation, authorization scope, privileged execution paths and signature behavior. Record whether the tester knowingly selected a wallet upgrade/smart-account flow. Do not ask for a seed phrase, private key or raw wallet session data.

## Read-only EIP-1271 checks executed

| Check | Result |
| --- | --- |
| eip712Domain fields | 0x0f |
| Domain name / version | Coinbase Smart Wallet / 1 |
| Domain chain / verifying contract | 84532 / 0xE5b9A38c37acEE4E51920540bF7085352AF057C1 |
| replaySafeHash for a fixed non-sensitive probe digest | on-chain result equals independent local EIP-712 calculation |
| isValidSignature with ABI-valid deliberately invalid signature bytes | returned 0xffffffff |
| Existing backend verifyContractWalletControl with invalid synthetic proof | rejected, status 401: Wallet ownership signature was rejected. |
| Real approved owner signature | NOT REQUESTED / NOT VERIFIED |

The invalid proof used zero signature components; it was not produced by signing with any key. RPC/contract compatibility and rejection are demonstrated, but no positive 0x1626ba7e ownership result is claimed. The backend test imported only the verification service; it did not start Express, load server/.env, connect to PostgreSQL or enable the feature.

## Exact challenge format to prepare after the review gate

The existing shared protocol must remain unchanged:

- packages/domain/src/walletLinkProtocol.js.
- tools/coinbase-verification/harness.js for isolated synthetic-user challenges.
- server/src/walletLinking/service.js for EIP-1271 and full application checks.

For an isolated test, generate a fresh challenge only when the tester is ready. A saved report is not a reusable challenge. Do not sign a stale payload from documentation.

~~~text
EIP-712 inner domain:
  name: KhmerFP Wallet Ownership
  version: 1
  chainId: 84532
  salt: keccak256(utf8(reviewed local application origin))

WalletLink fields, in this exact order:
  challengeId: string   [fresh UUID v4]
  action: string        [LINK]
  userId: uint256       [synthetic user 1 in isolated harness]
  wallet: address       [0xE5b9A38c37acEE4E51920540bF7085352AF057C1]
  sessionBinding: bytes32
  appOrigin: string     [reviewed isolated origin, currently http://127.0.0.1:5184]
  nonce: bytes32        [fresh random 32 bytes]
  issuedAt: uint64      [current Unix seconds]
  expiresAt: uint64     [issuedAt + 120]
~~~

The existing harness derives sessionBinding from its synthetic session context and nonce. It retains only an in-memory challenge record. For a real authenticated linking API test, the existing backend must issue and store the challenge for the actual authenticated user/session instead; do not pass synthetic identity into the application API or manufacture session credentials.

A prepared challenge should be checked by assertWalletLinkChallenge before presentation. Compute originalDigest = TypedDataEncoder.hash(innerDomain, walletLinkTypes, innerMessage).

## Coinbase replay-safe signing and signature wrapping

The verified Coinbase wallet implementation applies a second EIP-712 hash internally:

~~~text
Outer domain:
  name: Coinbase Smart Wallet
  version: 1
  chainId: 84532
  verifyingContract: 0xE5b9A38c37acEE4E51920540bF7085352AF057C1

Outer primary type: CoinbaseSmartWalletMessage
Fields: [{ name: 'hash', type: 'bytes32' }]
Message: { hash: originalDigest }
~~~

Use the existing tools/coinbase-open-source/review.js helpers replaySafeOwnershipData and replaySafeOwnershipHash to construct and independently compare this outer hash to wallet.replaySafeHash(originalDigest).

The Coinbase envelope is exactly:

~~~javascript
const wrapped = AbiCoder.defaultAbiCoder().encode(
  ['tuple(uint256 ownerIndex,bytes signatureData)'],
  [[0n, ownerProvidedSignatureData]],
)
// supply the ORIGINAL inner digest; the wallet applies the outer hash itself.
await wallet.isValidSignature(originalDigest, wrapped)
~~~

ownerIndex is uint256 zero, not uint8. No extra EIP-191 personal_sign prefix, no double-wrapping of the digest, no arbitrary signature stripping, and no EIP-6492 bypass is permitted.

For a plain EOA owner, signatureData would be its 65-byte r/s/v signature over the outer typed data. THIS owner now has delegated code. The Coinbase implementation's SignatureCheckerLib can use the owner contract's EIP-1271 path, so the accepted inner signature format must be verified against the actual delegate before assuming the plain-EOA wrapper is sufficient. The outer Coinbase tuple remains known; the delegated owner's signing/validation details remain a blocker. Official MetaMask documentation describes a stateless delegator model, but that generic document alone does not verify the deployed target's bytecode or authorize this account's changed state.

## Test against KhmerFP's existing verifier

After delegate review and SEPARATE signature approval:

1. Prepare a reviewed test-only adapter for the actual selected owner and this separate smart wallet. The normal Coinbase SDK provider returns the original passkey account, not this proxy. Do not relabel an injected wallet as a verified SDK account or weaken the existing wallet guard.
2. Confirm network 84532, selected owner address, current proxy implementation/owner state and delegate identity. Generate a fresh isolated challenge using the shared protocol. Require explicit user approval for the exact ownership payload.
3. Sign via the owner's trusted wallet only; no private key is requested. Make no transaction or deployment request. Cancel if the wallet asks to upgrade, delegate, spend or move funds.
4. Form the correct owner-specific signature data and Coinbase tuple. Check any required replay-safe owner-domain behavior against its verified implementation. Do not add guesses to the backend verifier.
5. Call the real verifyContractWalletControl({chainId:84532, wallet: expectedProxy, digest:originalDigest, signature:wrapped}). It calls the proxy at a fixed block and must return EIP1271 evidence only for the exact magic value 0x1626ba7e. Recheck block hash after verification.
6. Repeat with modified challenge, wrong wallet/domain/chain and invalid signature, requiring rejection. The application/harness must enforce expiry, session binding and single-use attempts; the contract alone does not consume a digest.
7. Save only non-sensitive success evidence: chain, proxy, method, block/hash and magic value. Do not persist raw signatures or credentials in a report.
8. Only later, in a separately approved disposable database, test authenticated persistence, replay rejection, refresh, fresh step-up unlink and relink. No production feature activation is part of this plan.

The existing backend's deployed-code and EIP-1271 rules remain unchanged. Positive ownership verification is not achieved by a successful invalid-signature rejection or by account registration.

## Next approval required

First review and explicitly accept or resolve the unexpected owner EIP-7702 delegation and relayed execution path. No automatic reversal or additional transaction is authorized. A verified delegate identity/signature model and a reviewed isolated adapter are prerequisites before requesting a real EIP-712 signature.

Only after those facts are resolved should the tester approve ONE fresh ownership-signature test for this separate Coinbase proxy. This is separate from deployment approval and grants no trading or transfer permission. There is no reason to deploy the Coinbase proxy again.

## Files and checks

Created:

- docs/COINBASE_REAL_EIP1271_TEST_PLAN.md (this plan).
- docs/COINBASE_DEPLOYED_TEST_WALLET_EVIDENCE.json (public receipt, proxy/owner and negative-verification evidence; no raw signatures).

Executed read-only: chain checks, transaction/receipt lookup, event decoding, proxy code/storage, implementation hashes, owner calls, domain/hash comparison, invalid-signature eth_call and the existing backend negative verifier. No schemas, migrations, dependencies, application code or production data were modified. No new signature, broadcast, funding, feature activation, commit or push occurred.

## Sources

- [Pinned Coinbase wallet signature wrapper and owner verification](https://github.com/coinbase/smart-wallet/blob/a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da/src/CoinbaseSmartWallet.sol)
- [Pinned Coinbase replay-safe ERC1271 implementation](https://github.com/coinbase/smart-wallet/blob/a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da/src/ERC1271.sol)
- [Pinned owner state implementation](https://github.com/coinbase/smart-wallet/blob/a4e83fd36c47b64cb4e21e1fa6bb9b04181a66da/src/MultiOwnable.sol)
- [EIP-7702 delegation and authorization semantics](https://eips.ethereum.org/EIPS/eip-7702)
- [Official MetaMask delegator overview, not bytecode identity proof](https://github.com/MetaMask/delegation-framework/blob/main/documents/EIP7702DeleGator.md)
