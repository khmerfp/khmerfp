# Local demo order API

This API is for the Stage 4.1 disposable Bitcoin round on Hardhat only. It uses mock collateral, not live BTC trading or fiat payment balances. It runs separately from the normal application so database initialization, hosted database credentials and payment routes are not started.

## Start

Use Node.js 22. From the repository root, install workspace dependencies with `npm ci`. In the contracts folder run `npm ci` if needed and `npm run compile`. Keep `npm run demo:node` running, then run `npm run demo:setup` in another terminal.

In PowerShell from the repository root:

```powershell
$env:NODE_ENV='development'
$env:LOCAL_DEMO_ENABLED='true'
npm run demo --workspace server
```

The API binds only to `127.0.0.1:4001`. It does not load server/.env or contracts/.env. No private key or DATABASE_URL is required. It uses the locally unlocked Hardhat operator through the fixed loopback RPC. Default test accounts and unlocked RPC are unsuitable for public networks. Approved browser origins are localhost/127.0.0.1 port 5173. Requests are limited to 60 per IP per minute, JSON bodies to 24 KB, and storage to 1,000 orders. No proxy is trusted.

Use the same hostname for frontend and API, preferably `127.0.0.1`, so the SameSite=Lax demo cookie works across ports. Mixing localhost and 127.0.0.1 can prevent browser cookies from being sent.

Run the latest setup first. The configuration now includes exact runtime code hashes and a Hardhat instance ID. Startup verifies those hashes, chain 31337, the Hardhat client, no fork, the real deployed MockCollateral bytecode, six decimals, exchange asset bindings and registered token IDs/cutoff. Every request and settlement rechecks the environment. A chain reset invalidates the running service and old journal even if addresses repeat.

## Authentication

The normal backend's `createRequireAuth`, cookie helpers and fixed-window limiter are reused. Demo sessions use an injected local user lookup and never query PostgreSQL. Existing production/application sessions do not become demo wallet authorization.

1. POST `/api/demo/auth/challenge` with `{ "wallet": "0x..." }`.
2. The wallet signs the returned message using personal-sign. The message binds wallet, chain, exchange, a random nonce and expiry.
3. POST `/api/demo/auth/verify` with `{ "nonce": "...", "signature": "0x..." }`.
4. Keep the returned HttpOnly session cookie; browser fetch must use `credentials: 'include'`.

Challenges are single-use with 60-second expiry. Sessions use a separate HttpOnly `khmerfp_demo_session` cookie, expire after 30 minutes and disappear on restart. This avoids overwriting the normal application's cookie across localhost ports. EOA and deployed EIP-1271 wallet proofs are supported. This establishes a local wallet principal; it does not link an existing KhmerFP database user to a wallet. That separate account-link flow remains required before normal application integration. An order maker must equal the proved session wallet; request bodies cannot supply user ownership or operator rights.

## Endpoints

| Endpoint | Purpose and access |
| --- | --- |
| GET `/api/demo/config` | Verified public local configuration and EIP-712 domain before wallet login |
| POST `/api/demo/auth/logout` | Invalidates the current demo session and clears its cookie, even after a chain reset |
| GET `/api/demo/market` | Authenticated public demo configuration and expected order domain |
| POST `/api/demo/orders` | Submit an authenticated maker's signed order |
| GET `/api/demo/orders` | Current user's orders with reconciled quantities and settlement status |
| GET `/api/demo/operator/orders` | Configured authenticated operator with active on-chain role; all stored public order records, without signatures |
| POST `/api/demo/matches` | Only the proved configured operator wallet; settle stored orders manually |
| GET `/api/demo/settlements` | Operator-only transaction status and hashes |

An order submission has exactly four fields: marketId, domain, order, signature. Use the GET market result for configuration; user-supplied contract addresses never configure the service.

The development browser entry point is documented in `client/LOCAL_BITCOIN_UI.md`. Public configuration has the same shape as the authenticated market response. Operator order listing returns an array using the existing public order shape, rather than accepting replacement order payloads. Logout is intentionally available before chain verification so a reset cannot prevent session cleanup.

```json
{
  "marketId": "BTC-USD-5M-<startTime>",
  "domain": {
    "name": "KhmerFP Exchange",
    "version": "1",
    "chainId": 31337,
    "verifyingContract": "<generated exchange address>"
  },
  "order": {
    "maker": "<authenticated wallet>",
    "tokenId": "<generated YES or NO ID>",
    "side": 0,
    "makerAmount": "650000",
    "takerAmount": "1000000",
    "nonce": "1",
    "expiration": "<cutoff timestamp as integer string>"
  },
  "signature": "0x..."
}
```

Use the exchange's exact EIP-712 types; side is numeric BUY=0 or SELL=1, while other integers are canonical decimal strings. BUY offers makerAmount collateral for takerAmount outcome units; SELL offers makerAmount outcome units for takerAmount collateral. Amounts use six-decimal token units. Demo prices must be strictly between zero and one. Expiry must be in the future and no later than cutoff. The API checks signatures, current fills/cancellation, enabled market, pause, remaining balances and approvals. For simplicity, the full remaining BUY budget or SELL quantity must currently be available; accepting an order does not reserve it against other orders.

Manual match request:

```json
{
  "buyId": "<stored buy order hash>",
  "sellId": "<stored sell order hash>",
  "quantity": "1000000",
  "payment": "620000"
}
```

The backend loads the signed orders itself. It rejects payload replacements, wrong sides/tokens, self trades, invalid prices, overfills, expiry/cutoff, revoked operators and paused/disabled markets. It revalidates signatures and balances immediately before simulating the exact call, then submits with the operator's reserved nonce. On-chain checks still decide success if state changes after simulation.

## Order and transaction lifecycle

Orders are OPEN, PARTIALLY_FILLED, FILLED or CANCELLED based on current contract state. Transaction records are separate:

- PENDING: intent and nonce saved before broadcast.
- SUBMITTED: transaction hash saved; receipt not yet confirmed.
- CONFIRMED: canonical successful receipt, matching TradeExecuted event and refreshed contract fill counters.
- FAILED: confirmed reverted receipt; quantities remain unfilled and a newly validated retry may proceed.
- REORGED: previously observed receipt disappears or its block is no longer canonical. Submissions stop for recovery.

Submission alone never marks an order filled. The current local policy waits for one block confirmation, which is appropriate only for this disposable environment. There is no continuous indexer; listing orders/settlements, matching and startup trigger reconciliation. Order responses include settlementStatus and transactionHash without returning signatures. Expired orders remain stored; validation rejects them even though their fill-derived status may remain OPEN.

## Storage, concurrency and recovery

`server/.local-demo/orders.json` is a private local journal with raw signed orders and transaction intents. It is Git-ignored and written through a synced temporary file and rename. There is no migration. One process owns a filesystem lock; one serialized queue covers mutations, reconciliation and settlement. All unresolved PENDING/SUBMITTED/REORGED attempts block further matches. Do not share the operator account with another service.

On restart, orders and transactions are loaded, receipts checked and fill counters refreshed. If a crash occurred after broadcast but before saving the hash, the service searches up to 1,000 local blocks for the recorded operator nonce, destination and exact calldata. It never automatically broadcasts an uncertain intent again. Unknown/replaced/pending transactions or reorgs require manual recovery; no automated reorg resubmission is implemented.

Stop the process cleanly before restarting. A crash leaves process.lock: verify its recorded process is no longer running before removing only that lock. After a chain reset, stop the API and archive/rename the old `.local-demo` directory before starting against the new deployment. Never delete recovery state merely to bypass an uncertain settlement. File permissions request owner-only access, but Windows ACLs and machine security still need attention. Sessions require a new wallet proof after restart.

## Tests and limits

Offline validation and default server tests:

```sh
npm run lint --workspace server
npm test --workspace server
```

Explicit integration test in PowerShell, with the dedicated demo node already running:

```powershell
$env:LOCAL_DEMO_INTEGRATION='true'
node --test server/test/localDemo.integration.test.js
```

The integration test resets only that disposable chain and uses temporary journals. It exercises real EOA and EIP-1271 signatures, wallet proof, ownership/domain/token/expiry/cancellation/allowance rejection, authorization, pause/revocation, duplicates, event confirmation, crash-window hash recovery, restart, transaction rollback and retry, reorg detection, closed markets and chain-reset rejection. It is skipped by default. The 40 exchange tests remain separate and unchanged by the API.

Next frontend work: wallet connection and proof, token-unit conversion with integers, EIP-712 signing, order/settlement status display and confirmed balance reads. The normal app's user-wallet link, durable financial reservations, a complete matcher, production finality policy, live Bitcoin price capture, oracle reporting and redemption UI remain outside this stage. No ABA/Bakong balances fund this demo.
