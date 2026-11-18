# Coinbase deployment preparation

Read-only Base Sepolia preview. No submission or signing path exists.
See [the deployment plan](../../docs/COINBASE_SMART_WALLET_DEPLOYMENT_PLAN.md)
for verified factory evidence, SDK metadata blockers and approval requirements.

From the repository root, run offline tests:

```powershell
npx.cmd --yes --package=node@22 node --test tools/coinbase-deployment/preview.test.js tools/coinbase-deployment/server.test.js
```

To inspect a public address manually, after reviewing the SDK risks:

```powershell
$env:COINBASE_DEPLOY_PREVIEW_ENABLED = 'true'
npx.cmd --yes --package=node@22 node tools/coinbase-deployment/server.js
```

Open http://127.0.0.1:5185. Startup itself makes no wallet/RPC call. The separate
buttons connect through Coinbase or inspect an entered address. The deployment
button stays disabled; the universal account owners, nonce, prediction and fee
quote are not yet available. Code presence alone does not prove wallet ownership.
No .env, database, private key, signing secret or production session is used.

Public bytecode in fixtures/public-contracts.json is captured chain data for
offline integrity tests, not a newly deployed or compiled contract. The original
Coinbase contracts are MIT licensed; source and deployment evidence are linked
in the plan. No wallet contract source is copied or modified here.

Stage 4.3O adds a pure firstUseRequest.js draft builder and offline tests. It
does not submit the draft or unlock deployment. Raw factory metadata is not an
inherent app requirement for wallet-managed execution; exact-account Base
Sepolia support still needs confirmation. See
[the resolution](../../docs/COINBASE_WALLET_DEPLOYMENT_RESOLUTION.md).
