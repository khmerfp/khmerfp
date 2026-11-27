-- NON-EXECUTABLE READING COPY. Execute only the reviewed migration through the migration runner.
-- Register the payment poll lease column that legacy startup code previously
-- created outside the migration chain. An existing column is accepted only
-- when its catalog definition is exactly compatible with this migration.
DO $$
DECLARE
  existing record;
BEGIN
  SELECT data_type, is_nullable, column_default
    INTO existing
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'bakong_payments'
     AND column_name = 'last_checked_at';

  IF FOUND THEN
    IF existing.data_type <> 'timestamp with time zone'
       OR existing.is_nullable <> 'YES'
       OR existing.column_default IS NOT NULL THEN
      RAISE EXCEPTION 'incompatible public.bakong_payments.last_checked_at definition';
    END IF;
  ELSE
    ALTER TABLE public.bakong_payments
      ADD COLUMN last_checked_at timestamp with time zone;
  END IF;
END $$;
--> statement-breakpoint
-- Runtime capabilities may verify canonical migration history in this database
-- but cannot insert, update or delete migration records.
GRANT USAGE ON SCHEMA drizzle TO
  kf_trading_http,
  kf_matching_worker,
  kf_market_scheduler,
  kf_market_admin,
  kf_reconciliation,
  kf_public_read,
  kf_funding;
GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO
  kf_trading_http,
  kf_matching_worker,
  kf_market_scheduler,
  kf_market_admin,
  kf_reconciliation,
  kf_public_read,
  kf_funding;
