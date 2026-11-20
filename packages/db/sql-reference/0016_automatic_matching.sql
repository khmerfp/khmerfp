-- READING COPY ONLY: do not execute or use as a migration.
-- Executable source: packages/db/migrations/0016_automatic_matching.sql
SELECT
    pg_advisory_xact_lock(727190001);

--> statement-breakpoint
SELECT
    public.financial_reconcile('system:matching_adoption');

--> statement-breakpoint
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
    SELECT
        id
    FROM
        public.position_accounts LOOP
            PERFORM
                public.position_validate('POSITION_ACCOUNT', r.id);
        END LOOP;
    FOR r IN
    SELECT
        id
    FROM
        public.position_journals LOOP
            PERFORM
                public.position_validate('POSITION_JOURNAL', r.id);
        END LOOP;
    FOR r IN
    SELECT
        id
    FROM
        public.position_reservations LOOP
            PERFORM
                public.position_validate('POSITION_RESERVATION', r.id);
        END LOOP;
    FOR r IN
    SELECT
        id
    FROM
        public.cash_position_settlements LOOP
            PERFORM
                public.position_validate('SETTLEMENT', r.id);
        END LOOP;
    FOR r IN
    SELECT
        id
    FROM
        public.trading_orders LOOP
            PERFORM
                public.trading_validate_order(r.id);
        END LOOP;
    FOR r IN
    SELECT
        id
    FROM
        public.trading_commands LOOP
            PERFORM
                public.trading_validate_command(r.id);
        END LOOP;
END
$$;

--> statement-breakpoint
CREATE TABLE "matching_markets"(
    "market_id" uuid PRIMARY KEY NOT NULL,
    "accepted_sequence" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "matching_markets_sequence_check" CHECK ("matching_markets"."accepted_sequence" >= 0)
);

--> statement-breakpoint
CREATE TABLE "matching_requests"(
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "market_id" uuid NOT NULL,
    "sequence" bigint NOT NULL,
    "operation_key" text NOT NULL,
    "actor" text NOT NULL,
    "action" text NOT NULL,
    "terms" jsonb NOT NULL,
    "order_id" bigint NOT NULL,
    "steps" bigint DEFAULT 0 NOT NULL,
    "state" text DEFAULT 'QUEUED' NOT NULL,
    "result" jsonb NOT NULL,
    "resting" text DEFAULT 'NO' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "matching_requests_operation_key_unique" UNIQUE ("operation_key"),
    CONSTRAINT "matching_requests_market_sequence_key" UNIQUE ("market_id", "sequence"),
    CONSTRAINT "matching_requests_state_check" CHECK ("matching_requests"."state" IN ('QUEUED', 'DONE') AND "matching_requests"."resting" IN ('YES', 'NO') AND "matching_requests"."steps" >= 0),
    CONSTRAINT "matching_requests_action_check" CHECK ("matching_requests"."action" IN ('PLACE', 'CANCEL', 'EXPIRE'))
);

--> statement-breakpoint
ALTER TABLE "matching_markets"
    ADD CONSTRAINT "matching_markets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "matching_requests"
    ADD CONSTRAINT "matching_requests_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "matching_requests"
    ADD CONSTRAINT "matching_requests_order_id_trading_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."trading_orders"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
CREATE INDEX "matching_requests_pending_idx" ON "matching_requests" USING btree("market_id", "state", "sequence");

--> statement-breakpoint
-- Historical implementation is a private settlement primitive, never a runtime fill API.
ALTER FUNCTION public.trading_execute(text, text, text, jsonb) RENAME TO trading_execute_foundation;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trading_execute_foundation(text, text, text, jsonb) FROM PUBLIC;

--> statement-breakpoint
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
    SELECT
        grantee
    FROM
        information_schema.routine_privileges
    WHERE
        specific_schema = 'public'
        AND routine_name = 'trading_execute_foundation'
        AND grantee NOT IN ('PUBLIC', CURRENT_USER, pg_get_userbyid((
                SELECT
                    proowner
                FROM pg_proc
                WHERE
                    oid = 'public.trading_execute_foundation(text,text,text,jsonb)'::regprocedure)))
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.trading_execute_foundation(text,text,text,jsonb) FROM %I', r.grantee);
    END LOOP;
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.matching_guard()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'matching history is immutable';
    END IF;
    IF TG_TABLE_NAME = 'matching_markets' THEN
        IF TG_OP = 'UPDATE' AND(NEW.market_id <> OLD.market_id OR NEW.accepted_sequence <> OLD.accepted_sequence + 1) THEN
            RAISE EXCEPTION 'invalid market command sequence';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF(to_jsonb(NEW) - ARRAY['state', 'steps', 'resting']) IS DISTINCT FROM(to_jsonb(OLD) - ARRAY['state', 'steps', 'resting']) OR OLD.state = 'DONE' OR NEW.steps < OLD.steps OR NEW.steps > OLD.steps + 1 THEN
            RAISE EXCEPTION 'immutable matching request or invalid progress';
        END IF;
    END IF;
    RETURN NEW;
END
$$;

--> statement-breakpoint
CREATE TRIGGER matching_markets_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.matching_markets
    FOR EACH ROW
    EXECUTE FUNCTION public.matching_guard();

--> statement-breakpoint
CREATE TRIGGER matching_requests_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.matching_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.matching_guard();

--> statement-breakpoint
-- Existing accepted orders become resting in their established book priority order.
-- New market sequencing begins after this historical prefix; no balances are modified.
INSERT INTO public.matching_markets(market_id, accepted_sequence)
SELECT
    market_id,
    count(*)
FROM
    public.trading_books b
    JOIN public.trading_orders o ON o.book_id = b.id
GROUP BY
    market_id;

--> statement-breakpoint
INSERT INTO public.matching_requests(market_id, SEQUENCE,
    operation_key,
    actor,
    action,
    terms,
    order_id,
    state,
    result,
    resting
)
SELECT
    b.market_id,
    row_number() OVER (PARTITION BY b.market_id ORDER BY b.id, o.priority_sequence, o.id),
    c.operation_key,
    c.actor,
    'PLACE',
    c.terms,
    o.id,
    'DONE',
    c.result,
    CASE WHEN o.status IN ('OPEN', 'PARTIAL') THEN
        'YES'
    ELSE
        'NO'
    END
FROM
    public.trading_orders o
    JOIN public.trading_books b ON b.id = o.book_id
    JOIN public.trading_commands c ON c.id = o.command_id;

--> statement-breakpoint
CREATE FUNCTION public.trading_execute(p_actor text, p_action text, p_key text, p_terms jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    r public.matching_requests;
    o public.trading_orders;
    m uuid;
    receipt jsonb;
    seq bigint;
    old public.trading_commands;
BEGIN
    IF p_actor IS NULL OR p_actor !~ '^(user:[1-9][0-9]*|system:[a-z][a-z0-9_-]{0,60})$' OR p_action IS NULL OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9:_-]{1,120}$' OR p_terms IS NULL OR jsonb_typeof(p_terms) <> 'object' THEN
        RAISE EXCEPTION 'invalid trading request';
    END IF;
    IF p_action = 'FILL' THEN
        RAISE EXCEPTION 'direct fill disabled; matching worker selects execution'
            USING ERRCODE = '42501';
    END IF;
    IF p_key LIKE 'engine:%' THEN
        RAISE EXCEPTION 'reserved engine operation key'
            USING ERRCODE = '42501';
    END IF;
    IF p_action = 'RECONCILE' THEN
        PERFORM
            pg_advisory_xact_lock(727190001);
    ELSE
        PERFORM
            pg_advisory_xact_lock_shared(727190001);
    END IF;
    SELECT
        *
    INTO
        r
    FROM
        public.matching_requests
    WHERE
        operation_key = p_key;
    IF FOUND THEN
        IF r.actor <> p_actor THEN
            RAISE EXCEPTION 'command belongs to another actor'
                USING ERRCODE = '42501';
        END IF;
        IF p_action = 'RECOVER' AND p_terms = '{}'::jsonb THEN
            RETURN r.result;
        END IF;
        IF r.action <> p_action OR r.terms <> p_terms THEN
            RAISE EXCEPTION 'conflicting trading idempotency terms';
        END IF;
        RETURN r.result;
    END IF;
    IF p_action = 'RECONCILE' THEN
        receipt := public.trading_execute_foundation(p_actor, p_action, p_key, p_terms);
        FOR r IN
        SELECT
            *
        FROM
            public.matching_requests LOOP
                PERFORM
                    public.matching_validate_request(r.id);
            END LOOP;
        IF EXISTS (
            SELECT
                1
            FROM
                public.matching_markets mm
            WHERE
                mm.accepted_sequence <>(
                SELECT
                    count(*)
                FROM
                    public.matching_requests mr
                WHERE
                    mr.market_id = mm.market_id)) THEN
            RAISE EXCEPTION 'market command reconciliation mismatch';
        END IF;
        RETURN receipt;
    END IF;
    IF p_action = 'RECOVER' THEN
        RETURN public.trading_execute_foundation(p_actor, p_action, p_key, p_terms);
    END IF;
    IF p_action NOT IN ('PLACE', 'CANCEL', 'EXPIRE') THEN
        RAISE EXCEPTION 'unsupported trading action';
    END IF;
    IF (p_action IN ('PLACE', 'CANCEL') AND p_actor NOT LIKE 'user:%') OR (p_action = 'EXPIRE' AND p_actor NOT LIKE 'system:%') THEN
        RAISE EXCEPTION 'trading actor capability denied'
            USING ERRCODE = '42501';
    END IF;
    IF p_action = 'PLACE' THEN
        m :=(p_terms ->> 'marketId')::uuid;
    ELSE
        IF p_terms - ARRAY['orderId'] <> '{}'::jsonb OR NOT p_terms ? 'orderId' THEN
            RAISE EXCEPTION 'invalid cancel terms';
        END IF;
        SELECT
            *
        INTO
            STRICT o
        FROM
            public.trading_orders
        WHERE
            id =(p_terms ->> 'orderId')::bigint;
        IF p_action = 'CANCEL' AND p_actor <> 'user:' || o.user_id::text THEN
            RAISE EXCEPTION 'order access denied'
                USING ERRCODE = '42501';
        END IF;
        IF o.status NOT IN ('OPEN', 'PARTIAL') THEN
            RAISE EXCEPTION 'order is terminal';
        END IF;
        SELECT
            market_id
        INTO
            STRICT m
        FROM
            public.trading_books
        WHERE
            id = o.book_id;
        IF p_action = 'EXPIRE' AND clock_timestamp() <(
            SELECT
                trading_ends_at
            FROM
                public.markets
            WHERE
                id = m) THEN
            RAISE EXCEPTION 'order has not expired';
        END IF;
    END IF;
    -- Gate order is shared maintenance, market advisory lock, market row, book and accounts.
    PERFORM
        pg_advisory_xact_lock(hashtextextended('matching:' || m::text, 0));
    SELECT
        *
    INTO
        r
    FROM
        public.matching_requests
    WHERE
        operation_key = p_key;
    IF FOUND THEN
        IF r.actor <> p_actor OR r.action <> p_action OR r.terms <> p_terms THEN
            RAISE EXCEPTION 'conflicting trading command';
        END IF;
        RETURN r.result;
    END IF;
    SELECT
        *
    INTO
        old
    FROM
        public.trading_commands
    WHERE
        operation_key = p_key;
    IF FOUND THEN
        RETURN public.trading_execute_foundation(p_actor, p_action, p_key, p_terms);
    END IF;
    INSERT INTO public.matching_markets(market_id)
        VALUES (m)
    ON CONFLICT
        DO NOTHING;
    UPDATE
        public.matching_markets
    SET
        accepted_sequence = accepted_sequence + 1
    WHERE
        market_id = m
    RETURNING
        accepted_sequence
    INTO
        seq;
    IF p_action = 'PLACE' THEN
        -- Lock before INSERT obtains FK KEY SHARE locks: avoid cross-book lock-upgrade deadlocks.
        PERFORM
            id
        FROM
            public.financial_accounts
        WHERE
            id =(p_terms ->> 'cashAccountId')::bigint
        FOR UPDATE;
        PERFORM
            id
        FROM
            public.position_accounts
        WHERE
            id =(p_terms ->> 'positionAccountId')::bigint
        FOR UPDATE;
        receipt := public.trading_execute_foundation(p_actor, p_action, p_key, p_terms);
        o.id :=(receipt ->> 'orderId')::bigint;
    ELSE
        receipt := jsonb_build_object(
            'orderId', o.id::text,
            'processing', 'QUEUED'
        );
    END IF;
    INSERT INTO public.matching_requests(market_id, SEQUENCE,
        operation_key,
        actor,
        action,
        terms,
        order_id,
        result)
VALUES (m,
    seq,
    p_key,
    p_actor,
    p_action,
    p_terms,
    o.id,
    receipt);
    RETURN receipt;
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.matching_step(p_actor text, p_market uuid)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    r public.matching_requests;
    taker public.trading_orders;
    maker public.trading_orders;
    market public.markets;
    result jsonb;
    reason text;
    op text;
    buy bigint;
    sell bigint;
BEGIN
    IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' OR p_market IS NULL THEN
        RAISE EXCEPTION 'matching requires system authorization'
            USING ERRCODE = '42501';
    END IF;
    PERFORM
        pg_advisory_xact_lock_shared(727190001);
    PERFORM
        pg_advisory_xact_lock(hashtextextended('matching:' || p_market::text, 0));
    SELECT
        *
    INTO
        STRICT market
    FROM
        public.markets
    WHERE
        id = p_market FOR SHARE;
    SELECT
        *
    INTO
        r
    FROM
        public.matching_requests
    WHERE
        market_id = p_market
        AND state = 'QUEUED'
    ORDER BY
        SEQUENCE
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'state', 'IDLE'
        );
    END IF;
    SELECT
        *
    INTO
        STRICT taker
    FROM
        public.trading_orders
    WHERE
        id = r.order_id;
    op := 'engine:' || r.id::text || ':' || r.steps::text;
    IF r.action <> 'PLACE' THEN
        IF taker.status IN ('OPEN', 'PARTIAL') THEN
            result := public.trading_execute_foundation(r.actor, r.action, r.operation_key, r.terms);
        END IF;
        UPDATE
            public.matching_requests
        SET
            state = 'DONE'
        WHERE
            id = r.id;
        RETURN jsonb_build_object(
            'state', 'DONE',
            'requestId', r.id,
            'action', r.action,
            'result', result
        );
    END IF;
    IF taker.status NOT IN ('OPEN', 'PARTIAL') THEN
        UPDATE
            public.matching_requests
        SET
            state = 'DONE'
        WHERE
            id = r.id;
        RETURN jsonb_build_object(
            'state', 'DONE',
            'requestId', r.id
        );
    END IF;
    IF clock_timestamp() >= market.trading_ends_at THEN
        result := public.trading_execute_foundation(
            p_actor,
            'EXPIRE',
            op || ':expiry',
            jsonb_build_object(
                'orderId', taker.id::text
            )
        );
        UPDATE
            public.matching_requests
        SET
            state = 'DONE',
            steps = steps + 1
        WHERE
            id = r.id;
        RETURN jsonb_build_object(
            'state', 'DONE',
            'reason', 'EXPIRED',
            'result', result
        );
    END IF;
    IF market.lifecycle_status <> 'ACTIVE' OR market.trading_status <> 'OPEN' OR market.resolution_status <> 'UNRESOLVED' OR market.terms_frozen_at IS NULL OR clock_timestamp() < market.trading_starts_at THEN
        -- Drain the head in sequence without trading: preserve past fills and release the incoming remainder.
        result := public.trading_execute_foundation(
            'user:' || taker.user_id::text,
            'CANCEL',
            op || ':paused',
            jsonb_build_object(
                'orderId', taker.id::text
            )
        );
        UPDATE
            public.matching_requests
        SET
            state = 'DONE',
            steps = steps + 1
        WHERE
            id = r.id;
        RETURN jsonb_build_object(
            'state', 'DONE',
            'requestId', r.id,
            'reason', 'MARKET_PAUSED',
            'result', result
        );
    END IF;
    -- Only fully processed older PLACE commands are eligible makers. Never skip self-trades.
    SELECT
        o.*
    INTO
        maker
    FROM
        public.trading_orders o
        JOIN public.matching_requests mr ON mr.order_id = o.id
            AND mr.action = 'PLACE'
    WHERE
        o.book_id = taker.book_id
        AND o.side <> taker.side
        AND o.status IN ('OPEN', 'PARTIAL')
        AND mr.state = 'DONE'
        AND mr.resting = 'YES'
        AND mr.sequence < r.sequence
        AND ((taker.side = 'BUY'
                AND o.limit_price_cents <= taker.limit_price_cents)
            OR (taker.side = 'SELL'
                AND o.limit_price_cents >= taker.limit_price_cents))
    ORDER BY
        CASE WHEN taker.side = 'BUY' THEN
            o.limit_price_cents
        ELSE
            - o.limit_price_cents
        END,
        mr.sequence,
        o.id
    LIMIT 1;
    IF NOT FOUND THEN
        UPDATE
            public.matching_requests
        SET
            state = 'DONE',
            resting = 'YES'
        WHERE
            id = r.id;
        RETURN jsonb_build_object(
            'state', 'DONE',
            'requestId', r.id,
            'resting', TRUE
        );
    END IF;
    IF maker.user_id = taker.user_id THEN
        result := public.trading_execute_foundation(
            'user:' || taker.user_id::text,
            'CANCEL',
            op || ':stp',
            jsonb_build_object(
                'orderId', taker.id::text
            )
        );
        UPDATE
            public.matching_requests
        SET
            state = 'DONE',
            steps = steps + 1
        WHERE
            id = r.id;
        RETURN jsonb_build_object(
            'state', 'DONE',
            'reason', 'SELF_TRADE_PREVENTION',
            'result', result
        );
    END IF;
    buy := CASE WHEN taker.side = 'BUY' THEN
        taker.id
    ELSE
        maker.id
    END;
    sell := CASE WHEN taker.side = 'SELL' THEN
        taker.id
    ELSE
        maker.id
    END;
    result := public.trading_execute_foundation(
        p_actor,
        'FILL',
        op,
        jsonb_build_object(
            'buyerOrderId', buy::text,
            'sellerOrderId', sell::text,
            'quantity', least(taker.remaining_quantity, maker.remaining_quantity)::text,
            'priceCents', maker.limit_price_cents::text
        )
    );
    UPDATE
        public.matching_requests
    SET
        steps = steps + 1,
        state = CASE WHEN (
            SELECT
                remaining_quantity
            FROM
                public.trading_orders
            WHERE
                id = taker.id) = 0 THEN
            'DONE'
        ELSE
            'QUEUED'
        END
    WHERE
        id = r.id;
    RETURN jsonb_build_object(
        'state', 'FILLED_STEP',
        'requestId', r.id,
        'result', result
    );
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.matching_pending(p_actor text)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
BEGIN
    IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' THEN
        RAISE EXCEPTION 'matching discovery requires system authorization'
            USING ERRCODE = '42501';
    END IF;
    RETURN coalesce((
        SELECT
            jsonb_agg(market_id ORDER BY market_id)
        FROM( SELECT DISTINCT
                market_id
                FROM public.matching_requests
                WHERE
                    state = 'QUEUED') q), '[]'::jsonb);
END
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.trading_emit(p_command uuid, p_order bigint, p_kind text, p_ordinal smallint)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $$
DECLARE
    event uuid;
BEGIN
    INSERT INTO public.trading_order_events(command_id, order_id, kind, ordinal, payload)
    SELECT
        p_command,
        o.id,
        p_kind,
        p_ordinal,
        jsonb_build_object(
            'orderId', o.id::text,
            'status', o.status,
            'filledQuantity', o.filled_quantity::text,
            'remainingQuantity', o.remaining_quantity::text,
            'reason', CASE WHEN c.operation_key LIKE 'engine:%:stp' THEN
                'SELF_TRADE_PREVENTION'
            WHEN c.operation_key LIKE 'engine:%:paused' THEN
                'MARKET_PAUSED'
            ELSE
                NULL
            END
        )
    FROM
        public.trading_orders o
        JOIN public.trading_commands c ON c.id = p_command
    WHERE
        o.id = p_order
    RETURNING
        id
    INTO
        event;
    INSERT INTO public.trading_outbox(event_id)
        VALUES (event);
END
$$;

--> statement-breakpoint
REVOKE ALL ON TABLE public.matching_markets, public.matching_requests FROM PUBLIC;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.matching_guard(), public.matching_step(text, uuid), public.matching_pending(text), public.trading_execute(text, text, text, jsonb) FROM PUBLIC;

--> statement-breakpoint
CREATE FUNCTION public.matching_audit()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    r public.matching_requests;
    o public.trading_orders;
    m uuid;
    n bigint;
BEGIN
    IF TG_TABLE_NAME = 'matching_markets' THEN
        IF (
            SELECT
                count(*)
            FROM
                public.matching_requests
            WHERE
                market_id = NEW.market_id) <>(
        SELECT
            accepted_sequence
        FROM
            public.matching_markets
        WHERE
            market_id = NEW.market_id) THEN
            RAISE EXCEPTION 'missing market command';
        END IF;
    ELSE
        PERFORM
            public.matching_validate_request(NEW.id);
    END IF;
    RETURN NULL;
END
$$;

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER matching_markets_audit
    AFTER INSERT OR UPDATE ON public.matching_markets DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.matching_audit();

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER matching_requests_audit
    AFTER INSERT OR UPDATE ON public.matching_requests DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.matching_audit();

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.matching_audit() FROM PUBLIC;

--> statement-breakpoint
CREATE FUNCTION public.matching_validate_request(p_id uuid)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    r public.matching_requests;
    o public.trading_orders;
    m uuid;
    n bigint;
BEGIN
    SELECT
        *
    INTO
        STRICT r
    FROM
        public.matching_requests
    WHERE
        id = p_id;
    SELECT
        *
    INTO
        STRICT o
    FROM
        public.trading_orders
    WHERE
        id = r.order_id;
    SELECT
        market_id
    INTO
        STRICT m
    FROM
        public.trading_books
    WHERE
        id = o.book_id;
    IF r.market_id <> m OR r.sequence < 1 OR r.sequence >(
        SELECT
            accepted_sequence
        FROM
            public.matching_markets
        WHERE
            market_id = m) THEN
        RAISE EXCEPTION 'matching command identity mismatch';
    END IF;
    IF r.action = 'PLACE' AND NOT EXISTS (
        SELECT
            1
        FROM
            public.trading_commands c
        WHERE
            c.id = o.command_id
            AND c.actor = r.actor
            AND c.terms = r.terms
            AND c.result = r.result
            AND c.operation_key = r.operation_key) THEN
        RAISE EXCEPTION 'matching acceptance mismatch';
    END IF;
    SELECT
        count(*)
    INTO
        n
    FROM
        public.trading_commands
    WHERE
        operation_key LIKE 'engine:' || r.id::text || ':%';
    IF n <> r.steps THEN
        RAISE EXCEPTION 'missing or fabricated matching progress';
    END IF;
    IF r.resting = 'YES' AND (r.action <> 'PLACE' OR r.state <> 'DONE') THEN
        RAISE EXCEPTION 'unprocessed maker';
    END IF;
    IF r.state = 'DONE' AND r.action = 'PLACE' AND r.resting = 'NO' AND o.status IN ('OPEN', 'PARTIAL') THEN
        RAISE EXCEPTION 'unfinished incoming order';
    END IF;
    IF r.state = 'DONE' AND r.action IN ('CANCEL', 'EXPIRE') AND o.status IN ('OPEN', 'PARTIAL') THEN
        RAISE EXCEPTION 'unfinished cancellation';
    END IF;
END
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.matching_validate_request(uuid) FROM PUBLIC;
