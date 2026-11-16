# Database Package

Reserved for Drizzle ORM schemas, ordered PostgreSQL migrations, migration metadata, and narrowly scoped repositories. Runtime application startup must not become the migration mechanism.

## Commands

- `npm run db:generate --workspace @khmerfp/db` generates reviewed SQL migration files from schema changes. It does not connect to PostgreSQL.
- `npm run db:migrate --workspace @khmerfp/db` applies committed migrations and requires `DATABASE_URL`. Run it only as an explicitly authorized deployment operation.
- `npm run db:validate-baseline --workspace @khmerfp/db` checks the baseline SQL and metadata offline without database credentials.

Never use `drizzle-kit push` for this project. Existing server queries and the current `pg.Pool` remain unchanged during the incremental migration.

Migration `0008_wallet_link_challenges` adds durable ownership challenges only.
Its generated snapshot describes the table; its SQL also contains the reviewed
immutability/session-binding protection function and trigger. Do not execute the
historical proposal after this migration. See
[wallet migration verification](../../docs/WALLET_LINKING_POSTGRES_VERIFICATION.md)
for disposable tests, the resolved CTF fixture regression, and adoption/recovery
requirements. Wallet linking remains disabled pending approval.

`node packages/db/scripts/testCtfSlotCount.js` (from the repository root) compares
CTF validation before/after 0008. It requires the dedicated empty disposable
PostgreSQL configuration documented in
[CTF regression verification](../../docs/CTF_SLOT_COUNT_REGRESSION.md).

