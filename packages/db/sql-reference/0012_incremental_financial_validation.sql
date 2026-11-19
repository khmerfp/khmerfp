-- READING COPY ONLY: do not execute or use as a migration.
-- Executable source: packages/db/migrations/0012_incremental_financial_validation.sql
-- Original statement order, object names, quoted values and Drizzle boundaries are preserved.
-- Function versions are historical: apply the migration chain to determine the current definition.

-- ============================================================================
-- VALIDATION AND TRANSACTION SAFETY (original execution order preserved)
-- ============================================================================
-- Establish the induction base before introducing incremental validation.
SELECT
    pg_advisory_xact_lock(727190001);

--> statement-breakpoint
LOCK TABLE public.financial_accounts,
public.financial_operations,
public.financial_journals,
public.financial_journal_entries,
public.financial_balance_projections,
public.cash_reservations,
public.cash_reservation_events,
public.position_accounts,
public.position_journals,
public.position_journal_entries,
public.position_balance_projections,
public.position_reservations,
public.position_reservation_events,
public.cash_position_settlements,
public.financial_audit_targets IN SHARE ROW EXCLUSIVE MODE;

--> statement-breakpoint
DO $$
DECLARE
    item record;
BEGIN
    PERFORM
        public.financial_reconcile('system:migration');
    FOR item IN
    SELECT
        id
    FROM
        public.position_accounts LOOP
            PERFORM
                public.position_validate('POSITION_ACCOUNT', item.id);
        END LOOP;
    FOR item IN
    SELECT
        id
    FROM
        public.position_journals LOOP
            PERFORM
                public.position_validate('POSITION_JOURNAL', item.id);
        END LOOP;
    FOR item IN
    SELECT
        id
    FROM
        public.position_reservations LOOP
            PERFORM
                public.position_validate('POSITION_RESERVATION', item.id);
        END LOOP;
    FOR item IN
    SELECT
        id
    FROM
        public.cash_position_settlements LOOP
            PERFORM
                public.position_validate('SETTLEMENT', item.id);
        END LOOP;
    IF EXISTS (
        SELECT
            1
        FROM
            public.financial_audit_targets) OR EXISTS (
    SELECT
        1
    FROM
        public.financial_operations o
    WHERE
        o.action = 'SETTLE'
            AND NOT EXISTS (
            SELECT
                1
            FROM
                public.cash_position_settlements s
            WHERE
                s.operation_id = o.id)) THEN
        RAISE EXCEPTION 'inconsistent pre-existing audit or settlement state';
    END IF;
    IF EXISTS (
        SELECT
            1
        FROM
            public.financial_accounts a
            JOIN public.financial_balance_projections p ON p.account_id = a.id
        WHERE
            a.kind = 'CUSTOMER'
            AND (p.posted < 0
            OR p.reserved < 0
            OR p.reserved > p.posted)) OR EXISTS (
SELECT
    1
FROM
    public.position_accounts a
    JOIN public.position_balance_projections p ON p.account_id = a.id
WHERE (a.kind <> 'EXTERNAL_CONTROL'
AND p.posted < p.reserved)
    OR p.reserved < 0
    OR (a.kind = 'EXTERNAL_CONTROL'
    AND p.reserved <> 0)) THEN
        RAISE EXCEPTION 'inconsistent pre-existing available balances';
    END IF;
END
$$;

--> statement-breakpoint

-- ============================================================================
-- TABLES (original execution order preserved)
-- ============================================================================
-- Internal transaction baselines and independently derived changes; removed after validation.
CREATE TABLE "financial_audit_deltas"(
    "generation" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name
        "financial_audit_deltas_generation_seq" INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 9223372036854775807 START WITH 1
        CACHE 1),
        "transaction_id" text NOT NULL,
        "target_kind" text NOT NULL,
        "target_id" bigint NOT NULL,
        "baseline_first" numeric NOT NULL,
        "baseline_second" numeric NOT NULL,
        "delta_first" numeric DEFAULT '0' NOT NULL,
        "delta_second" numeric DEFAULT '0' NOT NULL,
        "new_object" boolean DEFAULT FALSE NOT NULL,
        "full_rebuild" boolean DEFAULT FALSE NOT NULL,
        "event_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
        "rebuild_domain" text DEFAULT '' NOT NULL,
        CONSTRAINT "financial_audit_deltas_target_key" UNIQUE ("transaction_id", "target_kind", "target_id"),
        CONSTRAINT "financial_audit_deltas_identity_check" CHECK ("financial_audit_deltas"."transaction_id" ~ '^[0-9]+$' AND "financial_audit_deltas"."target_id" > 0),
        CONSTRAINT "financial_audit_deltas_kind_check" CHECK ("financial_audit_deltas"."target_kind" IN ('ACCOUNT', 'POSITION_ACCOUNT', 'RESERVATION', 'POSITION_RESERVATION', 'MAINTENANCE')),
        CONSTRAINT "financial_audit_deltas_integer_check" CHECK (scale("financial_audit_deltas"."baseline_first") = 0 AND scale("financial_audit_deltas"."baseline_second") = 0 AND scale("financial_audit_deltas"."delta_first") = 0 AND scale("financial_audit_deltas"."delta_second") = 0),
        CONSTRAINT "financial_audit_deltas_domain_check" CHECK (("financial_audit_deltas"."target_kind" = 'MAINTENANCE' AND "financial_audit_deltas"."rebuild_domain" IN ('CASH', 'POSITION')) OR ("financial_audit_deltas"."target_kind" <> 'MAINTENANCE' AND "financial_audit_deltas"."rebuild_domain" = ''))
);

--> statement-breakpoint

-- ============================================================================
-- CONSTRAINTS AND TABLE ALTERATIONS (original execution order preserved)
-- ============================================================================
ALTER TABLE "financial_audit_targets"
    ADD COLUMN "context_generation" bigint;

--> statement-breakpoint
ALTER TABLE "financial_audit_targets"
    ADD CONSTRAINT "financial_targets_delta_generation_fk" FOREIGN KEY ("context_generation") REFERENCES "public"."financial_audit_deltas"("generation") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Rejects direct audit-state manipulation, baseline replacement and unauthorized rebuild context changes.
CREATE FUNCTION public.financial_protect_delta()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $$
BEGIN
    IF TG_OP = 'TRUNCATE' OR pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'protected audit state cannot be manipulated directly'
            USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.transaction_id IS DISTINCT FROM pg_current_xact_id()::text THEN
        RAISE EXCEPTION 'audit transaction mismatch';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF(to_jsonb(NEW) - ARRAY['delta_first', 'delta_second', 'event_ids', 'full_rebuild']) IS DISTINCT FROM(to_jsonb(OLD) - ARRAY['delta_first', 'delta_second', 'event_ids', 'full_rebuild']) OR cardinality(NEW.event_ids) < cardinality(OLD.event_ids) OR(cardinality(OLD.event_ids) > 0 AND NEW.event_ids[1:cardinality(OLD.event_ids)] IS DISTINCT FROM OLD.event_ids) THEN
            RAISE EXCEPTION 'audit baseline and generation are immutable';
        END IF;
        IF NEW.full_rebuild IS DISTINCT FROM OLD.full_rebuild AND(OLD.full_rebuild OR NOT EXISTS(
            SELECT
                1
            FROM
                public.financial_audit_deltas d
            WHERE
                d.transaction_id = NEW.transaction_id
                AND d.target_kind = 'MAINTENANCE'
                AND d.rebuild_domain = CASE WHEN NEW.target_kind = 'ACCOUNT' THEN
                    'CASH'
                ELSE
                    'POSITION'
                END)) THEN
    RAISE EXCEPTION 'unauthorized rebuild context';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END
$$;

--> statement-breakpoint

-- ============================================================================
-- TRIGGERS (original execution order preserved)
-- ============================================================================
-- Rejects direct audit-state manipulation, baseline replacement and unauthorized rebuild context changes.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER financial_delta_protection
    BEFORE INSERT OR UPDATE OR DELETE ON public.financial_audit_deltas
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_protect_delta();

--> statement-breakpoint
-- Rejects direct audit-state manipulation, baseline replacement and unauthorized rebuild context changes.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER financial_delta_truncate_protection
    BEFORE TRUNCATE ON public.financial_audit_deltas
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.financial_protect_delta();

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Protects audit target identity, scheduling and cleanup from direct runtime manipulation.
CREATE FUNCTION public.financial_protect_target()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.transaction_id IS DISTINCT FROM pg_current_xact_id()::text THEN
        RAISE EXCEPTION 'audit transaction mismatch';
    END IF;
    IF TG_OP = 'TRUNCATE' OR TG_OP = 'UPDATE' OR pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'protected audit target cannot be manipulated directly'
            USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END
$$;

--> statement-breakpoint

-- ============================================================================
-- TRIGGERS (original execution order preserved)
-- ============================================================================
-- Protects audit target identity, scheduling and cleanup from direct runtime manipulation.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER financial_target_protection
    BEFORE INSERT OR UPDATE OR DELETE ON public.financial_audit_targets
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_protect_target();

--> statement-breakpoint
-- Protects audit target identity, scheduling and cleanup from direct runtime manipulation.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER financial_target_truncate_protection
    BEFORE TRUNCATE ON public.financial_audit_targets
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.financial_protect_target();

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Captures the locked account or reservation state before its first transaction mutation; rebuilds require the exclusive maintenance gate.
CREATE FUNCTION public.financial_capture_baseline()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    tx text := pg_current_xact_id()::text;
    kind text;
    object_id bigint;
    first_value numeric := 0;
    second_value numeric := 0;
    fresh boolean := TG_OP = 'INSERT';
    DOMAIN text;
BEGIN
    IF TG_TABLE_NAME = 'financial_operations' THEN
        IF NEW.action NOT IN ('REBUILD', 'POSITION_REBUILD') THEN
            RETURN NEW;
        END IF;
        IF NEW.actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' OR NEW.terms <> '{}'::jsonb OR NOT EXISTS (
            SELECT
                1
            FROM
                pg_locks
            WHERE
                locktype = 'advisory'
                AND pid = pg_backend_pid()
                AND classid = 0
                AND objid = 727190001
                AND objsubid = 1
                AND mode = 'ExclusiveLock'
                AND granted) THEN
            RAISE EXCEPTION 'rebuild requires controlled exclusive maintenance gate';
        END IF;
        DOMAIN := CASE NEW.action
        WHEN 'REBUILD' THEN
            'CASH'
        ELSE
            'POSITION'
        END;
        INSERT INTO public.financial_audit_deltas(transaction_id, target_kind, target_id, baseline_first, baseline_second, rebuild_domain)
            VALUES (tx, 'MAINTENANCE', NEW.id, 0, 0, domain);
        UPDATE
            public.financial_audit_deltas
        SET
            full_rebuild = TRUE
        WHERE
            transaction_id = tx
            AND target_kind = CASE DOMAIN
            WHEN 'CASH' THEN
                'ACCOUNT'
            ELSE
                'POSITION_ACCOUNT'
            END;
        RETURN NEW;
    ELSIF TG_TABLE_NAME IN ('financial_accounts', 'position_accounts') THEN
        kind := CASE TG_TABLE_NAME
        WHEN 'financial_accounts' THEN
            'ACCOUNT'
        ELSE
            'POSITION_ACCOUNT'
        END;
        object_id := NEW.id;
    ELSIF TG_TABLE_NAME IN ('financial_balance_projections', 'position_balance_projections') THEN
        kind := CASE TG_TABLE_NAME
        WHEN 'financial_balance_projections' THEN
            'ACCOUNT'
        ELSE
            'POSITION_ACCOUNT'
        END;
        object_id := NEW.account_id;
        IF kind = 'ACCOUNT' THEN
            PERFORM
                id
            FROM
                public.financial_accounts
            WHERE
                id = object_id
            FOR UPDATE;
        ELSE
            PERFORM
                id
            FROM
                public.position_accounts
            WHERE
                id = object_id
            FOR UPDATE;
        END IF;
        IF TG_OP = 'UPDATE' THEN
            first_value := OLD.posted;
            second_value := OLD.reserved;
        END IF;
    ELSIF TG_TABLE_NAME IN ('cash_reservations', 'position_reservations') THEN
        kind := CASE TG_TABLE_NAME
        WHEN 'cash_reservations' THEN
            'RESERVATION'
        ELSE
            'POSITION_RESERVATION'
        END;
        object_id := NEW.id;
        IF kind = 'RESERVATION' THEN
            PERFORM
                id
            FROM
                public.financial_accounts
            WHERE
                id = NEW.account_id
            FOR UPDATE;
        ELSE
            PERFORM
                id
            FROM
                public.position_accounts
            WHERE
                id = NEW.account_id
            FOR UPDATE;
        END IF;
        IF TG_OP = 'UPDATE' THEN
            first_value := OLD.consumed;
            second_value := OLD.released;
        END IF;
    ELSE
        RAISE EXCEPTION 'unexpected baseline source';
    END IF;
    DOMAIN := CASE WHEN kind = 'ACCOUNT' THEN
        'CASH'
    ELSE
        'POSITION'
    END;
    INSERT INTO public.financial_audit_deltas(transaction_id, target_kind, target_id, baseline_first, baseline_second, new_object, full_rebuild)
        VALUES (tx, kind, object_id, first_value, second_value, fresh, kind IN ('ACCOUNT', 'POSITION_ACCOUNT')
            AND EXISTS (
                SELECT
                    1
                FROM
                    public.financial_audit_deltas
                WHERE
                    transaction_id = tx
                    AND target_kind = 'MAINTENANCE'
                    AND rebuild_domain = DOMAIN))
    ON CONFLICT (transaction_id,
        target_kind,
        target_id)
        DO NOTHING;
    RETURN NEW;
END
$$;

--> statement-breakpoint

-- ============================================================================
-- TRIGGERS (original execution order preserved)
-- ============================================================================
-- Captures the locked account or reservation state before its first transaction mutation; rebuilds require the exclusive maintenance gate.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER aaa_financial_accounts_baseline
    BEFORE INSERT ON public.financial_accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_capture_baseline();

--> statement-breakpoint
-- Captures the locked account or reservation state before its first transaction mutation; rebuilds require the exclusive maintenance gate.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER aaa_position_accounts_baseline
    BEFORE INSERT ON public.position_accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_capture_baseline();

--> statement-breakpoint
-- Captures the locked account or reservation state before its first transaction mutation; rebuilds require the exclusive maintenance gate.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER aaa_financial_balance_projections_baseline
    BEFORE INSERT OR UPDATE ON public.financial_balance_projections
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_capture_baseline();

--> statement-breakpoint
-- Captures the locked account or reservation state before its first transaction mutation; rebuilds require the exclusive maintenance gate.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER aaa_position_balance_projections_baseline
    BEFORE INSERT OR UPDATE ON public.position_balance_projections
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_capture_baseline();

--> statement-breakpoint
-- Captures the locked account or reservation state before its first transaction mutation; rebuilds require the exclusive maintenance gate.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER aaa_cash_reservations_baseline
    BEFORE INSERT OR UPDATE ON public.cash_reservations
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_capture_baseline();

--> statement-breakpoint
-- Captures the locked account or reservation state before its first transaction mutation; rebuilds require the exclusive maintenance gate.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER aaa_position_reservations_baseline
    BEFORE INSERT OR UPDATE ON public.position_reservations
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_capture_baseline();

--> statement-breakpoint
-- Captures the locked account or reservation state before its first transaction mutation; rebuilds require the exclusive maintenance gate.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER financial_operations_rebuild_context
    AFTER INSERT ON public.financial_operations
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_capture_baseline();

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Derives expected changes from newly inserted immutable entries and reservation events, not supplied projection values.
CREATE FUNCTION public.financial_accumulate_delta()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    tx text := pg_current_xact_id()::text;
    kind text;
    account_kind text;
    account_id bigint;
    reservation_id bigint;
    value numeric;
    normal text;
BEGIN
    IF TG_TABLE_NAME IN ('financial_journal_entries', 'position_journal_entries') THEN
        account_id := NEW.account_id;
        IF TG_TABLE_NAME = 'financial_journal_entries' THEN
            kind := 'ACCOUNT';
            SELECT
                normal_side
            INTO
                STRICT normal
            FROM
                public.financial_accounts
            WHERE
                id = account_id;
            value := CASE WHEN NEW.side = normal THEN
                NEW.amount::numeric
            ELSE
                - NEW.amount::numeric
            END;
        ELSE
            kind := 'POSITION_ACCOUNT';
            value := CASE NEW.side
            WHEN 'IN' THEN
                NEW.quantity::numeric
            ELSE
                - NEW.quantity::numeric
            END;
        END IF;
        UPDATE
            public.financial_audit_deltas
        SET
            delta_first = delta_first + value
        WHERE
            transaction_id = tx
            AND target_kind = kind
            AND target_id = account_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'missing pre-mutation account baseline';
        END IF;
    ELSIF TG_TABLE_NAME IN ('cash_reservation_events', 'position_reservation_events') THEN
        reservation_id := NEW.reservation_id;
        IF TG_TABLE_NAME = 'cash_reservation_events' THEN
            kind := 'RESERVATION';
            account_kind := 'ACCOUNT';
            value := NEW.amount;
            SELECT
                r.account_id
            INTO
                STRICT account_id
            FROM
                public.cash_reservations r
            WHERE
                r.id = reservation_id;
        ELSE
            kind := 'POSITION_RESERVATION';
            account_kind := 'POSITION_ACCOUNT';
            value := NEW.quantity;
            SELECT
                r.account_id
            INTO
                STRICT account_id
            FROM
                public.position_reservations r
            WHERE
                r.id = reservation_id;
        END IF;
        UPDATE
            public.financial_audit_deltas
        SET
            delta_first = delta_first + CASE NEW.kind
            WHEN 'CONSUME' THEN
                value
            ELSE
                0
            END,
            delta_second = delta_second + CASE WHEN NEW.kind IN ('RELEASE', 'CANCEL') THEN
                value
            ELSE
                0
            END,
            event_ids = array_append(event_ids, NEW.id)
        WHERE
            transaction_id = tx
            AND target_kind = kind
            AND target_id = reservation_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'missing pre-mutation reservation baseline';
        END IF;
        UPDATE
            public.financial_audit_deltas
        SET
            delta_second = delta_second + CASE NEW.kind
            WHEN 'RESERVE' THEN
                value
            ELSE
                - value
            END
        WHERE
            transaction_id = tx
            AND target_kind = account_kind
            AND target_id = account_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'missing pre-mutation reserved baseline';
        END IF;
    ELSE
        RAISE EXCEPTION 'unexpected delta source';
    END IF;
    RETURN NULL;
END
$$;

--> statement-breakpoint

-- ============================================================================
-- TRIGGERS (original execution order preserved)
-- ============================================================================
-- Derives expected changes from newly inserted immutable entries and reservation events, not supplied projection values.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER aaa_financial_journal_entries_delta
    AFTER INSERT ON public.financial_journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_accumulate_delta();

--> statement-breakpoint
-- Derives expected changes from newly inserted immutable entries and reservation events, not supplied projection values.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER aaa_position_journal_entries_delta
    AFTER INSERT ON public.position_journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_accumulate_delta();

--> statement-breakpoint
-- Derives expected changes from newly inserted immutable entries and reservation events, not supplied projection values.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER aaa_cash_reservation_events_delta
    AFTER INSERT ON public.cash_reservation_events
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_accumulate_delta();

--> statement-breakpoint
-- Derives expected changes from newly inserted immutable entries and reservation events, not supplied projection values.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER aaa_position_reservation_events_delta
    AFTER INSERT ON public.position_reservation_events
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_accumulate_delta();

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Binds a deduplicated target to the current transaction and protected baseline generation.
CREATE FUNCTION public.financial_queue_audit(p_kind text, p_id bigint)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    tx text := pg_current_xact_id()::text;
    generation_id bigint;
BEGIN
    IF p_kind IN ('ACCOUNT', 'POSITION_ACCOUNT', 'RESERVATION', 'POSITION_RESERVATION') THEN
        SELECT
            generation
        INTO
            STRICT generation_id
        FROM
            public.financial_audit_deltas
        WHERE
            transaction_id = tx
            AND target_kind = p_kind
            AND target_id = p_id;
    END IF;
    INSERT INTO public.financial_audit_targets(transaction_id, target_kind, target_id, context_generation)
        VALUES (tx, p_kind, p_id, generation_id)
    ON CONFLICT
        DO NOTHING;
END
$$;

--> statement-breakpoint
-- Queues affected records for mandatory transaction-end checks without rescanning unrelated history.
CREATE OR REPLACE FUNCTION public.financial_schedule_audit()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
BEGIN
    CASE TG_TABLE_NAME
    WHEN 'financial_accounts' THEN
        PERFORM
            public.financial_queue_audit('ACCOUNT', NEW.id);
    WHEN 'financial_operations' THEN
        PERFORM
            public.financial_queue_audit('OPERATION', NEW.id);
    WHEN 'financial_journals' THEN
        PERFORM
            public.financial_queue_audit('JOURNAL', NEW.id);
    WHEN 'financial_journal_entries' THEN
        PERFORM
            public.financial_queue_audit('JOURNAL', NEW.journal_id);
            PERFORM
                public.financial_queue_audit('ACCOUNT', NEW.account_id);
    WHEN 'financial_balance_projections' THEN
        PERFORM
            public.financial_queue_audit('ACCOUNT', NEW.account_id);
    WHEN 'cash_reservations' THEN
        PERFORM
            public.financial_queue_audit('RESERVATION', NEW.id);
            PERFORM
                public.financial_queue_audit('ACCOUNT', NEW.account_id);
    WHEN 'cash_reservation_events' THEN
        PERFORM
            public.financial_queue_audit('RESERVATION', NEW.reservation_id); IF NEW.journal_id IS NOT NULL THEN
                    PERFORM
                        public.financial_queue_audit('JOURNAL', NEW.journal_id);
            END IF;
    WHEN 'position_accounts' THEN
        PERFORM
            public.financial_queue_audit('POSITION_ACCOUNT', NEW.id);
    WHEN 'position_journals' THEN
        PERFORM
            public.financial_queue_audit('POSITION_JOURNAL', NEW.id);
    WHEN 'position_journal_entries' THEN
        PERFORM
            public.financial_queue_audit('POSITION_JOURNAL', NEW.journal_id);
    PERFORM
        public.financial_queue_audit('POSITION_ACCOUNT', NEW.account_id);
    WHEN 'position_balance_projections' THEN
        PERFORM
            public.financial_queue_audit('POSITION_ACCOUNT', NEW.account_id);
    WHEN 'position_reservations' THEN
        PERFORM
            public.financial_queue_audit('POSITION_RESERVATION', NEW.id);
    PERFORM
        public.financial_queue_audit('POSITION_ACCOUNT', NEW.account_id);
    WHEN 'position_reservation_events' THEN
        PERFORM
            public.financial_queue_audit('POSITION_RESERVATION', NEW.reservation_id);
    WHEN 'cash_position_settlements' THEN
        PERFORM
            public.financial_queue_audit('SETTLEMENT', NEW.id);
ELSE
    RAISE EXCEPTION 'unexpected audit source';
    END CASE;
    RETURN NULL;
END
$$;

--> statement-breakpoint
-- Compares final counters and projections with protected baselines plus authoritative deltas; validates new reservation event links.
CREATE FUNCTION public.financial_validate_delta(p_kind text, p_id bigint, p_generation bigint)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
    << audit >>
DECLARE
    d public.financial_audit_deltas;
    first_value numeric;
    second_value numeric;
    account_id bigint;
    operation_id bigint;
    total numeric;
    v record;
    o public.financial_operations;
BEGIN
    SELECT
        *
    INTO
        STRICT d
    FROM
        public.financial_audit_deltas
    WHERE
        generation = p_generation
        AND transaction_id = pg_current_xact_id()::text
        AND target_kind = p_kind
        AND target_id = p_id
    FOR UPDATE;
    IF p_kind IN ('ACCOUNT', 'POSITION_ACCOUNT') THEN
        IF p_kind = 'ACCOUNT' THEN
            SELECT
                posted,
                reserved
            INTO
                STRICT first_value,
                second_value
            FROM
                public.financial_balance_projections
            WHERE
                financial_balance_projections.account_id = p_id;
                IF d.full_rebuild THEN
                    IF first_value <> COALESCE((
                        SELECT
                            sum(
                            CASE WHEN e.side = a.normal_side THEN
                                e.amount::numeric
                            ELSE
                                - e.amount::numeric
                            END)
                        FROM public.financial_journal_entries e
                    JOIN public.financial_accounts a ON a.id = e.account_id
                        WHERE
                            e.account_id = p_id), 0)
                            OR second_value <> COALESCE((
                                SELECT
                                    sum(amount::numeric - consumed - released)
                                FROM public.cash_reservations
                                WHERE
                                    cash_reservations.account_id = p_id), 0) THEN
                            RAISE EXCEPTION 'financial projection differs from history during reconstruction';
                    END IF;
                    RETURN;
                END IF;
            ELSE
                SELECT
                    posted,
                    reserved
                INTO
                    STRICT first_value,
                    second_value
                FROM
                    public.position_balance_projections
                WHERE
                    position_balance_projections.account_id = p_id;
                    IF d.full_rebuild THEN
                        PERFORM
                            public.position_validate('POSITION_ACCOUNT', p_id);
                            RETURN;
                    END IF;
        END IF;
        IF first_value <> d.baseline_first + d.delta_first OR second_value <> d.baseline_second + d.delta_second THEN
            RAISE EXCEPTION 'projection differs from authoritative transaction deltas'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF p_kind = 'RESERVATION' THEN
            SELECT
                consumed,
                released,
                r.account_id,
                r.operation_id,
                r.amount
            INTO
                STRICT first_value,
                second_value,
                account_id,
                operation_id,
                total
            FROM
                public.cash_reservations r
            WHERE
                r.id = p_id;
            ELSE
                SELECT
                    consumed,
                    released,
                    r.account_id,
                    r.operation_id,
                    r.quantity
                INTO
                    STRICT first_value,
                    second_value,
                    account_id,
                    operation_id,
                    total
                FROM
                    public.position_reservations r
                WHERE
                    r.id = p_id;
        END IF;
        IF first_value <> d.baseline_first + d.delta_first OR second_value <> d.baseline_second + d.delta_second THEN
            RAISE EXCEPTION 'reservation differs from immutable event deltas'
                USING ERRCODE = '23514';
        END IF;
        IF p_kind = 'RESERVATION' THEN
            IF cardinality(d.event_ids) <>(
                SELECT
                    count(*)
                FROM
                    public.cash_reservation_events
                WHERE
                    id = ANY (d.event_ids)
                    AND reservation_id = p_id) THEN
                RAISE EXCEPTION 'missing or duplicate cash reservation events';
            END IF;
        ELSE
            IF cardinality(d.event_ids) <>(
                SELECT
                    count(*)
                FROM
                    public.position_reservation_events
                WHERE
                    id = ANY (d.event_ids)
                    AND reservation_id = p_id) THEN
                RAISE EXCEPTION 'missing or duplicate position reservation events';
            END IF;
        END IF;
        IF d.new_object AND cardinality(d.event_ids) = 0 THEN
            RAISE EXCEPTION 'new reservation requires initial reserve event';
        END IF;
        -- Only current-generation IDs are read; neither xmin nor sequence frontiers identify new rows.
        FOR v IN
        SELECT
            e.id,
            e.operation_id AS op,
            e.kind,
            e.amount AS quantity,
            e.journal_id
        FROM
            public.cash_reservation_events e
        WHERE
            p_kind = 'RESERVATION'
            AND id = ANY (d.event_ids)
        UNION ALL
        SELECT
            e.id,
            e.operation_id,
            e.kind,
            e.quantity,
            e.journal_id
        FROM
            public.position_reservation_events e
        WHERE
            p_kind = 'POSITION_RESERVATION'
            AND id = ANY (d.event_ids)
        LOOP
            SELECT
                *
            INTO
                STRICT o
            FROM
                public.financial_operations
            WHERE
                id = v.op;
                IF v.kind = 'RESERVE' THEN
                    IF NOT d.new_object OR v.op <> operation_id OR v.quantity <> total OR o.action <>(
                        CASE p_kind
                        WHEN 'RESERVATION' THEN
                            'RESERVE'
                        ELSE
                            'POSITION_RESERVE'
                        END) THEN
                    RAISE EXCEPTION 'reservation initial event mismatch';
                    END IF;
                ELSIF v.kind = 'CONSUME' THEN
                    IF p_kind = 'RESERVATION' THEN
                        IF o.action NOT IN ('CONSUME', 'SETTLE') OR NOT EXISTS (
                            SELECT
                                1
                            FROM
                                public.financial_journals
                            WHERE
                                id = v.journal_id
                                AND financial_journals.operation_id = v.op
                                AND status = 'POSTED') OR (
                        SELECT
                            count(*)
                        FROM
                            public.financial_journal_entries
                        WHERE
                            journal_id = v.journal_id) <> 2 OR NOT EXISTS (
                    SELECT
                        1
                    FROM
                        public.financial_journal_entries
                    WHERE
                        journal_id = v.journal_id
                        AND financial_journal_entries.account_id = audit.account_id
                        AND side = 'DEBIT'
                        AND amount = v.quantity) THEN
                            RAISE EXCEPTION 'reservation consumption journal mismatch';
                        END IF;
                    ELSE
                        IF o.action NOT IN ('POSITION_CONSUME', 'SETTLE') OR NOT EXISTS (
                            SELECT
                                1
                            FROM
                                public.position_journals
                            WHERE
                                id = v.journal_id
                                AND position_journals.operation_id = v.op
                                AND status = 'POSTED'
                                AND purpose = CASE o.action
                                WHEN 'SETTLE' THEN
                                    'SETTLEMENT'
                                ELSE
                                    'CONSUMPTION'
                                END)
                        OR (
                            SELECT
                                count(*)
                            FROM
                                public.position_journal_entries
                            WHERE
                                journal_id = v.journal_id) <> 2
                        OR NOT EXISTS (
                            SELECT
                                1
                            FROM
                                public.position_journal_entries
                            WHERE
                                journal_id = v.journal_id
                                AND position_journal_entries.account_id = audit.account_id
                                AND side = 'OUT'
                                AND quantity = v.quantity) THEN
                        RAISE EXCEPTION 'position reservation consumption mismatch';
                        END IF;
                    END IF;
                ELSIF o.action <>(
                        CASE WHEN p_kind = 'RESERVATION' THEN
                            v.kind
                        ELSE
                            'POSITION_' || v.kind
                        END) THEN
                    RAISE EXCEPTION 'reservation event operation mismatch';
                END IF;
        END LOOP;
        IF d.new_object AND (
            SELECT
                count(*)
            FROM (
            SELECT
                id
            FROM
                public.cash_reservation_events
            WHERE
                p_kind = 'RESERVATION'
                AND id = ANY (d.event_ids)
                AND kind = 'RESERVE'
            UNION ALL
            SELECT
                id
            FROM
                public.position_reservation_events
            WHERE
                p_kind = 'POSITION_RESERVATION'
                AND id = ANY (d.event_ids)
                AND kind = 'RESERVE') initial_events) <> 1 THEN
            RAISE EXCEPTION 'reservation requires exactly one initial event';
        END IF;
    END IF;
END
$$;

--> statement-breakpoint
-- Validates the selected journal/account/reservation/operation/settlement and removes its completed audit context.
CREATE OR REPLACE FUNCTION public.financial_validate_target()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    j public.financial_journals;
    a public.financial_accounts;
    p public.financial_balance_projections;
    r public.cash_reservations;
BEGIN
    IF NEW.transaction_id IS DISTINCT FROM pg_current_xact_id()::text THEN
        RAISE EXCEPTION 'audit transaction mismatch';
    END IF;
    IF NEW.target_kind IN ('ACCOUNT', 'POSITION_ACCOUNT', 'RESERVATION', 'POSITION_RESERVATION') THEN
        PERFORM
            public.financial_validate_delta(NEW.target_kind, NEW.target_id, NEW.context_generation);
    ELSIF NEW.target_kind IN ('POSITION_JOURNAL', 'SETTLEMENT') THEN
        IF NEW.target_kind = 'SETTLEMENT' AND NOT EXISTS (
            SELECT
                1
            FROM
                public.cash_position_settlements s1
                JOIN public.markets m1 ON m1.id = s1.market_id
            WHERE
                s1.id = NEW.target_id
                AND m1.lifecycle_status = 'ACTIVE'
                AND m1.trading_status = 'OPEN'
                AND m1.resolution_status = 'UNRESOLVED'
                AND m1.terms_frozen_at IS NOT NULL
                AND clock_timestamp() >= m1.trading_starts_at
                AND clock_timestamp() < m1.trading_ends_at) THEN
            RAISE EXCEPTION 'market closed or cutoff reached before settlement commit';
        END IF;
        PERFORM
            public.position_validate(NEW.target_kind, NEW.target_id);
    ELSIF NEW.target_kind = 'OPERATION' THEN
        IF NOT EXISTS (
            SELECT
                1
            FROM
                public.financial_operations
            WHERE
                id = NEW.target_id
                AND result IS NOT NULL) THEN
            RAISE EXCEPTION 'incomplete financial operation';
        END IF;
        IF EXISTS (
            SELECT
                1
            FROM
                public.financial_operations o
            WHERE
                o.id = NEW.target_id
                AND o.action = 'SETTLE'
                AND NOT EXISTS (
                SELECT
                    1
                FROM
                    public.cash_position_settlements s1
                WHERE
                    s1.operation_id = o.id)) THEN
            RAISE EXCEPTION 'incomplete settlement operation';
        END IF;
    ELSIF NEW.target_kind = 'JOURNAL' THEN
        SELECT
            *
        INTO
            STRICT j
        FROM
            public.financial_journals
        WHERE
            id = NEW.target_id;
        IF j.status <> 'POSTED' OR (
            SELECT
                count(*)
            FROM
                public.financial_journal_entries
            WHERE
                journal_id = j.id) < 2 OR EXISTS (
        SELECT
            1
        FROM
            public.financial_journal_entries
        WHERE
            journal_id = j.id
        GROUP BY
            asset
        HAVING
            sum(
            CASE side
            WHEN 'DEBIT' THEN
                amount::numeric
            ELSE
                - amount::numeric
            END) <> 0) THEN
    RAISE EXCEPTION 'journal must be posted and balanced per asset'
                USING ERRCODE = '23514';
        END IF;
        IF j.reversal_of IS NOT NULL AND (EXISTS (
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
        OR EXISTS (
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
        OR EXISTS (
            SELECT
                1
            FROM
                public.cash_reservation_events
            WHERE
                journal_id = j.reversal_of)) THEN
    RAISE EXCEPTION 'reversal must exactly compensate eligible journal';
        END IF;
    ELSE
        RAISE EXCEPTION 'unknown audit target';
    END IF;
    -- Remove protected transaction state only after the required validation succeeds.
    DELETE FROM public.financial_audit_targets
    WHERE transaction_id = NEW.transaction_id
        AND target_kind = NEW.target_kind
        AND target_id = NEW.target_id;
    IF NEW.context_generation IS NOT NULL THEN
        DELETE FROM public.financial_audit_deltas
        WHERE generation = NEW.context_generation;
    END IF;
    IF NEW.target_kind = 'OPERATION' THEN
        DELETE FROM public.financial_audit_deltas
        WHERE transaction_id = NEW.transaction_id
            AND target_kind = 'MAINTENANCE'
            AND target_id = NEW.target_id;
    END IF;
    RETURN NULL;
END
$$;

--> statement-breakpoint
-- Executes authorized financial operations; later versions extend dispatch to positions. The caller owns the transaction and deferred commit checks.
CREATE OR REPLACE FUNCTION public.financial_execute(p_actor text, p_action text, p_key text, p_terms jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    result jsonb;
BEGIN
    IF p_action LIKE 'POSITION_%' OR p_action = 'SETTLE' THEN
        RETURN public.position_execute(p_actor, p_action, p_key, p_terms);
    END IF;
    result := public.financial_cash_execute(p_actor, p_action, p_key, p_terms);
    IF p_action = 'REBUILD' THEN
        PERFORM
            public.financial_reconcile(p_actor);
    END IF;
    RETURN result;
END
$$;

--> statement-breakpoint

-- ============================================================================
-- PERMISSIONS AND SECURITY (original execution order preserved)
-- ============================================================================
REVOKE ALL ON TABLE public.financial_audit_deltas FROM PUBLIC;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.financial_protect_delta(), public.financial_protect_target(), public.financial_capture_baseline(), public.financial_accumulate_delta(), public.financial_queue_audit(text, bigint), public.financial_validate_delta(text, bigint, bigint) FROM PUBLIC;

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Rejects an orphan baseline at commit; forced earlier validation may already have removed a checked generation.
CREATE FUNCTION public.financial_delta_link_check()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
BEGIN
    -- A prior forced validation may already have removed this protected generation.
    IF NOT EXISTS(
        SELECT
            1
        FROM
            public.financial_audit_deltas
        WHERE
            generation = NEW.generation) THEN
        RETURN NULL;
    END IF;
    IF NEW.target_kind = 'MAINTENANCE' THEN
        IF NOT EXISTS(
            SELECT
                1
            FROM
                public.financial_audit_targets
            WHERE
                transaction_id = NEW.transaction_id
                AND target_kind = 'OPERATION'
                AND target_id = NEW.target_id) THEN
            RAISE EXCEPTION 'orphan maintenance audit context';
        END IF;
    ELSIF NOT EXISTS(
            SELECT
                1
            FROM
                public.financial_audit_targets
            WHERE
                transaction_id = NEW.transaction_id
                AND target_kind = NEW.target_kind
                AND target_id = NEW.target_id
                AND context_generation = NEW.generation) THEN
        RAISE EXCEPTION 'orphan incremental audit context';
    END IF;
    RETURN NULL;
END
$$;

--> statement-breakpoint

-- ============================================================================
-- TRIGGERS (original execution order preserved)
-- ============================================================================
-- Rejects an orphan baseline at commit; forced earlier validation may already have removed a checked generation.
-- Mandatory deferred integrity check; validation must succeed before the transaction commits.
CREATE CONSTRAINT TRIGGER financial_delta_requires_target
    AFTER INSERT ON public.financial_audit_deltas DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_delta_link_check();

--> statement-breakpoint

-- ============================================================================
-- PERMISSIONS AND SECURITY (original execution order preserved)
-- ============================================================================
REVOKE ALL ON FUNCTION public.financial_delta_link_check() FROM PUBLIC;
