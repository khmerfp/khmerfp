# Exchange reuse evaluation

Review date: 13 November 2026. This is research and a local proof of concept. No adoption or production deployment is approved.

## Pinned sources

| Implementation | Exact revision | Build and license |
| --- | --- | --- |
| Polymarket V1 | `ed5c7708b7be3aa98bf5f0c6602b57cc498e2ef4` | `git describe`: `0.0.1-24-ged5c770`; Solidity 0.8.15, Foundry, 1,000,000 optimizer runs; MIT |
| Polymarket V2 | `ccc0596074f4dfd62c944fbca4de252893b82b4b` | No release tag established; Solidity 0.8.34 in `foundry.toml` and source (README says 0.8.30); Foundry, 1,000,000 optimizer runs; BUSL-1.1 |
| KhmerFP | Base commit `9f176fe98f5213149fa47807cc619dfe42ddc44c` plus preserved, uncommitted Stage 3.2 changes | Solidity 0.8.28, Hardhat 2.29.2, OpenZeppelin 5.4.0; custom source SPDX MIT; no independent audit |

Official source links: [V1 pinned tree](https://github.com/Polymarket/ctf-exchange/tree/ed5c7708b7be3aa98bf5f0c6602b57cc498e2ef4), [V2 pinned tree](https://github.com/Polymarket/ctf-exchange-v2/tree/ccc0596074f4dfd62c944fbca4de252893b82b4b). Local clones are `upstream-v1/` and `upstream-v2/`, with detached HEADs. They are ignored by the parent Git repository. No V2 code was copied into KhmerFP sources or the POC.

V1 is archived. Its pinned dependencies are OpenZeppelin `8769b19860863ed14e82ac78eb0d09449a49290b`, Solady `acd959aa4bd04720d640bf4e6a5c71037510cc4b`, Solmate `bff24e835192470ed38bf15dbed6084c2d723ace`, and forge-std `1801b0541f4fda118a10798fd3486bb7051c5dd6`. V2 gitlinks pin Solady to that same SHA and forge-std to `0844d7e1fc5e60d77b68e469bff60265f236c398`; V2 dependencies were not built or initialized. These pins come from each repository's Git tree, not dependency names alone.

## Licensing and audit references

V1's `LICENSE.md` grants MIT reuse, modification and commercial distribution subject to retaining its permission/copyright notices. Preserve the exact upstream license and applicable dependency notices when distributing source or substantial portions. The official Gnosis package is separately LGPL-3.0; owner/legal should review distribution of combined artifacts and any modified versions.

V2's `LICENSE.md` identifies Blockratize Inc. as licensor, has Additional Use Grant `None`, and specifies March 27, 2030 as Change Date with MIT as Change License. It permits non-production use. Its text requires a commercial license for use outside the current grant, and also contains a version-specific fourth-anniversary rule. Do not assume a public testnet, public demo, business service, or modified derivative is automatically permitted. Owner/legal must approve use, commercial terms, applicable change date, notices and distribution. This is a technical reading of the pinned text, not legal clearance.

V1 contains `audit/ChainSecurity_Polymarket_Exchange_audit.pdf`. V2 contains `audits/CTF Exchange V2 - Quantstamp - March 2026.pdf` and `audits/CTF Exchange V2 - Cantina - March 2026.pdf`. Their existence and README references were verified. Audit scope, audited SHA, unresolved findings and changes since the audited versions still need a report-by-report review. Neither these reports nor this POC audit KhmerFP changes.

## Feature comparison

V1 evidence paths below are relative to `upstream-v1/src/exchange/`. V2 uses the corresponding paths in `upstream-v2/src/exchange/` unless noted. V2 entries are source review only.

| Area | V1 | V2 | KhmerFP Stage 3.2 |
| --- | --- | --- | --- |
| Secondary BUY/SELL | Supported; operator matches taker and maker list | Supported; operator batching | Supported; one BUY and one SELL |
| Crossed prices | Maker ratio and taker minimum, surplus/refund handling | Crossing checks and batched settlement | Explicit payment/quantity ratio checked against both limits |
| BUY YES + BUY NO | CTF split via MINT | Batched MINT | Not supported |
| SELL YES + SELL NO | CTF merge via MERGE | Batched MERGE | Not supported |
| Partial fills | Maker-asset remaining; BUY fills counted in collateral | Packed remaining maker amount | Outcome quantity and cumulative collateral tracked |
| Rounding | Per-fill taking amount floors; tiny SELL fills can pay zero | Taking amount also floors in calculator; not executed here | Strict ceiling seller minimum / floor buyer maximum; rejects impossible fills |
| EIP-712 | Polymarket domain; salt, maker, signer, taker, fee, nonce, expiration | Different struct with timestamp, metadata, builder; no signed expiry/nonce fields | KhmerFP domain; maker, token, amounts, side, nonce, expiration |
| EIP-1271 | Signature type 3; signer equals wallet maker | Signature type 3 and validated preapproval path | OpenZeppelin SignatureChecker |
| Cancellation | User cancelOrder(s), maker nonce increment invalidates older epoch | No V1-style nonce manager or user cancelOrder in reviewed entry points; user pause and operator preapproval invalidation | User cancels order hash; nonce is salt-like identity, not epoch |
| Expiry | Zero means no expiry; checks expired timestamps | No expiry field in reviewed signed order; backend policy needed | Required future expiry |
| Operators | onlyOperator, admin manages roles | onlyOperator, admin roles | Anyone may submit valid signed pair |
| Token registration | Admin registry of complements and condition | No registry; derives/validates CTF positions | Same-token check only; no market allowlist |
| Emergency controls | Global admin pause | Global pause plus delayed user pause | None |
| Fees | Signed feeRateBps, fee calculator, operator receives fees | Explicit amounts, maximum rate and fee receiver | None |
| Reentrancy | Guard on settlement | No settlement guard; operator restriction is upstream rationale | OpenZeppelin guard |
| Callback risks | ERC-1155 receiver callbacks; privileged operator contracts need review | Operator-as-callback recipient deserves review; do not treat onlyOperator as universal protection | Callback tests still incomplete |
| Collateral | Direct ERC-20, unlimited exchange-to-CTF allowance | Separate collateral, CTF collateral and outcome factory; wrapper/adapters available | Direct ERC-20; no exchange-to-CTF allowance |
| Complexity | Multiple mixins, maker/taker routing, fees, registry | More assembly and wrapper/adapter surface | Small contract; fewer features and less external review |

Relevant evidence: V1 `CTFExchange.sol`, `mixins/Trading.sol`, `mixins/Signatures.sol`, `mixins/NonceManager.sol`, `mixins/Assets.sol`, `mixins/Registry.sol`, `libraries/CalculatorHelper.sol`, `libraries/OrderStructs.sol`; V2 `CTFExchange.sol`, `mixins/Trading.sol`, `mixins/Signatures.sol`, `mixins/UserPausable.sol`, `mixins/Assets.sol`, `libraries/Structs.sol`, `libraries/CalculatorHelper.sol`; KhmerFP `contracts/src/KhmerFPExchange.sol`.

V2's standard stack uses wrapped collateral, but its configurable `collateral`, `ctfCollateral`, and `outcomeTokenFactory` show that a direct-collateral configuration should be evaluated rather than assuming wrapping is mandatory. That configuration was not tested here.

## Executed local POC

`poc/v1.test.js` compiles the pinned V1 source unchanged with isolated solc 0.8.15 and its pinned dependency import paths. It uses the existing local Hardhat network, official Gnosis ConditionalTokens 1.0.3, 6-decimal MockCollateral, and the existing Mock1271Wallet. The deployer is the operator; proxy/safe factory addresses are zero because only EOA and type-3 EIP-1271 paths are exercised. No hosted RPC or real funds are used.

| Scenario | Result |
| --- | --- |
| BUY 0.65 / SELL 0.60 | Passed: one YES transferred; buyer pays 0.60 after 0.05 refund |
| Partial fills and cancellation | Passed: half fill updates remaining; cancelled order rejected |
| EIP-1271 | Passed: deployed smart wallet signs and receives CTF |
| BUY YES 0.60 + BUY NO 0.40 | Passed: real CTF split, each buyer receives one outcome, one collateral unit locked |
| SELL YES + SELL NO | Passed: real CTF merge; collateral unlocked and distributed |
| Invalid signature and late transfer failure | Passed: forged signature rejected; missing CTF approval reverts buyer debit and order state |
| Tiny-fill rounding probe | Reproduced: ask 2 collateral units / 3 outcome units, fill 1 outcome unit, seller payment 0 |

Combined run: **25 passing** under Node 22.23.5: 7 research tests plus all 18 unchanged KhmerFP tests. The rounding probe passes because it asserts the observed risk; it is not a safety endorsement. No V2 tests were run. Upstream Foundry suites, adversarial callback suites, fee scenarios, full nonce/expiry coverage and Base compatibility tests were not run.

The V1 crossed trade used **197,206 gas** locally and compiled to **17,603 runtime bytes** with the POC compiler settings. Gas excludes preparation, approvals and deployment. This is one zero-fee scenario, not a production benchmark. V2 README claims lower gas in its own snapshots; those numbers were not reproduced and are not directly comparable to this harness. A matching custom-contract gas benchmark was not collected.

## Reproduce

From `contracts/research`, clone the official repositories into `upstream-v1` and `upstream-v2`, then checkout the SHAs listed above with `git checkout --detach <SHA>`. For V1, run `git submodule update --init --recursive`. Keep both upstream license files intact.

From `contracts` with Node 22:

```sh
npm ci
npm ci --prefix research/poc
npm run compile
node node_modules/hardhat/internal/cli/cli.js test --no-compile research/poc/v1.test.js test/KhmerFPExchange.test.js
```

The isolated legacy solc package reports two npm findings (one low, one high) at installation. Keep it in local research only. No application dependencies or compiler configuration were changed for this POC.
