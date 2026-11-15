# Local Bitcoin trading demo

This page connects the browser to the local demo API and Hardhat contracts. It uses mock USDC and real local CTF token balances. It does not use normal KhmerFP accounts, balances, ABA or Bakong.

## Start

Use Node.js 22. Run these commands in the matching-contract worktree, not the development worktree.

Terminal 1, from `contracts/`:

```powershell
npm run compile
npm run demo:node
```

Terminal 2, from `contracts/`:

```powershell
npm run demo:setup
```

Setup resets the disposable chain and starts a new five-minute round. Configure the browser wallets before running setup so you have time to trade. The deployment file lists the public buyer, seller and operator addresses. Use only the corresponding local Hardhat test accounts in your wallet. The page does not import accounts, store keys or fund personal wallets. Never send real assets to these test addresses.

Terminal 3, from the worktree root:

```powershell
$env:NODE_ENV='development'
$env:LOCAL_DEMO_ENABLED='true'
npm run demo --workspace server
```

Terminal 4, from the worktree root:

```powershell
npm run dev --workspace client -- --host 127.0.0.1 --port 5173 --strictPort
```

Open **http://127.0.0.1:5173/local-demo/bitcoin**. Use this hostname, not localhost, so the demo cookie reaches the API. Configure an EIP-1193 wallet with RPC `http://127.0.0.1:8545`, chain ID `31337`, and ETH as the gas currency. No frontend environment variables or operator keys are needed. The API address is fixed to `http://127.0.0.1:4001`; production API settings are ignored by this page.

The Bitcoin card uses the same display component as the existing market cards. Click it to open the trading drawer, using the existing dark theme, green YES and red NO buttons. BUY/SELL is a separate choice from YES/NO. Close the drawer to view orders and the operator panel. Display components are shared; production authentication, simulated prices and balance-update actions are not used. No odds or recent results are invented when the local demo has none.

The demo entry point is excluded from production builds. It sits outside the normal authentication and application providers. Opening it does not start normal wallet, payment or live-price requests.

Clicking Connect wallet requests a switch to chain 31337 if another network is selected. If the wallet does not know that chain, it offers the fixed local network above. Approve the network switch in your wallet; merely adding a network does not select it for the site. The page checks the selected chain again before continuing.

## Complete a trade

See [the test workflow diagrams and pass checklist](LOCAL_DEMO_TEST_WORKFLOW.md) for a full walkthrough using an execution price of 0.60. The crossed-price example below instead uses 0.65 / 0.60 limits and a 0.62 execution price.

1. Connect the configured buyer test account. Sign the local login challenge. Choose BUY, YES, quantity 1, and price 0.65. Approve the exact ticket cost if needed, then sign and submit the order.
2. Disconnect. Switch the wallet to the configured seller test account and connect again. Choose SELL, YES, quantity 1, price 0.60. Approve the exchange as a CTF operator if needed, then sign and submit. The seller already has YES and NO inventory from setup.
3. Disconnect and switch to the configured operator test account. Connect again. The manual matching panel appears only for this authenticated account while its on-chain operator role is active.
4. Select the stored BUY and SELL orders. Set quantity 1 and execution price 0.62. Click **Simulate and settle** before the cutoff.
5. Wait for CONFIRMED. Reconnect the buyer or seller to see updated balances. The buyer pays 0.62 mock USDC and receives 1 YES token; the seller receives 0.62 mock USDC and gives up 1 YES token. Both need local ETH for their own approval and cancellation transactions.

You can also use separate browser profiles for the accounts. Tabs in the same browser profile share the demo cookie, so changing accounts requires reconnecting. Each account signs its own order; the backend signs only the settlement transaction.

## Signing and approvals

The login message binds the wallet, chain, exchange, nonce and expiry. The session uses a separate HttpOnly cookie; no token or private key is stored in localStorage. Wallet, chain and deployment changes clear the page session. A server restart requires login again.

Order signatures use the exchange's exact EIP-712 domain and seven order fields. The browser verifies the local instance ID and deployed code hashes. It also compares the wallet's deployment block with the fixed local RPC. The backend independently checks the full order and signature.

Some wallets retain numbered blocks after Hardhat resets. If the numbered deployment block differs, the page checks the current block by hash. Recognizing that hash alone is not sufficient. The wallet must also support [EIP-1898 canonical block-hash reads](https://eips.ethereum.org/EIPS/eip-1898) with `requireCanonical: true`, return all three expected contract code hashes, and return the same registered YES/NO pair and cutoff as the local RPC and configuration. Missing, unsupported or conflicting proof still stops login. This path uses read-only calls and never signs or sends a transaction. The connection details panel retains public diagnostics when proof fails.

All signed amounts use six-decimal integer arithmetic. Prices must be strictly between zero and one. A quantity/price combination that leaves fractional micro-USDC is rejected rather than silently rounded. The UI does not choose price priority or reserve balances across outstanding orders. The backend rechecks balances, approvals and signed limits before settlement.

BUY approval is for the current ticket's exact cost, not an unlimited amount. Changing the ticket may require another approval. SELL approval is broader: ERC-1155 operator approval covers all positions in this CTF contract. It is explicit, explained on screen, and can be revoked. Approval is not marked ready until its transaction confirms and balances are read again.

## Status and recovery

The page polls every ten seconds and offers a manual refresh. OPEN means awaiting a match. SUBMITTED is not a completed trade. FAILED is a confirmed failure; PENDING or REORGED may require reconciliation and must not be blindly retried. Only backend-confirmed settlement is displayed as confirmed. Balances come from contract reads, never an optimistic frontend credit.

Cancellation sends the maker's order to the exchange and remains available after the cutoff. New orders and matching stop at the cutoff; the contract is the final enforcement point. A pause, disabled market or revoked operator also prevents matching.

After a chain reset, stop the API, archive its old `.local-demo/orders.json` journal and restart with the new deployment configuration. Never reuse old orders on a new chain instance. Follow `server/LOCAL_DEMO_API.md` for stale-lock recovery; do not delete an active process lock. Reset the wallet's local test-account nonce history if its extension caches transactions from the previous chain. The page never resets the chain itself.

## Validation and limits

Run `npm test --workspace client` and `npm run lint --workspace client`. The new tests cover arithmetic, signing payloads, transport isolation, wallet changes, authentication failure, approvals, duplicate clicks, deployment verification, operator visibility, uncertain settlement and confirmed balance refresh. Component tests use a mocked EIP-1193 connection; they are not a manual wallet-extension browser test. The guarded backend integration suite separately exercises real local CTF settlement, rollback, restart recovery and chain resets.

No live BTC oracle, recurring markets, automatic matching, resolution transaction or redemption page is included. Missing opening/closing fixtures are shown as missing; no price is invented. Resolution still needs validated fixture evidence, an authorized CTF payout report and a redemption flow. This is a local development demonstration, not production-ready trading.
