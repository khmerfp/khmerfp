# Wallet browser tests

This standalone test package is not an application runtime dependency.

Use Node.js 22 and Docker Desktop with a working Linux engine. From the repository root:

```powershell
npm ci --prefix tools/wallet-browser-e2e --ignore-scripts
npx.cmd --yes --package=node@22 node tools/wallet-browser-e2e/node_modules/playwright/cli.js install chromium
npx.cmd --yes --package=node@22 node tools/wallet-browser-e2e/run.js
npx.cmd --yes --package=node@22 node --test tools/wallet-browser-e2e/safety.test.js
```

The runner creates its own labelled postgres:16 container on 127.0.0.1:55436. It refuses an existing container with the same name. Test servers use ports 5187 and 4017 on loopback; both must be free. The container is removed after the run, including test failure. If the runner is forcibly killed, inspect its exact ID and khmerfp.disposable=wallet-browser label before stopping it. Never remove unrelated containers.

The fixture verifies PostgreSQL 16, its dedicated database, anonymous volume, empty schema and immutable artifacts before applying the nine existing migrations. It loads no .env files.

The real page, login form, HTTP cookies, linking API, service and PostgreSQL repository run together. The Coinbase adapter and EIP-1271 RPC are simulated. Signatures come from random in-memory test signers, never a real wallet. Each case gets a fresh app instance with unchanged rate limits; authentication rate-limit fixture rows are reset between cases. Unlink/relink explicitly seed a fresh step-up timestamp, not a real Telegram factor verification.

Normal application entry points never import these tools. There is no production mock flag. The fixture accepts only NODE_ENV=test with the runner opt-in and a per-run random token. Test controls require that token and loopback host/peer. Browser non-local requests are blocked. Never expose this fixture publicly.

Browser output is ignored by Git. Trace/video and automatic failure screenshots are off. Explicit screenshots contain synthetic fixture data only.

Results and limitations: docs/COINBASE_WALLET_BROWSER_E2E_REPORT.md.
