# Coinbase tester wallet inspection

Stage 4.3P, 17 November 2026. Branch feature/matching-contract-mvp.

## Current result

**Read-only inspection completed. The tester manually connected and supplied the
public SDK report. Independent RPC checks confirmed no code and zero native balance.
Deployment still cannot safely proceed without the remaining reviews and approval.**

| Item | Observed result |
| --- | --- |
| Local URL | http://127.0.0.1:5185 |
| Binding | 127.0.0.1 only; process 25068 at startup |
| HTTP check | 200, expected isolated page, Cache-Control: no-store |
| Tester SDK address | 0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC (tester-provided SDK report) |
| Actual wallet chain | SDK report: 84532; independently confirmed RPC chain 84532 |
| Wallet code/deployment status | NO_CODE; eth_getCode = 0x at reported and independent read blocks |
| Wallet capability flags | AVAILABLE; Base Sepolia entry present; atomic supported; legacy atomicBatch, paymasterService, auxiliaryFunds and dataSuffix reported true |
| First-use deployment support | Unverified for the exact account |
| Reliable gas quote / sponsorship | Unavailable |
| Deployment readiness | BLOCKED |

The connection was performed manually by the tester. No signature or submission
was requested. Capability observations below are from the tester-supplied SDK
report; those off-chain flags cannot be independently authenticated through public
Ethereum RPC. Code and native balance were independently checked read-only.
This is not ownership proof or permission to deploy.


### Actual observations and independent read evidence

The tester shared the page report inspectedAt 2026-11-16T22:54:53.459Z (UTC),
which is 17 November in Asia/Calcutta. It reports sdkConnected true, chain 84532,
NO_CODE, balanceWei '0', submissionEnabled false, ownershipVerified false,
firstUseDeploymentVerified false and deploymentMayProceed false. All owners,
factory nonce, prediction, gas, maximum fee and sponsorship-commitment fields are
null/unknown. The SDK report shows:

| Flag | Reported value | What it does not prove |
| --- | --- | --- |
| Base Sepolia capability entry | Present | Per-account provisioning is ready |
| atomic.status | supported | The account can deploy automatically |
| atomicBatch.supported | true | Factory/proxy identity or ownership |
| paymasterService.supported | true | A sponsor will pay for the actual operation |
| auxiliaryFunds.supported | true | Testnet funds exist or are approved to spend |
| dataSuffix.supported | true | Gas coverage or deployment readiness |

The reported factory/implementation are the previously pinned v1.1 pair. Those
shared contracts being deployed does not mean this user's account is deployed.

Independent read-only RPC evidence, checkedAt 2026-11-16T22:56:49.304Z (UTC):

| Check | Result |
| --- | --- |
| RPC | https://sepolia.base.org |
| Chain | 84532 |
| Reported block | 59739120 |
| Reported block hash | 0x95a182b054a36b65c1a3542835127c59c4e04c6a547af0ba1044a432f312007f |
| Wallet code at reported block | 0x |
| Native balance at reported block | 0 wei |
| Independent later block | 59739703 |
| Independent block hash | 0xe2d54d719c327416702aa9ca47095496a0458738e90c1b5ab244a3c8e7c07dad |
| Wallet code at later block | 0x |
| Native balance at later block | 0 wei |

The later block hash was re-read and matched. No call to isValidSignature,
wallet_sendCalls, a bundler or a transaction method was made. Empty code confirms
no deployed smart-account code at these sampled blocks; it does not identify
counterfactual ERC-4337 versus undelegated EOA/7702 account type. EntryPoint deposits
and operation sponsorship were not inspected. Zero native balance alone does not
prove which gas funding arrangement is possible.

**Deployment readiness: BLOCKED.** Confirm Coinbase's supported first-use path for
this exact account type on Base Sepolia, review any setup/delegation effects, and
obtain an actual maximum fee or sponsorship commitment. No fee was inferred from
capability support, and no request was submitted to test whether it would work.

## Manual connection

1. Use a separate test browser profile and open http://127.0.0.1:5185. Loading the
   page does not initialize a wallet connection or query the chain.
2. Click Connect Coinbase wallet — read only. Select the intended Coinbase passkey
   account. This is connection authorization, not an ownership-signature test.
3. Require Base Sepolia 84532. If the saved wallet context is on another chain,
   the page stops and displays its public chain ID. Select Base Sepolia manually
   in the wallet and reconnect; no automatic switching or add-chain request runs.
4. The page reads wallet_getCapabilities for the selected wallet and 0x14a34,
   checks account/chain again, then asks the loopback server for read-only code
   and balance checks. It displays the public address, chain and sanitized results.
5. Decline any unexpected signing, transaction, UserOperation, funding, permission,
   account upgrade or deployment prompt. None is part of this inspection.
6. Use Copy public inspection report if you want to share results with the reviewer.
   This is another explicit click. The clipboard report contains a public address,
   block/hash, code/factory evidence and allowlisted capability flags, not raw SDK
   responses, credentials, wallet signatures or passkey assertions. Public addresses
   are linkable information; share only the intended test account.

The alternate Read public deployment status button accepts a public address
without SDK connection. Its result explicitly has sdkConnected false and capability
read status NOT_REQUESTED. It cannot be represented as inspection of a connected
account or proof of account control.

## Read-only checks and result interpretation

RPC reads use https://sepolia.base.org, require chain 84532, pin the factory and
implementation identity and compare the sampled block hash again. Wallet status:

- NO_CODE: eth_getCode returned 0x. This does not distinguish an undeployed factory
  account from an EOA awaiting delegation, and proves no first-use readiness.
- CODE_PRESENT_ACCOUNT_IDENTITY_PENDING: code exists but its Coinbase provenance,
  account implementation and tester ownership remain unverified.
- DELEGATED_ACCOUNT_REQUIRES_REVIEW: a 0xef0100 prefix indicates delegation; do
  not treat it as the planned classic Coinbase factory proxy.
- An RPC error, timeout or changed factory/block fails the read. It is not a passed
  check or evidence that the tester wallet is unsupported.

The capability summary keeps only the explicit Base Sepolia entry and public flags:
atomic.status (supported/ready/unsupported/UNKNOWN), legacy atomicBatch.supported,
paymasterService.supported, auxiliaryFunds.supported and dataSuffix.supported.
Wildcard or another network's flags are not silently promoted to Base Sepolia.
Missing/unrecognized booleans remain null, not false. Method failure or the
5-second capability timeout gives UNAVAILABLE, not a deployment rejection.

An advertised atomic capability is about call execution/atomicity, not proof of
first-use provisioning. A paymaster capability is not a gas quote or sponsorship
promise. Every report explicitly keeps firstUseDeploymentVerified false,
ownershipVerified false, deploymentMayProceed false and sponsored unknown.
No signing, wallet_sendCalls, wallet_prepareCalls, sendPreparedCalls, permission,
transaction or UserOperation method is enabled to test those claims.

The SDK can retain connection metadata in its own storage; this is why the test
profile must be isolated. Our code does not persist the public inspection report,
raw SDK replies, signatures or session credentials. Account/chain events invalidate
the report, and late RPC responses cannot restore an old context's evidence.

## Information still required before deployment

- The account address/public report are now available; keep this same account
  through all later reviews and recheck it immediately before any authorized action.
- Coinbase-supported confirmation that this specific account type supports
  wallet-managed first use on Base Sepolia. Capability support alone is insufficient;
  an empty account's type cannot be inferred from eth_getCode.
- The exact intended operation, complete wallet-managed setup effects and confirmation
  that no unapproved delegation, owner change or additional permission is involved.
- A reliable operation-specific fee quote: actual gas payer, deployment/verification/
  execution overhead, network fee, maximum test-ETH spend and quote validity.
- If sponsored, the exact sponsor/service and commitment for this operation; otherwise
  sufficient approved Base Sepolia test ETH or an adequate existing gas deposit.
  A zero-value call and a positive balance are not a complete fee calculation.
- Explicit acceptance of the unresolved SDK dependency risks for the isolated test.
- Separate approval and review before adding/enabling any submission implementation.

As established in Stage 4.3O, raw factory owners/nonce are not inherently required
in the app for a wallet-managed request. They must never be invented. That does
not remove the need to confirm the exact account, setup effects and fees.

The current read-only inspection cannot obtain a trustworthy full operation quote
merely from capabilities or eth_getCode. Do not call wallet_sendCalls as a gas
estimator. If Coinbase cannot confirm a supported flow for this exact account,
stop and request its official guidance; do not substitute an EOA/server wallet,
subaccount, mainnet path, SDK downgrade or guessed deployment.

## Local changes and validation

- tools/coinbase-deployment/connection.js: allowlisted capability summary, explicit
  wallet chain result, capability timeout and sanitized unavailability.
- browser/main.js and browser/index.html: manual connection, separate address/chain
  display, public report copy, account-change invalidation and distinct manual
  address-only status.
- inspection.test.js: six offline cases for sanitization, chain scoping, unknown
  values, exact read-method sequence, safe errors and wrong-chain stopping.

All 40 offline tests passed (6 new inspection cases plus the previous 34). Node
and browser lint passed. The running server built the isolated assets in memory
and served the correct page with no-store headers. No production application,
database, migrations, dependencies, exchange contracts or linking flags changed.
Existing unrelated work was preserved. No commit, push or deployment occurred.

## Approval boundary

The tester's explicit connection click and read-only inspection are authorized
for this stage. They do not authorize signing, deployment, test-ETH funding,
sponsorship setup or UserOperation submission. Any later execution requires a
separate reviewed implementation and approval naming the exact address, network,
operation, setup effects and maximum fee or verified sponsorship.

The tester report has been received and code/balance independently confirmed.
Read-only inspection is complete; deployment remains blocked by account-specific
first-use support, setup/fee review and separate execution approval. Stop at this
boundary. No deployment, signature or transaction is authorized by these results.

References: [deployment resolution](COINBASE_WALLET_DEPLOYMENT_RESOLUTION.md),
[deployment plan](COINBASE_SMART_WALLET_DEPLOYMENT_PLAN.md),
[EIP-5792 capability semantics](https://eips.ethereum.org/EIPS/eip-5792).
