-- READING COPY ONLY: do not execute or use as a migration.
-- Executable source: packages/db/migrations/0011_position_accounting.sql
-- Original statement order, object names, quoted values and Drizzle boundaries are preserved.
-- Function versions are historical: apply the migration chain to determine the current definition.

-- ============================================================================
-- TABLES (original execution order preserved)
-- ============================================================================
-- One database settlement linking buyer/seller accounts, reservations and both journals.
CREATE TABLE "cash_position_settlements"(
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name
        "cash_position_settlements_id_seq" INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 9223372036854775807 START WITH 1
        CACHE 1),
        "operation_id" bigint NOT NULL,
        "match_reference" text NOT NULL,
        "market_id" uuid NOT NULL,
        "token_id" bigint NOT NULL,
        "buyer_cash_account_id" bigint NOT NULL,
        "seller_cash_account_id" bigint NOT NULL,
        "buyer_position_account_id" bigint NOT NULL,
        "seller_position_account_id" bigint NOT NULL,
        "cash_reservation_id" bigint NOT NULL,
        "position_reservation_id" bigint NOT NULL,
        "cash_journal_id" bigint NOT NULL,
        "position_journal_id" bigint NOT NULL,
        "quantity" bigint NOT NULL,
        "price_cents" bigint NOT NULL,
        "consideration_cents" bigint NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "cash_position_settlements_operation_id_unique" UNIQUE ("operation_id"),
        CONSTRAINT "cash_position_settlements_match_reference_unique" UNIQUE ("match_reference"),
        CONSTRAINT "cash_position_settlements_cash_journal_id_unique" UNIQUE ("cash_journal_id"),
        CONSTRAINT "cash_position_settlements_position_journal_id_unique" UNIQUE ("position_journal_id"),
        CONSTRAINT "settlement_consideration_check" CHECK ("cash_position_settlements"."quantity" > 0 AND "cash_position_settlements"."quantity" % 1000000 = 0 AND "cash_position_settlements"."price_cents" > 0 AND "cash_position_settlements"."consideration_cents" > 0 AND "cash_position_settlements"."consideration_cents"::numeric =("cash_position_settlements"."quantity"::numeric / 1000000) * "cash_position_settlements"."price_cents")
);

--> statement-breakpoint
-- Customer or system inventory accounts for one registered CTF token.
CREATE TABLE "position_accounts"(
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name
        "position_accounts_id_seq" INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 9223372036854775807 START WITH 1
        CACHE 1),
        "token_id" bigint NOT NULL,
        "owner_user_id" bigint,
        "account_key" text NOT NULL,
        "kind" text NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "position_accounts_account_key_unique" UNIQUE ("account_key"),
        CONSTRAINT "position_accounts_id_token_key" UNIQUE ("id", "token_id"),
        CONSTRAINT "position_accounts_owner_token_key" UNIQUE ("owner_user_id", "token_id"),
        CONSTRAINT "position_accounts_kind_check" CHECK (("position_accounts"."kind" = 'CUSTOMER' AND "position_accounts"."owner_user_id" IS NOT NULL) OR ("position_accounts"."kind" IN ('UNALLOCATED', 'EXTERNAL_CONTROL') AND "position_accounts"."owner_user_id" IS NULL))
);

--> statement-breakpoint
-- Current posted and reserved shares; available equals posted minus reserved.
CREATE TABLE "position_balance_projections"(
    "account_id" bigint PRIMARY KEY NOT NULL,
    "posted" bigint DEFAULT 0 NOT NULL,
    "reserved" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "position_projection_units_check" CHECK ("position_balance_projections"."posted" % 1000000 = 0 AND "position_balance_projections"."reserved" >= 0 AND "position_balance_projections"."reserved" % 1000000 = 0)
);

--> statement-breakpoint
-- Immutable IN/OUT share movements tied to the correct account and token.
CREATE TABLE "position_journal_entries"(
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name
        "position_journal_entries_id_seq" INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 9223372036854775807 START WITH 1
        CACHE 1),
        "journal_id" bigint NOT NULL,
        "account_id" bigint NOT NULL,
        "token_id" bigint NOT NULL,
        "side" text NOT NULL,
        "quantity" bigint NOT NULL,
        CONSTRAINT "position_entries_quantity_check" CHECK ("position_journal_entries"."quantity" > 0 AND "position_journal_entries"."quantity" % 1000000 = 0),
        CONSTRAINT "position_entries_side_check" CHECK ("position_journal_entries"."side" IN ('IN', 'OUT'))
);

--> statement-breakpoint
-- Position movement headers and reversal links, balanced independently per token.
CREATE TABLE "position_journals"(
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name
        "position_journals_id_seq" INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 9223372036854775807 START WITH 1
        CACHE 1),
        "operation_id" bigint NOT NULL,
        "reference" text NOT NULL,
        "purpose" text NOT NULL,
        "status" text DEFAULT 'DRAFT' NOT NULL,
        "reversal_of" bigint,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "position_journals_operation_id_unique" UNIQUE ("operation_id"),
        CONSTRAINT "position_journals_reference_unique" UNIQUE ("reference"),
        CONSTRAINT "position_journals_reversal_key" UNIQUE ("reversal_of"),
        CONSTRAINT "position_journals_status_check" CHECK ("position_journals"."status" IN ('DRAFT', 'POSTED')),
        CONSTRAINT "position_journals_purpose_check" CHECK ("position_journals"."purpose" IN ('POST', 'TRANSFER', 'CONSUMPTION', 'REVERSAL', 'RECOGNITION', 'SETTLEMENT'))
);

--> statement-breakpoint
-- Immutable share reservation lifecycle events and consumption journals.
CREATE TABLE "position_reservation_events"(
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name
        "position_reservation_events_id_seq" INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 9223372036854775807 START WITH 1
        CACHE 1),
        "reservation_id" bigint NOT NULL,
        "operation_id" bigint NOT NULL,
        "kind" text NOT NULL,
        "quantity" bigint NOT NULL,
        "journal_id" bigint,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "position_reservation_events_operation_id_unique" UNIQUE ("operation_id"),
        CONSTRAINT "position_reservation_events_journal_id_unique" UNIQUE ("journal_id"),
        CONSTRAINT "position_reservation_events_kind_check" CHECK ("position_reservation_events"."kind" IN ('RESERVE', 'CONSUME', 'RELEASE', 'CANCEL')),
        CONSTRAINT "position_reservation_events_quantity_check" CHECK ("position_reservation_events"."quantity" > 0 AND "position_reservation_events"."quantity" % 1000000 = 0),
        CONSTRAINT "position_reservation_events_journal_check" CHECK (("position_reservation_events"."kind" = 'CONSUME') =("position_reservation_events"."journal_id" IS NOT NULL))
);

--> statement-breakpoint
-- Share holds that prevent overselling and support partial consumption or release.
CREATE TABLE "position_reservations"(
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name
        "position_reservations_id_seq" INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 9223372036854775807 START WITH 1
        CACHE 1),
        "account_id" bigint NOT NULL,
        "operation_id" bigint NOT NULL,
        "reference" text NOT NULL,
        "quantity" bigint NOT NULL,
        "consumed" bigint DEFAULT 0 NOT NULL,
        "released" bigint DEFAULT 0 NOT NULL,
        "status" text DEFAULT 'OPEN' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "position_reservations_operation_id_unique" UNIQUE ("operation_id"),
        CONSTRAINT "position_reservations_reference_key" UNIQUE ("account_id", "reference"),
        CONSTRAINT "position_reservations_units_check" CHECK ("position_reservations"."quantity" > 0 AND "position_reservations"."consumed" >= 0 AND "position_reservations"."released" >= 0 AND "position_reservations"."quantity" % 1000000 = 0 AND "position_reservations"."consumed" % 1000000 = 0 AND "position_reservations"."released" % 1000000 = 0 AND "position_reservations"."consumed"::numeric + "position_reservations"."released" <= "position_reservations"."quantity"),
        CONSTRAINT "position_reservations_status_check" CHECK (("position_reservations"."status" = 'OPEN' AND "position_reservations"."consumed"::numeric + "position_reservations"."released" < "position_reservations"."quantity") OR ("position_reservations"."status" IN ('CLOSED', 'CANCELLED') AND "position_reservations"."consumed"::numeric + "position_reservations"."released" = "position_reservations"."quantity"))
);

--> statement-breakpoint

-- ============================================================================
-- CONSTRAINTS AND TABLE ALTERATIONS (original execution order preserved)
-- ============================================================================
ALTER TABLE "cash_position_settlements"
    ADD CONSTRAINT "cash_position_settlements_operation_id_financial_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."financial_operations"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "cash_position_settlements"
    ADD CONSTRAINT "cash_position_settlements_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "cash_position_settlements"
    ADD CONSTRAINT "cash_position_settlements_token_id_ctf_position_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."ctf_position_tokens"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "cash_position_settlements"
    ADD CONSTRAINT "cash_position_settlements_buyer_cash_account_id_financial_accounts_id_fk" FOREIGN KEY ("buyer_cash_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "cash_position_settlements"
    ADD CONSTRAINT "cash_position_settlements_seller_cash_account_id_financial_accounts_id_fk" FOREIGN KEY ("seller_cash_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "cash_position_settlements"
    ADD CONSTRAINT "cash_position_settlements_cash_reservation_id_cash_reservations_id_fk" FOREIGN KEY ("cash_reservation_id") REFERENCES "public"."cash_reservations"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "cash_position_settlements"
    ADD CONSTRAINT "cash_position_settlements_position_reservation_id_position_reservations_id_fk" FOREIGN KEY ("position_reservation_id") REFERENCES "public"."position_reservations"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "cash_position_settlements"
    ADD CONSTRAINT "cash_position_settlements_cash_journal_id_financial_journals_id_fk" FOREIGN KEY ("cash_journal_id") REFERENCES "public"."financial_journals"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "cash_position_settlements"
    ADD CONSTRAINT "cash_position_settlements_position_journal_id_position_journals_id_fk" FOREIGN KEY ("position_journal_id") REFERENCES "public"."position_journals"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "cash_position_settlements"
    ADD CONSTRAINT "settlement_buyer_position_token_fk" FOREIGN KEY ("buyer_position_account_id", "token_id") REFERENCES "public"."position_accounts"("id", "token_id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "cash_position_settlements"
    ADD CONSTRAINT "settlement_seller_position_token_fk" FOREIGN KEY ("seller_position_account_id", "token_id") REFERENCES "public"."position_accounts"("id", "token_id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "position_accounts"
    ADD CONSTRAINT "position_accounts_token_id_ctf_position_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."ctf_position_tokens"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "position_accounts"
    ADD CONSTRAINT "position_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "position_balance_projections"
    ADD CONSTRAINT "position_balance_projections_account_id_position_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."position_accounts"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "position_journal_entries"
    ADD CONSTRAINT "position_journal_entries_journal_id_position_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."position_journals"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "position_journal_entries"
    ADD CONSTRAINT "position_entries_account_token_fk" FOREIGN KEY ("account_id", "token_id") REFERENCES "public"."position_accounts"("id", "token_id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "position_journals"
    ADD CONSTRAINT "position_journals_operation_id_financial_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."financial_operations"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "position_journals"
    ADD CONSTRAINT "position_journals_reversal_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."position_journals"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "position_reservation_events"
    ADD CONSTRAINT "position_reservation_events_reservation_id_position_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."position_reservations"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "position_reservation_events"
    ADD CONSTRAINT "position_reservation_events_operation_id_financial_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."financial_operations"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "position_reservation_events"
    ADD CONSTRAINT "position_reservation_events_journal_id_position_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."position_journals"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "position_reservations"
    ADD CONSTRAINT "position_reservations_account_id_position_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."position_accounts"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "position_reservations"
    ADD CONSTRAINT "position_reservations_operation_id_financial_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."financial_operations"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint

-- ============================================================================
-- INDEXES (original execution order preserved)
-- ============================================================================
CREATE INDEX "idx_cash_position_settlements_market" ON "cash_position_settlements" USING btree("market_id", "id");

--> statement-breakpoint
CREATE UNIQUE INDEX "position_accounts_system_token_key" ON "position_accounts" USING btree("token_id", "kind")
WHERE
    "position_accounts"."owner_user_id" IS NULL;

--> statement-breakpoint
CREATE INDEX "idx_position_entries_account" ON "position_journal_entries" USING btree("account_id", "id");

--> statement-breakpoint
CREATE INDEX "idx_position_entries_journal" ON "position_journal_entries" USING btree("journal_id");

--> statement-breakpoint
CREATE INDEX "idx_position_reservation_events_reservation" ON "position_reservation_events" USING btree("reservation_id", "id");

--> statement-breakpoint
CREATE INDEX "idx_position_reservations_account" ON "position_reservations" USING btree("account_id");

--> statement-breakpoint

-- ============================================================================
-- CONSTRAINTS AND TABLE ALTERATIONS (original execution order preserved)
-- ============================================================================
ALTER TABLE public.financial_audit_targets
    DROP CONSTRAINT financial_audit_targets_kind_check;

--> statement-breakpoint
ALTER TABLE public.financial_audit_targets
    ADD CONSTRAINT financial_audit_targets_kind_check CHECK (target_kind IN ('OPERATION', 'JOURNAL', 'ACCOUNT', 'RESERVATION', 'POSITION_ACCOUNT', 'POSITION_JOURNAL', 'POSITION_RESERVATION', 'SETTLEMENT'));

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Validates actor and canonical terms, handles idempotency, locks accounts, and executes the selected cash operation.
CREATE FUNCTION public.financial_cash_execute(p_actor text, p_action text, p_key text, p_terms jsonb)
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
-- Protects position identity, journal posting, whole-share quantities and nonnegative spendable inventory.
CREATE FUNCTION public.position_guard()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    a public.position_accounts;
    j public.position_journals;
    delta bigint;
BEGIN
    IF TG_TABLE_NAME = 'position_accounts' THEN
        IF NOT EXISTS (
            SELECT
                1
            FROM
                public.ctf_position_tokens t
                JOIN public.chain_assets c ON c.id = t.collateral_asset_id
            WHERE
                t.id = NEW.token_id
                AND c.asset_type = 'ERC20'
                AND c.decimals = 6) THEN
            RAISE EXCEPTION 'position requires registered token with six-decimal ERC20 collateral';
        END IF;
    ELSIF TG_TABLE_NAME = 'position_journals' THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.status <> 'DRAFT' THEN
                RAISE EXCEPTION 'journal must begin as draft';
            END IF;
        ELSIF TG_OP = 'DELETE'
                OR OLD.status <> 'DRAFT'
                OR NEW.status <> 'POSTED'
                OR (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
                RAISE EXCEPTION 'position journal is immutable';
        END IF;
    ELSIF TG_TABLE_NAME = 'position_journal_entries' THEN
        IF TG_OP <> 'INSERT' THEN
            RAISE EXCEPTION 'position entries are immutable';
        END IF;
        SELECT
            *
        INTO
            STRICT j
        FROM
            public.position_journals
        WHERE
            id = NEW.journal_id
        FOR UPDATE;
        IF j.status <> 'DRAFT' THEN
            RAISE EXCEPTION 'cannot append to posted position journal';
        END IF;
        SELECT
            *
        INTO
            STRICT a
        FROM
            public.position_accounts
        WHERE
            id = NEW.account_id
        FOR UPDATE;
        IF a.token_id <> NEW.token_id THEN
            RAISE EXCEPTION 'position token mismatch';
        END IF;
        delta := CASE NEW.side
        WHEN 'IN' THEN
            NEW.quantity
        ELSE
            - NEW.quantity
        END;
        UPDATE
            public.position_balance_projections
        SET
            posted = posted + delta
        WHERE
            account_id = a.id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'missing position projection';
        END IF;
    ELSIF TG_TABLE_NAME = 'position_reservations' THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'position reservation deletion forbidden';
        END IF;
        IF TG_OP = 'UPDATE' AND ((to_jsonb(NEW) - ARRAY['consumed', 'released', 'status']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['consumed', 'released', 'status']) OR OLD.status <> 'OPEN' OR NEW.consumed < OLD.consumed OR NEW.released < OLD.released) THEN
            RAISE EXCEPTION 'invalid position reservation mutation';
        END IF;
        SELECT
            *
        INTO
            STRICT a
        FROM
            public.position_accounts
        WHERE
            id = NEW.account_id
        FOR UPDATE;
        IF a.kind <> 'CUSTOMER' THEN
            RAISE EXCEPTION 'only customer positions may be reserved';
        END IF;
        delta := NEW.quantity - NEW.consumed - NEW.released;
        IF TG_OP = 'UPDATE' THEN
            delta := delta -(OLD.quantity - OLD.consumed - OLD.released);
        END IF;
        UPDATE
            public.position_balance_projections
        SET
            reserved = reserved + delta
        WHERE
            account_id = a.id;
    ELSIF TG_TABLE_NAME = 'position_balance_projections' THEN
        IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.account_id <> OLD.account_id) THEN
            RAISE EXCEPTION 'invalid position projection mutation';
        END IF;
        SELECT
            *
        INTO
            STRICT a
        FROM
            public.position_accounts
        WHERE
            id = NEW.account_id;
        IF (a.kind <> 'EXTERNAL_CONTROL' AND NEW.posted < NEW.reserved) OR (a.kind = 'EXTERNAL_CONTROL' AND NEW.reserved <> 0) THEN
            RAISE EXCEPTION 'insufficient available positions'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END
$$;

--> statement-breakpoint

-- ============================================================================
-- TRIGGERS (original execution order preserved)
-- ============================================================================
-- Protects position identity, journal posting, whole-share quantities and nonnegative spendable inventory.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER position_accounts_guard
    BEFORE INSERT ON public.position_accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.position_guard();

--> statement-breakpoint
-- Protects position identity, journal posting, whole-share quantities and nonnegative spendable inventory.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER position_journals_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.position_journals
    FOR EACH ROW
    EXECUTE FUNCTION public.position_guard();

--> statement-breakpoint
-- Protects position identity, journal posting, whole-share quantities and nonnegative spendable inventory.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER position_journal_entries_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.position_journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.position_guard();

--> statement-breakpoint
-- Protects position identity, journal posting, whole-share quantities and nonnegative spendable inventory.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER position_balance_projections_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.position_balance_projections
    FOR EACH ROW
    EXECUTE FUNCTION public.position_guard();

--> statement-breakpoint
-- Protects position identity, journal posting, whole-share quantities and nonnegative spendable inventory.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER position_reservations_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.position_reservations
    FOR EACH ROW
    EXECUTE FUNCTION public.position_guard();

--> statement-breakpoint
-- Rejects changes to immutable accounting records; corrections use eligible compensating entries.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER position_accounts_immutable
    BEFORE UPDATE OR DELETE ON public.position_accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_immutable();

--> statement-breakpoint
-- Rejects changes to immutable accounting records; corrections use eligible compensating entries.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER position_reservation_events_immutable
    BEFORE UPDATE OR DELETE ON public.position_reservation_events
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_immutable();

--> statement-breakpoint
-- Rejects changes to immutable accounting records; corrections use eligible compensating entries.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER cash_position_settlements_immutable
    BEFORE UPDATE OR DELETE ON public.cash_position_settlements
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_immutable();

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Independently validates a position account, journal, reservation or linked cash/share settlement.
CREATE FUNCTION public.position_validate(p_kind text, p_id bigint)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    j public.position_journals;
    a public.position_accounts;
    r public.position_reservations;
    x public.cash_position_settlements;
    original public.position_journals;
BEGIN
    IF p_kind = 'POSITION_JOURNAL' THEN
        SELECT
            *
        INTO
            STRICT j
        FROM
            public.position_journals
        WHERE
            id = p_id;
        IF j.status <> 'POSTED' OR (
            SELECT
                count(*)
            FROM
                public.position_journal_entries
            WHERE
                journal_id = j.id) < 2 OR EXISTS (
        SELECT
            1
        FROM
            public.position_journal_entries
        WHERE
            journal_id = j.id
        GROUP BY
            token_id
        HAVING
            sum(
            CASE side
            WHEN 'IN' THEN
                quantity::numeric
            ELSE
                - quantity::numeric
            END) <> 0) THEN
    RAISE EXCEPTION 'position journal must be posted and balanced per token'
                USING ERRCODE = '23514';
        END IF;
        IF j.purpose = 'RECOGNITION' THEN
            IF NOT EXISTS (
                SELECT
                    1
                FROM
                    public.financial_operations
                WHERE
                    id = j.operation_id
                    AND action = 'POSITION_FIXTURE_RECOGNITION') OR (
            SELECT
                count(*)
            FROM
                public.position_journal_entries
            WHERE
                journal_id = j.id) <> 2 OR NOT EXISTS (
        SELECT
            1
        FROM
            public.position_journal_entries e
            JOIN public.position_accounts a1 ON a1.id = e.account_id
        WHERE
            e.journal_id = j.id
            AND a1.kind = 'EXTERNAL_CONTROL'
            AND e.side = 'OUT') OR NOT EXISTS (
    SELECT
        1
    FROM
        public.position_journal_entries e
        JOIN public.position_accounts a1 ON a1.id = e.account_id
    WHERE
        e.journal_id = j.id
        AND a1.kind = 'UNALLOCATED'
        AND e.side = 'IN') THEN
                RAISE EXCEPTION 'invalid test inventory recognition';
            END IF;
        ELSIF EXISTS (
                SELECT
                    1
                FROM
                    public.position_journal_entries e
                    JOIN public.position_accounts a1 ON a1.id = e.account_id
                WHERE
                    e.journal_id = j.id
                    AND a1.kind = 'EXTERNAL_CONTROL') THEN
            RAISE EXCEPTION 'external control is not spendable inventory';
        END IF;
        IF NOT EXISTS (
            SELECT
                1
            FROM
                public.financial_operations o
            WHERE
                o.id = j.operation_id
                AND o.action = CASE j.purpose
                WHEN 'POST' THEN
                    'POSITION_POST'
                WHEN 'TRANSFER' THEN
                    'POSITION_TRANSFER'
                WHEN 'CONSUMPTION' THEN
                    'POSITION_CONSUME'
                WHEN 'REVERSAL' THEN
                    'POSITION_REVERSE'
                WHEN 'RECOGNITION' THEN
                    'POSITION_FIXTURE_RECOGNITION'
                WHEN 'SETTLEMENT' THEN
                    'SETTLE'
                END) THEN
        RAISE EXCEPTION 'position journal operation mismatch';
        END IF;
        IF (j.purpose = 'SETTLEMENT') IS DISTINCT FROM EXISTS (
        SELECT
            1
        FROM
            public.cash_position_settlements
        WHERE
            position_journal_id = j.id) THEN
            RAISE EXCEPTION 'incomplete settlement position journal';
        END IF;
        IF j.purpose = 'CONSUMPTION' AND NOT EXISTS (
            SELECT
                1
            FROM
                public.position_reservation_events
            WHERE
                journal_id = j.id
                AND kind = 'CONSUME'
                AND operation_id = j.operation_id) THEN
            RAISE EXCEPTION 'missing consumption event';
        END IF;
        IF (j.purpose = 'REVERSAL') IS DISTINCT FROM (j.reversal_of IS NOT NULL) THEN
            RAISE EXCEPTION 'invalid reversal relationship';
        END IF;
        IF j.reversal_of IS NOT NULL THEN
            SELECT
                *
            INTO
                STRICT original
            FROM
                public.position_journals
            WHERE
                id = j.reversal_of;
            IF original.purpose NOT IN ('POST', 'TRANSFER') OR original.reversal_of IS NOT NULL OR EXISTS (
                SELECT
                    account_id,
                    token_id,
                    side,
                    sum(quantity::numeric)
                FROM
                    public.position_journal_entries
                WHERE
                    journal_id = j.id
                GROUP BY
                    account_id,
                    token_id,
                    side
                EXCEPT
                SELECT
                    account_id,
                    token_id,
                    CASE side
                    WHEN 'IN' THEN
                        'OUT'
                    ELSE
                        'IN'
                    END,
                    sum(quantity::numeric)
                FROM
                    public.position_journal_entries
                WHERE
                    journal_id = original.id
                GROUP BY
                    account_id,
                    token_id,
                    side)
            OR EXISTS (
                SELECT
                    account_id,
                    token_id,
                    CASE side
                    WHEN 'IN' THEN
                        'OUT'
                    ELSE
                        'IN'
                    END,
                    sum(quantity::numeric)
                FROM
                    public.position_journal_entries
                WHERE
                    journal_id = original.id
                GROUP BY
                    account_id,
                    token_id,
                    side
                EXCEPT
                SELECT
                    account_id,
                    token_id,
                    side,
                    sum(quantity::numeric)
                FROM
                    public.position_journal_entries
                WHERE
                    journal_id = j.id
                GROUP BY
                    account_id,
                    token_id,
                    side) THEN
            RAISE EXCEPTION 'position reversal must exactly compensate eligible journal';
            END IF;
        END IF;
    ELSIF p_kind = 'POSITION_ACCOUNT' THEN
        SELECT
            *
        INTO
            STRICT a
        FROM
            public.position_accounts
        WHERE
            id = p_id;
        IF NOT EXISTS (
            SELECT
                1
            FROM
                public.position_balance_projections p
            WHERE
                p.account_id = a.id
                AND p.posted::numeric = COALESCE((
                    SELECT
                        sum(
                        CASE side
                        WHEN 'IN' THEN
                            quantity::numeric
                        ELSE
                            - quantity::numeric
                        END)
                    FROM public.position_journal_entries
                    WHERE
                        account_id = a.id), 0)
                AND p.reserved::numeric = COALESCE((
                    SELECT
                        sum(quantity::numeric - consumed - released)
                    FROM public.position_reservations
                    WHERE
                        account_id = a.id), 0)) THEN
        RAISE EXCEPTION 'position projection differs from history';
        END IF;
    ELSIF p_kind = 'POSITION_RESERVATION' THEN
        SELECT
            *
        INTO
            STRICT r
        FROM
            public.position_reservations
        WHERE
            id = p_id;
        IF r.quantity::numeric <> COALESCE((
            SELECT
                sum(quantity::numeric)
            FROM public.position_reservation_events
            WHERE
                reservation_id = r.id AND kind = 'RESERVE'), 0) OR r.consumed::numeric <> COALESCE((
                    SELECT
                        sum(quantity::numeric)
                    FROM public.position_reservation_events
                    WHERE
                        reservation_id = r.id AND kind = 'CONSUME'), 0) OR r.released::numeric <> COALESCE((
                            SELECT
                                sum(quantity::numeric)
                            FROM public.position_reservation_events
                            WHERE
                                reservation_id = r.id AND kind IN ('RELEASE', 'CANCEL')), 0) THEN
            RAISE EXCEPTION 'position reservation differs from immutable event history';
        END IF;
        IF EXISTS (
            SELECT
                1
            FROM
                public.position_reservation_events v
            WHERE
                v.reservation_id = r.id
                AND (NOT EXISTS (
                SELECT
                    1
                FROM
                    public.financial_operations o
                WHERE
                    o.id = v.operation_id
                    AND o.action = CASE v.kind
                    WHEN 'RESERVE' THEN
                        'POSITION_RESERVE'
                    WHEN 'RELEASE' THEN
                        'POSITION_RELEASE'
                    WHEN 'CANCEL' THEN
                        'POSITION_CANCEL'
                    WHEN 'CONSUME' THEN
                        CASE WHEN EXISTS (
                            SELECT
                                1
                            FROM
                                public.cash_position_settlements s1
                            WHERE
                                s1.operation_id = v.operation_id) THEN
                            'SETTLE'
                        ELSE
                            'POSITION_CONSUME'
                        END
                    END)
                OR (v.kind = 'CONSUME'
                    AND ((
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
                                    AND account_id = r.account_id
                                    AND side = 'OUT'
                                    AND quantity = v.quantity))))) THEN
        RAISE EXCEPTION 'position reservation operation or consumption mismatch';
        END IF;
    ELSIF p_kind = 'SETTLEMENT' THEN
        SELECT
            *
        INTO
            STRICT x
        FROM
            public.cash_position_settlements
        WHERE
            id = p_id;
        IF NOT EXISTS (
            SELECT
                1
            FROM
                public.financial_operations
            WHERE
                id = x.operation_id
                AND action = 'SETTLE') OR NOT EXISTS (
        SELECT
            1
        FROM
            public.financial_journals
        WHERE
            id = x.cash_journal_id
                AND operation_id = x.operation_id
                AND status = 'POSTED'
                AND reversal_of IS NULL) OR NOT EXISTS (
        SELECT
            1
        FROM
            public.position_journals
        WHERE
            id = x.position_journal_id
                AND operation_id = x.operation_id
                AND status = 'POSTED'
                AND purpose = 'SETTLEMENT') OR (
        SELECT
            count(*)
        FROM
            public.financial_journal_entries
        WHERE
            journal_id = x.cash_journal_id) <> 2 OR (
    SELECT
        count(*)
    FROM
        public.position_journal_entries
    WHERE
        journal_id = x.position_journal_id) <> 2 OR NOT EXISTS (
SELECT
    1
FROM
    public.financial_journal_entries
WHERE
    journal_id = x.cash_journal_id
    AND account_id = x.buyer_cash_account_id
    AND asset = 'USD'
    AND side = 'DEBIT'
    AND amount = x.consideration_cents) OR NOT EXISTS (
SELECT
    1
FROM
    public.financial_journal_entries
WHERE
    journal_id = x.cash_journal_id
    AND account_id = x.seller_cash_account_id
    AND asset = 'USD'
    AND side = 'CREDIT'
    AND amount = x.consideration_cents) OR NOT EXISTS (
SELECT
    1
FROM
    public.position_journal_entries
WHERE
    journal_id = x.position_journal_id
    AND account_id = x.seller_position_account_id
    AND token_id = x.token_id
    AND side = 'OUT'
    AND quantity = x.quantity) OR NOT EXISTS (
SELECT
    1
FROM
    public.position_journal_entries
WHERE
    journal_id = x.position_journal_id
    AND account_id = x.buyer_position_account_id
    AND token_id = x.token_id
    AND side = 'IN'
    AND quantity = x.quantity) OR NOT EXISTS (
SELECT
    1
FROM
    public.cash_reservation_events v
    JOIN public.cash_reservations r1 ON r1.id = v.reservation_id
WHERE
    v.operation_id = x.operation_id
    AND v.journal_id = x.cash_journal_id
    AND v.reservation_id = x.cash_reservation_id
    AND v.kind = 'CONSUME'
    AND v.amount = x.consideration_cents
    AND r1.account_id = x.buyer_cash_account_id) OR NOT EXISTS (
SELECT
    1
FROM
    public.position_reservation_events v
    JOIN public.position_reservations r1 ON r1.id = v.reservation_id
WHERE
    v.operation_id = x.operation_id
    AND v.journal_id = x.position_journal_id
    AND v.reservation_id = x.position_reservation_id
    AND v.kind = 'CONSUME'
    AND v.quantity = x.quantity
    AND r1.account_id = x.seller_position_account_id) THEN
            RAISE EXCEPTION 'incomplete or mismatched cash and position settlement';
        END IF;
        IF NOT EXISTS (
            SELECT
                1
            FROM
                public.financial_operations o
                JOIN public.cash_reservations cr ON cr.id = x.cash_reservation_id
                JOIN public.position_reservations pr ON pr.id = x.position_reservation_id
            WHERE
                o.id = x.operation_id
                AND o.terms @> jsonb_build_object(
                    'matchReference', x.match_reference,
                    'marketId', x.market_id::text,
                    'tokenId', x.token_id::text,
                    'buyerCashAccountId', x.buyer_cash_account_id::text,
                    'sellerCashAccountId', x.seller_cash_account_id::text,
                    'buyerPositionAccountId', x.buyer_position_account_id::text,
                    'sellerPositionAccountId', x.seller_position_account_id::text,
                    'cashReservationId', x.cash_reservation_id::text,
                    'positionReservationId', x.position_reservation_id::text,
                    'cashReservationReference', cr.reference,
                    'positionReservationReference', pr.reference,
                    'quantity', x.quantity::text,
                    'priceCents', x.price_cents::text
                )) THEN
            RAISE EXCEPTION 'settlement differs from authorized operation terms or reservation references';
        END IF;
        IF NOT EXISTS (
            SELECT
                1
            FROM
                public.financial_accounts bc
                JOIN public.financial_accounts sc ON sc.id = x.seller_cash_account_id
                JOIN public.position_accounts bp ON bp.id = x.buyer_position_account_id
                JOIN public.position_accounts sp ON sp.id = x.seller_position_account_id
            WHERE
                bc.id = x.buyer_cash_account_id
                AND bc.kind = 'CUSTOMER'
                AND sc.kind = 'CUSTOMER'
                AND bp.kind = 'CUSTOMER'
                AND sp.kind = 'CUSTOMER'
                AND bc.asset = 'USD'
                AND sc.asset = 'USD'
                AND bc.owner_user_id = bp.owner_user_id
                AND sc.owner_user_id = sp.owner_user_id
                AND bc.owner_user_id <> sc.owner_user_id
                AND bp.token_id = x.token_id
                AND sp.token_id = x.token_id) THEN
            RAISE EXCEPTION 'settlement account ownership or token mismatch';
        END IF;
        IF NOT EXISTS (
            SELECT
                1
            FROM
                public.ctf_position_tokens t
                JOIN public.market_outcomes o ON o.id = t.market_outcome_id
            WHERE
                t.id = x.token_id
                AND o.market_id = x.market_id) THEN
            RAISE EXCEPTION 'settlement market token mismatch';
        END IF;
    ELSE
        RAISE EXCEPTION 'unknown position audit target';
    END IF;
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
DECLARE
    tx text := pg_current_xact_id()::text;
BEGIN
    IF TG_TABLE_NAME = 'financial_operations' THEN
        INSERT INTO public.financial_audit_targets
            VALUES (tx, 'OPERATION', NEW.id)
        ON CONFLICT
            DO NOTHING;
    ELSIF TG_TABLE_NAME = 'financial_journals' THEN
        INSERT INTO public.financial_audit_targets
            VALUES (tx, 'JOURNAL', NEW.id)
        ON CONFLICT
            DO NOTHING;
    ELSIF TG_TABLE_NAME = 'financial_journal_entries' THEN
        INSERT INTO public.financial_audit_targets
        VALUES
            (tx, 'JOURNAL', NEW.journal_id),
(tx, 'ACCOUNT', NEW.account_id)
        ON CONFLICT
            DO NOTHING;
    ELSIF TG_TABLE_NAME = 'financial_accounts' THEN
        INSERT INTO public.financial_audit_targets
            VALUES (tx, 'ACCOUNT', NEW.id)
        ON CONFLICT
            DO NOTHING;
    ELSIF TG_TABLE_NAME = 'financial_balance_projections' THEN
        INSERT INTO public.financial_audit_targets
            VALUES (tx, 'ACCOUNT', NEW.account_id)
        ON CONFLICT
            DO NOTHING;
    ELSIF TG_TABLE_NAME = 'cash_reservations' THEN
        INSERT INTO public.financial_audit_targets
        VALUES
            (tx, 'RESERVATION', NEW.id),
(tx, 'ACCOUNT', NEW.account_id)
        ON CONFLICT
            DO NOTHING;
    ELSIF TG_TABLE_NAME = 'cash_reservation_events' THEN
        INSERT INTO public.financial_audit_targets
            VALUES (tx, 'RESERVATION', NEW.reservation_id)
        ON CONFLICT
            DO NOTHING;
        IF NEW.journal_id IS NOT NULL THEN
            INSERT INTO public.financial_audit_targets
                VALUES (tx, 'JOURNAL', NEW.journal_id)
            ON CONFLICT
                DO NOTHING;
        END IF;
    ELSIF TG_TABLE_NAME = 'position_accounts' THEN
        INSERT INTO public.financial_audit_targets
            VALUES (tx, 'POSITION_ACCOUNT', NEW.id)
        ON CONFLICT
            DO NOTHING;
    ELSIF TG_TABLE_NAME = 'position_balance_projections' THEN
        INSERT INTO public.financial_audit_targets
            VALUES (tx, 'POSITION_ACCOUNT', NEW.account_id)
        ON CONFLICT
            DO NOTHING;
    ELSIF TG_TABLE_NAME = 'position_journals' THEN
        INSERT INTO public.financial_audit_targets
            VALUES (tx, 'POSITION_JOURNAL', NEW.id)
        ON CONFLICT
            DO NOTHING;
    ELSIF TG_TABLE_NAME = 'position_journal_entries' THEN
        INSERT INTO public.financial_audit_targets
        VALUES
            (tx, 'POSITION_JOURNAL', NEW.journal_id),
(tx, 'POSITION_ACCOUNT', NEW.account_id)
        ON CONFLICT
            DO NOTHING;
    ELSIF TG_TABLE_NAME = 'position_reservations' THEN
        INSERT INTO public.financial_audit_targets
        VALUES
            (tx, 'POSITION_RESERVATION', NEW.id),
(tx, 'POSITION_ACCOUNT', NEW.account_id)
        ON CONFLICT
            DO NOTHING;
    ELSIF TG_TABLE_NAME = 'position_reservation_events' THEN
        INSERT INTO public.financial_audit_targets
            VALUES (tx, 'POSITION_RESERVATION', NEW.reservation_id)
        ON CONFLICT
            DO NOTHING;
    ELSIF TG_TABLE_NAME = 'cash_position_settlements' THEN
        INSERT INTO public.financial_audit_targets
            VALUES (tx, 'SETTLEMENT', NEW.id)
        ON CONFLICT
            DO NOTHING;
    ELSE
        RAISE EXCEPTION 'unexpected audit source';
    END IF;
    RETURN NULL;
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
    IF NEW.target_kind IN ('POSITION_ACCOUNT', 'POSITION_JOURNAL', 'POSITION_RESERVATION', 'SETTLEMENT') THEN
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
    ELSIF NEW.target_kind = 'ACCOUNT' THEN
        SELECT
            *
        INTO
            STRICT a
        FROM
            public.financial_accounts
        WHERE
            id = NEW.target_id;
        SELECT
            *
        INTO
            p
        FROM
            public.financial_balance_projections
        WHERE
            account_id = a.id;
        IF NOT FOUND OR p.posted::numeric <> COALESCE((
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
                        sum(r2.amount::numeric - r2.consumed - r2.released)
                    FROM public.cash_reservations r2
                    WHERE
                        r2.account_id = a.id), 0) THEN
                RAISE EXCEPTION 'financial projection differs from history'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.target_kind = 'RESERVATION' THEN
        SELECT
            *
        INTO
            STRICT r
        FROM
            public.cash_reservations
        WHERE
            id = NEW.target_id;
        IF r.amount::numeric <> COALESCE((
            SELECT
                sum(e.amount::numeric)
            FROM public.cash_reservation_events e
            WHERE
                e.reservation_id = r.id AND e.kind = 'RESERVE'), 0) OR r.consumed::numeric <> COALESCE((
                    SELECT
                        sum(e.amount::numeric)
                    FROM public.cash_reservation_events e
                    WHERE
                        e.reservation_id = r.id AND e.kind = 'CONSUME'), 0) OR r.released::numeric <> COALESCE((
                            SELECT
                                sum(e.amount::numeric)
                            FROM public.cash_reservation_events e
                            WHERE
                                e.reservation_id = r.id AND e.kind IN ('RELEASE', 'CANCEL')), 0) THEN
            RAISE EXCEPTION 'reservation differs from immutable event history'
                USING ERRCODE = '23514';
        END IF;
        IF EXISTS (
            SELECT
                1
            FROM
                public.cash_reservation_events v
            WHERE
                v.reservation_id = r.id
                AND v.kind = 'CONSUME'
                AND ((
                    SELECT
                        count(*)
                    FROM
                        public.financial_journal_entries e
                    WHERE
                        e.journal_id = v.journal_id) <> 2
                OR NOT EXISTS (
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
    ELSE
        RAISE EXCEPTION 'unknown audit target';
    END IF;
    -- Remove protected transaction state only after the required validation succeeds.
    DELETE FROM public.financial_audit_targets
    WHERE transaction_id = NEW.transaction_id
        AND target_kind = NEW.target_kind
        AND target_id = NEW.target_id;
    RETURN NULL;
END
$$;

--> statement-breakpoint

-- ============================================================================
-- TRIGGERS (original execution order preserved)
-- ============================================================================
-- Queues affected records for mandatory transaction-end checks without rescanning unrelated history.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER position_accounts_audit
    AFTER INSERT OR UPDATE ON public.position_accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_schedule_audit();

--> statement-breakpoint
-- Queues affected records for mandatory transaction-end checks without rescanning unrelated history.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER position_journals_audit
    AFTER INSERT OR UPDATE ON public.position_journals
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_schedule_audit();

--> statement-breakpoint
-- Queues affected records for mandatory transaction-end checks without rescanning unrelated history.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER position_journal_entries_audit
    AFTER INSERT OR UPDATE ON public.position_journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_schedule_audit();

--> statement-breakpoint
-- Queues affected records for mandatory transaction-end checks without rescanning unrelated history.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER position_balance_projections_audit
    AFTER INSERT OR UPDATE ON public.position_balance_projections
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_schedule_audit();

--> statement-breakpoint
-- Queues affected records for mandatory transaction-end checks without rescanning unrelated history.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER position_reservations_audit
    AFTER INSERT OR UPDATE ON public.position_reservations
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_schedule_audit();

--> statement-breakpoint
-- Queues affected records for mandatory transaction-end checks without rescanning unrelated history.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER position_reservation_events_audit
    AFTER INSERT OR UPDATE ON public.position_reservation_events
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_schedule_audit();

--> statement-breakpoint
-- Queues affected records for mandatory transaction-end checks without rescanning unrelated history.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER cash_position_settlements_audit
    AFTER INSERT OR UPDATE ON public.cash_position_settlements
    FOR EACH ROW
    EXECUTE FUNCTION public.financial_schedule_audit();

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Validates token identity and ownership, locks cash before positions, and executes transfers, holds, rebuilds or atomic settlement.
CREATE FUNCTION public.position_execute(p_actor text, p_action text, p_key text, p_terms jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
    << positions >>
DECLARE
    op public.financial_operations;
    a public.position_accounts;
    target public.position_accounts;
    r public.position_reservations;
    original public.position_journals;
    ids bigint[];
    lines jsonb;
    entry jsonb;
    result jsonb;
    op_id bigint;
    journal_id bigint;
    reservation_id bigint;
    q bigint;
    remaining bigint;
    target_id bigint;
    expected text[];
    item record;
    bc public.financial_accounts;
    sc public.financial_accounts;
    bp public.position_accounts;
    sp public.position_accounts;
    cr public.cash_reservations;
    m public.markets;
    cash_report jsonb;
    cash_journal bigint;
    price bigint;
    consideration bigint;
    settlement_id bigint;
BEGIN
    IF p_actor IS NULL OR p_actor !~ '^(user:[1-9][0-9]*|system:[a-z][a-z0-9_-]{0,60})$' OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9:_-]{1,120}$' OR jsonb_typeof(p_terms) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'invalid position request';
    END IF;
    IF p_action NOT IN ('POSITION_ACCOUNT', 'POSITION_BALANCE', 'POSITION_POST', 'POSITION_TRANSFER', 'POSITION_RESERVE', 'POSITION_CONSUME', 'POSITION_RELEASE', 'POSITION_CANCEL', 'POSITION_REVERSE', 'POSITION_REBUILD', 'POSITION_RECONCILE', 'SETTLE') THEN
        RAISE EXCEPTION 'unknown position action';
    END IF;
    IF p_action IN ('POSITION_ACCOUNT', 'POSITION_POST', 'POSITION_CONSUME', 'POSITION_REVERSE', 'POSITION_REBUILD', 'POSITION_RECONCILE', 'SETTLE') AND p_actor NOT LIKE 'system:%' THEN
        RAISE EXCEPTION 'system capability required'
            USING ERRCODE = '42501';
    END IF;
    expected := CASE p_action
    WHEN 'POSITION_ACCOUNT' THEN
        ARRAY['tokenId', 'ownerUserId', 'accountKey', 'kind']
    WHEN 'POSITION_BALANCE' THEN
        ARRAY['accountId']
    WHEN 'POSITION_POST' THEN
        ARRAY['entries', 'reference']
    WHEN 'POSITION_TRANSFER' THEN
        ARRAY['sourceAccountId', 'targetAccountId', 'quantity', 'reference']
    WHEN 'POSITION_RESERVE' THEN
        ARRAY['accountId', 'quantity', 'reference']
    WHEN 'POSITION_CONSUME' THEN
        ARRAY['reservationId', 'quantity', 'targetAccountId']
    WHEN 'POSITION_RELEASE' THEN
        ARRAY['reservationId', 'quantity']
    WHEN 'POSITION_CANCEL' THEN
        ARRAY['reservationId']
    WHEN 'POSITION_REVERSE' THEN
        ARRAY['journalId']
    WHEN 'SETTLE' THEN
        ARRAY['buyerCashAccountId', 'sellerCashAccountId', 'buyerPositionAccountId', 'sellerPositionAccountId', 'cashReservationId', 'positionReservationId', 'cashReservationReference', 'positionReservationReference', 'marketId', 'tokenId', 'quantity', 'priceCents', 'matchReference']
    ELSE
        ARRAY[]::text[]
    END;
    IF p_terms - expected <> '{}'::jsonb THEN
        RAISE EXCEPTION 'unexpected position terms';
    END IF;
    -- Same gate as cash operations: maintenance excludes all cash/position writers.
    IF p_action IN ('POSITION_REBUILD', 'POSITION_RECONCILE') THEN
        PERFORM
            pg_advisory_xact_lock(727190001);
        ELSE
            PERFORM
                pg_advisory_xact_lock_shared(727190001);
    END IF;
    IF p_action = 'POSITION_REBUILD' THEN
        cash_report := public.financial_reconcile(p_actor);
    END IF;
    IF p_action NOT IN ('POSITION_BALANCE', 'POSITION_RECONCILE') THEN
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
    IF p_action IN ('POSITION_TRANSFER', 'POSITION_RESERVE', 'POSITION_CONSUME', 'POSITION_RELEASE', 'SETTLE') THEN
        IF jsonb_typeof(p_terms -> 'quantity') IS DISTINCT FROM 'string' OR (p_terms ->> 'quantity') !~ '^[1-9][0-9]{0,18}$' THEN
            RAISE EXCEPTION 'quantity requires whole-share integer string';
        END IF;
        q :=(p_terms ->> 'quantity')::bigint;
        IF q % 1000000 <> 0 THEN
            RAISE EXCEPTION 'quantity requires whole shares';
        END IF;
    END IF;
    IF p_action = 'POSITION_ACCOUNT' THEN
        IF jsonb_typeof(p_terms -> 'accountKey') IS DISTINCT FROM 'string' OR length(p_terms ->> 'accountKey')
            NOT BETWEEN 1 AND 120 THEN
            RAISE EXCEPTION 'position account key required';
        END IF;
        INSERT INTO public.position_accounts(token_id, owner_user_id, account_key, kind)
            VALUES ((p_terms ->> 'tokenId')::bigint,(p_terms ->> 'ownerUserId')::bigint, p_terms ->> 'accountKey', p_terms ->> 'kind')
        RETURNING
            *
        INTO
            a;
        INSERT INTO public.position_balance_projections(account_id)
            VALUES (a.id);
            result := jsonb_build_object(
                'accountId', a.id::text
            );
        ELSIF p_action IN ('POSITION_REBUILD', 'POSITION_RECONCILE') THEN
            IF p_action = 'POSITION_REBUILD' THEN
                PERFORM
                    id
                FROM
                    public.position_accounts
                ORDER BY
                    id
                FOR UPDATE;
                UPDATE
                    public.position_balance_projections p
                SET
                    posted = COALESCE((
                        SELECT
                            sum(
                                CASE e.side
                                WHEN 'IN' THEN
                                    e.quantity::numeric
                                ELSE
                                    - e.quantity::numeric
                                END)
                        FROM public.position_journal_entries e
                        WHERE
                            e.account_id = p.account_id), 0)::bigint,
                    reserved = COALESCE((
                        SELECT
                            sum(
                                CASE v.kind
                                WHEN 'RESERVE' THEN
                                    v.quantity::numeric
                                ELSE
                                    - v.quantity::numeric
                                END)
                        FROM public.position_reservation_events v
                        JOIN public.position_reservations r1 ON r1.id = v.reservation_id
                        WHERE
                            r1.account_id = p.account_id), 0)::bigint;
            END IF;
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
                    public.position_accounts LOOP
                        PERFORM
                            public.position_validate('POSITION_ACCOUNT', item.id);
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
                            result := jsonb_build_object(
                                'reconciled', TRUE,
                                'cash', CASE WHEN p_action = 'POSITION_REBUILD' THEN
                                    cash_report
                                ELSE
                                    public.financial_reconcile(p_actor)
                                END,
                                'journals',(
                                    SELECT
                                        count(*)::text
                                    FROM public.position_journals),
                                'settlements',(
                                    SELECT
                                        count(*)::text
                                    FROM public.cash_position_settlements)
                            );
                            IF p_action = 'POSITION_RECONCILE' THEN
                                RETURN result;
                            END IF;
                        -- Atomic settlement: validate market and reservations, then move cash and shares in this same transaction.
                        ELSIF p_action = 'SETTLE' THEN
                            IF jsonb_typeof(p_terms -> 'priceCents') IS DISTINCT FROM 'string' OR (p_terms ->> 'priceCents') !~ '^[1-9][0-9]{0,18}$' OR jsonb_typeof(p_terms -> 'matchReference') IS DISTINCT FROM 'string' OR length(p_terms ->> 'matchReference')
                            NOT BETWEEN 1 AND 120 THEN
                                RAISE EXCEPTION 'invalid settlement price or reference';
                            END IF;
                            IF jsonb_typeof(p_terms -> 'cashReservationReference') IS DISTINCT FROM 'string' OR length(p_terms ->> 'cashReservationReference')
                                NOT BETWEEN 1 AND 120 OR jsonb_typeof(p_terms -> 'positionReservationReference') IS DISTINCT FROM 'string' OR length(p_terms ->> 'positionReservationReference')
                                NOT BETWEEN 1 AND 120 THEN
                                RAISE EXCEPTION 'settlement reservation business references required';
                            END IF;
                            price :=(p_terms ->> 'priceCents')::bigint;
                            consideration :=((q::numeric / 1000000) * price)::bigint;
                            -- Global order: market, ascending cash accounts, ascending position accounts, cash hold, position hold.
                            SELECT
                                *
                            INTO
                                STRICT m
                            FROM
                                public.markets
                            WHERE
                                id =(p_terms ->> 'marketId')::uuid FOR SHARE;
                                IF m.lifecycle_status <> 'ACTIVE' OR m.trading_status <> 'OPEN' OR m.resolution_status <> 'UNRESOLVED' OR m.terms_frozen_at IS NULL OR clock_timestamp() < m.trading_starts_at OR clock_timestamp() >= m.trading_ends_at THEN
                                    RAISE EXCEPTION 'market not open or trading cutoff reached';
                                END IF;
                                PERFORM
                                    id
                                FROM
                                    public.financial_accounts
                                WHERE
                                    id IN ((p_terms ->> 'buyerCashAccountId')::bigint,(p_terms ->> 'sellerCashAccountId')::bigint)
                                ORDER BY
                                    id
                                FOR UPDATE;
                                PERFORM
                                    id
                                FROM
                                    public.position_accounts
                                WHERE
                                    id IN ((p_terms ->> 'buyerPositionAccountId')::bigint,(p_terms ->> 'sellerPositionAccountId')::bigint)
                                ORDER BY
                                    id
                                FOR UPDATE;
                                SELECT
                                    *
                                INTO
                                    STRICT bc
                                FROM
                                    public.financial_accounts
                                WHERE
                                    id =(p_terms ->> 'buyerCashAccountId')::bigint;
                                    SELECT
                                        *
                                    INTO
                                        STRICT sc
                                    FROM
                                        public.financial_accounts
                                    WHERE
                                        id =(p_terms ->> 'sellerCashAccountId')::bigint;
                                        SELECT
                                            *
                                        INTO
                                            STRICT bp
                                        FROM
                                            public.position_accounts
                                        WHERE
                                            id =(p_terms ->> 'buyerPositionAccountId')::bigint;
                                            SELECT
                                                *
                                            INTO
                                                STRICT sp
                                            FROM
                                                public.position_accounts
                                            WHERE
                                                id =(p_terms ->> 'sellerPositionAccountId')::bigint;
                                                IF bc.kind <> 'CUSTOMER' OR sc.kind <> 'CUSTOMER' OR bp.kind <> 'CUSTOMER' OR sp.kind <> 'CUSTOMER' OR bc.asset <> 'USD' OR sc.asset <> 'USD' OR bc.owner_user_id <> bp.owner_user_id OR sc.owner_user_id <> sp.owner_user_id OR bc.owner_user_id = sc.owner_user_id THEN
                                                    RAISE EXCEPTION 'settlement owner mismatch or self trade';
                                                END IF;
                                                IF bp.token_id <> sp.token_id OR bp.token_id <>(p_terms ->> 'tokenId')::bigint OR NOT EXISTS (
                                                SELECT
                                                    1
                                                FROM
                                                    public.ctf_position_tokens t
                                                    JOIN public.market_outcomes o ON o.id = t.market_outcome_id
                                                WHERE
                                                    t.id = bp.token_id
                                                        AND o.market_id = m.id) THEN
                                                    RAISE EXCEPTION 'settlement market token mismatch';
                                                END IF;
                                                SELECT
                                                    *
                                                INTO
                                                    STRICT cr
                                                FROM
                                                    public.cash_reservations
                                                WHERE
                                                    id =(p_terms ->> 'cashReservationId')::bigint
                                                FOR UPDATE;
                                                SELECT
                                                    *
                                                INTO
                                                    STRICT r
                                                FROM
                                                    public.position_reservations
                                                WHERE
                                                    id =(p_terms ->> 'positionReservationId')::bigint
                                                FOR UPDATE;
                                                IF cr.reference IS DISTINCT FROM p_terms ->> 'cashReservationReference' OR r.reference IS DISTINCT FROM p_terms ->> 'positionReservationReference' THEN
                                                    RAISE EXCEPTION 'settlement reservation business reference mismatch';
                                                END IF;
                                                IF cr.account_id <> bc.id OR r.account_id <> sp.id OR cr.status <> 'OPEN' OR r.status <> 'OPEN' OR cr.amount - cr.consumed - cr.released < consideration OR r.quantity - r.consumed - r.released < q THEN
                                                    RAISE EXCEPTION 'settlement reservation mismatch or insufficient remaining';
                                                END IF;
                                                UPDATE
                                                    public.cash_reservations
                                                SET
                                                    consumed = consumed + consideration,
                                                    status = CASE WHEN consumed + released + consideration = amount THEN
                                                        'CLOSED'
                                                    ELSE
                                                        'OPEN'
                                                    END
                                                WHERE
                                                    id = cr.id;
        -- Create the journal header before its immutable accounting lines.
        INSERT INTO public.financial_journals(operation_id)
            VALUES (op_id)
        RETURNING
            id
        INTO
            cash_journal;
        INSERT INTO public.financial_journal_entries(journal_id, account_id, asset, side, amount)
        VALUES
            (cash_journal, bc.id, 'USD', 'DEBIT', consideration),
(cash_journal, sc.id, 'USD', 'CREDIT', consideration);
        UPDATE
            public.financial_journals
        SET
            status = 'POSTED'
        WHERE
            id = cash_journal;
        INSERT INTO public.cash_reservation_events(reservation_id, operation_id, kind, amount, journal_id)
            VALUES (cr.id, op_id, 'CONSUME', consideration, cash_journal);
            UPDATE
                public.position_reservations
            SET
                consumed = consumed + q,
                status = CASE WHEN consumed + released + q = quantity THEN
                    'CLOSED'
                ELSE
                    'OPEN'
                END
            WHERE
                id = r.id;
        -- Create the journal header before its immutable accounting lines.
        INSERT INTO public.position_journals(operation_id, reference, purpose)
            VALUES (op_id, p_terms ->> 'matchReference', 'SETTLEMENT')
        RETURNING
            id
        INTO
            journal_id;
        INSERT INTO public.position_journal_entries(journal_id, account_id, token_id, side, quantity)
        VALUES
            (journal_id, sp.id, sp.token_id, 'OUT', q),
(journal_id, bp.id, bp.token_id, 'IN', q);
        UPDATE
            public.position_journals
        SET
            status = 'POSTED'
        WHERE
            id = journal_id;
        INSERT INTO public.position_reservation_events(reservation_id, operation_id, kind, quantity, journal_id)
            VALUES (r.id, op_id, 'CONSUME', q, journal_id);
        INSERT INTO public.cash_position_settlements(operation_id, match_reference, market_id, token_id, buyer_cash_account_id, seller_cash_account_id, buyer_position_account_id, seller_position_account_id, cash_reservation_id, position_reservation_id, cash_journal_id, position_journal_id, quantity, price_cents, consideration_cents)
            VALUES (op_id, p_terms ->> 'matchReference', m.id, bp.token_id, bc.id, sc.id, bp.id, sp.id, cr.id, r.id, cash_journal, journal_id, q, price, consideration)
        RETURNING
            id
        INTO
            settlement_id;
            -- Recheck after possible lock waits and all writes; historical reconciliation uses immutable links, not today's market state.
            IF clock_timestamp() >= m.trading_ends_at THEN
                RAISE EXCEPTION 'trading cutoff reached during settlement';
            END IF;
            result := jsonb_build_object(
                'settlementId', settlement_id::text,
                'cashJournalId', cash_journal::text,
                'positionJournalId', journal_id::text,
                'quantity', q::text,
                'considerationCents', consideration::text
            );
        ELSE
            IF p_action IN ('POSITION_CONSUME', 'POSITION_RELEASE', 'POSITION_CANCEL') THEN
                SELECT
                    *
                INTO
                    STRICT r
                FROM
                    public.position_reservations
                WHERE
                    id =(p_terms ->> 'reservationId')::bigint;
                    ids := ARRAY[r.account_id];
                    IF p_action = 'POSITION_CONSUME' THEN
                        ids := ids || ARRAY[(p_terms ->> 'targetAccountId')::bigint];
                    END IF;
                ELSIF p_action = 'POSITION_POST' THEN
                    lines := p_terms -> 'entries';
                    IF jsonb_typeof(lines) IS DISTINCT FROM 'array' OR jsonb_array_length(lines)
                        NOT BETWEEN 2 AND 100 THEN
                        RAISE EXCEPTION 'position journal requires 2 to 100 entries';
                    END IF;
                    SELECT
                        array_agg(DISTINCT (v ->> 'accountId')::bigint)
                    INTO
                        ids
                    FROM
                        jsonb_array_elements(lines) v;
                    ELSIF p_action = 'POSITION_REVERSE' THEN
                        SELECT
                            *
                        INTO
                            STRICT original
                        FROM
                            public.position_journals
                        WHERE
                            id =(p_terms ->> 'journalId')::bigint;
                            IF original.purpose NOT IN ('POST', 'TRANSFER') OR original.reversal_of IS NOT NULL THEN
                                RAISE EXCEPTION 'position journal ineligible for reversal';
                            END IF;
                            SELECT
                                jsonb_agg(
                                    jsonb_build_object(
                                        'accountId', e.account_id::text,
                                        'tokenId', e.token_id::text,
                                        'side', CASE e.side
                                        WHEN 'IN' THEN
                                            'OUT'
                                        ELSE
                                            'IN'
                                        END,
                                        'quantity', e.quantity::text
                                    )
                                    ORDER BY e.id
                                ),
                                array_agg(DISTINCT e.account_id)
                            INTO
                                lines,
                                ids
                            FROM
                                public.position_journal_entries e
                            WHERE
                                e.journal_id = original.id;
                            ELSIF p_action = 'POSITION_TRANSFER' THEN
                                ids := ARRAY[(p_terms ->> 'sourceAccountId')::bigint,(p_terms ->> 'targetAccountId')::bigint];
                            ELSE
                                ids := ARRAY[(p_terms ->> 'accountId')::bigint];
            END IF;
            IF ids IS NULL OR array_position(ids, NULL) IS NOT NULL THEN
                RAISE EXCEPTION 'missing position account';
            END IF;
            PERFORM
                id
            FROM
                public.position_accounts
            WHERE
                id = ANY (ids)
            ORDER BY
                id
            FOR UPDATE;
            IF (
                SELECT
                    count(*)
                FROM
                    public.position_accounts
                WHERE
                    id = ANY (ids)) <>(
        SELECT
            count(DISTINCT v)
        FROM
            unnest(ids) v) THEN
                RAISE EXCEPTION 'unknown position account';
            END IF;
            IF p_action IN ('POSITION_CONSUME', 'POSITION_RELEASE', 'POSITION_CANCEL') THEN
                SELECT
                    *
                INTO
                    STRICT r
                FROM
                    public.position_reservations
                WHERE
                    id = r.id
                FOR UPDATE;
                IF r.status <> 'OPEN' THEN
                    RAISE EXCEPTION 'position reservation closed';
                END IF;
                SELECT
                    *
                INTO
                    STRICT a
                FROM
                    public.position_accounts
                WHERE
                    id = r.account_id;
                ELSE
                    SELECT
                        *
                    INTO
                        STRICT a
                    FROM
                        public.position_accounts
                    WHERE
                        id = ids[1];
            END IF;
            IF p_actor LIKE 'user:%' AND (a.owner_user_id IS NULL OR p_actor <> 'user:' || a.owner_user_id::text) THEN
                RAISE EXCEPTION 'position access denied'
                    USING ERRCODE = '42501';
            END IF;
            IF p_action = 'POSITION_BALANCE' THEN
                RETURN (
                    SELECT
                        jsonb_build_object(
                            'accountId', p.account_id::text,
                            'tokenId', a.token_id::text,
                            'posted', p.posted::text,
                            'reserved', p.reserved::text,
                            'available', CASE WHEN a.kind = 'EXTERNAL_CONTROL' THEN
                                '0'
                            ELSE
                                (p.posted - p.reserved)::text
                            END,
                            'spendable', a.kind <> 'EXTERNAL_CONTROL'
                        )
                    FROM
                        public.position_balance_projections p
                    WHERE
                        account_id = a.id);
            END IF;
            IF a.kind = 'EXTERNAL_CONTROL' OR EXISTS (
                SELECT
                    1
                FROM
                    public.position_accounts
                WHERE
                    id = ANY (ids)
                    AND kind = 'EXTERNAL_CONTROL') THEN
                RAISE EXCEPTION 'external control is not spendable inventory';
            END IF;
            IF p_action = 'POSITION_RESERVE' THEN
                IF jsonb_typeof(p_terms -> 'reference') IS DISTINCT FROM 'string' OR length(p_terms ->> 'reference')
                    NOT BETWEEN 1 AND 120 THEN
                    RAISE EXCEPTION 'position reservation reference required';
                END IF;
                INSERT INTO public.position_reservations(account_id, operation_id, reference, quantity)
                    VALUES (a.id, op_id, p_terms ->> 'reference', q)
                RETURNING
                    id
                INTO
                    reservation_id;
                INSERT INTO public.position_reservation_events(reservation_id, operation_id, kind, quantity)
                    VALUES (reservation_id, op_id, 'RESERVE', q);
                    result := jsonb_build_object(
                        'reservationId', reservation_id::text
                    );
                ELSIF p_action IN ('POSITION_CONSUME', 'POSITION_RELEASE', 'POSITION_CANCEL') THEN
                    remaining := r.quantity - r.consumed - r.released;
                    IF p_action = 'POSITION_CANCEL' THEN
                        q := remaining;
                    END IF;
                    IF q > remaining THEN
                        RAISE EXCEPTION 'position reservation quantity exceeds remaining';
                    END IF;
                    UPDATE
                        public.position_reservations
                    SET
                        consumed = consumed + CASE WHEN p_action = 'POSITION_CONSUME' THEN
                            q
                        ELSE
                            0
                        END,
                        released = released + CASE WHEN p_action <> 'POSITION_CONSUME' THEN
                            q
                        ELSE
                            0
                        END,
                        status = CASE WHEN p_action = 'POSITION_CANCEL' THEN
                            'CANCELLED'
                        WHEN q = remaining THEN
                            'CLOSED'
                        ELSE
                            'OPEN'
                        END
                    WHERE
                        id = r.id;
                        IF p_action = 'POSITION_CONSUME' THEN
                            target_id :=(p_terms ->> 'targetAccountId')::bigint;
                            lines := jsonb_build_array(
                                jsonb_build_object(
                                    'accountId', r.account_id::text,
                                    'tokenId', a.token_id::text,
                                    'side', 'OUT',
                                    'quantity', q::text
                                ),
                                jsonb_build_object(
                                    'accountId', target_id::text,
                                    'tokenId', a.token_id::text,
                                    'side', 'IN',
                                    'quantity', q::text
                                )
                            );
                        END IF;
                        result := jsonb_build_object(
                            'reservationId', r.id::text
                        );
                    ELSIF p_action = 'POSITION_TRANSFER' THEN
                        target_id :=(p_terms ->> 'targetAccountId')::bigint;
                        lines := jsonb_build_array(
                            jsonb_build_object(
                                'accountId', a.id::text,
                                'tokenId', a.token_id::text,
                                'side', 'OUT',
                                'quantity', q::text
                            ),
                            jsonb_build_object(
                                'accountId', target_id::text,
                                'tokenId', a.token_id::text,
                                'side', 'IN',
                                'quantity', q::text
                            )
                        );
            END IF;
            IF p_action IN ('POSITION_POST', 'POSITION_TRANSFER', 'POSITION_CONSUME', 'POSITION_REVERSE') THEN
                IF p_action IN ('POSITION_TRANSFER', 'POSITION_CONSUME') AND (target_id = a.id OR NOT EXISTS (
                    SELECT
                        1
                    FROM
                        public.position_accounts
                    WHERE
                        id = target_id
                        AND token_id = a.token_id
                        AND kind <> 'EXTERNAL_CONTROL')) THEN
                    RAISE EXCEPTION 'position transfer target or token mismatch';
                END IF;
                IF p_action IN ('POSITION_POST', 'POSITION_TRANSFER') AND (jsonb_typeof(p_terms -> 'reference') IS DISTINCT FROM 'string' OR length(p_terms ->> 'reference')
                    NOT BETWEEN 1 AND 120) THEN
                    RAISE EXCEPTION 'position posting reference required';
                END IF;
                -- Create the journal header before its immutable accounting lines.
                INSERT INTO public.position_journals(operation_id, reference, purpose, reversal_of)
                    VALUES (op_id, COALESCE(p_terms ->> 'reference', p_key), CASE p_action
                        WHEN 'POSITION_POST' THEN
                            'POST'
                        WHEN 'POSITION_TRANSFER' THEN
                            'TRANSFER'
                        WHEN 'POSITION_CONSUME' THEN
                            'CONSUMPTION'
                        ELSE
                            'REVERSAL'
                        END, CASE WHEN p_action = 'POSITION_REVERSE' THEN
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
                    IF entry - ARRAY['accountId', 'tokenId', 'side', 'quantity'] <> '{}'::jsonb OR jsonb_typeof(entry -> 'quantity') IS DISTINCT FROM 'string' OR (entry ->> 'quantity') !~ '^[1-9][0-9]{0,18}$' THEN
                        RAISE EXCEPTION 'invalid position entry';
                    END IF;
                    INSERT INTO public.position_journal_entries(journal_id, account_id, token_id, side, quantity)
                        VALUES (journal_id,(entry ->> 'accountId')::bigint,(entry ->> 'tokenId')::bigint, entry ->> 'side',(entry ->> 'quantity')::bigint);
                END LOOP;
                UPDATE
                    public.position_journals
                SET
                    status = 'POSTED'
                WHERE
                    id = journal_id;
                    result := COALESCE(result, '{}'::jsonb) || jsonb_build_object(
                        'journalId', journal_id::text
                    );
            END IF;
            IF p_action IN ('POSITION_CONSUME', 'POSITION_RELEASE', 'POSITION_CANCEL') THEN
                INSERT INTO public.position_reservation_events(reservation_id, operation_id, kind, quantity, journal_id)
                    VALUES (r.id, op_id, substring(p_action FROM 10), q, journal_id);
            END IF;
    END IF;
    UPDATE
        public.financial_operations
    SET
        result = positions.result
    WHERE
        id = op_id;
        RETURN result;
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
BEGIN
    IF p_action LIKE 'POSITION_%' OR p_action = 'SETTLE' THEN
        RETURN public.position_execute(p_actor, p_action, p_key, p_terms);
    END IF;
    RETURN public.financial_cash_execute(p_actor, p_action, p_key, p_terms);
END
$$;

--> statement-breakpoint

-- ============================================================================
-- PERMISSIONS AND SECURITY (original execution order preserved)
-- ============================================================================
REVOKE ALL ON FUNCTION public.financial_cash_execute(text, text, text, jsonb), public.position_execute(text, text, text, jsonb), public.position_guard(), public.position_validate(text, bigint) FROM PUBLIC;

--> statement-breakpoint
REVOKE ALL ON TABLE public.position_accounts, public.position_journals, public.position_journal_entries, public.position_balance_projections, public.position_reservations, public.position_reservation_events, public.cash_position_settlements FROM PUBLIC;
