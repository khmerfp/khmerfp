# Isolated financial ledger

Development/test only. No payment integration, public credit endpoint, production activation, blockchain signing or balance migration.

USD amounts are positive BigInt cents, bounded by PostgreSQL BIGINT. USDC has its own disabled asset identity with six decimals. Existing wallet balances are not ledger opening balances.

Customer accounts are credit-normal liabilities. A mock $100 deposit debits treasury cash 10,000 and credits customer cash 10,000. Reserving 3,000 leaves posted 10,000 and available 7,000. Consuming 1,000 debits the customer and credits the destination customer; releasing the remaining 2,000 changes no posted cash.

Use `createLedger({ pool, authorize, enabled: true, environment: 'test' })`. The mandatory trusted backend authorizer receives a separate snapshot of canonical terms (amounts are decimal strings) and must return exactly true for each permitted operation. Caller changes while authorization is pending cannot change the executed terms. Derive actors from authenticated server context, never request JSON. `user:<id>` can only read/reserve/release/cancel their own funds. `system:<capability>` is restricted to trusted internal financial workers; consumption, posting, account creation, reconstruction and reversal need explicit authorization. Anyone holding the shared runtime database credential is trusted infrastructure and can invoke that database capability; it is not an end-user credential.

Supported methods: createAccount, post, balance, reserve, release, cancel, consume, reverse, rebuild and system-only reconcile. Pass amounts as BigInt and IDs as decimal strings or BigInt. Returned monetary amounts and IDs are decimal strings. Retries must reuse exactly the same actor, action, key and canonical terms. Posting business references are independently unique. Reversals are full only and cannot reverse reservation consumption or reversal journals.

Every operation uses a dedicated connection and explicit transaction, deterministic account locks, then reservation locks. Reconstruction takes an exclusive advisory gate against all ledger writers. Normal operations use the shared gate. Do not nest a ledger operation inside another transaction; the package owns its connection and transaction boundary. Application cancellation does not establish whether a commit occurred: retry with the same idempotency key.

## Database privilege boundary

Migration 0009 revokes PUBLIC access to financial tables and functions. Before any future enablement, a migration administrator must configure a separate NOLOGIN non-superuser owner for all nine ledger tables (eight financial tables plus the internal audit-target table, including their identity sequences) and seven financial functions. The service login must not own these objects, inherit the owner role, hold superuser/BYPASSRLS/CREATEROLE privileges or have direct table/sequence write access. Keep CREATE on the function's schema restricted to trusted migration administration.

The ledger service checks these privilege restrictions on every connection before executing an operation and rejects migration-owner credentials. Grant the runtime login only schema USAGE and EXECUTE on `public.financial_execute(text,text,text,jsonb)` and `public.financial_reconcile(text)`. No automatic role or credential provisioning is performed by the application. The disposable integration test creates these separate roles, changes object ownership, grants only this function and proves direct writes and owner-role escalation fail. Trigger functions use fixed pg_catalog search paths and qualified financial table names; deferred audit reads execute as the restricted owner at commit.

Posted history is immutable, journals must be posted/balanced at commit, accounts and assets are immutable, and projections are checked against journal/event history. A database superuser or object owner capable of disabling triggers remains a trusted administrative boundary; these controls do not defend against a malicious database administrator.

## Local validation

- `npm test --workspace @khmerfp/ledger`: unit tests; PostgreSQL test explicitly skips without its dedicated runner.
- `npm run test:postgres --workspace @khmerfp/ledger`: creates a fresh labelled PostgreSQL 16 container, loopback-only dynamic port and tmpfs data; applies all eleven migrations, runs real integration tests and removes only its own container.
- `npm run lint --workspace @khmerfp/ledger`
- `npm run db:validate-baseline --workspace @khmerfp/db`

No existing or hosted database URL is used by the PostgreSQL runner. Docker Desktop must be available. Use Node.js 22. The tests create mock users and funds only inside that disposable database.

Migration 0010 replaces repeated global commit-time scans with a protected `financial_audit_targets` table. Source triggers enqueue one target per transaction/object; one deferred constraint check validates each final affected journal/account/reservation/operation before deleting its marker. Runtime cannot read, insert, update, delete or truncate markers. No caller-controlled GUC, advisory-lock marker or temporary table is trusted for skipping audits. Original history remains immutable. Account checks still reconcile that account's indexed history, so a very active account can require progressively more work. `reconcile` retains independent full-history validation under the exclusive writer gate. `rebuild` reconstructs projections and is followed by the same commit-time guarantees. Load testing, operational role provisioning and independent review remain required before production. The package has no production wiring. No fractional shares, fees or currency conversion are implemented.

Run `npm run benchmark --workspace @khmerfp/ledger` for bounded real-operation workloads and complete reconciliation after every phase. Synthetic benchmark reports are written to the OS temporary directory, never a production data store. The 10,000-posting acceptance check counts the combined 1,000 and subsequent 9,000 phase durations against 180 seconds; this is a local development threshold only.
