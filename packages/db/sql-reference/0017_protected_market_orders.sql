-- READING COPY ONLY: do not execute or use as a migration.
-- Executable source: packages/db/migrations/0017_protected_market_orders.sql
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

--> statement-breakpoint
DO $$
DECLARE
    audit_item record;
BEGIN
    FOR audit_item IN
    SELECT
        id
    FROM
        public.matching_requests LOOP
            PERFORM
                public.matching_validate_request(audit_item.id);
        END LOOP;
    IF EXISTS (
        SELECT
            1
        FROM
            public.matching_markets m
        WHERE
            accepted_sequence <>(
            SELECT
                count(*)
            FROM
                public.matching_requests r
            WHERE
                r.market_id = m.market_id)) THEN
        RAISE EXCEPTION 'inconsistent pre-existing matching sequence';
    END IF;
END
$$;

--> statement-breakpoint
CREATE TABLE "trading_order_policies"(
    "order_id" bigint PRIMARY KEY NOT NULL,
    "order_type" text NOT NULL,
    "time_in_force" text NOT NULL,
    "max_spend_cents" bigint,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "trading_order_policies_type_check" CHECK ("trading_order_policies"."order_type" = 'MARKET' AND "trading_order_policies"."time_in_force" = 'IOC'),
    CONSTRAINT "trading_order_policies_budget_check" CHECK ("trading_order_policies"."max_spend_cents" IS NULL OR "trading_order_policies"."max_spend_cents" > 0)
);

--> statement-breakpoint
ALTER TABLE "trading_order_policies"
    ADD CONSTRAINT "trading_order_policies_order_id_trading_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."trading_orders"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
CREATE FUNCTION public.trading_policy_guard()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $$
DECLARE
    o public.trading_orders;
    terms jsonb;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'order execution policy is immutable';
    END IF;
    SELECT
        *
    INTO
        STRICT o
    FROM
        public.trading_orders
    WHERE
        id = NEW.order_id;
    SELECT
        c.terms
    INTO
        STRICT terms
    FROM
        public.trading_commands c
    WHERE
        c.id = o.command_id;
    IF terms ->> 'orderType' IS DISTINCT FROM 'MARKET' OR terms ->> 'timeInForce' IS DISTINCT FROM 'IOC' THEN
        RAISE EXCEPTION 'market policy requires an authorized IOC command';
    END IF;
    IF o.side = 'BUY' THEN
        IF NEW.max_spend_cents IS NULL OR NEW.max_spend_cents <= 0 OR NEW.max_spend_cents::numeric > o.original_quantity::numeric / 1000000 * o.limit_price_cents OR terms ->> 'maxSpendCents' IS DISTINCT FROM NEW.max_spend_cents::text THEN
            RAISE EXCEPTION 'invalid market BUY spending cap';
        END IF;
    ELSE
        IF NEW.max_spend_cents IS NOT NULL OR terms ? 'maxSpendCents' THEN
            RAISE EXCEPTION 'market SELL cannot have a cash spending cap';
        END IF;
    END IF;
    RETURN NEW;
END
$$;

--> statement-breakpoint
CREATE TRIGGER trading_order_policies_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.trading_order_policies
    FOR EACH ROW
    EXECUTE FUNCTION public.trading_policy_guard();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.trading_validate_order(p_id bigint)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    o public.trading_orders;
    b public.trading_books;
    c public.cash_reservations;
    p public.position_reservations;
    filled numeric;
    paid numeric;
    POLICY public.trading_order_policies;
    expected_hold numeric;
    expected_remaining numeric;
BEGIN
    SELECT
        *
    INTO
        STRICT o
    FROM
        public.trading_orders
    WHERE
        id = p_id;
    SELECT
        *
    INTO
        STRICT b
    FROM
        public.trading_books
    WHERE
        id = o.book_id;
    IF NOT EXISTS (
        SELECT
            1
        FROM
            public.financial_accounts a
            JOIN public.position_accounts p1 ON p1.id = o.position_account_id
        WHERE
            a.id = o.cash_account_id
            AND a.kind = 'CUSTOMER'
            AND a.asset = 'USD'
            AND p1.kind = 'CUSTOMER'
            AND a.owner_user_id = o.user_id
            AND p1.owner_user_id = o.user_id
            AND p1.token_id = b.token_id) THEN
        RAISE EXCEPTION 'order account ownership or token mismatch';
    END IF;
    IF NOT EXISTS (
        SELECT
            1
        FROM
            public.trading_commands cmd
        WHERE
            cmd.id = o.command_id
            AND cmd.action = 'PLACE'
            AND cmd.book_id = o.book_id
            AND cmd.sequence = o.priority_sequence
            AND cmd.actor = 'user:' || o.user_id::text
            AND cmd.terms @> jsonb_build_object(
                'marketId', b.market_id::text,
                'tokenId', b.token_id::text,
                'side', o.side,
                'quantity', o.original_quantity::text,
                'priceCents', o.limit_price_cents::text,
                'cashAccountId', o.cash_account_id::text,
                'positionAccountId', o.position_account_id::text
            )) THEN
        RAISE EXCEPTION 'order differs from authorized command';
    END IF;
    SELECT
        COALESCE(sum(f.quantity), 0),
        COALESCE(sum(f.quantity::numeric / 1000000 * f.price_cents), 0)
    INTO
        filled,
        paid
    FROM
        public.trading_fills f
    WHERE
        f.buyer_order_id = o.id
        OR f.seller_order_id = o.id;
    IF o.filled_quantity <> filled OR o.status = 'PENDING' OR (o.status = 'OPEN' AND (filled <> 0 OR o.cancelled_quantity <> 0)) OR (o.status = 'PARTIAL' AND (filled <= 0 OR o.remaining_quantity <= 0 OR o.cancelled_quantity <> 0)) OR (o.status = 'FILLED' AND (o.remaining_quantity <> 0 OR o.cancelled_quantity <> 0)) OR (o.status IN ('CANCELLED', 'EXPIRED', 'REJECTED') AND o.remaining_quantity <> 0) THEN
        RAISE EXCEPTION 'order quantities or state differ from immutable fills';
    END IF;
    SELECT
        *
    INTO
        POLICY
    FROM
        public.trading_order_policies
    WHERE
        order_id = o.id;
    IF EXISTS (
        SELECT
            1
        FROM
            public.trading_commands cmd
        WHERE
            cmd.id = o.command_id
            AND cmd.terms ->> 'orderType' = 'MARKET') IS DISTINCT FROM (policy.order_id IS NOT NULL) THEN
        RAISE EXCEPTION 'missing or fabricated market execution policy';
    END IF;
    IF policy.order_id IS NOT NULL AND EXISTS (
        SELECT
            1
        FROM
            public.matching_requests
        WHERE
            order_id = o.id
            AND resting = 'YES') THEN
        RAISE EXCEPTION 'IOC orders cannot become resting makers';
    END IF;
    IF o.status = 'REJECTED' THEN
        IF o.filled_quantity <> 0 OR o.cancelled_quantity <> o.original_quantity OR o.cash_reservation_id IS NOT NULL OR o.position_reservation_id IS NOT NULL THEN
            RAISE EXCEPTION 'invalid rejected order';
        END IF;
        RETURN;
    END IF;
    IF o.side = 'BUY' THEN
        SELECT
            *
        INTO
            STRICT c
        FROM
            public.cash_reservations
        WHERE
            id = o.cash_reservation_id;
        expected_hold := CASE WHEN policy.order_id IS NOT NULL THEN
            policy.max_spend_cents::numeric
        ELSE
            o.original_quantity::numeric / 1000000 * o.limit_price_cents
        END;
        expected_remaining := CASE WHEN policy.order_id IS NOT NULL THEN
            CASE WHEN o.status IN ('OPEN', 'PARTIAL') THEN
                expected_hold - paid
            ELSE
                0
            END
        ELSE
            o.remaining_quantity::numeric / 1000000 * o.limit_price_cents
        END;
        IF o.position_reservation_id IS NOT NULL OR c.account_id <> o.cash_account_id OR c.reference <> 'order:' || o.id::text OR c.amount::numeric <> expected_hold OR c.consumed::numeric <> paid OR (c.amount::numeric - c.consumed - c.released) <> expected_remaining THEN
            RAISE EXCEPTION 'order cash reservation mismatch';
        END IF;
    ELSE
        SELECT
            *
        INTO
            STRICT p
        FROM
            public.position_reservations
        WHERE
            id = o.position_reservation_id;
        IF o.cash_reservation_id IS NOT NULL OR p.account_id <> o.position_account_id OR p.reference <> 'order:' || o.id::text OR p.quantity <> o.original_quantity OR p.consumed <> o.filled_quantity OR p.released <> o.cancelled_quantity THEN
            RAISE EXCEPTION 'order position reservation mismatch';
        END IF;
    END IF;
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.trading_policy_audit()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
BEGIN
    PERFORM
        public.trading_validate_order(NEW.order_id);
    RETURN NULL;
END
$$;

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trading_order_policies_audit
    AFTER INSERT ON public.trading_order_policies DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.trading_policy_audit();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.trading_execute_foundation(p_actor text, p_action text, p_key text, p_terms jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    market public.markets;
    book public.trading_books;
    command public.trading_commands;
    prior public.trading_commands;
    o public.trading_orders;
    buy public.trading_orders;
    sell public.trading_orders;
    item record;
    v_result jsonb;
    accounting jsonb;
    q bigint;
    price bigint;
    hold bigint;
    released bigint;
    fill_id bigint;
    expected text[];
    user_id bigint;
BEGIN
    IF p_action = 'RECONCILE' THEN
        PERFORM
            pg_advisory_xact_lock(727190001);
    ELSE
        PERFORM
            pg_advisory_xact_lock_shared(727190001);
    END IF;
    IF p_actor IS NULL OR p_action IS NULL OR p_key IS NULL OR p_terms IS NULL OR p_actor !~ '^(user:[1-9][0-9]*|system:[a-z][a-z0-9_-]{0,60})$' OR p_key !~ '^[A-Za-z0-9:_-]{1,120}$' OR jsonb_typeof(p_terms) <> 'object' THEN
        RAISE EXCEPTION 'invalid trading request';
    END IF;
    IF p_action = 'RECOVER' THEN
        IF p_terms <> '{}'::jsonb THEN
            RAISE EXCEPTION 'invalid recovery request';
        END IF;
        SELECT
            *
        INTO
            prior
        FROM
            public.trading_commands
        WHERE
            operation_key = p_key;
        IF FOUND AND prior.actor <> p_actor THEN
            RAISE EXCEPTION 'command belongs to another actor'
                USING ERRCODE = '42501';
        END IF;
        RETURN CASE WHEN prior.id IS NULL THEN
            jsonb_build_object(
                'state', 'NOT_FOUND'
            )
        ELSE
            prior.result
        END;
    END IF;
    IF p_action = 'RECONCILE' THEN
        IF p_actor NOT LIKE 'system:%' OR p_terms <> '{}'::jsonb THEN
            RAISE EXCEPTION 'trading reconciliation requires system authorization'
                USING ERRCODE = '42501';
        END IF;
        v_result := public.financial_execute(p_actor, 'POSITION_RECONCILE', p_key, '{}'::jsonb);
        FOR item IN
        SELECT
            id
        FROM
            public.trading_orders LOOP
                PERFORM
                    public.trading_validate_order(item.id);
            END LOOP;
        FOR item IN
        SELECT
            id
        FROM
            public.trading_commands LOOP
                PERFORM
                    public.trading_validate_command(item.id);
            END LOOP;
        RETURN jsonb_build_object(
            'reconciled', TRUE,
            'accounting', v_result
        );
    END IF;
    expected := CASE p_action
    WHEN 'PLACE' THEN
        ARRAY['marketId', 'tokenId', 'side', 'quantity', 'priceCents', 'cashAccountId', 'positionAccountId']
    WHEN 'CANCEL' THEN
        ARRAY['orderId']
    WHEN 'EXPIRE' THEN
        ARRAY['orderId']
    WHEN 'FILL' THEN
        ARRAY['buyerOrderId', 'sellerOrderId', 'quantity', 'priceCents']
    END;
    IF expected IS NULL OR p_terms - expected <> '{}'::jsonb OR (
        SELECT
            count(*)
        FROM
            jsonb_object_keys(p_terms)) <> cardinality(expected) THEN
        RAISE EXCEPTION 'unsupported trading action or terms';
    END IF;
    IF p_action IN ('FILL', 'EXPIRE') AND p_actor NOT LIKE 'system:%' OR p_action IN ('PLACE', 'CANCEL') AND p_actor NOT LIKE 'user:%' THEN
        RAISE EXCEPTION 'trading actor capability denied'
            USING ERRCODE = '42501';
    END IF;
    SELECT
        *
    INTO
        prior
    FROM
        public.trading_commands
    WHERE
        operation_key = p_key;
    IF FOUND THEN
        IF prior.actor <> p_actor THEN
            RAISE EXCEPTION 'command belongs to another actor'
                USING ERRCODE = '42501';
        END IF;
        IF prior.action <> p_action OR prior.terms <> p_terms THEN
            RAISE EXCEPTION 'conflicting trading idempotency terms';
        END IF;
        RETURN prior.result;
    END IF;
    IF p_action = 'PLACE' THEN
        SELECT
            *
        INTO
            STRICT market
        FROM
            public.markets
        WHERE
            id =(p_terms ->> 'marketId')::uuid FOR SHARE;
    ELSE
        SELECT
            *
        INTO
            STRICT o
        FROM
            public.trading_orders
        WHERE
            id =(p_terms ->> CASE WHEN p_action = 'FILL' THEN
                    'buyerOrderId'
                ELSE
                    'orderId'
                END)::bigint;
        SELECT
            *
        INTO
            STRICT book
        FROM
            public.trading_books
        WHERE
            id = o.book_id;
        SELECT
            *
        INTO
            STRICT market
        FROM
            public.markets
        WHERE
            id = book.market_id FOR SHARE;
    END IF;
    IF p_action IN ('PLACE', 'FILL') AND (market.lifecycle_status <> 'ACTIVE' OR market.trading_status <> 'OPEN' OR market.resolution_status <> 'UNRESOLVED' OR market.terms_frozen_at IS NULL OR clock_timestamp() < market.trading_starts_at OR clock_timestamp() >= market.trading_ends_at) THEN
        RAISE EXCEPTION 'market closed, paused or trading cutoff reached';
    END IF;
    IF p_action = 'PLACE' THEN
        INSERT INTO public.trading_books(token_id, market_id)
            VALUES ((p_terms ->> 'tokenId')::bigint, market.id)
        ON CONFLICT (token_id)
            DO NOTHING;
        SELECT
            *
        INTO
            STRICT book
        FROM
            public.trading_books
        WHERE
            token_id =(p_terms ->> 'tokenId')::bigint
        FOR UPDATE;
        IF book.market_id <> market.id THEN
            RAISE EXCEPTION 'book market mismatch';
        END IF;
    ELSE
        SELECT
            *
        INTO
            STRICT book
        FROM
            public.trading_books
        WHERE
            id = book.id
        FOR UPDATE;
    END IF;
    IF p_action IN ('PLACE', 'FILL') AND clock_timestamp() >= market.trading_ends_at THEN
        RAISE EXCEPTION 'trading cutoff reached while waiting for book';
    END IF;
    -- Retry after the book lock: a concurrent identical command may have committed while waiting.
    SELECT
        *
    INTO
        prior
    FROM
        public.trading_commands
    WHERE
        operation_key = p_key;
    IF FOUND THEN
        IF prior.actor <> p_actor OR prior.action <> p_action OR prior.terms <> p_terms THEN
            RAISE EXCEPTION 'conflicting trading command';
        END IF;
        RETURN prior.result;
    END IF;
    UPDATE
        public.trading_books
    SET
        command_sequence = command_sequence + 1
    WHERE
        id = book.id
    RETURNING
        *
    INTO
        book;
    INSERT INTO public.trading_commands(book_id, SEQUENCE,
        operation_key,
        actor,
        action,
        terms)
VALUES (book.id,
    book.command_sequence,
    p_key,
    p_actor,
    p_action,
    p_terms)
RETURNING
    *
INTO
    command;
    IF p_action = 'PLACE' THEN
        user_id := substring(p_actor FROM 6)::bigint;
        IF jsonb_typeof(p_terms -> 'quantity') <> 'string' OR (p_terms ->> 'quantity') !~ '^[1-9][0-9]{0,18}$' OR jsonb_typeof(p_terms -> 'priceCents') <> 'string' OR (p_terms ->> 'priceCents') !~ '^[1-9][0-9]?$' THEN
            RAISE EXCEPTION 'invalid exact order quantity or price';
        END IF;
        q :=(p_terms ->> 'quantity')::bigint;
        price :=(p_terms ->> 'priceCents')::bigint;
        IF q % 1000000 <> 0 OR p_terms ->> 'side' NOT IN ('BUY', 'SELL') THEN
            RAISE EXCEPTION 'whole shares and BUY/SELL required';
        END IF;
        hold :=(q::numeric / 1000000 * price)::bigint;
        INSERT INTO public.trading_orders(book_id, command_id, user_id, side, limit_price_cents, original_quantity, priority_sequence, cash_account_id, position_account_id)
            VALUES (book.id, command.id, user_id, p_terms ->> 'side', price, q, book.command_sequence,(p_terms ->> 'cashAccountId')::bigint,(p_terms ->> 'positionAccountId')::bigint)
        RETURNING
            *
        INTO
            o;
        BEGIN
            IF o.side = 'BUY' THEN
                accounting := public.financial_execute(
                    p_actor,
                    'RESERVE',
                    command.id::text,
                    jsonb_build_object(
                        'accountId', o.cash_account_id::text,
                        'amount', hold::text,
                        'reference', 'order:' || o.id::text
                    )
                );
                UPDATE
                    public.trading_orders
                SET
                    cash_reservation_id =(accounting ->> 'reservationId')::bigint,
                    status = 'OPEN'
                WHERE
                    id = o.id;
            ELSE
                accounting := public.financial_execute(
                    p_actor,
                    'POSITION_RESERVE',
                    command.id::text,
                    jsonb_build_object(
                        'accountId', o.position_account_id::text,
                        'quantity', q::text,
                        'reference', 'order:' || o.id::text
                    )
                );
                UPDATE
                    public.trading_orders
                SET
                    position_reservation_id =(accounting ->> 'reservationId')::bigint,
                    status = 'OPEN'
                WHERE
                    id = o.id;
            END IF;
        EXCEPTION
            WHEN check_violation THEN
                IF SQLERRM NOT IN ('insufficient available funds', 'insufficient available positions') THEN
                    RAISE;
                    END IF;
                    UPDATE
                        public.trading_orders
                    SET
                        status = 'REJECTED',
                        cancelled_quantity = original_quantity
                    WHERE
                        id = o.id;
        END;
        PERFORM
            public.trading_emit(command.id, o.id, 'PLACE', 0::smallint);
            v_result := jsonb_build_object(
                'orderId', o.id::text,
                'bookId', book.id::text,
                'sequence', book.command_sequence::text,
                'status',(
                    SELECT
                        status
                    FROM public.trading_orders
                    WHERE
                        id = o.id)
            );
        ELSIF p_action IN ('CANCEL', 'EXPIRE') THEN
            SELECT
                *
            INTO
                STRICT o
            FROM
                public.trading_orders
            WHERE
                id = o.id
            FOR UPDATE;
            IF o.status NOT IN ('OPEN', 'PARTIAL') THEN
                RAISE EXCEPTION 'order is terminal';
                END IF;
                IF p_action = 'CANCEL' AND p_actor <> 'user:' || o.user_id::text THEN
                    RAISE EXCEPTION 'order access denied' USING ERRCODE = '42501';
                    END IF;
                    IF p_action = 'EXPIRE' AND clock_timestamp() < market.trading_ends_at THEN
                        RAISE EXCEPTION 'order has not expired';
                        END IF;
                        IF o.side = 'BUY' THEN
                            -- A partially filled IOC may have exhausted its entire authorized budget.
                            IF NOT EXISTS (
                                SELECT
                                    1
                                FROM
                                    public.trading_order_policies
                                WHERE
                                    order_id = o.id) OR (
                            SELECT
                                cr.amount - cr.consumed - cr.released
                            FROM
                                public.cash_reservations cr
                            WHERE
                                cr.id = o.cash_reservation_id) > 0 THEN
                                PERFORM
                                    public.financial_execute(
                                        'user:' || o.user_id::text,
                                        'CANCEL',
                                        command.id::text,
                                        jsonb_build_object(
                                            'reservationId', o.cash_reservation_id::text
                                        )
                                    );
                                END IF;
                            ELSE
                                PERFORM
                                    public.financial_execute(
                                        'user:' || o.user_id::text,
                                        'POSITION_CANCEL',
                                        command.id::text,
                                        jsonb_build_object(
                                            'reservationId', o.position_reservation_id::text
                                        )
                                    );
                            END IF;
                            UPDATE
                                public.trading_orders
                            SET
                                cancelled_quantity = cancelled_quantity + remaining_quantity,
                                status = CASE WHEN p_action = 'EXPIRE' THEN
                                    'EXPIRED'
                                ELSE
                                    'CANCELLED'
                                END
                            WHERE
                                id = o.id;
                                PERFORM
                                    public.trading_emit(command.id, o.id, p_action, 0::smallint);
                                    v_result := jsonb_build_object(
                                        'orderId', o.id::text
                                    );
                                ELSE
                                    PERFORM
                                        id
                                    FROM
                                        public.trading_orders
                                    WHERE
                                        id IN ((p_terms ->> 'buyerOrderId')::bigint,(p_terms ->> 'sellerOrderId')::bigint)
                                    ORDER BY
                                        id
                                    FOR UPDATE;
                                    SELECT
                                        *
                                    INTO
                                        STRICT buy
                                    FROM
                                        public.trading_orders
                                    WHERE
                                        id =(p_terms ->> 'buyerOrderId')::bigint;
                                        SELECT
                                            *
                                        INTO
                                            STRICT sell
                                        FROM
                                            public.trading_orders
                                        WHERE
                                            id =(p_terms ->> 'sellerOrderId')::bigint;
                                            IF buy.book_id <> book.id OR sell.book_id <> book.id OR buy.side <> 'BUY' OR sell.side <> 'SELL' OR buy.user_id = sell.user_id OR buy.status NOT IN ('OPEN', 'PARTIAL') OR sell.status NOT IN ('OPEN', 'PARTIAL') THEN
                                                RAISE EXCEPTION 'incompatible orders or self trade';
                                                END IF;
                                                IF jsonb_typeof(p_terms -> 'quantity') <> 'string' OR (p_terms ->> 'quantity') !~ '^[1-9][0-9]{0,18}$' OR jsonb_typeof(p_terms -> 'priceCents') <> 'string' OR (p_terms ->> 'priceCents') !~ '^[1-9][0-9]?$' THEN
                                                    RAISE EXCEPTION 'invalid exact fill units';
                                                    END IF;
                                                    q :=(p_terms ->> 'quantity')::bigint;
                                                    price :=(p_terms ->> 'priceCents')::bigint;
                                                    IF q % 1000000 <> 0 OR q > buy.remaining_quantity OR q > sell.remaining_quantity OR price > buy.limit_price_cents OR price < sell.limit_price_cents THEN
                                                        RAISE EXCEPTION 'fill exceeds quantity or price limits';
                                                        END IF;
                                                        accounting := public.financial_execute(
                                                            p_actor,
                                                            'SETTLE',
                                                            command.id::text,
                                                            jsonb_build_object(
                                                                'marketId', market.id::text,
                                                                'tokenId', book.token_id::text,
                                                                'buyerCashAccountId', buy.cash_account_id::text,
                                                                'sellerCashAccountId', sell.cash_account_id::text,
                                                                'buyerPositionAccountId', buy.position_account_id::text,
                                                                'sellerPositionAccountId', sell.position_account_id::text,
                                                                'cashReservationId', buy.cash_reservation_id::text,
                                                                'positionReservationId', sell.position_reservation_id::text,
                                                                'cashReservationReference', 'order:' || buy.id::text,
                                                                'positionReservationReference', 'order:' || sell.id::text,
                                                                'quantity', q::text,
                                                                'priceCents', price::text,
                                                                'matchReference', 'trading:' || command.id::text
                                                            )
                                                        );
                                                        released := CASE WHEN EXISTS (
                                                            SELECT
                                                                1
                                                            FROM
                                                                public.trading_order_policies
                                                            WHERE
                                                                order_id = buy.id) THEN
                                                            0
                                                        ELSE
                                                            (q::numeric / 1000000 *(buy.limit_price_cents - price))::bigint
                                                        END;
                                                        IF released > 0 THEN
                                                            PERFORM
                                                                public.financial_execute(
                                                                    'user:' || buy.user_id::text,
                                                                    'RELEASE',
                                                                    command.id::text || ':improvement',
                                                                    jsonb_build_object(
                                                                        'reservationId', buy.cash_reservation_id::text,
                                                                        'amount', released::text
                                                                    )
                                                                );
                                                            END IF;
                                                            UPDATE
                                                                public.trading_orders
                                                            SET
                                                                filled_quantity = filled_quantity + q,
                                                                status = CASE WHEN remaining_quantity = q THEN
                                                                    'FILLED'
                                                                ELSE
                                                                    'PARTIAL'
                                                                END
                                                            WHERE
                                                                id IN (buy.id, sell.id);
    INSERT INTO public.trading_fills(command_id, book_id, buyer_order_id, seller_order_id, settlement_id, quantity, price_cents)
        VALUES (command.id, book.id, buy.id, sell.id,(accounting ->> 'settlementId')::bigint, q, price)
    RETURNING
        id
    INTO
        fill_id;
        PERFORM
            public.trading_emit(command.id, buy.id, 'FILL', 0::smallint);
            PERFORM
                public.trading_emit(command.id, sell.id, 'FILL', 1::smallint);
                v_result := jsonb_build_object(
                    'fillId', fill_id::text,
                    'settlementId', accounting ->> 'settlementId',
                    'settlementScope', 'INTERNAL_LEDGER'
                );
    END IF;
    UPDATE
        public.trading_commands
    SET
        state = 'APPLIED',
        result = v_result
    WHERE
        id = command.id;
        RETURN v_result;
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.trading_accept_market(p_actor text, p_key text, p_terms jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    market public.markets;
    book public.trading_books;
    command public.trading_commands;
    o public.trading_orders;
    accounting jsonb;
    v_result jsonb;
    q bigint;
    price bigint;
    cap bigint;
BEGIN
    -- Only the authorized wrapper may call this private acceptance primitive.
    IF p_actor IS NULL OR p_actor !~ '^user:[1-9][0-9]*$' OR p_terms ->> 'orderType' IS DISTINCT FROM 'MARKET' OR p_terms ->> 'timeInForce' IS DISTINCT FROM 'IOC' THEN
        RAISE EXCEPTION 'invalid market order actor or policy';
    END IF;
    IF jsonb_typeof(p_terms -> 'quantity') <> 'string' OR p_terms ->> 'quantity' !~ '^[1-9][0-9]{0,18}$' OR jsonb_typeof(p_terms -> 'priceCents') <> 'string' OR p_terms ->> 'priceCents' !~ '^[1-9][0-9]?$' THEN
        RAISE EXCEPTION 'invalid exact market order units';
    END IF;
    q :=(p_terms ->> 'quantity')::bigint;
    price :=(p_terms ->> 'priceCents')::bigint;
    IF q % 1000000 <> 0 OR p_terms ->> 'side' NOT IN ('BUY', 'SELL') THEN
        RAISE EXCEPTION 'whole shares and BUY/SELL required';
    END IF;
    IF p_terms ->> 'side' = 'BUY' THEN
        IF jsonb_typeof(p_terms -> 'maxSpendCents') <> 'string' OR p_terms ->> 'maxSpendCents' !~ '^[1-9][0-9]{0,18}$' THEN
            RAISE EXCEPTION 'market BUY requires an exact spending cap';
        END IF;
        cap :=(p_terms ->> 'maxSpendCents')::bigint;
        IF cap <= 0 OR cap::numeric > q::numeric / 1000000 * price THEN
            RAISE EXCEPTION 'invalid market BUY spending cap';
        END IF;
    ELSIF p_terms ? 'maxSpendCents' THEN
        RAISE EXCEPTION 'market SELL cannot have a spending cap';
    END IF;
    SELECT
        *
    INTO
        STRICT market
    FROM
        public.markets
    WHERE
        id =(p_terms ->> 'marketId')::uuid FOR SHARE;
    IF market.lifecycle_status <> 'ACTIVE' OR market.trading_status <> 'OPEN' OR market.resolution_status <> 'UNRESOLVED' OR market.terms_frozen_at IS NULL OR clock_timestamp() < market.trading_starts_at OR clock_timestamp() >= market.trading_ends_at THEN
        RAISE EXCEPTION 'market closed, paused or trading cutoff reached';
    END IF;
    INSERT INTO public.trading_books(token_id, market_id)
        VALUES ((p_terms ->> 'tokenId')::bigint, market.id)
    ON CONFLICT (token_id)
        DO NOTHING;
    SELECT
        *
    INTO
        STRICT book
    FROM
        public.trading_books
    WHERE
        token_id =(p_terms ->> 'tokenId')::bigint
    FOR UPDATE;
    IF book.market_id <> market.id OR clock_timestamp() >= market.trading_ends_at THEN
        RAISE EXCEPTION 'market book mismatch or cutoff reached';
    END IF;
    UPDATE
        public.trading_books
    SET
        command_sequence = command_sequence + 1
    WHERE
        id = book.id
    RETURNING
        *
    INTO
        book;
    INSERT INTO public.trading_commands(book_id, SEQUENCE,
        operation_key,
        actor,
        action,
        terms)
VALUES (book.id,
    book.command_sequence,
    p_key,
    p_actor,
    'PLACE',
    p_terms)
RETURNING
    *
INTO
    command;
    INSERT INTO public.trading_orders(book_id, command_id, user_id, side, limit_price_cents, original_quantity, priority_sequence, cash_account_id, position_account_id)
        VALUES (book.id, command.id, substring(p_actor FROM 6)::bigint, p_terms ->> 'side', price, q, book.command_sequence,(p_terms ->> 'cashAccountId')::bigint,(p_terms ->> 'positionAccountId')::bigint)
    RETURNING
        *
    INTO
        o;
    INSERT INTO public.trading_order_policies(order_id, order_type, time_in_force, max_spend_cents)
        VALUES (o.id, 'MARKET', 'IOC', cap);
    BEGIN
        IF o.side = 'BUY' THEN
            accounting := public.financial_execute(
                p_actor,
                'RESERVE',
                command.id::text,
                jsonb_build_object(
                    'accountId', o.cash_account_id::text,
                    'amount', cap::text,
                    'reference', 'order:' || o.id::text
                )
            );
            UPDATE
                public.trading_orders
            SET
                cash_reservation_id =(accounting ->> 'reservationId')::bigint,
                status = 'OPEN'
            WHERE
                id = o.id;
        ELSE
            accounting := public.financial_execute(
                p_actor,
                'POSITION_RESERVE',
                command.id::text,
                jsonb_build_object(
                    'accountId', o.position_account_id::text,
                    'quantity', q::text,
                    'reference', 'order:' || o.id::text
                )
            );
            UPDATE
                public.trading_orders
            SET
                position_reservation_id =(accounting ->> 'reservationId')::bigint,
                status = 'OPEN'
            WHERE
                id = o.id;
        END IF;
    EXCEPTION
        WHEN check_violation THEN
            IF SQLERRM NOT IN ('insufficient available funds', 'insufficient available positions') THEN
                RAISE;
                END IF;
                UPDATE
                    public.trading_orders
                SET
                    status = 'REJECTED',
                    cancelled_quantity = original_quantity
                WHERE
                    id = o.id;
    END;
    PERFORM
        public.trading_emit(command.id, o.id, 'PLACE', 0::smallint);
        v_result := jsonb_build_object(
            'orderId', o.id::text,
            'bookId', book.id::text,
            'sequence', book.command_sequence::text,
            'status',(
                SELECT
                    status
                FROM public.trading_orders
                WHERE
                    id = o.id)
        );
        UPDATE
            public.trading_commands
        SET
            state = 'APPLIED',
            result = v_result
        WHERE
            id = command.id;
            RETURN v_result;
END
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.trading_execute(p_actor text, p_action text, p_key text, p_terms jsonb)
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
    IF p_action = 'PLACE_MARKET' THEN
        IF p_terms - ARRAY['marketId', 'tokenId', 'side', 'quantity', 'priceCents', 'cashAccountId', 'positionAccountId', 'maxSpendCents'] <> '{}'::jsonb OR (
            SELECT
                count(*)
            FROM
                jsonb_object_keys(p_terms)) <>(
    CASE WHEN p_terms ->> 'side' = 'BUY' THEN
        8
    ELSE
        7
    END)
    OR NOT p_terms ?& ARRAY['marketId', 'tokenId', 'side', 'quantity', 'priceCents', 'cashAccountId', 'positionAccountId'] THEN
    RAISE EXCEPTION 'invalid market order terms';
        END IF;
        IF p_terms ->> 'side' = 'SELL' AND p_terms ? 'maxSpendCents' THEN
            RAISE EXCEPTION 'market SELL cannot have a spending cap';
        END IF;
        p_action := 'PLACE';
        p_terms := p_terms || jsonb_build_object(
            'orderType', 'MARKET',
            'timeInForce', 'IOC'
        );
    ELSIF p_action = 'PLACE'
            AND (p_terms - ARRAY['marketId', 'tokenId', 'side', 'quantity', 'priceCents', 'cashAccountId', 'positionAccountId'] <> '{}'::jsonb
                OR (
                    SELECT
                        count(*)
                    FROM
                        jsonb_object_keys(p_terms)) <> 7) THEN
            RAISE EXCEPTION 'invalid limit order terms';
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
        IF p_terms ->> 'orderType' = 'MARKET' THEN
            receipt := public.trading_accept_market(p_actor, p_key, p_terms);
        ELSE
            receipt := public.trading_execute_foundation(p_actor, p_action, p_key, p_terms);
        END IF;
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
CREATE OR REPLACE FUNCTION public.matching_step(p_actor text, p_market uuid)
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
    POLICY public.trading_order_policies;
    q bigint;
    cash_left bigint;
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
    SELECT
        *
    INTO
        POLICY
    FROM
        public.trading_order_policies
    WHERE
        order_id = taker.id;
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
        IF policy.order_id IS NOT NULL THEN
            result := public.trading_execute_foundation(
                'user:' || taker.user_id::text,
                'CANCEL',
                op || ':ioc',
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
                'reason', 'IOC_UNFILLED',
                'result', result
            );
        END IF;
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
    q := least(taker.remaining_quantity, maker.remaining_quantity);
    IF policy.order_id IS NOT NULL AND taker.side = 'BUY' THEN
        SELECT
            cr.amount - cr.consumed - cr.released
        INTO
            STRICT cash_left
        FROM
            public.cash_reservations cr
        WHERE
            cr.id = taker.cash_reservation_id;
        q := least(q::numeric, floor(cash_left::numeric / maker.limit_price_cents) * 1000000)::bigint;
        IF q = 0 THEN
            result := public.trading_execute_foundation(
                'user:' || taker.user_id::text,
                'CANCEL',
                op || ':budget',
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
                'reason', 'IOC_SPENDING_CAP',
                'result', result
            );
        END IF;
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
            'quantity', q::text,
            'priceCents', maker.limit_price_cents::text
        )
    );
    IF policy.order_id IS NOT NULL AND taker.side = 'BUY' AND q = taker.remaining_quantity THEN
        SELECT
            cr.amount - cr.consumed - cr.released
        INTO
            STRICT cash_left
        FROM
            public.cash_reservations cr
        WHERE
            cr.id = taker.cash_reservation_id;
        IF cash_left > 0 THEN
            PERFORM
                public.financial_execute(
                    'user:' || taker.user_id::text,
                    'RELEASE',
                    op || ':finalcash',
                    jsonb_build_object(
                        'reservationId', taker.cash_reservation_id::text,
                        'amount', cash_left::text
                    )
                );
        END IF;
    END IF;
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
            WHEN c.operation_key LIKE 'engine:%:ioc' THEN
                'IOC_UNFILLED'
            WHEN c.operation_key LIKE 'engine:%:budget' THEN
                'IOC_SPENDING_CAP'
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
CREATE OR REPLACE FUNCTION public.matching_validate_request(p_id uuid)
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
    IF r.resting = 'YES' AND EXISTS (
        SELECT
            1
        FROM
            public.trading_order_policies
        WHERE
            order_id = o.id) THEN
        RAISE EXCEPTION 'IOC orders cannot become resting makers';
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
REVOKE ALL ON TABLE public.trading_order_policies FROM PUBLIC;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trading_policy_guard(), public.trading_policy_audit(), public.trading_accept_market(text, text, jsonb) FROM PUBLIC;

--> statement-breakpoint
-- STABLE shares one committed MVCC snapshot throughout estimation. It grants no execution authority.
CREATE FUNCTION public.matching_quote(p_actor text, p_terms jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    market public.markets;
    book public.trading_books;
    maker record;
    q bigint;
    price bigint;
    cap bigint;
    remaining bigint;
    take bigint;
    total numeric := 0;
    best bigint;
    worst bigint;
    reason text;
    v_side text;
    expected integer;
BEGIN
    IF p_actor IS NULL OR p_actor !~ '^user:[1-9][0-9]*$' OR p_terms IS NULL OR jsonb_typeof(p_terms) <> 'object' THEN
        RAISE EXCEPTION 'quote requires an authorized user and exact terms'
            USING ERRCODE = '42501';
    END IF;
    v_side := p_terms ->> 'side';
    expected := CASE WHEN v_side = 'BUY' THEN
        6
    ELSE
        5
    END;
    IF v_side NOT IN ('BUY', 'SELL') OR v_side IS NULL OR p_terms - ARRAY['marketId', 'tokenId', 'side', 'quantity', 'priceCents', 'maxSpendCents'] <> '{}'::jsonb OR (
        SELECT
            count(*)
        FROM
            jsonb_object_keys(p_terms)) <> expected OR NOT p_terms ?& ARRAY['marketId', 'tokenId', 'side', 'quantity', 'priceCents'] THEN
        RAISE EXCEPTION 'invalid quote terms';
    END IF;
    IF jsonb_typeof(p_terms -> 'quantity') <> 'string' OR p_terms ->> 'quantity' !~ '^[1-9][0-9]{0,18}$' OR jsonb_typeof(p_terms -> 'priceCents') <> 'string' OR p_terms ->> 'priceCents' !~ '^[1-9][0-9]?$' THEN
        RAISE EXCEPTION 'invalid exact quote units';
    END IF;
    q :=(p_terms ->> 'quantity')::bigint;
    price :=(p_terms ->> 'priceCents')::bigint;
    remaining := q;
    IF q % 1000000 <> 0 THEN
        RAISE EXCEPTION 'quote requires whole shares';
    END IF;
    IF v_side = 'BUY' THEN
        IF jsonb_typeof(p_terms -> 'maxSpendCents') <> 'string' OR p_terms ->> 'maxSpendCents' !~ '^[1-9][0-9]{0,18}$' THEN
            RAISE EXCEPTION 'quote BUY requires a spending cap';
        END IF;
        cap :=(p_terms ->> 'maxSpendCents')::bigint;
        IF cap IS NULL OR cap <= 0 OR cap::numeric > q::numeric / 1000000 * price THEN
            RAISE EXCEPTION 'invalid quote spending cap';
        END IF;
    ELSIF p_terms ? 'maxSpendCents' THEN
        RAISE EXCEPTION 'quote SELL cannot have a spending cap';
    END IF;
    SELECT
        *
    INTO
        STRICT market
    FROM
        public.markets
    WHERE
        id =(p_terms ->> 'marketId')::uuid;
    IF NOT EXISTS (
        SELECT
            1
        FROM
            public.ctf_position_tokens t
            JOIN public.ctf_conditions c ON c.id = t.condition_id
            JOIN public.market_questions mq ON mq.id = c.market_question_id
        WHERE
            t.id =(p_terms ->> 'tokenId')::bigint
            AND mq.market_id = market.id) THEN
        RAISE EXCEPTION 'quote token market mismatch';
    END IF;
    SELECT
        *
    INTO
        book
    FROM
        public.trading_books
    WHERE
        token_id =(p_terms ->> 'tokenId')::bigint;
    IF market.lifecycle_status <> 'ACTIVE' OR market.trading_status <> 'OPEN' OR market.resolution_status <> 'UNRESOLVED' OR market.terms_frozen_at IS NULL OR statement_timestamp() < market.trading_starts_at OR statement_timestamp() >= market.trading_ends_at THEN
        reason := 'MARKET_CLOSED';
    ELSE
        FOR maker IN
        SELECT
            o.*
        FROM
            public.trading_orders o
            JOIN public.matching_requests mr ON mr.order_id = o.id
                AND mr.action = 'PLACE'
        WHERE
            o.book_id = book.id
            AND o.side <> v_side
            AND o.status IN ('OPEN', 'PARTIAL')
            AND mr.state = 'DONE'
            AND mr.resting = 'YES'
        ORDER BY
            CASE WHEN v_side = 'BUY' THEN
                o.limit_price_cents
            ELSE
                - o.limit_price_cents
            END,
            mr.sequence,
            o.id LOOP
                IF best IS NULL THEN
                    best := maker.limit_price_cents;
                END IF;
                IF (v_side = 'BUY' AND maker.limit_price_cents > price) OR (v_side = 'SELL' AND maker.limit_price_cents < price) THEN
                    reason := 'PRICE_PROTECTION';
                    EXIT;
                END IF;
                IF 'user:' || maker.user_id::text = p_actor THEN
                    reason := 'SELF_TRADE_PREVENTION';
                    EXIT;
                END IF;
                take := least(remaining, maker.remaining_quantity);
                IF v_side = 'BUY' THEN
                    take := least(take::numeric, floor((cap::numeric - total) / maker.limit_price_cents) * 1000000)::bigint;
                END IF;
                IF take = 0 THEN
                    reason := 'SPENDING_CAP';
                    EXIT;
                END IF;
                total := total + take::numeric / 1000000 * maker.limit_price_cents;
                remaining := remaining - take;
                worst := maker.limit_price_cents;
                EXIT
                WHEN remaining = 0;
            END LOOP;
    END IF;
    RETURN jsonb_build_object(
        'requestedQuantity', q::text,
        'estimatedExecutableQuantity',(q - remaining)::text,
        'estimatedUnfilledQuantity', remaining::text,
        'bestAvailablePriceCents', best::text,
        'estimatedAverageExecutionPriceCents', CASE WHEN q = remaining THEN
            NULL
        ELSE
            jsonb_build_object(
                'numerator', total::bigint::text,
                'denominator',((q - remaining) / 1000000)::text
            )
        END,
        'estimatedWorstExecutionPriceCents', worst::text,
        'estimatedTotalCents', total::bigint::text,
        'priceProtectionCents', price::text,
        'maxSpendCents', cap::text,
        'bookVersion', coalesce(book.command_sequence, 0)::text,
        'snapshotId', pg_current_snapshot()::text,
        'generatedAt', statement_timestamp(),
        'indicative', TRUE,
        'stoppedReason', CASE WHEN remaining = 0 THEN
            'FILLED_ESTIMATE'
        ELSE
            coalesce(reason, 'INSUFFICIENT_LIQUIDITY')
        END
    );
END
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.matching_quote(text, jsonb) FROM PUBLIC;
