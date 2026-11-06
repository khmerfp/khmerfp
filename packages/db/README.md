# Database Package

Reserved for Drizzle ORM schemas, ordered PostgreSQL migrations, migration metadata, and narrowly scoped repositories. Runtime application startup must not become the migration mechanism.

## Commands

- `npm run db:generate --workspace @khmerfp/db` generates reviewed SQL migration files from schema changes. It does not connect to PostgreSQL.
- `npm run db:migrate --workspace @khmerfp/db` applies committed migrations and requires `DATABASE_URL`. Run it only as an explicitly authorized deployment operation.
- `npm run db:validate-baseline --workspace @khmerfp/db` checks the baseline SQL and metadata offline without database credentials.

Never use `drizzle-kit push` for this project. Existing server queries and the current `pg.Pool` remain unchanged during the incremental migration.

