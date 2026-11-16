# Coinbase wallet ownership and KhmerFP accounts

Stage 4.3G update: CI preparation and the latest dependency assessment are in
[GITHUB_CI_READINESS.md](GITHUB_CI_READINESS.md) and
[DEPENDENCY_SECURITY_REVIEW.md](DEPENDENCY_SECURITY_REVIEW.md). The current root
audit has 17 affected entries after targeted ethers/ESLint fixes; earlier counts
below are historical. Wallet linking remains disabled and real proof is pending.

Stages 4.3B–4.3E. Implementation is feature-gated. Final migration 0008 is generated
and tested only on disposable PostgreSQL. The original proposal remains a historical
reference. No migration was applied to the application database, and no real
Coinbase ownership link has been persisted during this work.

## Workflow in simple English

1. Sign in with your existing KhmerFP account using the existing login system.
2. Connect your user-controlled Coinbase passkey wallet on Base Sepolia.
3. KhmerFP gives you a unique message saying which account, wallet, network and action you are authorizing. It expires after two minutes.
4. Sign that ownership message through your wallet. This is not a trade, token approval or transfer.
5. The server checks your application session and the wallet contract's signature verification, then saves the ownership link atomically.
6. A used message cannot be used again. Changing accounts or sessions requires a new message.

The server never obtains your wallet signing key. Linking does not let the server sign orders, settle as you, spend tokens, or log in as you using only an address.

```mermaid
sequenceDiagram
    actor User
    participant UI as KhmerFP account page
    participant Auth as Existing application session
    participant API as Wallet-link API
    participant DB as PostgreSQL
    participant Wallet as Coinbase Smart Wallet
    participant Chain as Base Sepolia read-only RPC
    User->>Auth: Existing KhmerFP login
    User->>Wallet: Passkey connection
    UI->>API: Request challenge for connected address and action
    API->>DB: Validate session and ownership rules
    API->>DB: Store short-lived challenge bound to user and session
    API-->>UI: Server-generated EIP-712 ownership message
    UI->>UI: Check domain, user, wallet, origin, action and expiry
    User->>Wallet: Approve ownership signature
    UI->>API: Challenge ID and signature only
    API->>DB: Lock session and challenge; consume valid-context attempt
    API->>Chain: Verify deployed wallet EIP-1271 signature
    API->>DB: Recheck session and expiry; lock user and wallet identity
    API->>DB: Update identity and append audit evidence in one transaction
    API-->>UI: Confirm ownership link; no trading permissions granted
```

## Existing architecture reused

- `requireAuth` and `getAuthenticatedUser()` validate the normal KhmerFP session cookie. The local demo cookie is not accepted.
- `sessions.token_hash`, expiry, revocation and `step_up_at` bind requests to the current application session. The service checks that session again within its transaction.
- `user_wallets` stores chain/address identities, smart-account type, custody model, provider metadata and verified ownership state.
- Existing unique `(chain_id, wallet_address)` prevents one chain/address identity from being assigned to two users. The existing identity trigger prevents changing its user, chain or address.
- `auth_audit_logs` receives ownership-result evidence without raw signatures, cookies, session hashes or private keys.
- The frontend reuses `AuthProvider`, the normal authentication modal, application cookies, styling and account navigation. It uses `@base-org/account`, not a CDP server-wallet API key.

`wallet_authorizations` is intentionally unchanged. Its scopes are ORDER_SIGNING, TRADE_SETTLEMENT, CTF_OPERATIONS and REDEMPTION, and its records require a target. None is an ownership-login scope. Inserting a fake trade authorization to represent a wallet link would grant the wrong meaning.

## Account-link policy

| Rule | Behavior |
| --- | --- |
| One user, multiple wallets | Allowed, maximum ten non-revoked identities per chain |
| One chain/address, multiple users | Rejected, including concurrent verification attempts |
| Same address on different chains | Separate identities; this release allows only chain 84532 |
| Duplicate LINK | Rejected; no silent overwrite or idempotent ownership reassignment |
| New identity | SMART_ACCOUNT, USER_CONTROLLED, VERIFIED, ACTIVE, `is_primary=false` only after proof |
| Provider label | BASE_ACCOUNT_SDK identifies the integration, not a cryptographic Coinbase-brand attestation |
| UNLINK | Fresh wallet signature and application step-up within five minutes; mark identity REVOKED and clear primary flag |
| RELINK | Same original user only, identity must be REVOKED, fresh wallet signature plus application step-up |
| SUSPENDED wallet | Cannot be reactivated through this endpoint; administrator review required |
| Existing EOA or different custody model | Requires a separate custody/identity review; no silent conversion |
| Lost-wallet recovery or transfer to another user | Not implemented; never bypassed by a new SDK connection |

The current application has a Telegram-factor step-up flow that rotates the session and writes `step_up_at`. Plain wallet connection or ordinary login does not substitute for that step-up. Request unlink/relink challenges only after step-up, using the new session cookie. Other application reauthentication methods require a separate implementation.

Unlink is an application ownership-status change. It does not cancel existing on-chain orders or revoke ERC-20/ERC-1155 approvals. It does not change operator roles or existing authorization evidence. Future callers must check an ACTIVE verified wallet owned by the authenticated user, in addition to any specific authorization scope. A historical VERIFIED authorization record alone is insufficient after unlinking.

## API

All routes are under the normal Express app, not the port-4001 local demo API. They require a valid existing application session. Mutating requests also require an exact trusted Origin matching `WALLET_LINK_APP_ORIGIN`. The existing application CORS allowlist must permit that origin.

| Method and path | Request | Response |
| --- | --- | --- |
| GET `/api/wallet-links` | Cookie only | `{ wallets: [...] }`, current user's identities only |
| POST `/api/wallet-links/challenges` | `{ walletAddress, chainId: 84532, action: "LINK" }`; action may also be UNLINK or RELINK | HTTP 201 `{ challengeId, typedData }` |
| POST `/api/wallet-links/verify` | `{ challengeId, signature }` | `{ wallet, grantsTradingPermission: false }` |

The client cannot supply a user ID, session binding, RPC endpoint, signing domain or replacement typed data to verification. Extra request fields are rejected by the service.

Wallet responses include ID, chain ID, address, wallet type, custody model, provider label, ownership state/timestamp, primary flag and wallet status. They do not include another user's identity or session details.

Errors: 401 for invalid/changed session or rejected signature; 403 for rejected origin or missing fresh step-up; 409 for conflicts/replay; 410 for expiration; 422 for undeployed or EIP-6492 wallets; 429 for rate limits; 503 for disabled/unavailable rollout, network or storage.

## Signing and single-use protection

Shared protocol: `packages/domain/src/walletLinkProtocol.js`.

The EIP-712 domain is `KhmerFP Wallet Ownership`, version 1, chain 84532, with a salt derived from the exact application origin. It has no exchange verifying contract because this message is not an exchange order or on-chain allowance.

WalletLink fields: challengeId, action, userId, wallet, sessionBinding, appOrigin, nonce, issuedAt and expiresAt. The opaque session binding hashes the authenticated user ID, session hash and random nonce; the session token/hash itself is not exposed in the signing message.

The server generates a cryptographically random UUID and 32-byte nonce, persists the typed data and digest, and allows 120 seconds for signing. The frontend checks the exact protocol, user, address, network, action, origin and expiry before requesting a signature.

Verification uses one dedicated PostgreSQL client. The session and challenge are locked, and the valid-context attempt is consumed. Controlled invalid-signature, RPC-failure and policy-rejection outcomes commit the consumed attempt and audit record, then return an error. Infrastructure/database rollback confirms no ownership change. Only a committed action can establish a link. Successful verification cannot be replayed across processes or restarts.

User and chain/address advisory transaction locks serialize ownership changes and limit checks. The database unique constraint remains the final identity-duplication protection. Session/challenge expiry and sensitive-action step-up are checked again in the ownership-writing SQL. Connection release and rollback use `finally`/error handling.

Abuse limits: five challenges per user per minute, enforced in PostgreSQL; thirty endpoint requests per IP per minute, using the existing limiter; ten non-revoked wallets per user/chain; bounded signatures and existing 10-KB JSON limit. RPC requests have four-second timeouts and a ten-second overall verification limit. Database statements, lock waits and idle transactions are also bounded.

## EIP-1271 and EIP-6492

The server checks code and calls the wallet's `isValidSignature` on the configured chain, using the original ownership digest and a bounded gas limit. It requires `0x1626ba7e`. It does not recover the owner EOA and substitute it for the smart-account address. Coinbase's own wallet verification handles any replay-safe inner wrapping.

The verification call and code read use one block number, followed by a block-hash recheck. The audit stores the verification block and digest. This is point-in-time ownership evidence, not an assertion of permanent ownership or economic finality. Trading must separately reverify order signatures and approvals.

[ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) requires deployed contract verification. [ERC-6492](https://eips.ethereum.org/EIPS/eip-6492) adds predeployment signature wrappers and factory/preparation behavior. This release detects that wrapper and rejects it without executing or stripping anything. Undeployed accounts remain unverified, including the wallet observed in Stage 4.3A. No transaction or testnet spend is requested to work around this.

Counterfactual linking remains a separate security decision: trusted factories, deterministic address derivation, chain binding, gas/calldata bounds, simulation/verifier trust and deployed-state transitions must be reviewed. Merely returning an SDK address or a 6492 payload is not evidence sufficient to write VERIFIED ownership.

## Database compatibility and approval proposal

Existing wallet identities and audit tables can be reused unchanged. Their migrations must first be adopted and verified in the chosen database. The Base Sepolia `chains` row must already exist, be enabled and be marked testnet. This implementation does not seed it or create/upgrade tables at startup.

**Historical Stage 4.3B proposal.** This table is now represented by migration
0008. The following original example is retained for explanation only; do not
execute it alongside the migration:

```sql
CREATE TABLE wallet_link_challenges (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash CHAR(64) NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  chain_id NUMERIC(78,0) NOT NULL REFERENCES chains(chain_id) ON DELETE RESTRICT,
  wallet_address CHAR(42) NOT NULL,
  action VARCHAR(10) NOT NULL CHECK (action IN ('LINK','UNLINK','RELINK')),
  app_origin TEXT NOT NULL CHECK (length(app_origin) <= 512),
  nonce CHAR(66) NOT NULL UNIQUE CHECK (nonce ~ '^0x[0-9a-f]{64}$'),
  typed_data JSONB NOT NULL CHECK (jsonb_typeof(typed_data) = 'object'),
  payload_hash CHAR(66) NOT NULL CHECK (payload_hash ~ '^0x[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);
CREATE INDEX idx_wallet_link_challenges_user_created
  ON wallet_link_challenges(user_id, created_at DESC);
CREATE INDEX idx_wallet_link_challenges_session
  ON wallet_link_challenges(session_hash);
CREATE INDEX idx_wallet_link_challenges_expiry
  ON wallet_link_challenges(expires_at);
```

Approval should also settle immutable challenge fields and whether to enforce one-way consumption through a trigger or restricted database grants. The service only updates consumed_at. Typed data, digest, user, session, address, chain, action, nonce and expiry must not change after issuance. The user/session relationship is rechecked through the actual session row; the two separate foreign keys alone do not prove that relationship.

Use a forward-only reviewed Drizzle migration after the current migration chain, preserve every existing artifact, update artifact validation deliberately, and run disposable PostgreSQL tests before any adoption. Do not paste the proposal into a hosted database. An approved cleanup job can later remove expired challenges after a defined retention period; audit evidence stays separate. No cleanup job is executed here. Keep application/database clocks synchronized.

## Rollout and frontend

Default state is disabled. The server requires `WALLET_LINK_ENABLED=true`, an explicit development/test NODE_ENV, and `WALLET_LINK_APP_ORIGIN` set to the exact frontend origin. Production NODE_ENV is deliberately blocked until security/schema rollout is reviewed.

The frontend requires `VITE_WALLET_LINK_ENABLED=true` to register `/account/wallets` and show its account-menu link. It reuses `VITE_API_URL` and normal application cookies; no new authentication token is stored. With an empty API URL it uses the normal Vite `/api` proxy. Keep frontend/API hostnames consistent for cookies. No CDP API key or Wallet Secret is required.

Do not enable this against a hosted or production database during this stage. An approved disposable PostgreSQL database must contain the existing auth/identity schema and proposed challenge schema before testing the full application workflow. No app server or migration was started by this implementation to bypass that requirement.

The account page requires a KhmerFP login, then a Coinbase connection. It reports deployment separately from ownership. It validates the server-issued message and discards in-flight results on account, network or application-user change. An undeployed wallet's proof controls are disabled. This page does not create a demo wallet principal or use `khmerfp_demo_session`.

Unlink/relink use separate signed actions. A fresh application step-up is required by the API, not inferred by the frontend. Wallet linking makes no changes to balances, allowances, CTF, treasury, payment records, exchange roles or orders. Proofs are never persisted in localStorage by the application.

## Security test evidence and remaining work

Service tests use a serialized in-memory transaction fixture and mocked RPC. They cover successful ownership linking, replay, consumed invalid attempts, wrong user/session, session rotation, expired messages, in-flight revocation/expiry, multiple wallets, duplicate/concurrent claims, fresh step-up, unlink/relink, rate limits and corrupted stored payloads. They are not PostgreSQL integration evidence.

Verifier tests exercise the real EIP-1271 ABI boundary against a fake provider, reject bad magic, wrong networks and undeployed/6492 signatures, and check timeout cleanup. Route tests cover existing-auth enforcement, exact-origin CSRF rejection and server-derived session/user identity. Frontend tests cover signing context, account switching, duplicate clicks, undeployed-wallet blocking and normal cookie transport.

Required next approvals and checks:

1. Review the challenge schema, retention, linking policy and ownership-state rules.
2. Review final migration 0008 and its disposable PostgreSQL results; approve the artifact and a separate existing-database adoption plan before rollout.
3. Review deployment/adoption of existing identity tables; do not rely on runtime initialization to create them.
4. Resolve the Stage 4.3A SDK dependency/security findings before public use.
5. Verify actual Coinbase signature encoding on a user-controlled deployed test account without deploying or spending funds during this task. Counterfactual support requires separate approval/design.
6. Complete browser login-to-link/unlink/relink tests with the real application session, deployed wallet and approved disposable database. Current unit tests do not establish that result.

No production migration, hosted database access, funds movement, contract deployment, commit or push is part of this work.

## Stage 4.3C persistence review

The SQL above explains the original design. The complete review candidate is now
`packages/db/proposals/wallet_link_challenges.sql`. Use that file for review and
disposable testing; the earlier example omits the added protections described here.
It is deliberately outside `packages/db/migrations`, and is not read by Drizzle's
normal migrator. Stage 4.3E generated migration 0008 from this reference; review
and target-specific adoption approval are still required.

At Stage 4.3C the chain ended at 0007. Stage 4.3E now adds 0008: one table, three
lookup indexes, one function and one trigger. It does not modify users, sessions,
user_wallets, wallet_authorizations, balances or payments. Do not edit historical
snapshots or insert migration-history records.

| Existing table | Reuse |
| --- | --- |
| users | Existing KhmerFP account; no separate wallet-only user |
| sessions | Login identity, expiry, revocation and fresh step-up |
| chains | Enabled Base Sepolia network reference |
| user_wallets | Verified ownership, account relationship, ACTIVE/REVOKED state |
| auth_audit_logs | Successful and rejected ownership proof records |
| wallet_authorizations | Unchanged; ownership linking creates no authorization rows |
| wallets | Unchanged; legacy fiat balances are unrelated to ownership proof |

The candidate adds these database protections:

- A unique random nonce and UUID primary key identify each attempt.
- Foreign keys require a real user, session and chain. An INSERT trigger also
  checks that the active session belongs to that user.
- Named checks bind the stored message to its row: user, wallet, chain, origin,
  action, challenge ID and nonce. Missing JSON fields cannot pass through SQL NULL.
- Lifetime is at most two minutes. Consumption must be within that lifetime.
- The trigger prevents changing challenge terms or resetting/replacing consumption.
- The existing user_wallets `(chain_id, wallet_address)` uniqueness and immutable
  identity trigger prevent assigning an existing wallet to another user.

The service independently checks the exact EIP-712 protocol, session binding,
nonce, expiry and digest before calling EIP-1271. A stored payload hash alone is
not enough. The application still decides who may perform LINK/UNLINK/RELINK;
ordinary database constraints cannot prove a wallet signature by themselves.
Use restricted application-role grants and reviewed database administration.
An administrator or table owner can bypass or remove triggers; these controls
do not protect against a compromised database owner.

The repository uses a dedicated connection and transaction for each operation.
Session/challenge row locks and user/address advisory locks serialize cooperating
instances. Unique constraints protect the final write even if another writer
does not use those locks. Controlled verification rejection consumes the attempt
and records the rejection. Database failure rolls back ownership, consumption and
audit together. A retry after rollback can succeed once; a committed success
cannot be replayed by a restarted process or another instance.

### Disposable PostgreSQL tests

Run under Node.js 22 after the existing workspace dependencies are installed
(`npm ci` from the repository root). The suite never loads server/.env and never falls back to
DATABASE_URL. It refuses production/staging, non-loopback hosts, URL options,
the wrong database name, non-16 PostgreSQL, and a nonempty database. Connection,
statement and lock timeouts are bounded. It does not drop or truncate anything.

With Docker Desktop running, an example isolated setup is:

```powershell
docker run --detach --rm --name khmerfp-wallet-link-pg16 --label khmerfp.disposable=wallet-link --publish 127.0.0.1:55434:5432 --env POSTGRES_DB=khmerfp_wallet_link_test --env POSTGRES_USER=wallet_link_test --env POSTGRES_PASSWORD=disposable_local_only postgres:16
docker exec khmerfp-wallet-link-pg16 pg_isready -U wallet_link_test -d khmerfp_wallet_link_test
$env:NODE_ENV = 'test'
$env:WALLET_LINK_TEST_DISPOSABLE = 'true'
$env:WALLET_LINK_TEST_DATABASE_URL = 'postgresql://wallet_link_test:disposable_local_only@127.0.0.1:55434/khmerfp_wallet_link_test'
$env:WALLET_LINK_TEST_RESTART_CONTAINER = 'khmerfp-wallet-link-pg16'
cd server
node --test test/walletLinkPostgres.test.js
```

The password above is public, disposable test configuration, never a deployment
credential. The current suite validates immutable artifacts and applies all nine
migrations through Drizzle. It compares the final catalog against the historical
proposal in a rollback-only reference schema. The result is 21 application tables
and nine history entries. Stage 4.3D's earlier proposal test had eight entries.

Subtests cover persistence and audit, expired challenges, expired sessions,
cross-account attempts, replay across repository instances, concurrent verification,
duplicate ownership races, fresh step-up for unlink/relink, failed-signature
consumption, rollback after a post-write audit failure, immutable challenge terms,
session/user binding and one-way consumption. They use mocked EIP-1271 evidence:
passing these tests would not establish real Coinbase compatibility.

Each run needs a new empty container. On failure, inspect that test database;
do not bypass the empty-database check. To discard only the container created
above, run `docker stop khmerfp-wallet-link-pg16`. With `--rm` and no mounted
volume its database disappears. Clear the three test environment variables after
use. Never substitute the running application's local or hosted database URL.

Updated Stage 4.3D result: Docker became available and the complete suite passed
against disposable PostgreSQL 16.14. All 10 database scenarios passed, including
concurrency, rollback, session revocation and actual database restart. Node
reported 12 tests, zero failures and zero skips. The normal backend's local
database was not used. See the verification report for the corrected test fixture
and remaining generated-migration/catalog verification requirements.
Stage 4.3D restored the existing lockfile dependencies, including drizzle-orm and
drizzle-kit, without version changes. The offline Drizzle consistency check passed.
The Drizzle imports are inside the opt-in integration test so ordinary backend
tests can run and report the integration skip explicitly.

Local validation after the persistence changes: 334 backend tests passed, 17
optional tests skipped, zero failures. The PostgreSQL and real Coinbase tests
are among those skips. Frontend/backend lint, immutable migration artifact
validation, its negative self-tests and git diff whitespace checks passed.

### Real Coinbase verification is a separate check

`server/test/walletLinkCoinbase.test.js` is opt-in. Default tests skip it. It uses
the actual Base Sepolia RPC, deployed account code, original challenge digest and
EIP-1271 magic value. It performs no database writes, deployment or transaction.

After persistence approval and controlled local activation, obtain a fresh LINK
challenge and its user-approved signature through the existing account page.
Keep this temporary JSON outside the repository, and delete it after testing:

```json
{
  "walletAddress": "connected deployed smart-account address",
  "challenge": { "challengeId": "server UUID", "typedData": "actual server object" },
  "signature": "actual user-approved signature"
}
```

The typedData value above is a placeholder for the real object, not a string in a
usable proof. Set NODE_ENV=test, WALLET_LINK_REAL_VERIFY=true,
WALLET_LINK_REAL_PROOF_FILE to the temporary file, WALLET_LINK_REAL_USER_ID to the
expected logged-in user ID and WALLET_LINK_REAL_ORIGIN to the reviewed frontend
origin. Run `node --test test/walletLinkCoinbase.test.js` from server within the
two-minute validity window. The signature is sensitive authorization material:
do not log, paste, commit or upload it. This read-only check neither consumes a
challenge nor establishes a persisted link. A full API test must still prove
one-time consumption and matching ownership/audit writes.

Real Coinbase status remains **not verified**. The earlier passkey connection
returned an undeployed account. Connection alone is not wallet ownership evidence.
No fresh deployed-account proof was supplied. EIP-6492 remains blocked and has
not been unwrapped, simulated or executed. Do not deploy or spend funds to make
this test pass during this stage.

The Stage 4.3C dependency audit still reports 22 findings: 12 moderate, 8 high,
2 critical. High findings include the Base Account SDK/CDP/abitype/zod chain;
critical findings include the existing Vitest/tinypool toolchain. Other affected
packages include axios, Vite, ws and bakong-khqr. No versions or lockfiles were
changed in this stage. These results require package/advisory reachability review
and tested remediation; mocked wallet tests do not resolve them. Do not run
`npm audit fix --force` as part of database adoption.

### Approval before activation

1. Approve the proposal, multi-wallet policy, unlink/relink rules and retention.
2. Generate and review an additive Drizzle schema/migration; extend artifact and
   catalog validation without altering existing migration protections.
3. Run the disposable suite and the final generated migration chain on PostgreSQL 16.
4. Complete real deployed Coinbase proof and browser/session integration checks.
5. Resolve or explicitly assess the SDK/toolchain vulnerability findings.
6. Review schema adoption, backup/restore, least-privilege grants, chain settings
   and staged rollout before changing application configuration.

Both wallet-link feature flags remain unchanged. Tests construct their own service
instances; no application ownership endpoint was enabled by this work.

Stage 4.3D setup, current blockers, restart verification and the per-package audit
assessment are in [WALLET_LINKING_POSTGRES_VERIFICATION.md](WALLET_LINKING_POSTGRES_VERIFICATION.md).

## Stage 4.3E final migration and recovery

The source of truth is now `src/schema/walletLinkChallenges.js` and
`migrations/0008_wallet_link_challenges.sql` under packages/db, with the generated
0008 snapshot and ninth journal entry. The proposal is a fixed comparison fixture,
not a second migration to execute. The schema explicitly preserves DESC NULLS
FIRST on the lookup index. Custom PL/pgSQL bodies are maintained in migration SQL
because Drizzle's table snapshot does not model functions and triggers.

Local verification applied the complete chain on fresh disposable PostgreSQL 16.14:
all ten ownership-persistence scenarios passed, catalog parity passed, nine history
rows matched, repeated migration was a no-op, and restart preserved replay protection.
No wallet_authorizations rows or permissions were created by ownership linking.
Stage 4.3F fixed the separate CTF slot-count fixture; the complete migration runner
now passes locally. See CTF_SLOT_COUNT_REGRESSION.md for before/after evidence.

Migration approval is separate from either feature flag. Before application
rollout, inspect and approve adoption of migrations 0000–0007. Do not execute their
CREATE statements on an already initialized database or invent history rows.
Back up the database and schema, verify restore, review role grants, and test
the exact release artifacts on a restored disposable copy. Run the reviewed
deployment process (`npm run db:migrate --workspace @khmerfp/db`) only with explicit
target approval. No such deployment command was executed here. Never run
drizzle-kit push or apply the old proposal after 0008.

Keep linking disabled during rollout. If migration fails, investigate actual
transaction/history state before retrying; never manually mark it complete.
PostgreSQL's Drizzle migrator applies pending changes transactionally. For an
application rollback, leave the additive table in place with linking disabled;
old code does not need it. Do not delete history, reset consumed_at or drop proof
data to make an earlier application version start.

Before restoring a backup, stop ownership writes. An older backup can resurrect
unused challenges and old session/ownership state. Revoke affected sessions,
invalidate restored proof attempts through a reviewed procedure, wait for the
short proof window to expire, and reconcile ownership/audit records before
re-enabling. Never replay old signatures or rewrite audit history. No destructive
down migration or automatic cleanup is supplied.

Still required: pass actual GitHub combined CI, approve database
adoption, verify a real deployed Coinbase account, and remediate or assess the
22 dependency findings. These results do not establish production readiness.
