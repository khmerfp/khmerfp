-- READING COPY ONLY: do not execute or use as a migration.
-- Executable source: packages/db/migrations/0019_recurring_market_lifecycle.sql
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
CREATE TABLE "market_lifecycle_cursors"(
    "consumer" text NOT NULL,
    "template_id" uuid NOT NULL,
    "sequence" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "market_lifecycle_cursors_consumer_template_id_pk" PRIMARY KEY ("consumer", "template_id"),
    CONSTRAINT "market_lifecycle_cursors_identity_check" CHECK ("market_lifecycle_cursors"."consumer" ~ '^system:[a-z][a-z0-9_-]{0,60}$' AND "market_lifecycle_cursors"."sequence" >= 0)
);

--> statement-breakpoint
CREATE TABLE "market_lifecycle_events"(
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "template_id" uuid NOT NULL,
    "market_id" uuid,
    "sequence" bigint NOT NULL,
    "operation_key" text NOT NULL,
    "kind" text NOT NULL,
    "code" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "market_lifecycle_events_operation_key_unique" UNIQUE ("operation_key"),
    CONSTRAINT "market_lifecycle_events_sequence_key" UNIQUE ("template_id", "sequence"),
    CONSTRAINT "market_lifecycle_events_sequence_check" CHECK ("market_lifecycle_events"."sequence" > 0)
);

--> statement-breakpoint
CREATE TABLE "market_round_observations"(
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "market_id" uuid NOT NULL,
    "kind" text NOT NULL,
    "observed_at" timestamp with time zone NOT NULL,
    "value" numeric(78, 0),
    "evidence_ref" text NOT NULL,
    "is_final" boolean NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "market_round_observations_evidence_key" UNIQUE ("market_id", "kind", "evidence_ref"),
    CONSTRAINT "market_round_observations_value_check" CHECK (("market_round_observations"."value" IS NULL OR scale("market_round_observations"."value") = 0) AND length(btrim("market_round_observations"."evidence_ref")) > 0)
);

--> statement-breakpoint
CREATE TABLE "market_round_requirements"(
    "market_id" uuid NOT NULL,
    "kind" text NOT NULL,
    "source_id" text NOT NULL,
    "unit" text NOT NULL,
    "decimals" integer NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "window_end" timestamp with time zone NOT NULL,
    "expected_available_at" timestamp with time zone NOT NULL,
    "revision_policy" text NOT NULL,
    CONSTRAINT "market_round_requirements_market_id_kind_pk" PRIMARY KEY ("market_id", "kind"),
    CONSTRAINT "market_round_requirements_terms_check" CHECK ("market_round_requirements"."kind" IN ('OPEN', 'CLOSE', 'RESULT') AND "market_round_requirements"."decimals" BETWEEN 0 AND 18 AND "market_round_requirements"."window_end" >= "market_round_requirements"."window_start" AND "market_round_requirements"."revision_policy" IN ('NO_REVISIONS', 'REQUIRE_FINAL') AND length(btrim("market_round_requirements"."source_id")) > 0 AND length(btrim("market_round_requirements"."unit")) > 0)
);

--> statement-breakpoint
CREATE TABLE "market_rounds"(
    "market_id" uuid PRIMARY KEY NOT NULL,
    "template_id" uuid NOT NULL,
    "ordinal" bigint NOT NULL,
    "opens_at" timestamp with time zone NOT NULL,
    "cutoff_at" timestamp with time zone NOT NULL,
    "observation_start" timestamp with time zone NOT NULL,
    "observation_end" timestamp with time zone NOT NULL,
    "expected_available_at" timestamp with time zone NOT NULL,
    "missed" boolean NOT NULL,
    "expiration_complete" boolean DEFAULT FALSE NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "market_rounds_template_ordinal_key" UNIQUE ("template_id", "ordinal"),
    CONSTRAINT "market_rounds_boundaries_check" CHECK ("market_rounds"."ordinal" >= 0 AND "market_rounds"."cutoff_at" > "market_rounds"."opens_at" AND "market_rounds"."observation_end" >= "market_rounds"."observation_start" AND "market_rounds"."expected_available_at" >= "market_rounds"."observation_end")
);

--> statement-breakpoint
CREATE TABLE "market_template_controls"(
    "template_id" uuid PRIMARY KEY NOT NULL,
    "template_key" text NOT NULL,
    "enabled" boolean DEFAULT FALSE NOT NULL,
    "next_ordinal" bigint DEFAULT 0 NOT NULL,
    "next_at" timestamp with time zone,
    "duplicate_attempts" bigint DEFAULT 0 NOT NULL,
    "failure_count" bigint DEFAULT 0 NOT NULL,
    "last_error" text,
    CONSTRAINT "market_template_controls_counters_check" CHECK ("market_template_controls"."next_ordinal" >= 0 AND "market_template_controls"."duplicate_attempts" >= 0 AND "market_template_controls"."failure_count" >= 0)
);

--> statement-breakpoint
CREATE TABLE "market_templates"(
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "template_key" text NOT NULL,
    "version" integer NOT NULL,
    "category_id" bigint NOT NULL,
    "ctf_deployment_id" bigint NOT NULL,
    "oracle_deployment_id" bigint NOT NULL,
    "collateral_asset_id" bigint NOT NULL,
    "definition" jsonb NOT NULL,
    "registry_identity" jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "market_templates_key_version_key" UNIQUE ("template_key", "version"),
    CONSTRAINT "market_templates_id_key_key" UNIQUE ("id", "template_key"),
    CONSTRAINT "market_templates_version_check" CHECK ("market_templates"."version" > 0 AND "market_templates"."template_key" ~ '^[a-z0-9][a-z0-9_-]{0,99}$'),
    CONSTRAINT "market_templates_scope_check" CHECK (jsonb_typeof("market_templates"."definition") = 'object' AND coalesce("market_templates"."definition" ->> 'scope', '') = 'MOCK_ONLY')
);

--> statement-breakpoint
ALTER TABLE "market_lifecycle_cursors"
    ADD CONSTRAINT "market_lifecycle_cursors_template_id_market_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."market_templates"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "market_lifecycle_events"
    ADD CONSTRAINT "market_lifecycle_events_template_id_market_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."market_templates"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "market_lifecycle_events"
    ADD CONSTRAINT "market_lifecycle_events_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "market_round_observations"
    ADD CONSTRAINT "market_round_observations_requirement_fk" FOREIGN KEY ("market_id", "kind") REFERENCES "public"."market_round_requirements"("market_id", "kind") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "market_round_requirements"
    ADD CONSTRAINT "market_round_requirements_market_id_market_rounds_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."market_rounds"("market_id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "market_rounds"
    ADD CONSTRAINT "market_rounds_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "market_rounds"
    ADD CONSTRAINT "market_rounds_template_id_market_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."market_templates"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "market_template_controls"
    ADD CONSTRAINT "market_template_controls_template_id_market_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."market_templates"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "market_template_controls"
    ADD CONSTRAINT "market_template_controls_identity_fk" FOREIGN KEY ("template_id", "template_key") REFERENCES "public"."market_templates"("id", "template_key") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "market_templates"
    ADD CONSTRAINT "market_templates_category_id_market_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."market_categories"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "market_templates"
    ADD CONSTRAINT "market_templates_ctf_deployment_id_contract_deployments_id_fk" FOREIGN KEY ("ctf_deployment_id") REFERENCES "public"."contract_deployments"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "market_templates"
    ADD CONSTRAINT "market_templates_oracle_deployment_fk" FOREIGN KEY ("oracle_deployment_id") REFERENCES "public"."contract_deployments"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "market_templates"
    ADD CONSTRAINT "market_templates_collateral_asset_id_chain_assets_id_fk" FOREIGN KEY ("collateral_asset_id") REFERENCES "public"."chain_assets"("id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint
CREATE INDEX "market_rounds_cutoff_idx" ON "market_rounds" USING btree("expiration_complete", "cutoff_at");

--> statement-breakpoint
CREATE UNIQUE INDEX "market_template_controls_enabled_key" ON "market_template_controls" USING btree("template_key")
WHERE
    "market_template_controls"."enabled";

--> statement-breakpoint
CREATE INDEX "market_template_controls_due_idx" ON "market_template_controls" USING btree("enabled", "next_at");

--> statement-breakpoint
-- Calendar evaluation is database-owned. UTC instants are stored on each frozen round.
CREATE FUNCTION public.market_schedule_time(p_definition jsonb, p_ordinal bigint)
    RETURNS timestamptz
    LANGUAGE plpgsql
    STABLE
    SET search_path = pg_catalog
    AS $$
DECLARE
    cfg jsonb := p_definition -> 'schedule';
    mode text := cfg ->> 'mode';
    zone text := cfg ->> 'timezone';
    local_time timestamp;
    candidate timestamptz;
    matches integer;
BEGIN
    IF p_ordinal IS NULL OR p_ordinal < 0 OR p_ordinal > 1000000 THEN
        RAISE EXCEPTION 'invalid bounded schedule ordinal';
    END IF;
    IF mode = 'ONCE' AND p_ordinal > 0 THEN
        RETURN NULL;
    END IF;
    IF NOT EXISTS (
        SELECT
            1
        FROM
            pg_timezone_names
        WHERE
            name = zone) OR (zone <> 'UTC' AND position('/' IN zone) = 0) THEN
        RAISE EXCEPTION 'a named schedule timezone is required';
    END IF;
    local_time :=(cfg ->> 'anchorLocal')::timestamp;
    IF mode = 'MONTHLY' THEN
        local_time := local_time + make_interval(months =>((cfg ->> 'months')::integer * p_ordinal)::integer);
    ELSIF mode = 'WEEKLY' THEN
        local_time := local_time + make_interval(days =>(7 * p_ordinal)::integer);
    ELSIF mode NOT IN ('ONCE', 'FIXED') THEN
        RAISE EXCEPTION 'unsupported schedule mode';
    END IF;
    -- Enumerate nearby timezone offsets and require one exact local-time interpretation.
    -- Ambiguous and nonexistent DST boundary times are rejected, not silently shifted.
    SELECT
        count(*),
        min(utc_time)
    INTO
        matches,
        candidate
    FROM ( SELECT DISTINCT
            (local_time AT TIME ZONE 'UTC') - offset_value AS utc_time
        FROM ( SELECT DISTINCT
                (sample AT TIME ZONE zone) -(sample AT TIME ZONE 'UTC') AS offset_value
            FROM
                generate_series((local_time AT TIME ZONE 'UTC') - interval '48 hours',(local_time AT TIME ZONE 'UTC') + interval '48 hours', interval '1 hour') sample) offsets) candidates
WHERE
    utc_time AT TIME ZONE zone = local_time;
    IF matches <> 1 THEN
        RAISE EXCEPTION 'ambiguous or nonexistent local schedule boundary';
    END IF;
    IF mode = 'FIXED' THEN
        candidate := candidate + make_interval(secs =>(cfg ->> 'stepSeconds')::double precision * p_ordinal);
    END IF;
    RETURN candidate;
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.market_schedule_registry(p_ctf bigint, p_oracle bigint, p_collateral bigint)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    c public.contract_deployments;
    o public.contract_deployments;
    a public.chain_assets;
BEGIN
    SELECT
        *
    INTO
        STRICT c
    FROM
        public.contract_deployments
    WHERE
        id = p_ctf;
    SELECT
        *
    INTO
        STRICT o
    FROM
        public.contract_deployments
    WHERE
        id = p_oracle;
    SELECT
        *
    INTO
        STRICT a
    FROM
        public.chain_assets
    WHERE
        id = p_collateral;
    IF c.contract_role <> 'GNOSIS_CTF' OR o.contract_role <> 'ORACLE' OR c.deployment_status <> 'CONFIRMED' OR o.deployment_status <> 'CONFIRMED' OR c.contract_address IS NULL OR o.contract_address IS NULL OR a.asset_type <> 'ERC20' OR a.decimals <> 6 OR o.chain_id <> c.chain_id OR a.chain_id <> c.chain_id OR NOT EXISTS (
        SELECT
            1
        FROM
            public.chains
        WHERE
            chain_id = c.chain_id
            AND environment = 'testnet') THEN
        RAISE EXCEPTION 'schedule requires reviewed mock testnet registry references';
    END IF;
    RETURN jsonb_build_object(
        'chainId', c.chain_id::text,
        'ctfAddress', c.contract_address,
        'oracleAddress', o.contract_address,
        'collateralAddress', a.contract_address
    );
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.market_schedule_validate_definition(p_def jsonb)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $$
DECLARE
    cfg jsonb := p_def -> 'schedule';
    field text;
    n integer;
BEGIN
    IF jsonb_typeof(p_def) IS DISTINCT FROM 'object' OR p_def - ARRAY['scope', 'title', 'description', 'marketType', 'schedule', 'outcomes', 'observation', 'rules', 'ruleVersion', 'requireOther'] <> '{}'::jsonb OR p_def ->> 'scope' IS DISTINCT FROM 'MOCK_ONLY' OR p_def ->> 'marketType' NOT IN ('BINARY', 'CATEGORICAL', 'PRICE_RANGE') OR p_def ->> 'marketType' IS NULL OR coalesce(length(btrim(p_def ->> 'title')), 0)
        NOT BETWEEN 1 AND 255 OR coalesce(length(btrim(p_def ->> 'rules')), 0) = 0 OR coalesce(length(btrim(p_def ->> 'ruleVersion')), 0) = 0 OR coalesce(length(btrim(p_def ->> 'description')), 0) = 0 THEN
        RAISE EXCEPTION 'incomplete immutable mock market definition';
    END IF;
    IF jsonb_typeof(cfg) IS DISTINCT FROM 'object' OR cfg ->> 'mode' IS NULL OR cfg ->> 'durationMode' NOT IN ('SECONDS', 'NEXT_OCCURRENCE') OR cfg ->> 'durationMode' IS NULL OR cfg ->> 'anchorLocal' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$' OR cfg ->> 'anchorLocal' IS NULL OR cfg ->> 'dstPolicy' IS DISTINCT FROM 'REJECT' THEN
        RAISE EXCEPTION 'explicit bounded schedule terms are required';
    END IF;
    FOREACH field IN ARRAY ARRAY['stepSeconds', 'months', 'tradingSeconds', 'observationStartOffset', 'observationEndOffset', 'resultDelaySeconds', 'resolutionDelaySeconds', 'lookaheadSeconds', 'openingGraceSeconds'] LOOP
        IF jsonb_typeof(cfg -> field) IS DISTINCT FROM 'string' OR cfg ->> field !~ '^[0-9]{1,8}$' THEN
            RAISE EXCEPTION 'exact nonnegative schedule integer required: %', field;
        END IF;
    END LOOP;
    IF (cfg ->> 'stepSeconds')::integer NOT BETWEEN 1 AND 31536000 OR (cfg ->> 'months')::integer NOT BETWEEN 1 AND 12 OR (cfg ->> 'tradingSeconds')::integer NOT BETWEEN 1 AND 31536000 OR (cfg ->> 'lookaheadSeconds')::integer NOT BETWEEN 1 AND 86400 OR (cfg ->> 'openingGraceSeconds')::integer NOT BETWEEN 0 AND 60 OR (cfg ->> 'resolutionDelaySeconds')::integer <(cfg ->> 'resultDelaySeconds')::integer OR (cfg ->> 'observationEndOffset')::integer >(cfg ->> 'resultDelaySeconds')::integer OR (cfg ->> 'mode' = 'ONCE' AND cfg ->> 'durationMode' = 'NEXT_OCCURRENCE') THEN
        RAISE EXCEPTION 'invalid schedule boundaries or availability policy';
    END IF;
    IF jsonb_typeof(p_def -> 'outcomes') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'outcome definitions are required';
    END IF;
    n := jsonb_array_length(p_def -> 'outcomes');
    IF n NOT BETWEEN 2 AND 256 OR (p_def ->> 'marketType' = 'BINARY' AND (n <> 2 OR p_def #>> '{outcomes,0,label}' IS DISTINCT FROM 'YES' OR p_def #>> '{outcomes,1,label}' IS DISTINCT FROM 'NO')) THEN
        RAISE EXCEPTION 'invalid atomic outcomes';
    END IF;
    IF EXISTS (
        SELECT
            1
        FROM
            jsonb_array_elements(p_def -> 'outcomes') e
        WHERE
            coalesce(length(btrim(e ->> 'label')), 0)
            NOT BETWEEN 1 AND 255) OR (
    SELECT
        count(DISTINCT e ->> 'label')
    FROM
        jsonb_array_elements(p_def -> 'outcomes') e) <> n THEN
        RAISE EXCEPTION 'outcome labels must be nonempty and distinct';
    END IF;
    IF p_def ->> 'requireOther' = 'true' AND NOT EXISTS (
        SELECT
            1
        FROM
            jsonb_array_elements(p_def -> 'outcomes') e
        WHERE
            e ->> 'label' = 'OTHER') THEN
        RAISE EXCEPTION 'explicit OTHER outcome required by fixture';
    END IF;
    IF coalesce(length(btrim(p_def #>> '{observation,sourceId}')), 0) = 0 OR coalesce(length(btrim(p_def #>> '{observation,unit}')), 0) = 0 OR coalesce(length(btrim(p_def #>> '{observation,referenceAsset}')), 0) = 0 OR p_def #>> '{observation,decimals}' IS NULL OR p_def #>> '{observation,decimals}' !~ '^([0-9]|1[0-8])$' OR p_def #>> '{observation,revisionPolicy}' IS NULL OR p_def #>> '{observation,revisionPolicy}' NOT IN ('NO_REVISIONS', 'REQUIRE_FINAL') THEN
        RAISE EXCEPTION 'explicit observation and revision terms required';
    END IF;
    PERFORM
        public.market_schedule_time(p_def, 0);
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.market_schedule_guard()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $$
DECLARE
    req public.market_round_requirements;
    v_market_type text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'market scheduling history cannot be deleted';
    END IF;
    IF TG_TABLE_NAME = 'market_template_controls' THEN
        IF TG_OP = 'UPDATE' AND (NEW.template_id <> OLD.template_id OR NEW.template_key <> OLD.template_key OR NEW.next_ordinal < OLD.next_ordinal OR NEW.next_ordinal > OLD.next_ordinal + 1 OR NEW.duplicate_attempts < OLD.duplicate_attempts OR NEW.failure_count < OLD.failure_count) THEN
            RAISE EXCEPTION 'invalid durable scheduler progress';
        END IF;
        IF NEW.next_at IS DISTINCT FROM public.market_schedule_time((
            SELECT
                definition
            FROM public.market_templates
            WHERE
                id = NEW.template_id), NEW.next_ordinal) THEN
            RAISE EXCEPTION 'scheduler cursor differs from immutable calendar';
        END IF;
    ELSIF TG_TABLE_NAME = 'market_lifecycle_cursors' THEN
        IF TG_OP = 'UPDATE' AND (NEW.consumer <> OLD.consumer OR NEW.template_id <> OLD.template_id OR NEW.sequence <= OLD.sequence) THEN
            RAISE EXCEPTION 'lifecycle delivery cursor must advance for its consumer';
        END IF;
        IF NEW.sequence >(
            SELECT
                coalesce(max(SEQUENCE), 0)
            FROM
                public.market_lifecycle_events
            WHERE
                template_id = NEW.template_id) THEN
            RAISE EXCEPTION 'cursor exceeds lifecycle stream';
        END IF;
    ELSIF TG_TABLE_NAME = 'market_rounds'
            AND TG_OP = 'UPDATE' THEN
            IF (to_jsonb(NEW) - 'expiration_complete') IS DISTINCT FROM (to_jsonb(OLD) - 'expiration_complete') OR (OLD.expiration_complete AND NOT NEW.expiration_complete) THEN
                RAISE EXCEPTION 'round identity and times are immutable';
            END IF;
        IF NEW.expiration_complete AND ((
            SELECT
                trading_status
            FROM
                public.markets
            WHERE
                id = NEW.market_id) <> 'CLOSED' OR EXISTS (
            SELECT
                1
            FROM
                public.trading_orders o
                JOIN public.trading_books b ON b.id = o.book_id
            WHERE
                b.market_id = NEW.market_id
                AND o.status IN ('OPEN', 'PARTIAL')) OR EXISTS (
        SELECT
            1
        FROM
            public.matching_requests
        WHERE
            market_id = NEW.market_id
                AND state = 'QUEUED')) THEN
            RAISE EXCEPTION 'expiration work is incomplete';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'market template, requirement, observation and lifecycle history is immutable';
    ELSIF TG_TABLE_NAME = 'market_templates' THEN
        PERFORM
            public.market_schedule_validate_definition(NEW.definition);
        IF NEW.registry_identity IS DISTINCT FROM public.market_schedule_registry(NEW.ctf_deployment_id, NEW.oracle_deployment_id, NEW.collateral_asset_id) THEN
            RAISE EXCEPTION 'template registry snapshot mismatch';
        END IF;
    ELSIF TG_TABLE_NAME = 'market_round_observations' THEN
        SELECT
            *
        INTO
            STRICT req
        FROM
            public.market_round_requirements
        WHERE
            market_id = NEW.market_id
            AND kind = NEW.kind;
        SELECT
            m.market_type
        INTO
            STRICT v_market_type
        FROM
            public.markets m
        WHERE
            id = NEW.market_id;
        IF NEW.observed_at < req.window_start OR NEW.observed_at > req.window_end OR NEW.observed_at > clock_timestamp() OR (v_market_type <> 'CATEGORICAL' AND NEW.value IS NULL) OR NEW.evidence_ref NOT LIKE 'mock:%' THEN
            RAISE EXCEPTION 'observation does not belong to this mock round requirement';
        END IF;
    END IF;
    RETURN NEW;
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.market_schedule_event_streams(p_actor text)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
BEGIN
    IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' THEN
        RAISE EXCEPTION 'lifecycle replay requires system authorization'
            USING ERRCODE = '42501';
    END IF;
    RETURN coalesce((
        SELECT
            jsonb_agg(template_id ORDER BY template_id)
        FROM( SELECT DISTINCT
                e.template_id
                FROM public.market_lifecycle_events e
        LEFT JOIN public.market_lifecycle_cursors c ON c.template_id = e.template_id
            AND c.consumer = p_actor
                WHERE
                    e.sequence > coalesce(c.sequence, 0)
                ORDER BY
                    e.template_id
                LIMIT 32) q), '[]'::jsonb);
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.market_schedule_event_batch(p_actor text, p_template uuid, p_limit integer, p_after bigint)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    start_sequence bigint;
    events jsonb;
BEGIN
    IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_after < 0 THEN
        RAISE EXCEPTION 'invalid public lifecycle batch'
            USING ERRCODE = '42501';
    END IF;
    SELECT
        coalesce((
            SELECT
                SEQUENCE
            FROM public.market_lifecycle_cursors
            WHERE
                consumer = p_actor
                AND template_id = p_template), 0) INTO start_sequence;
    start_sequence := coalesce(p_after, start_sequence);
    SELECT
        coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'eventId', id,
                    'sequence', SEQUENCE::text,
                    'marketId', market_id,
                    'kind', kind,
                    'code', code,
                    'createdAt', created_at
                )
                ORDER BY SEQUENCE
            ),
            '[]'::jsonb
        ) INTO events
    FROM (
        SELECT
            *
        FROM
            public.market_lifecycle_events
        WHERE
            template_id = p_template
            AND SEQUENCE >
                start_sequence
            ORDER BY
                SEQUENCE
            LIMIT p_limit) q;
    RETURN jsonb_build_object(
        'templateId', p_template,
        'consumer', p_actor,
        'afterSequence', start_sequence::text,
        'events', events
    );
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.market_schedule_event_ack(p_actor text, p_template uuid, p_after bigint, p_events jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    actual bigint;
    through_sequence bigint;
    expected jsonb;
    n integer;
BEGIN
    IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' OR p_after IS NULL OR p_after < 0 OR p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
        RAISE EXCEPTION 'invalid lifecycle acknowledgement'
            USING ERRCODE = '42501';
    END IF;
    n := jsonb_array_length(p_events);
    IF n NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'bounded lifecycle prefix required';
    END IF;
    PERFORM
        pg_advisory_xact_lock_shared(727190001);
    PERFORM
        pg_advisory_xact_lock(hashtextextended('lifecycle-delivery:' || p_actor || ':' || p_template::text, 0));
    SELECT
        coalesce((
            SELECT
                SEQUENCE
            FROM public.market_lifecycle_cursors
            WHERE
                consumer = p_actor
                AND template_id = p_template), 0) INTO actual;
    SELECT
        jsonb_agg(id::text ORDER BY SEQUENCE),
        max(SEQUENCE) INTO expected,
        through_sequence
    FROM (
        SELECT
            id,
            SEQUENCE
        FROM
            public.market_lifecycle_events
        WHERE
            template_id = p_template
            AND SEQUENCE >
                p_after
            ORDER BY
                SEQUENCE
            LIMIT n) q;
    IF expected IS DISTINCT FROM p_events THEN
        RAISE EXCEPTION 'exact next lifecycle event prefix required';
    END IF;
    IF actual = through_sequence THEN
        RETURN jsonb_build_object(
            'sequence', actual::text,
            'replayed', TRUE
        );
    END IF;
    IF actual <> p_after THEN
        RAISE EXCEPTION 'stale lifecycle consumer cursor';
    END IF;
    INSERT INTO public.market_lifecycle_cursors(consumer, template_id, SEQUENCE)
VALUES (p_actor,
    p_template,
    through_sequence)
ON CONFLICT (consumer,
    template_id)
    DO UPDATE SET SEQUENCE =
        EXCLUDED.sequence;
    RETURN jsonb_build_object(
        'sequence', through_sequence::text,
        'replayed', FALSE
    );
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.market_schedule_emit(p_template uuid, p_market uuid, p_kind text, p_key text, p_code text DEFAULT NULL)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    next_sequence bigint;
BEGIN
    IF p_kind NOT IN ('CREATED', 'OPENED', 'PAUSED', 'RESUMED', 'CLOSED', 'MISSED', 'EXPIRATION_COMPLETE', 'AWAITING_RESOLUTION', 'OBSERVATION_RECORDED', 'SCHEDULER_FAILURE', 'SCHEDULER_RECOVERY') OR (p_code IS NOT NULL AND p_code !~ '^[A-Z0-9_]{1,64}$') THEN
        RAISE EXCEPTION 'invalid public lifecycle event';
    END IF;
    PERFORM
        pg_advisory_xact_lock(hashtextextended('market-events:' || p_template::text, 0));
    SELECT
        coalesce(max(SEQUENCE), 0) + 1 INTO next_sequence
    FROM
        public.market_lifecycle_events
    WHERE
        template_id = p_template;
    INSERT INTO public.market_lifecycle_events(template_id, market_id, SEQUENCE,
        operation_key,
        kind,
        code)
VALUES (p_template,
    p_market,
    next_sequence,
    p_key,
    p_kind,
    p_code)
ON CONFLICT (operation_key)
    DO NOTHING;
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.market_schedule_plan(p_actor text, p_template uuid)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    t public.market_templates;
    control public.market_template_controls;
    cfg jsonb;
    start_at timestamptz;
    end_at timestamptz;
    obs_start timestamptz;
    obs_end timestamptz;
BEGIN
    IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' THEN
        RAISE EXCEPTION 'market scheduling requires system authorization'
            USING ERRCODE = '42501';
    END IF;
    SELECT
        *
    INTO
        STRICT t
    FROM
        public.market_templates
    WHERE
        id = p_template;
    SELECT
        *
    INTO
        STRICT control
    FROM
        public.market_template_controls
    WHERE
        template_id = p_template;
    IF NOT control.enabled THEN
        RETURN jsonb_build_object(
            'state', 'DISABLED'
        );
    END IF;
    IF control.next_at IS NULL THEN
        RETURN jsonb_build_object(
            'state', 'COMPLETE'
        );
    END IF;
    IF t.registry_identity IS DISTINCT FROM public.market_schedule_registry(t.ctf_deployment_id, t.oracle_deployment_id, t.collateral_asset_id) THEN
        RAISE EXCEPTION 'referenced registry identity changed since template approval';
    END IF;
    cfg := t.definition -> 'schedule';
    start_at := control.next_at;
    end_at := CASE WHEN cfg ->> 'durationMode' = 'NEXT_OCCURRENCE' THEN
        public.market_schedule_time(t.definition, control.next_ordinal + 1)
    ELSE
        start_at + make_interval(secs =>(cfg ->> 'tradingSeconds')::integer)
    END;
    obs_start := start_at + make_interval(secs =>(cfg ->> 'observationStartOffset')::integer);
    obs_end := end_at + make_interval(secs =>(cfg ->> 'observationEndOffset')::integer);
    IF end_at IS NULL OR end_at <= start_at OR obs_start > obs_end THEN
        RAISE EXCEPTION 'invalid round time boundaries';
    END IF;
    RETURN jsonb_build_object(
        'state', 'READY',
        'templateId', t.id,
        'ordinal', control.next_ordinal::text,
        'marketId', md5('market:' || t.id::text || ':' || control.next_ordinal::text)::uuid,
        'questionId', md5('question:' || t.id::text || ':' || control.next_ordinal::text)::uuid,
        'ctfQuestionId', '0x' || encode(sha256(convert_to('khmerfp:round:' || t.id::text || ':' || control.next_ordinal::text, 'UTF8')), 'hex'),
        'opensAt', start_at,
        'cutoffAt', end_at,
        'observationStart', obs_start,
        'observationEnd', obs_end,
        'expectedAvailableAt', end_at + make_interval(secs =>(cfg ->> 'resultDelaySeconds')::integer),
        'definition', t.definition,
        'registry', t.registry_identity
    );
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.market_schedule_create_round(p_actor text, p_terms jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
    << round_creation >>
DECLARE
    t public.market_templates;
    control public.market_template_controls;
    plan jsonb;
    old public.market_rounds;
    item jsonb;
    token jsonb;
    q_id uuid;
    m_id uuid;
    c_id bigint;
    i integer := 0;
    atomic_id bigint;
    ordinal bigint;
    missed boolean;
    first_at timestamptz;
    last_at timestamptz;
BEGIN
    IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' THEN
        RAISE EXCEPTION 'round creation requires system authorization'
            USING ERRCODE = '42501';
    END IF;
    PERFORM
        pg_advisory_xact_lock_shared(727190001);
        PERFORM
            pg_advisory_xact_lock(hashtextextended('schedule:' ||(p_terms ->> 'templateId'), 0));
            SELECT
                *
            INTO
                STRICT t
            FROM
                public.market_templates
            WHERE
                id =(p_terms ->> 'templateId')::uuid;
                SELECT
                    *
                INTO
                    STRICT control
                FROM
                    public.market_template_controls
                WHERE
                    template_id = t.id
                FOR UPDATE;
                ordinal :=(p_terms ->> 'ordinal')::bigint;
                SELECT
                    *
                INTO
                    old
                FROM
                    public.market_rounds
                WHERE
                    template_id = t.id
                    AND market_rounds.ordinal = round_creation.ordinal;
                    IF FOUND THEN
                        IF NOT EXISTS (
                            SELECT
                                1
                            FROM
                                public.ctf_conditions c
                                JOIN public.market_questions q ON q.id = c.market_question_id
                            WHERE
                                q.market_id = OLD.market_id
                                AND c.condition_id = p_terms ->> 'conditionId'
                                AND c.ctf_question_id = p_terms ->> 'ctfQuestionId') OR (
                        SELECT
                            jsonb_agg(
                                jsonb_build_object(
                                    'mask', tok.index_set::text,
                                    'collectionId', tok.collection_id,
                                    'positionId', tok.position_id::text
                                )
                                ORDER BY tok.index_set
                            )
                        FROM
                            public.ctf_position_tokens tok
                            JOIN public.ctf_conditions c ON c.id = tok.condition_id
                            JOIN public.market_questions q ON q.id = c.market_question_id
                        WHERE
                            q.market_id = OLD.market_id) IS DISTINCT FROM (
                        SELECT
                            jsonb_agg(value ORDER BY (value ->> 'mask')::numeric)
                        FROM
                            jsonb_array_elements(p_terms -> 'tokens')) THEN
                            RAISE EXCEPTION 'conflicting canonical round replay';
                        END IF;
                        UPDATE
                            public.market_template_controls
                        SET
                            duplicate_attempts = duplicate_attempts + 1
                        WHERE
                            template_id = t.id;
                            RETURN jsonb_build_object(
                                'marketId', OLD.market_id,
                                'replayed', TRUE
                            );
                    END IF;
                    IF ordinal <> control.next_ordinal THEN
                        RAISE EXCEPTION 'stale scheduler plan';
                    END IF;
                    plan := public.market_schedule_plan(p_actor, t.id);
                    IF plan ->> 'state' <> 'READY' THEN
                        RETURN plan;
                    END IF;
                    IF (plan ->> 'opensAt')::timestamptz > clock_timestamp() + make_interval(secs =>(t.definition #>> '{schedule,lookaheadSeconds}')::integer) THEN
                        RETURN jsonb_build_object(
                            'state', 'NOT_DUE'
                        );
                    END IF;
                    IF p_terms ->> 'ctfQuestionId' IS DISTINCT FROM plan ->> 'ctfQuestionId' OR jsonb_typeof(p_terms -> 'tokens') IS DISTINCT FROM 'array' OR p_terms ->> 'conditionId' !~ '^0x[0-9a-f]{64}$' OR p_terms ->> 'conditionId' IS NULL THEN
                        RAISE EXCEPTION 'round condition identity differs from immutable plan';
                    END IF;
                    m_id :=(plan ->> 'marketId')::uuid;
                    q_id :=(plan ->> 'questionId')::uuid;
                    PERFORM
                        pg_advisory_xact_lock(hashtextextended('matching:' || m_id::text, 0));
    INSERT INTO public.markets(id, category_id, slug, title, description, market_type, outcome_count, trading_starts_at, trading_ends_at, resolution_deadline, series_key, round_key)
    VALUES
        (m_id, t.category_id, 'round-' || replace(m_id::text, '-', ''), t.definition ->> 'title', t.definition ->> 'description', t.definition ->> 'marketType', jsonb_array_length(t.definition -> 'outcomes'),
(plan ->> 'opensAt')::timestamptz,(plan ->> 'cutoffAt')::timestamptz,(plan ->> 'cutoffAt')::timestamptz + make_interval(secs =>(t.definition #>> '{schedule,resolutionDelaySeconds}')::integer), 'template:' || t.id::text, ordinal::text);
    INSERT INTO public.market_questions(id, market_id, oracle_contract_deployment_id, question_text, resolution_rules, resolution_source)
        VALUES (q_id, m_id, t.oracle_deployment_id, t.definition ->> 'title', t.definition ->> 'rules', t.definition #>> '{observation,sourceId}');
        IF t.definition ->> 'marketType' = 'PRICE_RANGE' THEN
            INSERT INTO public.market_observation_specs(market_id, reference_asset, unit, decimals, domain_lower, domain_upper, source_policy, observation_timezone)
                VALUES (m_id, t.definition #>> '{observation,referenceAsset}', t.definition #>> '{observation,unit}',(t.definition #>> '{observation,decimals}')::integer,(t.definition #>> '{observation,domainLower}')::numeric,(t.definition #>> '{observation,domainUpper}')::numeric, t.definition ->> 'rules', t.definition #>> '{schedule,timezone}');
        END IF;
        FOR item IN
        SELECT
            value
        FROM
            jsonb_array_elements(t.definition -> 'outcomes')
    LOOP
        INSERT INTO public.market_outcomes(market_id, question_id, outcome_index, outcome_label, range_lower, range_upper)
            VALUES (m_id, q_id, i, item ->> 'label',(item ->> 'lower')::numeric,(item ->> 'upper')::numeric);
            i := i + 1;
    END LOOP;
    UPDATE
        public.markets
    SET
        lifecycle_status = 'REVIEW'
    WHERE
        id = m_id;
        UPDATE
            public.markets
        SET
            lifecycle_status = 'SCHEDULED',
            terms_hash = '0x' || encode(sha256(convert_to(t.id::text || ':' || ordinal::text || ':' || t.definition::text, 'UTF8')), 'hex'),
            terms_frozen_at = clock_timestamp()
        WHERE
            id = m_id;
    INSERT INTO public.ctf_conditions(market_question_id, chain_id, ctf_contract_deployment_id, oracle_contract_deployment_id, oracle_address, ctf_question_id, condition_id, outcome_slot_count, collateral_asset_id)
        VALUES (q_id,(t.registry_identity ->> 'chainId')::numeric, t.ctf_deployment_id, t.oracle_deployment_id, t.registry_identity ->> 'oracleAddress', plan ->> 'ctfQuestionId', p_terms ->> 'conditionId', i, t.collateral_asset_id)
    RETURNING
        id
    INTO
        c_id;
        IF jsonb_array_length(p_terms -> 'tokens') <>(
            CASE WHEN i = 2 THEN
                2
            ELSE
                2 * i
            END) THEN
        RAISE EXCEPTION 'complete canonical singleton and complement identities required';
        END IF;
        FOR token IN
        SELECT
            value
        FROM
            jsonb_array_elements(p_terms -> 'tokens')
    LOOP
        SELECT
            id
        INTO
            atomic_id
        FROM
            public.market_outcomes
        WHERE
            market_id = m_id
            AND power(2::numeric, outcome_index) =(token ->> 'mask')::numeric;
            IF NOT EXISTS (
                SELECT
                    1
                FROM
                    public.market_outcomes
                WHERE
                    market_id = m_id
                    AND ((token ->> 'mask')::numeric = power(2::numeric, outcome_index)
                    OR (token ->> 'mask')::numeric = power(2::numeric, i) - 1 - power(2::numeric, outcome_index))) THEN
                RAISE EXCEPTION 'unsupported canonical round token mask';
            END IF;
        INSERT INTO public.ctf_position_tokens(condition_id, market_outcome_id, chain_id, ctf_contract_deployment_id, collateral_asset_id, outcome_index, index_set, collection_id, position_id)
        VALUES
            (c_id, atomic_id,(t.registry_identity ->> 'chainId')::numeric, t.ctf_deployment_id, t.collateral_asset_id,(
                    SELECT
                        outcome_index
                    FROM
                        public.market_outcomes
                    WHERE
                        id = atomic_id),(token ->> 'mask')::numeric,
                    token ->> 'collectionId',
(token ->> 'positionId')::numeric);
    END LOOP;
    first_at :=(plan ->> 'observationStart')::timestamptz;
    last_at :=(plan ->> 'observationEnd')::timestamptz;
    missed := clock_timestamp() >(plan ->> 'opensAt')::timestamptz;
    INSERT INTO public.market_rounds(market_id, template_id, ordinal, opens_at, cutoff_at, observation_start, observation_end, expected_available_at, missed)
        VALUES (m_id, t.id, ordinal,(plan ->> 'opensAt')::timestamptz,(plan ->> 'cutoffAt')::timestamptz, first_at, last_at,(plan ->> 'expectedAvailableAt')::timestamptz, missed);
        FOR item IN
        SELECT
            to_jsonb(value)
        FROM
            unnest(
                CASE WHEN t.definition ->> 'marketType' = 'BINARY' THEN
                    ARRAY['OPEN', 'CLOSE']
                ELSE
                    ARRAY['RESULT']
                END) value LOOP
                INSERT INTO public.market_round_requirements(market_id, kind, source_id, unit, decimals, window_start, window_end, expected_available_at, revision_policy)
                    VALUES (m_id, item #>> '{}', t.definition #>> '{observation,sourceId}', t.definition #>> '{observation,unit}',(t.definition #>> '{observation,decimals}')::integer, CASE WHEN item #>> '{}' = 'CLOSE' THEN
                            last_at
                        ELSE
                            first_at
                        END, CASE WHEN item #>> '{}' = 'OPEN' THEN
                            first_at
                        ELSE
                            last_at
                        END, CASE WHEN item #>> '{}' = 'OPEN' THEN
                            first_at
                        ELSE
                            (plan ->> 'expectedAvailableAt')::timestamptz
                        END, t.definition #>> '{observation,revisionPolicy}');
            END LOOP;
            PERFORM
                public.market_schedule_emit(t.id, m_id, 'CREATED', 'created:' || m_id::text);
                IF missed THEN
                    UPDATE
                        public.markets
                    SET
                        trading_status = 'CLOSED',
                        resolution_status = 'PENDING'
                    WHERE
                        id = m_id;
                        PERFORM
                            public.market_schedule_emit(t.id, m_id, 'MISSED', 'missed:' || m_id::text);
                END IF;
                UPDATE
                    public.market_template_controls
                SET
                    next_ordinal = next_ordinal + 1,
                    next_at = public.market_schedule_time(t.definition, next_ordinal + 1)
                WHERE
                    template_id = t.id;
                    RETURN jsonb_build_object(
                        'marketId', m_id,
                        'questionId', q_id,
                        'conditionId', c_id::text,
                        'missed', missed,
                        'replayed', FALSE,
                        'onChainPrepared', FALSE
                    );
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.market_schedule_readiness(p_market uuid)
    RETURNS jsonb
    LANGUAGE sql
    STABLE
    SET search_path = pg_catalog
    AS $$
    SELECT
        coalesce(jsonb_object_agg(kind, state), '{}'::jsonb)
    FROM(
        SELECT
            r.kind,
            CASE WHEN count(o.id) = 0 THEN
                'MISSING'
            WHEN count(DISTINCT coalesce(o.value::text, o.evidence_ref)) > 1 THEN
                'CONFLICT'
            WHEN r.revision_policy = 'REQUIRE_FINAL'
                AND NOT bool_or(o.is_final) THEN
                'PENDING_FINAL'
            WHEN statement_timestamp() < r.expected_available_at THEN
                'WAITING_PUBLICATION'
            ELSE
                'AVAILABLE'
            END AS state
        FROM
            public.market_round_requirements r
        LEFT JOIN public.market_round_observations o ON o.market_id = r.market_id
            AND o.kind = r.kind
    WHERE
        r.market_id = p_market
    GROUP BY
        r.kind,
        r.revision_policy,
        r.expected_available_at) q;
$$;

--> statement-breakpoint
CREATE FUNCTION public.market_schedule_step(p_actor text, p_market uuid)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    r public.market_rounds;
    m public.markets;
    t public.market_templates;
    n integer;
    pending integer;
BEGIN
    IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' THEN
        RAISE EXCEPTION 'lifecycle work requires system authorization'
            USING ERRCODE = '42501';
    END IF;
    PERFORM
        pg_advisory_xact_lock_shared(727190001);
    PERFORM
        pg_advisory_xact_lock(hashtextextended('matching:' || p_market::text, 0));
    SELECT
        *
    INTO
        STRICT r
    FROM
        public.market_rounds
    WHERE
        market_id = p_market
    FOR UPDATE;
    SELECT
        *
    INTO
        STRICT m
    FROM
        public.markets
    WHERE
        id = p_market
    FOR UPDATE;
    SELECT
        *
    INTO
        STRICT t
    FROM
        public.market_templates
    WHERE
        id = r.template_id;
    IF clock_timestamp() >= r.cutoff_at THEN
        IF m.trading_status <> 'CLOSED' THEN
            UPDATE
                public.markets
            SET
                trading_status = 'CLOSED',
                resolution_status = 'PENDING'
            WHERE
                id = m.id;
            PERFORM
                public.market_schedule_emit(t.id, m.id, 'CLOSED', 'closed:' || m.id::text);
        END IF;
        PERFORM
            public.matching_expire(p_actor, m.id, 25);
        SELECT
            count(*)
        INTO
            n
        FROM
            public.trading_orders o
            JOIN public.trading_books b ON b.id = o.book_id
        WHERE
            b.market_id = m.id
            AND o.status IN ('OPEN', 'PARTIAL');
        SELECT
            count(*)
        INTO
            pending
        FROM
            public.matching_requests
        WHERE
            market_id = m.id
            AND state = 'QUEUED';
        IF n = 0 AND pending = 0 AND NOT r.expiration_complete THEN
            UPDATE
                public.market_rounds
            SET
                expiration_complete = TRUE
            WHERE
                market_id = m.id;
            PERFORM
                public.market_schedule_emit(t.id, m.id, 'EXPIRATION_COMPLETE', 'expiration:' || m.id::text);
            PERFORM
                public.market_schedule_emit(t.id, m.id, 'AWAITING_RESOLUTION', 'awaiting:' || m.id::text);
        END IF;
        RETURN jsonb_build_object(
            'state', 'CLOSED',
            'expirationPending', n + pending,
            'readiness', public.market_schedule_readiness(m.id)
        );
    END IF;
    IF m.trading_status = 'CLOSED' OR r.missed THEN
        RETURN jsonb_build_object(
            'state', 'CLOSED'
        );
    END IF;
    IF clock_timestamp() < r.opens_at THEN
        RETURN jsonb_build_object(
            'state', 'SCHEDULED'
        );
    END IF;
    IF m.trading_status = 'NOT_STARTED' THEN
        IF clock_timestamp() > r.opens_at + make_interval(secs =>(t.definition #>> '{schedule,openingGraceSeconds}')::integer) THEN
            UPDATE
                public.markets
            SET
                trading_status = 'CLOSED',
                resolution_status = 'PENDING'
            WHERE
                id = m.id;
            PERFORM
                public.market_schedule_emit(t.id, m.id, 'MISSED', 'missed:' || m.id::text);
            RETURN jsonb_build_object(
                'state', 'MISSED'
            );
        END IF;
        -- Registry derivation alone does not approve accounting, inventory or on-chain preparation.
        IF EXISTS (
            SELECT
                1
            FROM
                public.ctf_position_tokens tok
                JOIN public.ctf_conditions c ON c.id = tok.condition_id
                JOIN public.market_questions q ON q.id = c.market_question_id
            WHERE
                q.market_id = m.id
                AND NOT EXISTS (
                SELECT
                    1
                FROM
                    public.position_token_verifications v
                WHERE
                    v.token_id = tok.id
                    AND v.scope = 'MOCK_ONLY'
                    AND v.condition_id = c.condition_id
                    AND v.collection_id = tok.collection_id
                    AND v.position_id = tok.position_id::text)) THEN
            RETURN jsonb_build_object(
                'state', 'SETUP_REQUIRED'
            );
        END IF;
        INSERT INTO public.trading_books(token_id, market_id)
        SELECT
            tok.id,
            m.id
        FROM
            public.ctf_position_tokens tok
            JOIN public.ctf_conditions c ON c.id = tok.condition_id
            JOIN public.market_questions q ON q.id = c.market_question_id
        WHERE
            q.market_id = m.id
        ON CONFLICT (token_id)
            DO NOTHING;
        UPDATE
            public.markets
        SET
            lifecycle_status = 'ACTIVE',
            trading_status = 'OPEN'
        WHERE
            id = m.id;
        PERFORM
            public.market_schedule_emit(t.id, m.id, 'OPENED', 'opened:' || m.id::text);
    END IF;
    RETURN jsonb_build_object(
        'state',(
            SELECT
                trading_status
            FROM public.markets
            WHERE
                id = m.id)
    );
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.market_schedule_execute(p_actor text, p_action text, p_terms jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    t public.market_templates;
    old public.market_templates;
    registry jsonb;
    market public.market_rounds;
    observation public.market_round_observations;
    v_value numeric;
    item record;
    stamp timestamptz;
BEGIN
    IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' OR p_terms IS NULL OR jsonb_typeof(p_terms) <> 'object' THEN
        RAISE EXCEPTION 'market administration requires system authorization'
            USING ERRCODE = '42501';
    END IF;
    PERFORM
        pg_advisory_xact_lock_shared(727190001);
    IF p_action = 'CREATE_TEMPLATE' THEN
        PERFORM
            pg_advisory_xact_lock(hashtextextended('template-key:' ||(p_terms ->> 'templateKey'), 0));
        SELECT
            *
        INTO
            old
        FROM
            public.market_templates
        WHERE
            template_key = p_terms ->> 'templateKey'
            AND version =(p_terms ->> 'version')::integer;
        IF FOUND THEN
            IF OLD.definition IS DISTINCT FROM p_terms -> 'definition' OR OLD.category_id::text IS DISTINCT FROM p_terms ->> 'categoryId' OR OLD.ctf_deployment_id::text IS DISTINCT FROM p_terms ->> 'ctfDeploymentId' OR OLD.oracle_deployment_id::text IS DISTINCT FROM p_terms ->> 'oracleDeploymentId' OR OLD.collateral_asset_id::text IS DISTINCT FROM p_terms ->> 'collateralAssetId' THEN
                RAISE EXCEPTION 'conflicting template version';
            END IF;
            RETURN jsonb_build_object(
                'templateId', OLD.id,
                'replayed', TRUE
            );
        END IF;
        registry := public.market_schedule_registry((p_terms ->> 'ctfDeploymentId')::bigint,(p_terms ->> 'oracleDeploymentId')::bigint,(p_terms ->> 'collateralAssetId')::bigint);
        INSERT INTO public.market_templates(template_key, version, category_id, ctf_deployment_id, oracle_deployment_id, collateral_asset_id, definition, registry_identity)
            VALUES (p_terms ->> 'templateKey',(p_terms ->> 'version')::integer,(p_terms ->> 'categoryId')::bigint,(p_terms ->> 'ctfDeploymentId')::bigint,(p_terms ->> 'oracleDeploymentId')::bigint,(p_terms ->> 'collateralAssetId')::bigint, p_terms -> 'definition', registry)
        RETURNING
            *
        INTO
            t;
        INSERT INTO public.market_template_controls(template_id, template_key, next_at)
            VALUES (t.id, t.template_key, public.market_schedule_time(t.definition, 0));
        RETURN jsonb_build_object(
            'templateId', t.id,
            'replayed', FALSE
        );
    ELSIF p_action = 'ENABLE' THEN
        SELECT
            *
        INTO
            STRICT t
        FROM
            public.market_templates
        WHERE
            id =(p_terms ->> 'templateId')::uuid;
        PERFORM
            pg_advisory_xact_lock(hashtextextended('template-key:' || t.template_key, 0));
        IF jsonb_typeof(p_terms -> 'enabled') IS DISTINCT FROM 'boolean' THEN
            RAISE EXCEPTION 'explicit scheduling enabled state required';
        END IF;
        IF (p_terms ->> 'enabled')::boolean THEN
            UPDATE
                public.market_template_controls
            SET
                enabled = FALSE
            WHERE
                template_key = t.template_key
                AND template_id <> t.id
                AND enabled;
        END IF;
        UPDATE
            public.market_template_controls
        SET
            enabled =(p_terms ->> 'enabled')::boolean
        WHERE
            template_id = t.id;
        RETURN jsonb_build_object(
            'enabled',(p_terms ->> 'enabled')::boolean
        );
    ELSIF p_action = 'PAUSE' THEN
        SELECT
            *
        INTO
            STRICT market
        FROM
            public.market_rounds
        WHERE
            market_id =(p_terms ->> 'marketId')::uuid;
        PERFORM
            pg_advisory_xact_lock(hashtextextended('matching:' || market.market_id::text, 0));
        IF clock_timestamp() >= market.cutoff_at THEN
            RAISE EXCEPTION 'round cutoff reached';
        END IF;
        IF (
            SELECT
                trading_status
            FROM
                public.markets
            WHERE
                id = market.market_id)
        NOT IN ('OPEN', 'PAUSED') THEN
            RAISE EXCEPTION 'only an open round can pause';
        END IF;
        IF (
            SELECT
                trading_status
            FROM
                public.markets
            WHERE
                id = market.market_id) = 'OPEN' THEN
            UPDATE
                public.markets
            SET
                trading_status = 'PAUSED'
            WHERE
                id = market.market_id;
            PERFORM
                public.market_schedule_emit(market.template_id, market.market_id, 'PAUSED', 'pause:' || gen_random_uuid()::text);
        END IF;
        RETURN jsonb_build_object(
            'state', 'PAUSED'
        );
    ELSIF p_action = 'RESUME' THEN
        SELECT
            *
        INTO
            STRICT market
        FROM
            public.market_rounds
        WHERE
            market_id =(p_terms ->> 'marketId')::uuid;
        PERFORM
            pg_advisory_xact_lock(hashtextextended('matching:' || market.market_id::text, 0));
        IF clock_timestamp() >= market.cutoff_at OR clock_timestamp() < market.opens_at OR (
            SELECT
                trading_status
            FROM
                public.markets
            WHERE
                id = market.market_id)
        NOT IN ('PAUSED', 'OPEN') THEN
            RAISE EXCEPTION 'only a paused current round can resume';
        END IF;
        IF (
            SELECT
                trading_status
            FROM
                public.markets
            WHERE
                id = market.market_id) = 'PAUSED' THEN
            UPDATE
                public.markets
            SET
                trading_status = 'OPEN'
            WHERE
                id = market.market_id;
            PERFORM
                public.market_schedule_emit(market.template_id, market.market_id, 'RESUMED', 'resume:' || gen_random_uuid()::text);
        END IF;
        RETURN jsonb_build_object(
            'state', 'OPEN'
        );
    ELSIF p_action = 'OBSERVE' THEN
        SELECT
            *
        INTO
            STRICT market
        FROM
            public.market_rounds
        WHERE
            market_id =(p_terms ->> 'marketId')::uuid;
        PERFORM
            pg_advisory_xact_lock(hashtextextended('matching:' || market.market_id::text, 0));
        IF p_terms ->> 'value' IS NOT NULL AND p_terms ->> 'value' !~ '^-?(0|[1-9][0-9]{0,77})$' THEN
            RAISE EXCEPTION 'observation requires exact scaled integer';
        END IF;
        v_value :=(p_terms ->> 'value')::numeric;
        stamp :=(p_terms ->> 'observedAt')::timestamptz;
        SELECT
            *
        INTO
            observation
        FROM
            public.market_round_observations
        WHERE
            market_id = market.market_id
            AND kind = p_terms ->> 'kind'
            AND evidence_ref = p_terms ->> 'evidenceRef';
        IF FOUND THEN
            IF observation.value IS DISTINCT FROM v_value OR observation.observed_at IS DISTINCT FROM stamp OR observation.is_final IS DISTINCT FROM (p_terms ->> 'isFinal')::boolean THEN
                RAISE EXCEPTION 'conflicting observation replay';
            END IF;
            RETURN jsonb_build_object(
                'observationId', observation.id,
                'replayed', TRUE
            );
        END IF;
        INSERT INTO public.market_round_observations(market_id, kind, observed_at, value, evidence_ref, is_final)
            VALUES (market.market_id, p_terms ->> 'kind', stamp, v_value, p_terms ->> 'evidenceRef',(p_terms ->> 'isFinal')::boolean)
        RETURNING
            *
        INTO
            observation;
        PERFORM
            public.market_schedule_emit(market.template_id, market.market_id, 'OBSERVATION_RECORDED', 'observation:' || observation.id::text);
        RETURN jsonb_build_object(
            'observationId', observation.id,
            'readiness', public.market_schedule_readiness(market.market_id)
        );
    ELSIF p_action = 'FAILURE' THEN
        SELECT
            *
        INTO
            STRICT t
        FROM
            public.market_templates
        WHERE
            id =(p_terms ->> 'templateId')::uuid;
        IF p_terms ->> 'code' IS NULL OR p_terms ->> 'code' !~ '^[A-Z0-9_]{1,64}$' THEN
            RAISE EXCEPTION 'sanitized scheduler code required';
        END IF;
        PERFORM
            pg_advisory_xact_lock(hashtextextended('schedule:' || t.id::text, 0));
        UPDATE
            public.market_template_controls
        SET
            failure_count = failure_count + 1,
            last_error = p_terms ->> 'code'
        WHERE
            template_id = t.id
        RETURNING
            failure_count
        INTO
            v_value;
        PERFORM
            public.market_schedule_emit(t.id, NULL, 'SCHEDULER_FAILURE', 'failure:' || t.id::text || ':' || v_value::text, p_terms ->> 'code');
        RETURN jsonb_build_object(
            'recorded', TRUE
        );
    ELSIF p_action = 'RECOVERED' THEN
        SELECT
            *
        INTO
            STRICT t
        FROM
            public.market_templates
        WHERE
            id =(p_terms ->> 'templateId')::uuid;
        PERFORM
            pg_advisory_xact_lock(hashtextextended('schedule:' || t.id::text, 0));
        UPDATE
            public.market_template_controls
        SET
            last_error = NULL
        WHERE
            template_id = t.id
            AND last_error IS NOT NULL
        RETURNING
            failure_count
        INTO
            v_value;
        IF FOUND THEN
            PERFORM
                public.market_schedule_emit(t.id, NULL, 'SCHEDULER_RECOVERY', 'recovery:' || t.id::text || ':' || v_value::text);
        END IF;
        RETURN jsonb_build_object(
            'recorded', TRUE
        );
    END IF;
    RAISE EXCEPTION 'unsupported scheduler administration action';
END
$$;

--> statement-breakpoint
CREATE FUNCTION public.market_schedule_read(p_actor text, p_action text, p_terms jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    result jsonb;
BEGIN
    IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' THEN
        RAISE EXCEPTION 'scheduler inspection requires system authorization'
            USING ERRCODE = '42501';
    END IF;
    IF p_action = 'DISCOVER' THEN
        RETURN jsonb_build_object(
            'templates', coalesce((
                SELECT
                    jsonb_agg(template_id ORDER BY next_at, template_id)
                FROM (
                    SELECT
                        c.template_id, c.next_at
                    FROM public.market_template_controls c
                    JOIN public.market_templates t ON t.id = c.template_id
                    WHERE
                        c.enabled
                        AND c.next_at <= statement_timestamp() + make_interval(secs =>(t.definition #>> '{schedule,lookaheadSeconds}')::integer)
                    ORDER BY
                        next_at, template_id
                    LIMIT 32) q), '[]'::jsonb),
            'markets', coalesce((
                SELECT
                    jsonb_agg(market_id ORDER BY opens_at, market_id)
                FROM (
                    SELECT
                        r.market_id, r.opens_at
                    FROM public.market_rounds r
                    JOIN public.markets m ON m.id = r.market_id
                    WHERE (m.trading_status = 'NOT_STARTED'
                        AND r.opens_at <= statement_timestamp())
                OR (r.cutoff_at <= statement_timestamp()
                AND NOT r.expiration_complete)
                    ORDER BY
                        r.opens_at, r.market_id
                    LIMIT 32) q), '[]'::jsonb)
        );
    ELSIF p_action = 'HISTORY' THEN
        RETURN coalesce((
            SELECT
                jsonb_agg(
                    jsonb_build_object(
                        'marketId', r.market_id,
                        'ordinal', r.ordinal::text,
                        'opensAt', r.opens_at,
                        'cutoffAt', r.cutoff_at,
                        'missed', r.missed,
                        'tradingStatus', m.trading_status,
                        'resolutionStatus', m.resolution_status,
                        'expirationComplete', r.expiration_complete,
                        'readiness', public.market_schedule_readiness(r.market_id)
                    )
                    ORDER BY r.ordinal
                )
            FROM (
                SELECT
                    *
                FROM public.market_rounds
                WHERE
                    template_id =(p_terms ->> 'templateId')::uuid
                ORDER BY
                    ordinal DESC
                LIMIT 100) r
        JOIN public.markets m ON m.id = r.market_id), '[]'::jsonb);
    ELSIF p_action = 'DIAGNOSTICS' THEN
        RETURN jsonb_build_object(
            'upcomingRounds',(
                SELECT
                    count(*)
                FROM public.market_rounds r
                JOIN public.markets m ON m.id = r.market_id
                WHERE
                    m.trading_status = 'NOT_STARTED'
                    AND r.opens_at > statement_timestamp()),
            'missedSchedules',(
                SELECT
                    count(*)
                FROM public.market_lifecycle_events
                WHERE
                    kind = 'MISSED'),
            'templateBacklog',(
                SELECT
                    count(*)
                FROM public.market_template_controls
                WHERE
                    enabled
                    AND next_at <= statement_timestamp()),
            'duplicateAttempts',(
                SELECT
                    coalesce(sum(duplicate_attempts), 0)
                FROM public.market_template_controls),
            'schedulerFailures',(
                SELECT
                    coalesce(sum(failure_count), 0)
                FROM public.market_template_controls),
            'outstandingExpiration',(
                SELECT
                    count(*)
                FROM public.market_rounds
                WHERE
                    cutoff_at <= statement_timestamp()
                AND NOT expiration_complete),
            'openingDelays',(
                SELECT
                    count(*)
                FROM public.market_rounds r
                JOIN public.markets m ON m.id = r.market_id
                WHERE
                    m.trading_status = 'NOT_STARTED'
                    AND r.opens_at < statement_timestamp()),
            'closureDelays',(
                SELECT
                    count(*)
                FROM public.market_rounds r
                JOIN public.markets m ON m.id = r.market_id
                WHERE
                    m.trading_status <> 'CLOSED'
                    AND r.cutoff_at < statement_timestamp()),
            'awaitingResolution',(
                SELECT
                    count(*)
                FROM public.market_rounds r
                JOIN public.markets m ON m.id = r.market_id
                WHERE
                    m.resolution_status = 'PENDING')
        );
    END IF;
    RAISE EXCEPTION 'unsupported scheduler read action';
END
$$;

--> statement-breakpoint
CREATE TRIGGER market_templates_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.market_templates
    FOR EACH ROW
    EXECUTE FUNCTION public.market_schedule_guard();

--> statement-breakpoint
CREATE TRIGGER market_template_controls_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.market_template_controls
    FOR EACH ROW
    EXECUTE FUNCTION public.market_schedule_guard();

--> statement-breakpoint
CREATE TRIGGER market_rounds_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.market_rounds
    FOR EACH ROW
    EXECUTE FUNCTION public.market_schedule_guard();

--> statement-breakpoint
CREATE TRIGGER market_round_requirements_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.market_round_requirements
    FOR EACH ROW
    EXECUTE FUNCTION public.market_schedule_guard();

--> statement-breakpoint
CREATE TRIGGER market_round_observations_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.market_round_observations
    FOR EACH ROW
    EXECUTE FUNCTION public.market_schedule_guard();

--> statement-breakpoint
CREATE TRIGGER market_lifecycle_events_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.market_lifecycle_events
    FOR EACH ROW
    EXECUTE FUNCTION public.market_schedule_guard();

--> statement-breakpoint
CREATE TRIGGER market_lifecycle_cursors_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.market_lifecycle_cursors
    FOR EACH ROW
    EXECUTE FUNCTION public.market_schedule_guard();

--> statement-breakpoint
REVOKE ALL ON TABLE public.market_templates, public.market_template_controls, public.market_rounds, public.market_round_requirements, public.market_round_observations, public.market_lifecycle_events, public.market_lifecycle_cursors FROM PUBLIC;

--> statement-breakpoint

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT CAST(oid::regprocedure AS text) AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'market_schedule_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';END LOOP;
END $$;
