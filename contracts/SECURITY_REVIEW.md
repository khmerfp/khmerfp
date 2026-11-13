# Matching contract MVP review

The matching contract works in local tests. The review covered signed orders, wallet signatures, cancellation, prices, partial fills, token approvals, and transfers. It still needs an independent security review before real funds are used.

## Corrections

- Added a check for trade quantities larger than either signed order. The check now runs before the price calculation. Previously, a very large quantity could cause an arithmetic error. The transaction already failed safely, but it now returns the correct overfill error. No loss of funds was found from this issue.

## What was tested

All 13 tests passed using Node.js 22.23.5.

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

The exchange expects a trusted collateral token that transfers the exact requested amount. Tokens that charge transfer fees or change balances automatically are not supported. The collateral and CTF addresses must be checked before deployment.

The exchange checks that both orders trade the same token ID from the configured CTF contract. It does not yet check whether that token belongs to an approved KhmerFP binary market. A decision is still needed on how approved markets will be registered.

CTF uses ERC-1155 operator approval, which covers more than one order. Signed orders still limit what the exchange can transfer. The wallet flow should make approval and revocation clear to users.

Cancellation applies to one order hash. It does not cancel every order with the same nonce. Anyone can submit two compatible signed orders. The MVP requires equal prices and does not charge fees or handle price improvement.

Settlement uses ReentrancyGuard, and fill records are updated before transfers. More tests with malicious token contracts and callbacks are still needed. Smart wallets can change which signatures they accept. Wallets that have not been deployed are not supported.

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
