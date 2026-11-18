# Coinbase first-use deployment feasibility

Stage 4.3Q, 17 November 2026 (Asia/Calcutta).
Repository: F:/khmerfp-matching-contract.
Tester: 0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC.
Network: Base Sepolia, 84532 (0x14a34).
Installed SDK: @base-org/account 2.6.0.

## Decision: BLOCKED

We cannot establish that wallet_sendCalls will initialize this exact tester
account on Base Sepolia, or obtain a reliable unsigned deployment/fee preview
through a confirmed supported universal-account API. Do not request a signature,
open a submission flow to find out, fund the account as an experiment, or deploy.

This is insufficient evidence, not proof that Coinbase can never deploy it.
The general wallet-managed request exists; exact-account provisioning, account
setup effects, sender/creation identity and gas coverage are still unresolved.
Capability flags do not resolve those questions. Work stops at this boundary.

## Verified facts and their limits

| Evidence | Verified observation | Limit |
| --- | --- | --- |
| Tester-provided SDK inspection | Same public account; chain 84532; Base Sepolia capability entry; atomic and paymaster support advertised | Connection is not ownership proof; capabilities are not provisioning or sponsorship commitments |
| Stage 4.3P public RPC | Code 0x and native balance 0 wei at blocks 59739120 and 59739703 | Sampled historical results, not a claim of unchanged current state; EntryPoint deposits were not inspected |
| Known shared infrastructure | v1.1 Coinbase factory/implementation pinned and read-verified in Stage 4.3N | Does not establish this account's factory, implementation, owners or account type |
| SDK request dispatch | Universal wallet_sendCalls is sent to the hosted wallet popup | Hosted wallet can reject this account/network; no reviewed proof of its provisioning logic |
| Existing self-call draft | Fixed Base Sepolia sender and recipient, zero explicit value, empty calldata; submission disabled | Does not prove initialization, complete fees or absence of implicit setup effects |
| Offline tests | The public tester address remains the draft's exact from/to | Not an address derivation, onchain simulation or deployment proof |

The original public inspection evidence is in
[COINBASE_TESTER_WALLET_INSPECTION.md](COINBASE_TESTER_WALLET_INSPECTION.md).
No new live wallet interaction or public RPC was performed for Stage 4.3Q.

## Official documentation and installed behavior

The current [Coinbase Wallet SDK overview](https://docs.cdp.coinbase.com/coinbase-wallet/overview)
recommends @base-org/account. It does not document a successful first-use deployment
for this particular address or provide an account-specific unsigned quote.

[EIP-5792](https://eips.ethereum.org/EIPS/eip-5792) defines wallet_sendCalls as an
execution request and capability discovery as a separate concern. It is not a
non-submitting simulation method. A wallet may reject a sender or calls. Under
atomicRequired it can also need to upgrade atomicity before execution. These rules
do not guarantee classic Coinbase proxy deployment for a code-empty address.

The installed SDK source is the implementation evidence:

| Installed file | Finding |
| --- | --- |
| dist/sign/base-account/Signer.js | Explicit wallet_sendCalls case forwards to sendRequestToPopup |
| Same file, default dispatch | Unrecognized methods fall through to fetchRPCRequest at this.chain.rpcUrl, or fail if no RPC is set |
| dist/core/rpc/wallet_prepareCalls.d.ts | A type describes a signature request and opaque userOp; type presence is not proof of universal-account support |
| dist/sign/base-account/utils/createSubAccountSigner.js | Explicit wallet_prepareCalls handling exists in the internal subaccount path |
| Same file, wallet_sendCalls branch | It prepares, calls an owner signing method, then sends prepared calls; invoking that combined flow would violate this stage |
| dist/sign/base-account/utils.js | Builds version '1.0' wallet_sendCalls requests; no standalone universal deployment-only method is established |

Consequently, it would be incorrect to claim the SDK has no preparation-related
code at all. It would also be incorrect to claim a type or subaccount handler proves
this exact universal account can prepare unsigned deployment on Base Sepolia.
The fallback RPC might implement extra methods, but no documented supported
endpoint/account contract for that path was established. We did not probe it.

The [Wallet Call Preparation API](https://ercs.ethereum.org/ERCS/erc-7836) describes
wallet_prepareCalls separately from wallet_sendPreparedCalls. That standard-level
proposal does not prove Coinbase's installed universal provider supports it, nor
that its response includes a complete and reliable quote for this account.
Other vendors' preparation APIs cannot establish compatibility with this Coinbase
account and are not substituted here.

[Upstream issue #363](https://github.com/base/account-sdk/issues/363) reports
Base Sepolia provisioning failures for some newly created 7702 accounts despite
positive capabilities. This is a report for particular versions/account paths,
not proof the tester is a 7702 account or that 2.6.0 has the identical failure.
It prevents us from using advertised support as sufficient evidence.

## Non-submitting preparation and simulation

No supported non-submitting universal-account deployment/quote method was confirmed
in the reviewed documentation and installed source. The following are not valid
substitutes:

- wallet_sendCalls: can request signing and submission. Do not invoke it merely to
  open a fee preview or rely on cancelling a popup as the safety boundary.
- wallet_prepareCalls through the internal subaccount signer: a different account
  path; it must not silently create a subaccount, owner or permission.
- A generic eth_estimateGas to the empty tester address: may estimate an ordinary
  call without deploying anything, so it omits the intended account setup.
- eth_call/eth_simulateV1 with fabricated state overrides: cannot prove the hosted
  wallet's actual deployment context, ownership, account type or chosen operation.
- eth_estimateUserOperationGas without authentic wallet-provided operation data,
  EntryPoint version and supported signature estimation: insufficient context.
- A guessed factory createAccount call or a signature requested just to extract
  6492 metadata: outside the approved flow; never fabricate owners/nonces.

The non-submitting next step is official Coinbase confirmation/documentation of an
unsigned preparation endpoint for this exact account/network, if one exists.
Review its method semantics before allowing it through the local guard. It must
not sign, submit, create permissions, initialize an account onchain or silently
switch account type. If Coinbase only offers a combined signing/submission UI,
that is a separate permission model and this stage must remain stopped.

## Gas and sponsorship evidence required

A reliable result must bind to this address, chain 84532 and the exact approved
operation. We need:

1. Authentic unsigned operation/context or another official non-submitting quote
   with account type, intended sender, initialization/delegation and call effects.
2. Applicable wallet implementation, factory or delegation path, EntryPoint and
   bundler identity/version, wherever those components are used.
3. Complete maximum cost and validity: creation, verification and execution gas,
   pre-verification overhead, fee parameters and applicable L2/L1 fee components.
   A nominal call gas number is not the complete maximum spend.
4. Identified gas payer and any relevant deposit/prefund requirement.
5. If sponsored, operation-specific paymaster acceptance/terms, maximum coverage,
   validity and any remaining user charge. Policy eligibility or stub data alone
   is not final sponsorship. Do not acquire a server-wallet secret to obtain it.
6. A supported simulation/preparation result with no hidden owner update, permission,
   real-balance funding, unapproved delegation or account substitution.

Zero account ETH does not alone prove the transaction cannot be funded, because
a paymaster or existing deposit could cover it. Neither coverage has been verified.
If neither covers the actual operation, the approved gas payer needs Base Sepolia
test ETH. We cannot give a safe amount or tell the tester to fund the wallet until
that quote/funding path is known. Sending test ETH will not itself deploy a wallet
and does not fix an unsupported provisioning flow. No mainnet/real-balance bridge
or auxiliary funding request is allowed.

## Zero-value self-call: explicit versus implicit effects

The unexecuted candidate is:

~~~js
{
  method: 'wallet_sendCalls',
  params: [{
    version: '1.0',
    chainId: '0x14a34',
    from: '0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC',
    atomicRequired: true,
    calls: [{
      to: '0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC',
      value: '0x0',
      data: '0x',
    }],
  }],
}
~~~

Its explicit payload contains no ETH transfer to another address, token call,
allowance or arbitrary target. It is not an assurance of zero cost or zero setup:

- A compatible counterfactual account could be created/initialized by the wallet.
- A different account could need delegation or an atomicity upgrade.
- The wallet could select an auxiliary funding/paymaster path and charge fees.
- Account owners, recovery modules or other initialization can be set internally.
- An EOA could simply execute a self-call and still have no expected proxy code.
- Even a failed operation may consume gas. Submission uncertainty requires
  reconciliation, not automatic retry or a claim of success.

These are possible effects, not observed effects for this account. The user has
not approved them. No application request is forwarded; all existing guards and
the disabled deployment button remain intact.

## Same-address deployment evidence

The draft binds from/to to the exact reviewed SDK address. That verifies request
identity, not the resulting contract. We cannot currently prove that a contract
would be created there under this wallet's actual initialization path.

Before manual execution approval, obtain official account-specific preparation or
provisioning evidence showing the intended sender/deployment address is exactly
0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC. For a wallet-managed flow, the app need
not reconstruct raw owners and factory nonce; it still needs trustworthy sender
and setup evidence. A documented direct-factory alternative would require its
actual authentic initialization data and independent prediction, not guesses.

If a later stage is approved and executed, require a successful receipt on 84532,
then eth_getCode at that exact address and receipt block, stable block/hash,
expected proxy/implementation or separately approved delegation, and matching
creation provenance. Require the SDK still selects the same account. Code existence
alone is not ownership proof. EIP-1271 verification remains a separate approved
action after deployment; it is not performed to bypass this uncertainty.

## Required evidence checklist before approval

- [ ] Coinbase identifies this exact account's underlying type and confirms its
      Base Sepolia first-use path is supported.
- [ ] A documented non-submitting preparation/quote method for that account and
      installed integration is identified and reviewed.
- [ ] Preparation confirms the exact sender/account address and all setup effects.
- [ ] Simulation/quote covers the full operation with a maximum test fee and expiry.
- [ ] Gas funding/deposit or actual paymaster coverage is confirmed.
- [ ] No change of tester account, ownership, unapproved delegation or real-fund use.
- [ ] The unresolved SDK risks have an explicit isolated-test security decision.
- [ ] Any submission implementation is separately reviewed; the user then approves
      the exact address/network/request/effects and maximum fee or sponsorship.

None of the missing items is filled by atomic.supported or paymasterService.supported.
No approval is requested in this report because the necessary evidence is missing.

## Exact next external question

The tester can ask official Coinbase developer support the following. No message
was sent by this agent, and no credentials/signatures are needed:

> For @base-org/account 2.6.0, connected universal account
> 0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC has no code on Base Sepolia 84532,
> while wallet_getCapabilities advertises atomic and paymaster support. Is first-use
> provisioning supported for this exact account type/network? Is it a factory-based
> account or a 7702 path? Which documented API returns unsigned setup/operation data,
> intended sender, complete maximum fee and actual sponsorship status without a
> signing prompt or submission? If unavailable, what officially supported testnet
> flow preserves this same tester-controlled account address?

Share only the intended public test address with the chosen official support channel.
If Coinbase cannot provide a supported path/evidence, the blocker stands. Do not
invent an EOA/server-wallet/subaccount substitution or deploy a new wallet contract.

## Local validation and scope

Two offline regressions were added to the existing inspection/request tests:
capability advertisements cannot unlock preparation, quote or submission calls;
and the tester-specific draft keeps the same sender/self-call while still marking
deployment unverified. All 42 offline tests passed, including the previous 40.
Node lint, syntax and whitespace checks are completed before reporting. These
checks are not a simulation of Coinbase's hosted wallet or a production security audit.

No production code, dependency, migration, contract or permission rule changed.
No wallet reconnection, signing request, transaction/UserOperation submission,
deployment, commit or push occurred. The earlier read-only page remains separate;
its existence is not authorization to perform a new action.

**Final status: BLOCKED. Stop before signing or deployment.**
