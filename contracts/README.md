# KhmerFP matching and settlement MVP

This folder contains the matching contract for trading existing YES and NO tokens. It uses Hardhat for local development and tests. Market creation, the order book, resolution, and redemption are handled separately.

## How it works

`KhmerFPExchange` takes a signed BUY order and a signed SELL order for the same CTF token. It sends collateral from the buyer to the seller and sends YES or NO tokens from the seller to the buyer. Both transfers happen in one transaction.

- EIP-712 domain: `KhmerFP Exchange`, version `1`, current chain ID, deployed exchange address.
- EOA and EIP-1271 signatures use OpenZeppelin `SignatureChecker`.
- A BUY order offers `makerAmount` collateral for `takerAmount` outcome tokens.
- A SELL order offers `makerAmount` outcome tokens for `takerAmount` collateral.
- The execution price must be at or below the buyer's limit and at or above the seller's limit.
- Each order tracks how many outcome tokens have been filled.
- Cancelled, expired, or fully filled orders cannot execute. A trade cannot exceed either signed quantity.
- `nonReentrant` protects settlement. If either transfer fails, the whole trade rolls back, including balances, fill records, and events.

The exchange uses the standard ERC-1155 balance, approval, and transfer functions supported by Gnosis CTF. Tests cover both mock tokens and the official Gnosis ConditionalTokens contract deployed locally. The official CTF tests prepare a condition, split collateral, trade YES and NO tokens, and merge complete sets back into collateral.

## Run locally

Use Node.js 22. From the `contracts` folder, run:

```bash
npm ci
npm run compile
npm test
npm run deploy:local
npm run example:local
```

The example gives the buyer 1.00 mock USDC and the seller 1 YES token. The buyer signs a limit of 0.65, and the seller signs a limit of 0.60. A third account submits the trade at 0.62. The buyer receives 1 YES, and the seller receives 0.62 mock USDC. These scripts use a temporary local network.

The current suite has 35 passing tests under Node.js 22.23.5. It includes roles, pause, market authorization, official CTF integration, crossed-price fills, rounding checks, malicious tokens, receiver callbacks, signature revocation, and repeatable property tests across 32 fixed-price and 64 changing-price orders. See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for the review results and remaining work.

## Execution price and rounding

The settlement call now takes `matchOrders(buy, buySignature, sell, sellSignature, outcomeAmount, collateralAmount)`. The last two arguments explicitly define the execution price as a fraction of collateral units per outcome unit. They are exact token amounts, not a floating-point price or a fixed decimal scale. The signed order format and EIP-712 domain are unchanged, but callers must use the updated function ABI.

For each fill, the payment must be at least `ceil(quantity * sellerCollateral / sellerQuantity)` and at most `floor(quantity * buyerCollateral / buyerQuantity)`. The contract checks these rules by multiplication without rounding. It rejects zero payments and any amount outside that interval. Equal-price orders still work whenever the fill has an exact whole-unit payment.

Both outcome quantities and actual collateral payments are tracked per order hash. Total buyer payments cannot exceed the signed budget, and neither order can exceed its outcome quantity. The seller's collateral amount is a minimum receipt at the signed price, not a maximum: better execution may pay the seller more.

There is no automatic final-fill charge or refund for dust. Each fill must satisfy both limits on its own. If a small fill has no valid whole-unit payment, combine it into a larger fill. Splitting an exact-price order into unsuitable tiny quantities can leave an unfillable remainder; cancel and sign a new order if necessary. Unspent buyer budget stays in the buyer's wallet.

The approved off-chain matcher chooses the execution price and order priority. The contract enforces signed limits but cannot prove which order arrived first. An approved operator can choose a price within the spread. Maker-price priority and fair allocation of price improvement are not enforced on-chain.

## Roles, pause, and approved markets

The deploying account starts as the default admin and emergency guardian. No operator is granted automatically. The admin uses OpenZeppelin `grantRole` and `revokeRole` to manage `OPERATOR_ROLE` and `EMERGENCY_ROLE`.

- Operators can submit signed settlements. They cannot change signed terms, grant roles, or authorize markets.
- Emergency guardians can call `pause()`. Only the admin can call `unpause()`.
- Users can call `cancelOrder` while settlement is paused or their market is disabled.
- Admin handover uses `beginDefaultAdminTransfer` followed by the new admin's `acceptDefaultAdminTransfer` after the one-day delay. OpenZeppelin also supports cancellation of a pending transfer and delayed changes to that delay.

The admin calls `registerMarket(conditionId, yesTokenId, noTokenId)`. The configured CTF contract must report two prepared outcome slots. The exchange derives both root collection IDs using index sets 1 and 2, then derives position IDs using the exchange's fixed collateral address. Supplied IDs must match exactly. Reversed outcomes, other collateral, unrelated conditions, nested positions, and duplicate registrations are rejected. The configured CTF contract is still a trusted dependency.

Registration enables the market and fixes its identity. The admin can call `setMarketEnabled(conditionId, false)` to disable it, or pass `true` to re-enable it. Re-enabling does not clear cancellations or fill counters. Unexpired outstanding signatures can execute again after re-enabling unless cancelled. Registration verifies token identity; the admin must separately approve market wording, oracle policy, and trading deadlines.

For local tests the example grants its matcher access and registers the mock's fixed token pair. Real CTF derivation is covered by the official CTF tests; the mock identifier helpers are test fixtures only. The bare local deployment script deploys an exchange without an operator or registered markets.

Before backend integration, grant the relayer's address `OPERATOR_ROLE`, verify and register each CTF pair, and watch role, pause, and market-status events. Check `hasRole`, `paused`, `tokenConditions`, and `markets` before submission, while treating on-chain checks as final. Handle a role revocation, pause, disable, expiry or user cancellation between simulation and execution. The order signing format and settlement ABI remain unchanged from Stage 3.2.

Use a multisig for admin and separate keys for relayer and emergency guardian. A compromised operator can censor orders or choose unfavorable prices inside signed limits; it cannot bypass signatures. A compromised admin can add operators, disable markets, and unpause trading. Admin transfer does not revoke old operator/guardian grants: revoke them explicitly during handover. None of these roles can withdraw user funds through an admin transfer function.

## Order permissions

The buyer must approve enough collateral for the trade. The seller must approve the exchange to transfer CTF tokens using ERC-1155 operator approval. The exchange has no admin function for moving user funds.

Each signed order specifies the wallet, token ID, BUY or SELL side, quantities, price, nonce, and expiry. The signature also belongs to a specific chain and exchange address.

The example approves only the required collateral amount. CTF uses `setApprovalForAll`, which gives broader permission than a single order. Signed orders still limit transfers through the exchange, but the approval flow needs review before launch. Escrow or smart-wallet permissions may offer tighter control.

## Base Sepolia preparation

Create `contracts/.env` locally. Keep private keys out of Git:

```text
BASE_SEPOLIA_RPC_URL=https://...
BASE_SEPOLIA_DEPLOYER_KEY=0x...
BASE_SEPOLIA_COLLATERAL_ADDRESS=0x...
BASE_SEPOLIA_CTF_ADDRESS=0x...
```

After checking the mock collateral and CTF addresses, run:

```bash
npm run prepare:base-sepolia
```

The script checks chain ID `84532`, confirms both addresses have deployed code, and estimates gas. By default, it stops there. Setting `CONFIRM_BASE_SEPOLIA_DEPLOY=true` allows it to send the deployment transaction. Deployment requires project-owner approval.

Before deployment:

1. Build and test with Node.js 22.
2. Review the npm audit findings.
3. Verify the CTF and collateral addresses and deployed code.
4. Test against the selected Base Sepolia CTF deployment.
5. Get an independent contract review and agree on emergency controls.
6. Choose multisig, operator and emergency keys, and verify all role grants.
7. Agree on fees and how to handle orders with different prices.

## Current limits

- Use mock funds only until the security review is complete.
- Cancellation applies to one order hash, not every order with the same nonce.
- Smart wallets can change which signatures they accept after an order is signed.
- There are no fees, batch matching, or upgrades. Role permissions and pause controls require operational key management.
- The exchange trades existing positions. It does not split or merge collateral itself.
- Order amounts are limited to `uint128` to keep price calculations within `uint256`.
- The matcher chooses any execution price within both signed limits; order priority is handled off-chain.
- Only registered binary token pairs can trade. Registration does not validate the real-world question or oracle trustworthiness.
- Collateral must transfer the exact requested amount. Tokens with transfer fees or automatic balance changes are unsupported.
- Settlement checks the buyer's debit and seller's credit. Self trades are rejected. Tokens that lie about their balances still require trusted-token selection.
