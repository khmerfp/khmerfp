-- READING COPY ONLY: do not execute or use as a migration.
-- Executable source: packages/db/migrations/0001_powerful_katie_power.sql
-- Original statement order, object names, quoted values and Drizzle boundaries are preserved.
-- Function versions are historical: apply the migration chain to determine the current definition.

-- ============================================================================
-- CONSTRAINTS AND TABLE ALTERATIONS (original execution order preserved)
-- ============================================================================
ALTER TABLE "wallets"
    ADD COLUMN "usd_balance_minor" bigint DEFAULT 0 NOT NULL;

--> statement-breakpoint
ALTER TABLE "wallets"
    ADD CONSTRAINT "wallets_usd_balance_minor_nonnegative" CHECK ("wallets"."usd_balance_minor" >= 0);
