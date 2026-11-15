# Local Bitcoin five-minute demo

Stage 4.1 prepares one round on a disposable Hardhat chain. All funds are mock tokens. The existing frontend, Express backend and database are not connected to this setup yet.

## Start the chain

Use Node.js 22. From `F:/khmerfp-matching-contract/contracts`:

```sh
npm ci
npm run compile
npm run demo:node
```

Keep that terminal running. In a second terminal, from the same folder:

```sh
npm run demo:setup
```

No environment variables or private keys are required. The node listens only on `127.0.0.1:8545`, chain ID 31337. The wrapper suppresses Hardhat's private-key log lines. The default Hardhat accounts are publicly known test accounts: never use them on a public chain or send real assets to them. Avoid running the raw Hardhat node command in a screen-shared terminal because it prints test private keys.

Each setup run resets this dedicated local chain and replaces the generated configuration. It rejects any network name other than localhost, any URL other than the fixed loopback URL, a different chain ID, a non-Hardhat client or a forked chain. Resetting discards all transactions from the prior demo run. Do not use this node for unrelated work.

The setup deploys official Gnosis ConditionalTokens 1.0.3, six-decimal MockCollateral and the latest KhmerFPExchange. It prepares a binary condition, derives the real root YES/NO IDs, registers them with a cutoff, funds two traders and splits 20 mock USDC into 20 YES and 20 NO tokens for the seller.

## Accounts and balances

| Local signer index | Purpose | Setup |
| --- | --- | --- |
| 0 | Admin and demo oracle | Default admin; does not retain emergency role after setup |
| 1 | Emergency guardian | Can pause; cannot unpause |
| 2 | Backend operator | Explicit OPERATOR_ROLE grant |
| 3 | Buyer | 100 mock USDC; 10 mock USDC exchange allowance |
| 4 | Seller | 80 remaining mock USDC; 20 YES and 20 NO; explicit ERC-1155 exchange approval |

These accounts also have Hardhat's local ETH for gas. The seller's exact 20-USDC split allowance is consumed. The exchange itself grants no spending approval to CTF. CTF operator approval remains broad as required by ERC-1155.

## Round and price policy

The generated round is `BTC-USD-5M-<startTime>`. Times are UTC Unix seconds using the local chain clock:

- Start: the latest block timestamp just before condition preparation.
- Trading cutoff: start + 300 seconds.
- Earliest resolution: cutoff + 15 seconds.
- YES wins only when closing price is greater than opening price.
- NO wins for equal or lower closing price.

Configuration and funding consume several blocks after the start, so the full five-minute interval includes setup time. Run setup again if the round expires before testing. Hardhat's block time advances on transactions; it is not an autonomous production clock. The exchange enforces the cutoff at settlement entry, including exact equality. It does not wait for a future opening time or enforce resolution timing. Registration does not accept past cutoffs, and no method extends them. Cancellation is available after cutoff and while paused. Disabling and re-enabling the market cannot reopen expired trading.

Price source for this foundation is **LOCAL_FIXTURE_BTC_USD_DEMO**, a manually supplied local test fixture. It is not live Bitcoin pricing or a production oracle. Opening and closing samples initially remain null, and resolution is PENDING. No browser simulation or random price is treated as resolution evidence.

Each sample must contain:

```json
{
  "source": "LOCAL_FIXTURE_BTC_USD_DEMO",
  "sourceTimestamp": 1234567890,
  "recordedAt": 1234567891,
  "priceUsd6": "100000000000"
}
```

`priceUsd6` is a positive integer string with six decimal places implied: the example represents $100,000. The opening source timestamp must exactly equal startTime; closing must equal tradingCutoff. recordedAt must be no earlier than that boundary, no later than ten seconds after it, and not in the future relative to the evaluation time. Wrong source, absent samples, invalid prices, stale timestamps, early evaluation or malformed round data keep resolution pending.

`scripts/demo-price-policy.js` exports `evaluatePrices(round, opening, closing, now)`. It only evaluates evidence and returns PENDING or READY_FOR_DEMO_RESOLUTION with YES/NO. It never sends an oracle transaction or changes CTF state. A later demo resolver must save evidence and call reportPayouts from the configured oracle; that integration is not part of Stage 4.1. Manually authored timestamps do not prove real price capture. Switching to an external source requires an approved capture/recovery policy and new question terms.

## Backend discovery

Setup writes `contracts/deployments/local-bitcoin-demo.json` and prints the same public configuration. The generated file is Git-ignored and contains no keys. It includes:

- Chain ID and loopback RPC URL.
- Collateral, CTF and exchange addresses.
- Admin, guardian, operator, oracle and trader addresses.
- Round ID, question ID, condition ID, timing and price policy.
- YES/NO token and collection IDs as strings, with indexes 0/1 and sets 1/2.
- Initial token balances and relative Hardhat artifact paths for ABIs.

The backend should load this file at startup, resolve ABI paths relative to the contracts folder and verify code, chain ID, roles, market token IDs and cutoff against the chain. Invalidate cached data after every reset; deterministic deployment addresses alone do not identify a particular chain instance. If a future backend needs a path override, define a backend-only configuration such as LOCAL_DEMO_CONFIG_PATH; no current server environment variable is required or wired up.

The future local backend may use the unlocked operator through the loopback JSON-RPC signer for this demo. Do not expose unlocked RPC access remotely. Frontend users need account/wallet connection, domain-bound order signing, token approvals and confirmed balance reads. Neither existing fiat balances nor browser CREDIT_POSITION actions are on-chain funds.

## Tests and current limits

```sh
npm test
```

The 40 tests cover prior exchange behavior, official CTF identity, authorized settlement, invalid cutoffs, the before/at/after boundary, cancellation after cutoff, no deadline extension through status toggles, and the fixture price policy.

Setup was executed successfully twice against a persistent local node, confirming reset and artifact output. Public networks were not used. No migration or database write is needed. This does not implement an order API, matching engine, frontend signing, external price collection, payout reporting, redemption UI or automatic recurring rounds. Independent security review and dependency/static-analysis follow-up remain open.
