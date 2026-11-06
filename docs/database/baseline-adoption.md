# Drizzle baseline adoption

## Purpose

This document defines how KhmerFP may use the initial Drizzle baseline safely.
It is a procedure for review and approval, not authorization to run a migration.

The baseline represents the eight tables that already exist in application SQL:

- `users`
- `wallets`
- `sessions`
- `user_factors`
- `auth_rate_limits`
- `auth_audit_logs`
- `phone_otps`
- `transactions`

Current baseline artifacts:

- SQL: `packages/db/migrations/0000_fat_shen.sql`
- Snapshot: `packages/db/migrations/meta/0000_snapshot.json`
- Journal: `packages/db/migrations/meta/_journal.json`
- Journal version: `7`
- Journal timestamp: `1793950642587` (`2026-11-06T07:37:22.587Z`)
- SQL SHA-256: `7a22414a2cf43ed3755b0ca8545f8b929c0a740ebb8a23fe8016955b8e4b925d`

If the SQL file changes, its hash must be recalculated and this document must be
reviewed again. Generated migration files and metadata must be committed together.

## Safety rules

- Never run this baseline against an existing KhmerFP database.
- Never use `drizzle-kit push`.
- Never edit migration history by hand in an interactive production session.
- Never use production as the first adoption test.
- Never expose a database URL in commands, logs, screenshots, or source files.
- Use a separate migration identity with only the permissions needed for the task.
- Keep the application identity free of schema-change permissions after transition.
- Take and verify a recoverable backup before any existing-database adoption.

## New empty database procedure

The baseline is executable only when the target PostgreSQL database is confirmed
empty and is intended to receive the complete existing KhmerFP schema.

1. Create the database through the approved infrastructure process.
2. Confirm the selected database and schema are correct.
3. Confirm `public` contains no KhmerFP tables or migration-history records.
4. Confirm the connection `search_path` includes `public` and resolves it as the
   intended application schema.
5. Use the approved migration identity and provide `DATABASE_URL` through the
   deployment secret manager.
6. Run the reviewed `db:migrate` workspace command from the exact release commit.
7. Do not start the application until migration verification succeeds.
8. Verify all eight tables, constraints, indexes, sequences, and the single
   migration-history entry.
9. Run application smoke tests with non-production data.
10. Record the release commit, migration tag, SQL hash, operator, time, and result.

Drizzle's PostgreSQL migrator runs pending migration statements and the history
write in a transaction. A failed run must still be inspected before retrying; do
not assume that an infrastructure or connection failure left no external effects.

## Existing database inspection

An existing database must be inspected read-only before it can adopt Drizzle
history. Use a staging clone or a restored backup first. Production inspection
requires separate approval and read-only credentials.

Compare actual catalog metadata with both the generated SQL and snapshot.

### Database and schema context

- PostgreSQL server version
- current database name
- current user and role
- `search_path`
- actual schema for every KhmerFP table
- table owners and application privileges
- presence of an existing `drizzle` schema or migration table

The generated foreign keys target `public.users`. Adoption is not approved if the
current tables resolve to another schema until the difference is designed and
reviewed.

### Tables and columns

For every table and column, compare:

- table and column name
- ordinal position
- PostgreSQL data type and length
- nullability
- default expression after PostgreSQL normalization
- identity mode: `ALWAYS` or `BY DEFAULT`
- identity sequence name, ownership, increment, bounds, cache, and cycle setting

For populated identity tables, also verify that sequence state cannot generate an
identifier already present in the table.

### Constraints

Compare:

- primary-key names and columns
- unique-constraint names and column order
- foreign-key names, source and target columns
- `ON DELETE` and `ON UPDATE` actions
- check-constraint names and normalized expressions
- constraint validation state

Data must also satisfy the expected constraints. Check for duplicate identities,
duplicate provider transaction IDs, invalid hashes, negative balances or attempts,
unsupported currencies and statuses, and invalid session expiry ordering.

### Indexes

Compare:

- index name and owning table
- uniqueness
- access method
- column and expression order
- ascending or descending order
- null ordering
- partial-index predicate
- validity and readiness state

Important partial predicates include active sessions and nullable provider identity
indexes. Predicate equivalence must be based on PostgreSQL catalog expressions,
not formatting alone.

### Expected harmless formatting differences

The following generated SQL is behaviorally equivalent to the original source:

- explicit `USING btree` instead of PostgreSQL's default
- explicit `DESC NULLS FIRST` instead of implicit descending null order
- explicit `ON UPDATE NO ACTION` instead of the default action
- explicit default identity-sequence options
- normalized `now()` and `CURRENT_TIMESTAMP` expressions

Any other difference must be classified, reviewed, and resolved before adoption.

## Existing database adoption strategy

The baseline contains unconditional `CREATE TABLE` statements. It must not be
executed on an existing database. Adoption consists of proving schema equivalence
and then recording the baseline as already satisfied.

Drizzle ORM 0.45.4 uses these PostgreSQL history defaults:

- schema: `drizzle`
- table: `__drizzle_migrations`
- columns: `id`, `hash`, and `created_at`
- hash: SHA-256 of the complete migration SQL file
- `created_at`: the journal entry's `when` value

The current migrator decides whether a migration is pending by comparing its
journal timestamp with the newest history `created_at`. The hash remains essential
audit evidence even though this version does not use it as the ordering decision.

After all approval criteria pass, implement a dedicated one-time baseline-adoption
tool with the following behavior:

1. Require an explicit environment and baseline tag.
2. Acquire a database advisory lock.
3. Run the approved schema-parity checks again.
4. Refuse to continue on any unexpected table, constraint, index, schema, or
   migration-history state.
5. Create only Drizzle's migration metadata schema/table when absent.
6. In one transaction, record the reviewed SQL hash and journal timestamp without
   executing `0000_fat_shen.sql`.
7. Refuse duplicate or conflicting history rows.
8. Read the marker back and verify its exact values.
9. Release the lock and write a redacted operational audit record.

This tool must be code-reviewed and tested against a restored database. Operators
must not replace it with a manual history-table insert. This task documents that
future mechanism; it does not implement or execute it.

After marking the baseline in staging, run the normal migrator in a verification
exercise. It must report the baseline as already applied and execute no application
DDL. Only then may the same adoption procedure be considered for production.

## Runtime initialization risk

The existing backend still owns schema changes at application startup:

- `server/src/server.js` calls `initializeDatabase()`.
- `api/index.js` calls `initializeDatabase()` for a serverless runtime.
- `server/src/config/database.js` creates `transactions` and invokes auth setup.
- `server/src/db/authSchema.js` creates tables and runs additive `ALTER TABLE` SQL.

Keeping runtime DDL during transition preserves current behavior, but it creates
these risks:

- two competing schema owners can drift apart
- startup can change schema outside a reviewed release migration
- serverless instances may attempt DDL concurrently
- application startup requires excessive database permissions
- `IF NOT EXISTS` can hide an incorrect type, constraint, default, or index
- runtime SQL has no ordered migration history or rollback record
- a failed schema operation can prevent application availability
- future Drizzle changes may be partially undone or masked by old startup SQL

Do not remove runtime initialization in the baseline-adoption step. Retire it in a
separate backward-compatible deployment only after every environment is verified,
the migration job is operational, and rollback has been rehearsed.

## Backup, rollback, and recovery

### Before adoption

- Take a provider snapshot or PostgreSQL backup with a recorded recovery point.
- Verify the backup can be restored into an isolated environment.
- Record row counts and schema fingerprints.
- Confirm point-in-time recovery coverage and retention.
- Pause unrelated schema deployments and define an operator communication window.

### New empty database

If the baseline fails before use, prefer discarding and recreating the empty
database. If any data was written afterward, use the approved restore procedure;
do not improvise a reverse migration.

### Existing database marker

The marker should not alter application tables. If marker adoption fails, stop and
inspect the transaction and history state. Removal of a marker is permitted only
through an approved recovery procedure when no later migration has been applied.
Once later migrations exist, prefer a reviewed forward repair or full restore.

Never delete migration history merely to force Drizzle to rerun the baseline.

## Approval criteria

Existing-database adoption requires all of the following:

- baseline SQL, snapshot, journal, and hash are committed and immutable
- clean review of all eight table definitions
- exact or approved-equivalent column, identity, constraint, and index metadata
- confirmed `public` schema and expected `search_path`
- no unexplained objects or invalid constraints/indexes
- data-integrity checks pass
- identity sequence state is safe
- no conflicting Drizzle migration history exists
- backup and restore rehearsal succeeds
- the adoption tool passes automated tests on a restored database
- staging adoption and no-op migrator verification succeed
- runtime DDL transition plan is approved
- rollback owner, operator, maintenance window, and incident path are assigned
- security and database owners provide written approval

Failure of any criterion blocks adoption. It does not authorize an automatic schema
repair or migration against production.

## Reported whitespace-only changes

The following existing working-tree changes were inspected and intentionally left
untouched:

- `packages/db/src/schema/authAuditLogs.js:33` contains trailing spaces on a blank
  line before the foreign-key comment.
- `packages/db/src/schema/wallets.js:44` contains trailing spaces on a blank line
  before the check-constraint comment.

These whitespace changes do not alter generated SQL, but they currently cause a
full-worktree `git diff --check` failure. Clean them only in a separately approved
formatting change.
