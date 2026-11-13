# Matching contract MVP review

The matching contract works in local tests. The review covered signed orders, wallet signatures, cancellation, prices, partial fills, token approvals, and transfers. It still needs an independent security review before real funds are used.

## Corrections

- Added a check for trade quantities larger than either signed order. The check now runs before the price calculation. Previously, a very large quantity could cause an arithmetic error. The transaction already failed safely, but it now returns the correct overfill error. No loss of funds was found from this issue.

## What was tested

The Stage 3.5 suite has 35 KhmerFP tests under Node.js 22.23.5. It preserves the original 18 tests and the Stage 3.4 adversarial cases, with fixture setup now granting a matcher role and registering the test market.

The tests use the official Gnosis CTF package, `@gnosis.pm/conditional-tokens-contracts@1.0.3`, deployed on the local test network. Its source code was kept unchanged. CTF uses Solidity 0.5.17, and the exchange uses Solidity 0.8.28.

The CTF tests cover:

- Preparing a binary YES/NO condition.
- Getting the actual collection and position IDs from CTF.
- Splitting mock collateral into YES and NO tokens.
- Trading both tokens with the required approvals.
- Merging a complete YES/NO set back into collateral.

A repeatable test also runs 32 orders with different quantities and partial fills. It checks that neither order is overfilled, payments match on both sides, and completed orders cannot be used again. This is a small property test; broader fuzz testing is still needed.

Other tests cover invalid signatures, signatures for the wrong chain, smart-wallet signatures through EIP-1271, cancellation, expiry, balances, and approvals. The EIP-712 order hash is checked against ethers' TypedDataEncoder. Mock tests confirm that balances and fill records roll back if the second transfer fails.

## Remaining issues

Slither is not installed, so that check has not been run. The npm audit reported 24 findings at the time of review: 13 low, 7 moderate, 4 high, and no critical findings. Some dependencies come from the older official CTF package. These findings need to be reviewed before deployment; no broad dependency upgrade was made during this review.

The exchange expects a trusted collateral token that transfers the exact requested amount. It now checks the buyer's debit and seller's credit immediately after the ERC-20 call, before sending outcome tokens. Transfers that charge fees or report success without changing balances are rejected. A token that lies about its balances can still defeat these observations, so token code and addresses must be checked before deployment. Rebasing tokens are unsupported.

The exchange checks that both orders trade the same token ID from an enabled registered binary market. Stage 3.5 validates the supplied pair through the configured CTF contract using the fixed collateral and root index sets 1 and 2. Registration still relies on admin approval of the real-world question, oracle and trading policy.

CTF uses ERC-1155 operator approval, which covers more than one order. Signed orders still limit what the exchange can transfer. The wallet flow should make approval and revocation clear to users.

Cancellation applies to one order hash. It does not cancel every order with the same nonce. Only approved operators can submit compatible signed orders. The MVP charges no fees. The operator chooses the execution price within the signed limits; off-chain order priority and allocation of price improvement are not enforced by the contract.

## Crossed-price review

Settlement takes explicit outcome and collateral amounts. Their ratio is the execution price. Integer cross-products enforce both signed price limits, with amounts bounded to uint128 before multiplication. Both fill quantities and actual payments are tracked per hash. Buyer spending cannot exceed its signed total collateral. Seller proceeds can exceed the signed minimum when execution improves the seller's price.

Every partial fill must independently satisfy both limits. Payments below the seller's rounded-up minimum or above the buyer's rounded-down maximum revert. No final-fill dust is charged automatically. Some very small fills have no valid whole-unit payment; the matcher must use larger quantities or the user must cancel and replace the remainder. This conservative rule avoids cumulative rounding leakage but can reduce fill flexibility.

Tests cover a 0.65 bid against a 0.60 ask, execution outside each limit, non-crossing rejection, multiple prices on one order, exact-price compatibility, unrepresentable fractions, final fills, cumulative payments, and rollback of both counters. Crossed-price settlement also runs against official CTF locally. The order signing format is unchanged; the settlement ABI adds a collateral amount argument and callers must update.

Settlement uses ReentrancyGuard, and fill records are updated before transfers. Stage 3.4 tests cover reentrant calls from collateral transfers and official CTF receiver callbacks. Broader fuzzing and independent review are still needed. Smart wallets can change which signatures they accept. Wallets that have not been deployed are not supported.

## Stage 3.4 findings and fixes

The pre-fix regression confirmed that a collateral contract returning true without transferring funds could receive successful settlement: the seller lost outcome tokens without being paid. This required a non-standard or malicious configured collateral contract, and does not demonstrate an exploit against standard USDC. SafeERC20 checked the return value but did not verify balances. The fix checks both parties' exact balance changes before transferring CTF tokens. A fee-deducting transfer now fails the same check. Failed settlement rolls back the token transfer, allowance changes and both order counters.

Self trades are now rejected. A wallet cannot be both buyer and seller in the same match; this avoids treating a net-zero transfer as a normal payment and gives the balance checks an unambiguous meaning. This is a deliberate compatibility change.

The original negative test failed against the old contract because the unpaid settlement was accepted. It passes after the fix. There are no failing tests in the final run. No claim is made that the collateral checks can secure a token that fabricates balanceOf results or protect against a malicious CTF contract. Both configured assets remain trusted dependencies.

Additional executed tests cover:

- ERC-20 transfers returning false or reverting; fills stay unchanged, and a later valid retry succeeds.
- ERC-20 callbacks trying to settle recursively; the guard rejects the inner call and the signed outer trade completes once.
- Official CTF callbacks trying to settle recursively; the same guard blocks the inner call.
- A smart wallet rejecting official CTF delivery; payment, allowances, quantities and payment counters roll back, then a valid retry succeeds.
- An EIP-1271 wallet revoking signature validity between partial fills; the next fill fails without changing existing counters. Re-enabling validity permits the remaining fill.
- Rejection of self trades without allowance consumption.
- 64 reproducible changing-price order sequences, in addition to the original 32-order property test. Both payment and quantity counters are checked after each successful fill. Zero payment, above-limit payment, below-limit payment and completed-order replay are rejected. Counterparty collateral balances remain conserved.

These tests are a bounded property suite, not a formal proof or an exhaustive fuzz campaign. Signature changes after initial validation during a settlement callback do not retroactively invalidate an already executing fill. No cached signature preapproval is used; future settlements recheck the wallet. Maker-authorized cancellation remains callable during callbacks and affects subsequent fills.

## Stage 3.4 approval and control recommendations

ERC-20 approvals should cover only the intended budget. The exchange does not approve CTF or any third party to spend collateral, and stores no treasury balance. ERC-1155 setApprovalForAll remains broad: all positions in that CTF contract are exposed to the approved operator contract. Signed orders restrict this exchange's transfers, but any exchange bug can still make broad approval dangerous. Provide clear revocation instructions and require fresh approval for a replacement deployment. An operator allowlist does not narrow the user's token approval.

| Control | Recommendation | Reason and remaining decision |
| --- | --- | --- |
| Operator allowlist | Optional for the local MVP; decide before public launch | It can limit accidental or abusive submissions but adds key/censorship risk. It does not prove price-time priority or stop a compromised operator from selecting a price inside the spread. Signed limits and the guard must remain enforced. |
| Emergency pause | Include before public or funded testing | Pause settlement during an incident while keeping user cancellation available. Choose guardian, unpause authority, multisig and recovery policy first. |
| Market registration | Include before public trading | Validate CTF-derived YES/NO IDs and approved collateral/conditions. Same-token matching alone does not prove that the token belongs to an approved binary market. Decide registration authority and lifecycle rules first. |

These were Stage 3.4 recommendations. Stage 3.5 implements the controls described below; choosing actual deployment keys and operational recovery rules remains required before public testing.

Slither was checked again and is unavailable locally. Static analysis has not passed or been performed. The npm findings listed above remain a separate dependency-review blocker. No upstream licensed code or research documents were changed during this hardening work.

The custom exchange is ready to submit for independent review as a local prototype, with these open findings disclosed. It is not ready for funded or production deployment. Review scope should include settlement, configured asset trust, rounding, callback behavior, signature revocation, governance proposals and deployment configuration.

## Stage 3.5 governance and market authorization

The contract uses OpenZeppelin AccessControlDefaultAdminRules and Pausable. The deployer initially holds the sole default admin and EMERGENCY_ROLE. No account receives OPERATOR_ROLE automatically. The admin grants and revokes operator and guardian roles. An operator can only settle signed orders, and a guardian can only pause settlement. Only admin can unpause. Order cancellation remains available to makers during pause and market disablement.

Default-admin handover is two-step with an initial one-day delay. This delay applies to admin transfer, not to grants, revocations, unpause, registration or market status changes. OpenZeppelin exposes scheduled changes to the admin delay and a delayed renunciation path; renouncing the last admin can permanently remove management/unpause ability. Operational policy should prohibit unintended renunciation. Handover does not clear the previous admin's separate guardian or operator grants. Tests verify delayed acceptance and explicit guardian revocation.

The admin registers an immutable condition/token pair. CTF must report two outcome slots, and IDs must equal the CTF helper results for root parent collection zero, index sets 1/2, and the fixed collateral address. Zero, duplicate, reversed, unprepared, categorical, different-collateral and unrelated-condition registrations are rejected. Official CTF tests exercise these checks; the mock's identifier helpers are deliberately fixed fixtures and do not implement cryptographic derivation.

Markets can be disabled and re-enabled by admin. Settlement requires an enabled registration, but cancellation is never blocked. Fill and payment counters survive disable/re-enable, as do cancellation flags. Unexpired signatures become usable again after a market is re-enabled unless the maker cancelled them. Conditions are not remapped. Backend policy must separately close markets on time and after resolution: preparation and registration alone do not imply an unresolved question, finality or real-world legitimacy.

New tests cover unauthorized/revoked operators, role grants, operator tampering with signed prices, guardian revocation, restricted unpause, paused cancellation, admin privilege escalation, delayed admin transfer, official token derivation, invalid collateral/condition/token pairs, prepared categorical conditions, nested positions, duplicate registration and disabled-market accounting. Existing reentrancy tests remain passing with the guard first in settlement, so an inner callback cannot bypass the guard even if callback authorization changes.

Role and status checks apply when settlement enters. An authorized contract could pause, disable a market or revoke a role from a callback during an already executing settlement; this does not retroactively abort that fill. Future calls observe the new state. Do not grant privileged roles to arbitrary callback-bearing contracts. Cancellations during callbacks similarly affect future fills. Transaction ordering means a revocation/pause transaction cannot undo a settlement already mined ahead of it.

Use separate relayer and guardian keys, hardware-backed admin multisig, monitored role events, and tested recovery procedures. A compromised operator can censor or settle leaked orders at an adverse price within signed limits. A compromised guardian can halt service. A compromised admin can authorize more operators, register markets, disable trading or unpause it; the contract does not impose a timelock on those actions. None of the added methods transfers funds or bypasses signed settlement/allowance checks, and pause does not escrow or seize assets.

Before backend integration, select the multisig/guardian policy, grant the relayer role, verify official CTF code and collateral, register approved pairs, and index RoleGranted/RoleRevoked, Paused/Unpaused, MarketRegistered and MarketStatusChanged. Handle revocations, pause/disable, expiry and cancellation races as transaction failures, without marking orders settled. Existing order signatures and matchOrders ABI are unchanged from Stage 3.2; a new deployment address still requires new domain-bound signatures.

Slither remains unavailable and no static-analysis pass is claimed. Dependencies, privileged-key procedures, real smart-wallet providers, deployment configuration and independent review remain open. The contract is a reviewable local prototype, not production-ready.

## Before Base Sepolia

Before deployment:

1. Review and approve the contract changes.
2. Use Node.js 22 for the build and tests.
3. Verify the CTF and collateral addresses and their deployed code.
4. Review the dependency audit findings.
5. Expand fuzz, balance-invariant, and callback tests.
6. Get an independent contract security review.
7. Get explicit approval to deploy.

The preparation script can send a deployment transaction when its confirmation flag is enabled. It should only be used after deployment approval. No Base Sepolia transaction was sent during this review.
