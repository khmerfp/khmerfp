# Local demo: complete trade test

This test checks one trade from the browser to the local blockchain. It uses mock USDC and existing YES inventory. It does not test live Bitcoin prices, winner resolution or redemption.

## Prepare before starting the timer

- Use Node.js 22 and the matching-contract worktree.
- Import the buyer, seller and operator local test accounts before creating the round. Use only local test keys, never real funds.
- Select Hardhat Local, chain 31337, with RPC `http://127.0.0.1:8545`.
- Keep the local chain and frontend running. Open `http://127.0.0.1:5173/local-demo/bitcoin`.
- Follow [the startup and recovery guide](LOCAL_BITCOIN_UI.md) to stop the demo API, archive its journal, create a fresh round and restart the API. Never reset the chain in the middle of this test.

The configured public addresses are in `contracts/deployments/local-bitcoin-demo.json`. BUY/SELL describes the trade direction; YES/NO describes the outcome token. In this test both users trade YES.

## Browser test diagram

```mermaid
flowchart TD
    A["Prepare buyer, seller and operator wallets"] --> B["Create a fresh local round<br/>Restart API and reload page"]
    B --> C["Buyer connects and signs login<br/>Check 100 mock USDC"]
    C --> D["BUY YES<br/>Quantity 1, limit price 0.60"]
    D --> E["Approve exact ticket cost if needed<br/>Wait for approval confirmation"]
    E --> F["Sign and submit BUY order<br/>Check OPEN and remaining 1"]
    F --> G["Disconnect demo session<br/>Switch to seller and sign login"]
    G --> H["Check 80 mock USDC and 20 YES<br/>SELL YES: quantity 1, price 0.60"]
    H --> I["Approve CTF operator if needed<br/>Wait, then sign and submit SELL"]
    I --> J["Check OPEN and remaining 1<br/>Disconnect and connect operator"]
    J --> K["Close ticket and open operator panel<br/>Select stored BUY and SELL IDs"]
    K --> L["Fill quantity 1<br/>Execution price 0.60"]
    L --> M{"Before cutoff and both orders valid?"}
    M -->|No| N["No settlement<br/>Inspect error; do not claim a trade"]
    M -->|Yes| O["Backend simulates exact contract call<br/>Operator submits settlement"]
    O --> P{"Backend settlement status"}
    P -->|CONFIRMED| Q["Both orders FILLED<br/>Remaining quantity 0"]
    P -->|FAILED| R["Inspect confirmed failure<br/>Revalidate before any retry"]
    P -->|"PENDING / SUBMITTED / REORGED"| S["Wait for reconciliation<br/>Do not blindly resubmit"]
    Q --> T["Reconnect buyer and seller<br/>Refresh actual token balances"]
    T --> U["Buyer: 99.40 mock USDC and 1 YES<br/>Seller: 80.60 mock USDC and 19 YES"]
```

Use one BUY and one SELL order for this test. Signing twice creates separate orders when the nonces differ. Cancel unwanted orders rather than assuming they replace each other. All submission and settlement steps must finish before the five-minute cutoff.

When using one browser profile, disconnect the demo session before changing wallet accounts, then reconnect and sign the new login. Tabs in that profile share the same demo cookie. Separate browser profiles can keep separate sessions.

## What each part does

```mermaid
sequenceDiagram
    actor Buyer
    actor Seller
    actor Operator
    participant UI as Demo frontend
    participant API as Local demo API
    participant Chain as Local Hardhat contracts

    Note over Buyer,Chain: Each account signs its own wallet login before using its session
    Buyer->>Chain: Approve bounded mock USDC spending if needed
    Buyer->>UI: Sign BUY YES order using EIP-712
    UI->>API: Submit signed BUY order
    API->>Chain: Read signature validity, market, balances and approvals
    API-->>UI: Store order and return OPEN
    Seller->>Chain: Approve exchange as CTF operator if needed
    Seller->>UI: Sign SELL YES order using EIP-712
    UI->>API: Submit signed SELL order
    API->>Chain: Read signature validity, market, balances and approvals
    API-->>UI: Store order and return OPEN
    Operator->>UI: Select two stored order IDs and fill amounts
    UI->>API: Request manual match
    API->>Chain: Revalidate and simulate exact settlement call
    API->>Chain: Submit transaction using backend operator signer
    Note over Chain: Atomically transfer 0.60 mock USDC and 1 YES<br/>Record fills and emit TradeExecuted
    API->>Chain: Check canonical receipt, event and order fill counters
    API-->>UI: CONFIRMED only after verification
    UI->>Chain: Read actual wallet token balances
    UI-->>Buyer: 99.40 mock USDC and 1 YES
    UI-->>Seller: 80.60 mock USDC and 19 YES
```

The API keeps signed orders in its local journal, not in the production database. The browser never receives the backend operator's signing credentials. A signed order alone moves no tokens. Approvals are separate on-chain transactions, and the final settlement transfers both assets atomically.

The seller's ERC-1155 operator approval covers all its positions in this CTF contract. It is broader than the buyer's bounded ERC-20 allowance. Use the local test accounts and revoke the operator approval when no longer needed.

## Pass checklist

| Check | Expected result |
| --- | --- |
| Buyer login | Correct buyer address and 100 mock USDC after fresh setup |
| Seller login | Correct seller address, 80 mock USDC, 20 YES and 20 NO |
| Submitted orders | One BUY and one SELL, same YES token ID, each remaining 1 |
| Operator access | Configured authenticated operator has the on-chain role |
| Settlement | Backend reports CONFIRMED with a transaction hash |
| Orders after settlement | Both FILLED, remaining 0 |
| Buyer after settlement | 99.40 mock USDC, 1 YES, 0 NO |
| Seller after settlement | 80.60 mock USDC, 19 YES, 20 NO |
| Payment conservation | Buyer pays exactly 0.60; seller receives exactly 0.60 mock USDC |
| Position conservation | Buyer gains exactly the 1 YES token the seller gives up |

These balance expectations assume a fresh setup and exactly one successful fill at 0.60. Local ETH pays transaction gas separately and is not included in this table. MetaMask's fiat portfolio total is not the mock USDC balance; check the demo's contract-read balances.

Keep the round ID, both order IDs, settlement transaction hash and before/after balances as test evidence. Never include private keys or recovery phrases.

## Failure checks

Run each check with valid setup and enough time left. For a failed match, confirm that there is no successful TradeExecuted event and no fill-counter or asset-balance change caused by that attempt. A reverted transaction can still consume local ETH gas.

| Test | Expected result |
| --- | --- |
| Cancel an order, then attempt to match it | Rejected; no settlement of the cancelled order |
| BUY limit 0.55 against SELL limit 0.60 | Rejected; no acceptable execution price |
| Attempt settlement at or after cutoff | Rejected |
| Use buyer session to request matching | Rejected; operator authorization required |
| Reuse a fully filled order | Rejected; cannot overfill |
| Remove the required allowance or approval | Rejected; no partial asset transfer |

## Current test status and scope

The buyer's browser login, mock balance, signing, order storage, cancellation and expiry have been observed. The complete buyer-to-seller browser settlement remains pending until every pass check above is recorded. Passing automated tests is separate evidence and does not mark this manual test complete.

BTC opening and closing fixtures are currently missing. The chart can remain empty throughout this trade test. After settlement is verified, separate work is still needed for price evidence, authorized resolution and redemption of winning positions.
