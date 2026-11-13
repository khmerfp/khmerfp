# KhmerFP matching and settlement MVP

This folder contains the matching contract for trading existing YES and NO tokens. It uses Hardhat for local development and tests. Market creation, the order book, resolution, and redemption are handled separately.

## How it works

`KhmerFPExchange` takes a signed BUY order and a signed SELL order for the same CTF token. It sends collateral from the buyer to the seller and sends YES or NO tokens from the seller to the buyer. Both transfers happen in one transaction.

- EIP-712 domain: `KhmerFP Exchange`, version `1`, current chain ID, deployed exchange address.
- EOA and EIP-1271 signatures use OpenZeppelin `SignatureChecker`.
- A BUY order offers `makerAmount` collateral for `takerAmount` outcome tokens.
- A SELL order offers `makerAmount` outcome tokens for `takerAmount` collateral.
- Both orders must agree on the same price.
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

The example gives the buyer 1.00 mock USDC and the seller 1 YES token. They sign orders at 0.60 mock USDC per YES. A third account submits the trade. The buyer receives 1 YES, and the seller receives 0.60 mock USDC. These scripts use a temporary local network.

The current suite has 13 passing tests under Node.js 22.23.5. It includes 32 generated orders with different quantities and partial fills to check payment totals, overfills, and replay protection. See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for the review results and remaining work.

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
6. Confirm whether anyone should be allowed to submit signed matches.
7. Agree on fees and how to handle orders with different prices.

## Current limits

- Use mock funds only until the security review is complete.
- Cancellation applies to one order hash, not every order with the same nonce.
- Smart wallets can change which signatures they accept after an order is signed.
- There are no fees, pause controls, relayer restrictions, batch matching, or upgrades.
- The exchange trades existing positions. It does not split or merge collateral itself.
- Order amounts are limited to `uint128` to keep price calculations within `uint256`.
- Both orders must have the same price.
- Token IDs are matched, but the exchange does not check whether they belong to an approved KhmerFP market.
- Collateral must transfer the exact requested amount. Tokens with transfer fees or automatic balance changes are unsupported.
