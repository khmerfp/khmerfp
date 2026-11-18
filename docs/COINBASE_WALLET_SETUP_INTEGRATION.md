# Coinbase wallet setup integration

Status: read-only readiness handling implemented locally. Original account setup remains unavailable. No live setup or signing test was run.

## What the code does

The account page connects through the existing Coinbase SDK. The setup coordinator checks the connected address and chain before and after public RPC reads. It requires Base Sepolia 84532, reads code at a specific block, and checks that block hash again. Unknown results, timeouts, changed blocks and RPC failures keep ownership signing blocked. Network or account changes reject the check. A manual Check setup again button repeats only these reads.

The coordinator has no send, signing, deployment, funding, factory creation, delegation or permission method. It does not import the separate-wallet deployment draft. The backend deployed-code check and EIP-1271 signature verifier are unchanged. Production feature flags are unchanged.

## State meanings

| State | Meaning |
| --- | --- |
| Disconnected | No connected account. |
| Connected, setup required | Code read returned 0x; setupRequired is true. |
| Setup unavailable | No supported account-specific operation and quote is verified, or the read failed. This is the current empty-code outcome. |
| Setup ready for review | Reserved; never emitted by this implementation. Requires a supported prepared operation, exact setup effects, expected address, payer and bounded quote. |
| Setup pending confirmation | Reserved; no submission or confirmation workflow exists here. |
| Code detected | Public code exists at the connected address. This does not establish Coinbase implementation identity, ownership or signature compatibility. |
| Deployed and verified | Reserved; code presence alone cannot enter this state. A future approved setup flow must verify its receipt, resulting implementation and ownership configuration. |
| Ownership verified | Requires the existing backend's real EIP-1271 proof. Not produced by setup inspection. |
| Linked | Shown only after backend verification and persistence return successfully. |

No fee payer, cost, setup mechanism or effects are guessed. Those values remain unknown, and no executable review button is shown. The page presents the connected address and required network. Existing ownership actions remain disabled without code; a positive code read only permits attempting the existing strict backend proof.

## Evidence and limits

Installed @base-org/account is 2.6.0. Its universal-account dispatcher forwards wallet_sendCalls to the hosted wallet. Its helper uses request version 1.0 while the current method reference describes 2.0.0. Existing offline tests establish routing for both versions, not live acceptance or a deployment mechanism.

The original account 0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC was last observed with no code and 0.01 test ETH at Base Sepolia block 60096233. No live setup request was made, so there is no confirmed setup rejection for this tester. The upstream account-readiness report is a hypothesis for this account, not a diagnosed cause. Empty code does not identify factory creation versus EIP-7702 delegation.

No safe account-specific setup operation was established from the reviewed resources. Development stops at the unavailable state. The separate EOA-owned factory wallet has a different address and acceptance scope and cannot resolve this original-account requirement.

## Tests and review gates

Offline coordinator tests cover disconnection, empty code, code presence without ownership, wrong wallet/RPC chains, changed accounts, cancellation, RPC errors, changed blocks, malformed code, timeouts and unreachable approval states. Existing connection and page tests remain relevant. These are simulations and do not prove real Coinbase signing or deployment.

Before any future setup implementation: establish the actual account type and supported method; obtain an unsigned operation, complete fee quote and payer; verify expected account address and setup/delegation/upgrade effects; obtain separate approval for signing/submission. After confirmation, verify actual resulting state. Ownership signing and local persistence testing need their own approval. Never remove the deployed-code or EIP-1271 guards to proceed.

## Sources

- [Coinbase wallet_sendCalls execution reference](https://docs.cdp.coinbase.com/coinbase-wallet/reference/core/provider-rpc-methods/wallet_sendCalls)
- [Upstream account readiness report, not proof for this tester](https://github.com/base/account-sdk/issues/363)
- [Earlier detailed investigation](COINBASE_WALLET_DEPLOYMENT_RESOLUTION.md)

## Local validation results

- Node.js 22: 44 focused tests passed (13 coordinator, 7 existing connection, 24 page tests).
- Targeted frontend lint passed. JavaScript syntax checks passed.
- Local Vite production-bundle build passed; dependency pure-annotation warnings were reported. The test runner also reported a Tailwind content configuration warning.
- Failed rechecks immediately clear earlier readiness, including thrown network errors. Stale account results are discarded.
- No real Coinbase connection, signature, setup, deployment, database operation or end-to-end real-wallet verification was executed in this task.
- No backend guards, feature flags, dependencies, migrations or schemas were changed in this task. Prior local changes were preserved.
