# Isolated Coinbase ownership probe

This tool is opt-in and separate from the KhmerFP app. No real wallet interaction
has been verified yet. See the complete configuration, risk review and manual
steps in [the verification plan](../../docs/COINBASE_REAL_WALLET_VERIFICATION_PLAN.md#stage-43m-implemented-isolated-harness).

Run offline tests from the repository root:

```powershell
npx.cmd --yes --package=node@22 node --test tools/coinbase-verification/harness.test.js tools/coinbase-verification/server.test.js
```

After separate execution approval and configuration, the entry point is:

```powershell
npx.cmd --yes --package=node@22 node tools/coinbase-verification/server.js
```

Missing opt-in or a placeholder wallet refuses startup. The isolated page uses
127.0.0.1:5184; it has no automatic connection or signing. Startup makes no public
RPC call. Manual buttons perform preflight, connection, fresh challenge creation,
then explicit passkey signing and read-only verification. Do not run the manual
flow before approval. No database, transactions, deployment or token permissions
are part of this tool. Proofs stay in memory and are lost at process shutdown.
