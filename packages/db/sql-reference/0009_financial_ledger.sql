-- READING COPY ONLY: do not execute or use as a migration.
-- Executable source: packages/db/migrations/0009_financial_ledger.sql
-- Original statement order, object names, quoted values and Drizzle boundaries are preserved.
-- Function versions are historical: apply the migration chain to determine the current definition.

-- ============================================================================
-- TABLES (original execution order preserved)
-- ============================================================================
-- Immutable reserve, consume, release and cancel history.
CREATE TABLE "cash_reservation_events"(
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name
        "cash_reservation_events_id_seq" INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 9223372036854775807 START WITH 1
        CACHE 1),
        "reservation_id" bigint NOT NULL,
        "operation_id" bigint NOT NULL,
        "kind" text NOT NULL,
        "amount" bigint NOT NULL,
        "journal_id" bigint,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "cash_reservation_events_operation_id_unique" UNIQUE ("operation_id"),
        CONSTRAINT "cash_reservation_events_journal_id_unique" UNIQUE ("journal_id"),
        CONSTRAINT "cash_reservation_events_kind_check" CHECK ("cash_reservation_events"."kind" IN ('RESERVE', 'CONSUME', 'RELEASE', 'CANCEL')),
        CONSTRAINT "cash_reservation_events_amount_check" CHECK ("cash_reservation_events"."amount" > 0),
        CONSTRAINT "cash_reservation_events_journal_check" CHECK (("cash_reservation_events"."kind" = 'CONSUME') =("cash_reservation_events"."journal_id" IS NOT NULL))
);

--> statement-breakpoint
-- Cash holds with cumulative consumed and released amounts.
CREATE TABLE "cash_reservations"(
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name
        "cash_reservations_id_seq" INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 9223372036854775807 START WITH 1
        CACHE 1),
        "account_id" bigint NOT NULL,
        "operation_id" bigint NOT NULL,
        "reference" text NOT NULL,
        "amount" bigint NOT NULL,
        "consumed" bigint DEFAULT 0 NOT NULL,
        "released" bigint DEFAULT 0 NOT NULL,
        "status" text DEFAULT 'OPEN' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "cash_reservations_operation_id_unique" UNIQUE ("operation_id"),
        CONSTRAINT "cash_reservations_account_reference_key" UNIQUE ("account_id", "reference"),
        CONSTRAINT "cash_reservation_amounts_check" CHECK ("cash_reservations"."amount" > 0 AND "cash_reservations"."consumed" >= 0 AND "cash_reservations"."released" >= 0 AND "cash_reservations"."consumed"::numeric + "cash_reservations"."released" <= "cash_reservations"."amount"),
        CONSTRAINT "cash_reservation_status_check" CHECK (("cash_reservations"."status" = 'OPEN' AND "cash_reservations"."consumed"::numeric + "cash_reservations"."released" < "cash_reservations"."amount") OR ("cash_reservations"."status" IN ('CLOSED', 'CANCELLED') AND "cash_reservations"."consumed"::numeric + "cash_reservations"."released" = "cash_reservations"."amount"))
);

--> statement-breakpoint
-- Customer cash liabilities and system asset, clearing, equity, expense or revenue accounts.
CREATE TABLE "financial_accounts"(
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name
        "financial_accounts_id_seq" INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 9223372036854775807 START WITH 1
        CACHE 1),
        "asset" text NOT NULL,
        "owner_user_id" bigint,
        "account_key" text NOT NULL,
        "kind" text NOT NULL,
        "normal_side" text NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "financial_accounts_account_key_unique" UNIQUE ("account_key"),
        CONSTRAINT "financial_accounts_id_asset_key" UNIQUE ("id", "asset"),
        CONSTRAINT "financial_accounts_owner_asset_key" UNIQUE ("owner_user_id", "asset"),
        CONSTRAINT "financial_accounts_kind_check" CHECK (("financial_accounts"."kind" = 'CUSTOMER' AND "financial_accounts"."owner_user_id" IS NOT NULL AND "financial_accounts"."normal_side" = 'CREDIT') OR ("financial_accounts"."kind" IN ('ASSET', 'EQUITY', 'REVENUE', 'EXPENSE', 'CLEARING') AND "financial_accounts"."owner_user_id" IS NULL AND "financial_accounts"."normal_side" IN ('DEBIT', 'CREDIT')))
);

--> statement-breakpoint
-- Fixed accounting asset identities: enabled USD cents and disabled six-decimal USDC.
CREATE TABLE "financial_assets"(
    "code" text PRIMARY KEY NOT NULL,
    "decimals" integer NOT NULL,
    "enabled" boolean DEFAULT FALSE NOT NULL,
    CONSTRAINT "financial_assets_identity_check" CHECK (("financial_assets"."code" = 'USD' AND "financial_assets"."decimals" = 2 AND "financial_assets"."enabled") OR ("financial_assets"."code" = 'USDC' AND "financial_assets"."decimals" = 6 AND NOT "financial_assets"."enabled"))
);

--> statement-breakpoint
-- Current posted and reserved cash; available equals posted minus reserved.
CREATE TABLE "financial_balance_projections"(
    "account_id" bigint PRIMARY KEY NOT NULL,
    "posted" bigint DEFAULT 0 NOT NULL,
    "reserved" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "financial_projection_reserved_check" CHECK ("financial_balance_projections"."reserved" >= 0)
);

--> statement-breakpoint
-- Immutable cash debit and credit lines, balanced independently per asset.
CREATE TABLE "financial_journal_entries"(
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name
        "financial_journal_entries_id_seq" INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 9223372036854775807 START WITH 1
        CACHE 1),
        "journal_id" bigint NOT NULL,
        "account_id" bigint NOT NULL,
        "asset" text NOT NULL,
        "side" text NOT NULL,
        "amount" bigint NOT NULL,
        CONSTRAINT "financial_entries_amount_check" CHECK ("financial_journal_entries"."amount" > 0),
        CONSTRAINT "financial_entries_side_check" CHECK ("financial_journal_entries"."side" IN ('DEBIT', 'CREDIT'))
);

--> statement-breakpoint
-- Cash journal headers, posting status and eligible reversal linkage.
CREATE TABLE "financial_journals"(
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name
        "financial_journals_id_seq" INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 9223372036854775807 START WITH 1
        CACHE 1),
        "operation_id" bigint NOT NULL,
        "status" text DEFAULT 'DRAFT' NOT NULL,
        "reversal_of" bigint,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "financial_journals_operation_id_unique" UNIQUE ("operation_id"),
        CONSTRAINT "financial_journals_reversal_key" UNIQUE ("reversal_of"),
        CONSTRAINT "financial_journals_status_check" CHECK ("financial_journals"."status" IN ('DRAFT', 'POSTED'))
);

--> statement-breakpoint
-- Actor-bound idempotency, canonical operation terms and durable results.
CREATE TABLE "financial_operations"(
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name
        "financial_operations_id_seq" INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 9223372036854775807 START WITH 1
        CACHE 1),
        "operation_key" text NOT NULL,
        "actor" text NOT NULL,
        "action" text NOT NULL,
        "terms" jsonb NOT NULL,
        "request_hash" text NOT NULL,
        "result" jsonb,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "financial_operations_operation_key_unique" UNIQUE ("operation_key")
);

--> statement-breakpoint

-- ============================================================================
-- CONSTRAINTS AND TABLE ALTERATIONS (original execution order preserved)
-- ============================================================================
ALTER TABLE "cash_reservation_events"
    ADD CONSTRAINT "cash_reservation_events_reservation_id_cash_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."cash_reservations"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "cash_reservation_events"
    ADD CONSTRAINT "cash_reservation_events_operation_id_financial_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."financial_operations"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "cash_reservation_events"
    ADD CONSTRAINT "cash_reservation_events_journal_id_financial_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."financial_journals"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "cash_reservations"
    ADD CONSTRAINT "cash_reservations_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "cash_reservations"
    ADD CONSTRAINT "cash_reservations_operation_id_financial_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."financial_operations"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "financial_accounts"
    ADD CONSTRAINT "financial_accounts_asset_financial_assets_code_fk" FOREIGN KEY ("asset") REFERENCES "public"."financial_assets"("code") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "financial_accounts"
    ADD CONSTRAINT "financial_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "financial_balance_projections"
    ADD CONSTRAINT "financial_balance_projections_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "financial_journal_entries"
    ADD CONSTRAINT "financial_journal_entries_journal_id_financial_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."financial_journals"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "financial_journal_entries"
    ADD CONSTRAINT "financial_entries_account_asset_fk" FOREIGN KEY ("account_id", "asset") REFERENCES "public"."financial_accounts"("id", "asset") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "financial_journals"
    ADD CONSTRAINT "financial_journals_operation_id_financial_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."financial_operations"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "financial_journals"
    ADD CONSTRAINT "financial_journals_reversal_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."financial_journals"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint

-- ============================================================================
-- INDEXES (original execution order preserved)
-- ============================================================================
CREATE INDEX "idx_cash_reservation_events_reservation" ON "cash_reservation_events" USING btree("reservation_id", "id");

--> statement-breakpoint
CREATE INDEX "idx_cash_reservations_account" ON "cash_reservations" USING btree("account_id");

--> statement-breakpoint
CREATE INDEX "idx_financial_entries_account" ON "financial_journal_entries" USING btree("account_id", "id");

--> statement-breakpoint
CREATE INDEX "idx_financial_entries_journal" ON "financial_journal_entries" USING btree("journal_id");

--> statement-breakpoint

-- ============================================================================
-- REQUIRED DATA AND MIGRATION OPERATIONS (original execution order preserved)
-- ============================================================================
INSERT INTO public.financial_assets(code, decimals, enabled)
VALUES
    ('USD', 2, TRUE),
('USDC', 6, FALSE);

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Rejects changes to immutable accounting records; corrections use eligible compensating entries.
CREATE FUNCTION public.financial_immutable()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $$
BEGIN
    RAISE EXCEPTION 'financial history is immutable'
        USING ERRCODE = '23514';
END
$$;

--> statement-breakpoint

-- ============================================================================
-- TRIGGERS (original execution order preserved)
-- ============================================================================
-- Rejects changes to immutable accounting records; corrections use eligible compensating entries.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER financial_assets_immutable
    BEFORE UPDATE OR DELETE ON public.financial_assets
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_immutable();

--> statement-breakpoint
-- Rejects changes to immutable accounting records; corrections use eligible compensating entries.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER financial_accounts_immutable
    BEFORE UPDATE OR DELETE ON public.financial_accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_immutable();

--> statement-breakpoint
-- Rejects changes to immutable accounting records; corrections use eligible compensating entries.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER financial_events_immutable
    BEFORE UPDATE OR DELETE ON public.cash_reservation_events
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_immutable();

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Protects cash journals, entries, reservations, projections and completed operation results during mutation.
CREATE FUNCTION public.financial_guard()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $$
DECLARE
    a public.financial_accounts;
    j public.financial_journals;
    delta bigint;
BEGIN
    IF TG_TABLE_NAME = 'financial_journals' THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.status <> 'DRAFT' THEN
                RAISE EXCEPTION 'journal must begin as draft';
            END IF;
        ELSIF TG_OP = 'DELETE'
                OR OLD.status <> 'DRAFT'
                OR NEW.status <> 'POSTED'
                OR (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
                RAISE EXCEPTION 'posted journal is immutable'
                USING ERRCODE = '23514';
        END IF;
    ELSIF TG_TABLE_NAME = 'financial_journal_entries' THEN
        IF TG_OP <> 'INSERT' THEN
            RAISE EXCEPTION 'entries are immutable'
                USING ERRCODE = '23514';
        END IF;
        SELECT
            *
        INTO
            STRICT j
        FROM
            public.financial_journals
        WHERE
            id = NEW.journal_id
        FOR UPDATE;
        IF j.status <> 'DRAFT' THEN
            RAISE EXCEPTION 'cannot append to posted journal'
                USING ERRCODE = '23514';
        END IF;
        SELECT
            *
        INTO
            STRICT a
        FROM
            public.financial_accounts
        WHERE
            id = NEW.account_id
        FOR UPDATE;
        IF a.asset <> NEW.asset OR a.asset <> 'USD' THEN
            RAISE EXCEPTION 'asset mismatch or disabled asset'
                USING ERRCODE = '23514';
        END IF;
        delta := CASE WHEN a.normal_side = NEW.side THEN
            NEW.amount
        ELSE
            - NEW.amount
        END;
        UPDATE
            public.financial_balance_projections
        SET
            posted = posted + delta
        WHERE
            account_id = a.id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'missing account projection';
        END IF;
    ELSIF TG_TABLE_NAME = 'cash_reservations' THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'reservation deletion forbidden';
        END IF;
        IF TG_OP = 'UPDATE' AND ((to_jsonb(NEW) - ARRAY['consumed', 'released', 'status']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['consumed', 'released', 'status']) OR OLD.status <> 'OPEN' OR NEW.consumed < OLD.consumed OR NEW.released < OLD.released) THEN
            RAISE EXCEPTION 'invalid reservation mutation';
        END IF;
        SELECT
            *
        INTO
            STRICT a
        FROM
            public.financial_accounts
        WHERE
            id = NEW.account_id
        FOR UPDATE;
        IF a.kind <> 'CUSTOMER' OR a.asset <> 'USD' THEN
            RAISE EXCEPTION 'reservation requires USD customer account';
        END IF;
        delta := NEW.amount - NEW.consumed - NEW.released;
        IF TG_OP = 'UPDATE' THEN
            delta := delta -(OLD.amount - OLD.consumed - OLD.released);
        END IF;
        UPDATE
            public.financial_balance_projections
        SET
            reserved = reserved + delta
        WHERE
            account_id = a.id;
    ELSIF TG_TABLE_NAME = 'financial_balance_projections' THEN
        IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.account_id <> OLD.account_id) THEN
            RAISE EXCEPTION 'invalid projection mutation';
        END IF;
        SELECT
            *
        INTO
            STRICT a
        FROM
            public.financial_accounts
        WHERE
            id = NEW.account_id;
        IF a.kind = 'CUSTOMER' AND (NEW.posted < 0 OR NEW.posted < NEW.reserved) THEN
            RAISE EXCEPTION 'insufficient available funds'
                USING ERRCODE = '23514';
        END IF;
    ELSIF TG_TABLE_NAME = 'financial_operations' THEN
        IF TG_OP = 'DELETE' OR OLD.result IS NOT NULL OR NEW.result IS NULL OR (to_jsonb(NEW) - 'result') IS DISTINCT FROM (to_jsonb(OLD) - 'result') THEN
            RAISE EXCEPTION 'operation is immutable';
        END IF;
    END IF;
    RETURN NEW;
END
$$;

--> statement-breakpoint

-- ============================================================================
-- TRIGGERS (original execution order preserved)
-- ============================================================================
-- Protects cash journals, entries, reservations, projections and completed operation results during mutation.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER financial_journal_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.financial_journals
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_guard();

--> statement-breakpoint
-- Protects cash journals, entries, reservations, projections and completed operation results during mutation.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER financial_entry_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.financial_journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_guard();

--> statement-breakpoint
-- Protects cash journals, entries, reservations, projections and completed operation results during mutation.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER financial_reservation_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.cash_reservations
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_guard();

--> statement-breakpoint
-- Protects cash journals, entries, reservations, projections and completed operation results during mutation.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER financial_projection_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.financial_balance_projections
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_guard();

--> statement-breakpoint
-- Protects cash journals, entries, reservations, projections and completed operation results during mutation.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER financial_operation_guard
    BEFORE UPDATE OR DELETE ON public.financial_operations
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_guard();

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Historical full-history commit audit. Later migrations replace its trigger use, while preserving reconciliation.
CREATE FUNCTION public.financial_audit()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
BEGIN
    IF EXISTS(
        SELECT
            1
        FROM
            public.financial_journals j
        WHERE
            j.status <> 'POSTED'
            OR(
            SELECT
                count(*)
            FROM
                public.financial_journal_entries e
            WHERE
                e.journal_id = j.id) < 2) OR EXISTS(
    SELECT
        1
    FROM
        public.financial_journal_entries
    GROUP BY
        journal_id,
        asset
    HAVING
        sum(
        CASE side
        WHEN 'DEBIT' THEN
            amount::numeric
        ELSE
            - amount::numeric
        END) <> 0) THEN
RAISE EXCEPTION 'journal must be posted and balanced per asset' USING ERRCODE = '23514';
END IF;
    IF EXISTS(
        SELECT
            1
        FROM
            public.financial_operations
        WHERE
            result IS NULL) THEN
        RAISE EXCEPTION 'incomplete financial operation';
    END IF;
    IF EXISTS(
        SELECT
            1
        FROM
            public.financial_accounts a
            LEFT JOIN public.financial_balance_projections p ON p.account_id = a.id
        WHERE
            p.account_id IS NULL
            OR p.posted::numeric <> COALESCE((
                SELECT
                    sum(
                    CASE WHEN e.side = a.normal_side THEN
                        e.amount::numeric
                    ELSE
                        - e.amount::numeric
                    END)
                FROM public.financial_journal_entries e
                WHERE
                    e.account_id = a.id), 0)
            OR p.reserved::numeric <> COALESCE((
                SELECT
                    sum(r.amount::numeric - r.consumed - r.released)
                FROM public.cash_reservations r
                WHERE
                    r.account_id = a.id), 0)) THEN
    RAISE EXCEPTION 'financial projection differs from history'
            USING ERRCODE = '23514';
    END IF;
    IF EXISTS(
        SELECT
            1
        FROM
            public.cash_reservations r
        WHERE
            r.amount::numeric <> COALESCE((
                SELECT
                    sum(e.amount::numeric)
                FROM public.cash_reservation_events e
                WHERE
                    e.reservation_id = r.id
                    AND e.kind = 'RESERVE'), 0)
            OR r.consumed::numeric <> COALESCE((
                SELECT
                    sum(e.amount::numeric)
                FROM public.cash_reservation_events e
                WHERE
                    e.reservation_id = r.id
                    AND e.kind = 'CONSUME'), 0)
            OR r.released::numeric <> COALESCE((
                SELECT
                    sum(e.amount::numeric)
                FROM public.cash_reservation_events e
                WHERE
                    e.reservation_id = r.id
                    AND e.kind IN('RELEASE', 'CANCEL')), 0)) THEN
        RAISE EXCEPTION 'reservation differs from immutable event history'
            USING ERRCODE = '23514';
    END IF;
    IF EXISTS(
        SELECT
            1
        FROM
            public.cash_reservation_events v
            JOIN public.cash_reservations r ON r.id = v.reservation_id
        WHERE
            v.kind = 'CONSUME'
            AND((
                SELECT
                    count(*)
                FROM
                    public.financial_journal_entries e
                WHERE
                    e.journal_id = v.journal_id) <> 2
            OR NOT EXISTS(
            SELECT
                1
            FROM
                public.financial_journal_entries e
            WHERE
                e.journal_id = v.journal_id
                AND e.account_id = r.account_id
                AND e.side = 'DEBIT'
                AND e.amount = v.amount))) THEN
        RAISE EXCEPTION 'reservation consumption journal mismatch';
    END IF;
    IF EXISTS(
        SELECT
            1
        FROM
            public.financial_journals j
        WHERE
            j.reversal_of IS NOT NULL
            AND(EXISTS(
            SELECT
                account_id,
                asset,
                side,
                sum(amount::numeric)
            FROM
                public.financial_journal_entries
            WHERE
                journal_id = j.id
            GROUP BY
                account_id,
                asset,
                side
            EXCEPT
            SELECT
                account_id,
                asset,
                CASE side
                WHEN 'DEBIT' THEN
                    'CREDIT'
                ELSE
                    'DEBIT'
                END,
                sum(amount::numeric)
            FROM
                public.financial_journal_entries
            WHERE
                journal_id = j.reversal_of
            GROUP BY
                account_id,
                asset,
                side)
            OR EXISTS(
                SELECT
                    account_id,
                    asset,
                    CASE side
                    WHEN 'DEBIT' THEN
                        'CREDIT'
                    ELSE
                        'DEBIT'
                    END,
                    sum(amount::numeric)
                FROM
                    public.financial_journal_entries
                WHERE
                    journal_id = j.reversal_of
                GROUP BY
                    account_id,
                    asset,
                    side
                EXCEPT
                SELECT
                    account_id,
                    asset,
                    side,
                    sum(amount::numeric)
                FROM
                    public.financial_journal_entries
                WHERE
                    journal_id = j.id
                GROUP BY
                    account_id,
                    asset,
                    side)
            OR EXISTS(
                SELECT
                    1
                FROM
                    public.cash_reservation_events
                WHERE
                    journal_id = j.reversal_of))) THEN
RAISE EXCEPTION 'reversal must exactly compensate eligible journal';
    END IF;
    RETURN NULL;
END
$$;

--> statement-breakpoint

-- ============================================================================
-- TRIGGERS (original execution order preserved)
-- ============================================================================
-- Historical full-history commit audit. Later migrations replace its trigger use, while preserving reconciliation.
-- Mandatory deferred integrity check; validation must succeed before the transaction commits.
CREATE CONSTRAINT TRIGGER financial_accounts_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.financial_accounts DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_audit();

--> statement-breakpoint
-- Historical full-history commit audit. Later migrations replace its trigger use, while preserving reconciliation.
-- Mandatory deferred integrity check; validation must succeed before the transaction commits.
CREATE CONSTRAINT TRIGGER financial_operations_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.financial_operations DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_audit();

--> statement-breakpoint
-- Historical full-history commit audit. Later migrations replace its trigger use, while preserving reconciliation.
-- Mandatory deferred integrity check; validation must succeed before the transaction commits.
CREATE CONSTRAINT TRIGGER financial_journals_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.financial_journals DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_audit();

--> statement-breakpoint
-- Historical full-history commit audit. Later migrations replace its trigger use, while preserving reconciliation.
-- Mandatory deferred integrity check; validation must succeed before the transaction commits.
CREATE CONSTRAINT TRIGGER financial_journal_entries_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.financial_journal_entries DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_audit();

--> statement-breakpoint
-- Historical full-history commit audit. Later migrations replace its trigger use, while preserving reconciliation.
-- Mandatory deferred integrity check; validation must succeed before the transaction commits.
CREATE CONSTRAINT TRIGGER financial_balance_projections_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.financial_balance_projections DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_audit();

--> statement-breakpoint
-- Historical full-history commit audit. Later migrations replace its trigger use, while preserving reconciliation.
-- Mandatory deferred integrity check; validation must succeed before the transaction commits.
CREATE CONSTRAINT TRIGGER cash_reservations_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.cash_reservations DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_audit();

--> statement-breakpoint
-- Historical full-history commit audit. Later migrations replace its trigger use, while preserving reconciliation.
-- Mandatory deferred integrity check; validation must succeed before the transaction commits.
CREATE CONSTRAINT TRIGGER cash_reservation_events_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.cash_reservation_events DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_audit();

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Executes authorized financial operations; later versions extend dispatch to positions. The caller owns the transaction and deferred commit checks.
CREATE FUNCTION public.financial_execute(p_actor text, p_action text, p_key text, p_terms jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
    << ledger >>
DECLARE
    op public.financial_operations;
    a public.financial_accounts;
    r public.cash_reservations;
    entry jsonb;
    lines jsonb;
    result jsonb;
    account_ids bigint[];
    op_id bigint;
    journal_id bigint;
    target_id bigint;
    amount bigint;
    remaining bigint;
    reservation_id bigint;
    original public.financial_journals;
    expected_keys text[];
BEGIN
    IF p_actor IS NULL OR p_actor !~ '^(user:[1-9][0-9]*|system:[a-z][a-z0-9_-]{0,60})$' OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9:_-]{1,120}$' OR jsonb_typeof(p_terms) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'invalid financial request';
    END IF;
    IF p_action NOT IN ('ACCOUNT', 'POST', 'BALANCE', 'RESERVE', 'RELEASE', 'CANCEL', 'CONSUME', 'REVERSE', 'REBUILD') THEN
        RAISE EXCEPTION 'unknown financial action';
    END IF;
    IF p_action IN ('ACCOUNT', 'POST', 'REVERSE', 'REBUILD') AND p_actor NOT LIKE 'system:%' THEN
        RAISE EXCEPTION 'system capability required'
            USING ERRCODE = '42501';
    END IF;
    expected_keys := CASE p_action
    WHEN 'ACCOUNT' THEN
        ARRAY['asset', 'ownerUserId', 'accountKey', 'kind', 'normalSide']
    WHEN 'POST' THEN
        ARRAY['entries', 'reference']
    WHEN 'BALANCE' THEN
        ARRAY['accountId']
    WHEN 'RESERVE' THEN
        ARRAY['accountId', 'amount', 'reference']
    WHEN 'CONSUME' THEN
        ARRAY['reservationId', 'amount', 'targetAccountId']
    WHEN 'RELEASE' THEN
        ARRAY['reservationId', 'amount']
    WHEN 'CANCEL' THEN
        ARRAY['reservationId']
    WHEN 'REVERSE' THEN
        ARRAY['journalId']
    ELSE
        ARRAY[]::text[]
    END;
    IF p_terms - expected_keys <> '{}'::jsonb THEN
        RAISE EXCEPTION 'unexpected financial terms';
    END IF;
    -- Rebuild excludes every writer; normal operations share this gate and lock accounts in ID order.
    IF p_action = 'REBUILD' THEN
        PERFORM
            pg_advisory_xact_lock(727190001);
        ELSE
            PERFORM
                pg_advisory_xact_lock_shared(727190001);
    END IF;
    IF p_action <> 'BALANCE' THEN
        PERFORM
            pg_advisory_xact_lock(hashtextextended('financial-key:' || p_key, 0));
            SELECT
                *
            INTO
                op
            FROM
                public.financial_operations
            WHERE
                operation_key = p_key;
                IF FOUND THEN
                    IF op.actor <> p_actor OR op.action <> p_action OR op.terms <> p_terms THEN
                        RAISE EXCEPTION 'idempotency conflict'
                            USING ERRCODE = '23505';
                    END IF;
                    RETURN op.result;
                END IF;
        -- Claim the actor-bound idempotency key before applying financial changes.
        INSERT INTO public.financial_operations(operation_key, actor, action, terms, request_hash)
            VALUES (p_key, p_actor, p_action, p_terms, encode(sha256(convert_to(jsonb_build_array(p_actor, p_action, p_terms)::text, 'UTF8')), 'hex'))
        RETURNING
            id
        INTO
            op_id;
    END IF;
    IF p_action = 'POST' AND (jsonb_typeof(p_terms -> 'reference') IS DISTINCT FROM 'string' OR length(p_terms ->> 'reference')
        NOT BETWEEN 1 AND 120) THEN
        RAISE EXCEPTION 'posting business reference required';
    END IF;
    IF p_action = 'ACCOUNT' THEN
        IF p_terms ->> 'asset' IS DISTINCT FROM 'USD' OR length(p_terms ->> 'accountKey')
            NOT BETWEEN 1 AND 120 THEN
            RAISE EXCEPTION 'only USD cents accounts enabled';
        END IF;
        INSERT INTO public.financial_accounts(asset, owner_user_id, account_key, kind, normal_side)
            VALUES ('USD',(p_terms ->> 'ownerUserId')::bigint, p_terms ->> 'accountKey', p_terms ->> 'kind', p_terms ->> 'normalSide')
        RETURNING
            *
        INTO
            a;
        INSERT INTO public.financial_balance_projections(account_id)
            VALUES (a.id);
            result := jsonb_build_object(
                'accountId', a.id::text
            );
        ELSIF p_action = 'REBUILD' THEN
            PERFORM
                id
            FROM
                public.financial_accounts
            ORDER BY
                id
            FOR UPDATE;
            UPDATE
                public.financial_balance_projections p
            SET
                posted = COALESCE((
                    SELECT
                        sum(
                            CASE WHEN e.side = acc.normal_side THEN
                                e.amount::numeric
                            ELSE
                                - e.amount::numeric
                            END)
                    FROM public.financial_journal_entries e
                    WHERE
                        e.account_id = acc.id), 0)::bigint,
                reserved = COALESCE((
                    SELECT
                        sum(
                            CASE WHEN v.kind = 'RESERVE' THEN
                                v.amount::numeric
                            ELSE
                                - v.amount::numeric
                            END)
                    FROM public.cash_reservation_events v
                    JOIN public.cash_reservations r2 ON r2.id = v.reservation_id
                    WHERE
                        r2.account_id = acc.id), 0)::bigint
            FROM
                public.financial_accounts acc
            WHERE
                p.account_id = acc.id;
                result := jsonb_build_object(
                    'rebuilt', TRUE
                );
            ELSE
                IF p_action IN ('CONSUME', 'RELEASE', 'CANCEL') THEN
                    SELECT
                        *
                    INTO
                        STRICT r
                    FROM
                        public.cash_reservations
                    WHERE
                        id =(p_terms ->> 'reservationId')::bigint;
                        account_ids := ARRAY[r.account_id];
                        IF p_action = 'CONSUME' THEN
                            account_ids := account_ids || ARRAY[(p_terms ->> 'targetAccountId')::bigint];
                        END IF;
                    ELSIF p_action = 'POST' THEN
                        lines := p_terms -> 'entries';
                        IF jsonb_typeof(lines) IS DISTINCT FROM 'array' OR jsonb_array_length(lines)
                            NOT BETWEEN 2 AND 100 THEN
                            RAISE EXCEPTION 'journal requires 2 to 100 entries';
                        END IF;
                        SELECT
                            array_agg(DISTINCT (v ->> 'accountId')::bigint)
                        INTO
                            account_ids
                        FROM
                            jsonb_array_elements(lines) v;
                        ELSIF p_action = 'REVERSE' THEN
                            SELECT
                                *
                            INTO
                                STRICT original
                            FROM
                                public.financial_journals
                            WHERE
                                id =(p_terms ->> 'journalId')::bigint;
                                IF original.reversal_of IS NOT NULL OR EXISTS (
                                    SELECT
                                        1
                                    FROM
                                        public.cash_reservation_events
                                    WHERE
                                        cash_reservation_events.journal_id = original.id) THEN
                                    RAISE EXCEPTION 'reservation related or reversal journals are ineligible';
                                END IF;
                                SELECT
                                    jsonb_agg(
                                        jsonb_build_object(
                                            'accountId', e.account_id::text,
                                            'asset', e.asset,
                                            'side', CASE e.side
                                            WHEN 'DEBIT' THEN
                                                'CREDIT'
                                            ELSE
                                                'DEBIT'
                                            END,
                                            'amount', e.amount::text
                                        )
                                        ORDER BY e.id
                                    ),
                                    array_agg(DISTINCT e.account_id)
                                INTO
                                    lines,
                                    account_ids
                                FROM
                                    public.financial_journal_entries e
                                WHERE
                                    e.journal_id = original.id;
                                ELSE
                                    account_ids := ARRAY[(p_terms ->> 'accountId')::bigint];
                END IF;
                IF account_ids IS NULL OR array_position(account_ids, NULL) IS NOT NULL THEN
                    RAISE EXCEPTION 'missing account identity';
                END IF;
                PERFORM
                    id
                FROM
                    public.financial_accounts
                WHERE
                    id = ANY (account_ids)
                ORDER BY
                    id
                FOR UPDATE;
                IF (
                    SELECT
                        count(*)
                    FROM
                        public.financial_accounts
                    WHERE
                        id = ANY (account_ids)) <>(
            SELECT
                count(DISTINCT x)
            FROM
                unnest(account_ids) x) THEN
                    RAISE EXCEPTION 'unknown financial account';
                END IF;
                IF p_action IN ('CONSUME', 'RELEASE', 'CANCEL') THEN
                    SELECT
                        *
                    INTO
                        STRICT r
                    FROM
                        public.cash_reservations
                    WHERE
                        id = r.id
                    FOR UPDATE;
                    IF r.status <> 'OPEN' THEN
                        RAISE EXCEPTION 'reservation is closed';
                    END IF;
                    SELECT
                        *
                    INTO
                        STRICT a
                    FROM
                        public.financial_accounts
                    WHERE
                        id = r.account_id;
                    ELSE
                        SELECT
                            *
                        INTO
                            STRICT a
                        FROM
                            public.financial_accounts
                        WHERE
                            id = account_ids[1];
                END IF;
                IF p_actor LIKE 'user:%' AND (a.owner_user_id IS NULL OR p_actor <> 'user:' || a.owner_user_id::text) THEN
                    RAISE EXCEPTION 'account access denied'
                        USING ERRCODE = '42501';
                END IF;
                IF p_action = 'CONSUME' AND p_actor LIKE 'user:%' THEN
                    RAISE EXCEPTION 'consumption requires system settlement capability'
                        USING ERRCODE = '42501';
                END IF;
                IF p_action = 'BALANCE' THEN
                    SELECT
                        jsonb_build_object(
                            'accountId', account_id::text,
                            'posted', posted::text,
                            'reserved', reserved::text,
                            'available',(posted - reserved)::text
                        )
                    INTO
                        result
                    FROM
                        public.financial_balance_projections
                    WHERE
                        account_id = a.id;
                        RETURN result;
                END IF;
                IF p_action IN ('RESERVE', 'RELEASE', 'CONSUME') THEN
                    IF jsonb_typeof(p_terms -> 'amount') IS DISTINCT FROM 'string' OR (p_terms ->> 'amount') !~ '^[1-9][0-9]{0,18}$' THEN
                        RAISE EXCEPTION 'amount must be positive integer string';
                    END IF;
                    amount :=(p_terms ->> 'amount')::bigint;
                END IF;
                IF p_action = 'RESERVE' THEN
                    IF length(p_terms ->> 'reference')
                        NOT BETWEEN 1 AND 120 THEN
                        RAISE EXCEPTION 'reservation reference required';
                    END IF;
                    INSERT INTO public.cash_reservations(account_id, operation_id, reference, amount)
                        VALUES (a.id, op_id, p_terms ->> 'reference', amount)
                    RETURNING
                        id
                    INTO
                        reservation_id;
                    INSERT INTO public.cash_reservation_events(reservation_id, operation_id, kind, amount)
                        VALUES (reservation_id, op_id, 'RESERVE', amount);
                        result := jsonb_build_object(
                            'reservationId', reservation_id::text
                        );
                    ELSIF p_action IN ('RELEASE', 'CANCEL', 'CONSUME') THEN
                        remaining := r.amount - r.consumed - r.released;
                        IF p_action = 'CANCEL' THEN
                            amount := remaining;
                        END IF;
                        IF amount > remaining THEN
                            RAISE EXCEPTION 'reservation amount exceeds remaining';
                        END IF;
                        UPDATE
                            public.cash_reservations
                        SET
                            consumed = consumed + CASE WHEN p_action = 'CONSUME' THEN
                                ledger.amount
                            ELSE
                                0
                            END,
                            released = released + CASE WHEN p_action <> 'CONSUME' THEN
                                ledger.amount
                            ELSE
                                0
                            END,
                            status = CASE WHEN p_action = 'CANCEL' THEN
                                'CANCELLED'
                            WHEN ledger.amount = remaining THEN
                                'CLOSED'
                            ELSE
                                'OPEN'
                            END
                        WHERE
                            id = r.id;
                            IF p_action = 'CONSUME' THEN
                                target_id :=(p_terms ->> 'targetAccountId')::bigint;
                                IF target_id = r.account_id THEN
                                    RAISE EXCEPTION 'same account consumption forbidden';
                                END IF;
                                IF NOT EXISTS (
                                    SELECT
                                        1
                                    FROM
                                        public.financial_accounts
                                    WHERE
                                        id = target_id
                                        AND kind = 'CUSTOMER'
                                        AND asset = 'USD') THEN
                                    RAISE EXCEPTION 'consumption target must be USD customer';
                                END IF;
                                lines := jsonb_build_array(
                                    jsonb_build_object(
                                        'accountId', r.account_id::text,
                                        'asset', 'USD',
                                        'side', 'DEBIT',
                                        'amount', amount::text
                                    ),
                                    jsonb_build_object(
                                        'accountId', target_id::text,
                                        'asset', 'USD',
                                        'side', 'CREDIT',
                                        'amount', amount::text
                                    )
                                );
                            END IF;
                            result := jsonb_build_object(
                                'reservationId', r.id::text
                            );
                END IF;
                IF p_action IN ('POST', 'REVERSE', 'CONSUME') THEN
                    -- Create the journal header before its immutable accounting lines.
                    INSERT INTO public.financial_journals(operation_id, reversal_of)
                        VALUES (op_id, CASE WHEN p_action = 'REVERSE' THEN
                                original.id
                            ELSE
                                NULL
                            END)
                    RETURNING
                        id
                    INTO
                        journal_id;
                        FOR entry IN
                        SELECT
                            value
                        FROM
                            jsonb_array_elements(lines)
                    LOOP
                        IF entry - ARRAY['accountId', 'asset', 'side', 'amount'] <> '{}'::jsonb OR jsonb_typeof(entry -> 'amount') IS DISTINCT FROM 'string' OR (entry ->> 'amount') !~ '^[1-9][0-9]{0,18}$' THEN
                            RAISE EXCEPTION 'invalid journal entry';
                        END IF;
                        INSERT INTO public.financial_journal_entries(journal_id, account_id, asset, side, amount)
                            VALUES (journal_id,(entry ->> 'accountId')::bigint, entry ->> 'asset', entry ->> 'side',(entry ->> 'amount')::bigint);
                    END LOOP;
                    UPDATE
                        public.financial_journals
                    SET
                        status = 'POSTED'
                    WHERE
                        id = journal_id;
                        result := COALESCE(result, '{}'::jsonb) || jsonb_build_object(
                            'journalId', journal_id::text
                        );
                END IF;
                IF p_action IN ('RELEASE', 'CANCEL', 'CONSUME') THEN
                    INSERT INTO public.cash_reservation_events(reservation_id, operation_id, kind, amount, journal_id)
                        VALUES (r.id, op_id, p_action, amount, journal_id);
                END IF;
    END IF;
    UPDATE
        public.financial_operations
    SET
        result = ledger.result
    WHERE
        id = op_id;
        RETURN result;
END
$$;

--> statement-breakpoint

-- ============================================================================
-- PERMISSIONS AND SECURITY (original execution order preserved)
-- ============================================================================
REVOKE ALL ON FUNCTION public.financial_execute(text, text, text, jsonb) FROM PUBLIC;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.financial_guard(), public.financial_audit(), public.financial_immutable() FROM PUBLIC;

--> statement-breakpoint
REVOKE ALL ON TABLE public.financial_assets, public.financial_accounts, public.financial_operations, public.financial_journals, public.financial_journal_entries, public.financial_balance_projections, public.cash_reservations, public.cash_reservation_events FROM PUBLIC;

--> statement-breakpoint

-- ============================================================================
-- INDEXES (original execution order preserved)
-- ============================================================================
CREATE UNIQUE INDEX financial_operations_post_reference_key ON public.financial_operations USING btree((terms ->> 'reference'))
WHERE
    action = 'POST';
