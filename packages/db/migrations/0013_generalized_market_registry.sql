-- Registry only; no payments, inventory recognition or chain submissions.
SELECT pg_advisory_xact_lock(727190001);
--> statement-breakpoint
CREATE TABLE "market_observation_specs" (
	"market_id" uuid PRIMARY KEY NOT NULL,
	"reference_asset" varchar(100) NOT NULL,
	"unit" varchar(100) NOT NULL,
	"decimals" smallint NOT NULL,
	"domain_lower" numeric,
	"domain_upper" numeric,
	"source_policy" text NOT NULL,
	"observation_timezone" varchar(100) NOT NULL,
	CONSTRAINT "market_observation_specs_integer_check" CHECK (("market_observation_specs"."domain_lower" IS NULL OR (scale("market_observation_specs"."domain_lower") = 0 AND abs("market_observation_specs"."domain_lower") < power(10::numeric, 78))) AND ("market_observation_specs"."domain_upper" IS NULL OR (scale("market_observation_specs"."domain_upper") = 0 AND abs("market_observation_specs"."domain_upper") < power(10::numeric, 78)))),
	CONSTRAINT "market_observation_specs_precision_check" CHECK ("market_observation_specs"."decimals" BETWEEN 0 AND 18),
	CONSTRAINT "market_observation_specs_domain_check" CHECK ("market_observation_specs"."domain_lower" IS NULL OR "market_observation_specs"."domain_upper" IS NULL OR "market_observation_specs"."domain_lower" < "market_observation_specs"."domain_upper"),
	CONSTRAINT "market_observation_specs_text_check" CHECK (length(btrim("market_observation_specs"."reference_asset")) > 0 AND length(btrim("market_observation_specs"."unit")) > 0 AND length(btrim("market_observation_specs"."source_policy")) > 0 AND length(btrim("market_observation_specs"."observation_timezone")) > 0)
);
--> statement-breakpoint
CREATE TABLE "market_outcome_tokens" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "market_outcome_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"market_outcome_id" bigint NOT NULL,
	"polarity" varchar(3) NOT NULL,
	"token_id" bigint NOT NULL,
	CONSTRAINT "market_outcome_tokens_claim_key" UNIQUE("market_outcome_id","polarity"),
	CONSTRAINT "market_outcome_tokens_polarity_check" CHECK ("market_outcome_tokens"."polarity" IN ('YES', 'NO'))
);
--> statement-breakpoint
ALTER TABLE "ctf_conditions" DROP CONSTRAINT "ctf_conditions_outcome_slot_count_check";--> statement-breakpoint
ALTER TABLE "ctf_position_tokens" DROP CONSTRAINT "ctf_position_tokens_binary_mapping_check";--> statement-breakpoint
ALTER TABLE "market_outcomes" DROP CONSTRAINT "market_outcomes_binary_pair_check";--> statement-breakpoint
ALTER TABLE "ctf_position_tokens" ALTER COLUMN "market_outcome_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ctf_position_tokens" ALTER COLUMN "outcome_index" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "market_outcomes" ALTER COLUMN "outcome_label" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "market_outcomes" ADD COLUMN "range_lower" numeric;--> statement-breakpoint
ALTER TABLE "market_outcomes" ADD COLUMN "range_upper" numeric;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "market_type" varchar(20) DEFAULT 'BINARY' NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "outcome_count" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "series_key" varchar(160);--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "round_key" varchar(160);--> statement-breakpoint
ALTER TABLE "market_observation_specs" ADD CONSTRAINT "market_observation_specs_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_outcome_tokens" ADD CONSTRAINT "market_outcome_tokens_market_outcome_id_market_outcomes_id_fk" FOREIGN KEY ("market_outcome_id") REFERENCES "public"."market_outcomes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_outcome_tokens" ADD CONSTRAINT "market_outcome_tokens_token_id_ctf_position_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."ctf_position_tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_market_outcome_tokens_token" ON "market_outcome_tokens" USING btree ("token_id");--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_series_round_key" UNIQUE("series_key","round_key");--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_series_start_key" UNIQUE("series_key","trading_starts_at");--> statement-breakpoint
ALTER TABLE "ctf_conditions" ADD CONSTRAINT "ctf_conditions_outcome_slot_count_check" CHECK ("ctf_conditions"."outcome_slot_count" BETWEEN 2 AND 256);--> statement-breakpoint
ALTER TABLE "ctf_position_tokens" ADD CONSTRAINT "ctf_position_tokens_atomic_reference_check" CHECK (("ctf_position_tokens"."market_outcome_id" IS NULL) = ("ctf_position_tokens"."outcome_index" IS NULL));--> statement-breakpoint
ALTER TABLE "market_outcomes" ADD CONSTRAINT "market_outcomes_integer_bounds_check" CHECK (("market_outcomes"."range_lower" IS NULL OR (scale("market_outcomes"."range_lower") = 0 AND abs("market_outcomes"."range_lower") < power(10::numeric, 78))) AND ("market_outcomes"."range_upper" IS NULL OR (scale("market_outcomes"."range_upper") = 0 AND abs("market_outcomes"."range_upper") < power(10::numeric, 78))));--> statement-breakpoint
ALTER TABLE "market_outcomes" ADD CONSTRAINT "market_outcomes_index_check" CHECK ("market_outcomes"."outcome_index" BETWEEN 0 AND 255);--> statement-breakpoint
ALTER TABLE "market_outcomes" ADD CONSTRAINT "market_outcomes_label_check" CHECK (length(btrim("market_outcomes"."outcome_label")) > 0);--> statement-breakpoint
ALTER TABLE "market_outcomes" ADD CONSTRAINT "market_outcomes_range_check" CHECK ("market_outcomes"."range_lower" IS NULL OR "market_outcomes"."range_upper" IS NULL OR "market_outcomes"."range_lower" < "market_outcomes"."range_upper");--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_type_count_check" CHECK (("markets"."market_type" = 'BINARY' AND "markets"."outcome_count" = 2) OR ("markets"."market_type" IN ('CATEGORICAL', 'PRICE_RANGE') AND "markets"."outcome_count" BETWEEN 2 AND 256));--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_round_identity_check" CHECK (("markets"."series_key" IS NULL AND "markets"."round_key" IS NULL) OR (length(btrim("markets"."series_key")) > 0 AND length(btrim("markets"."round_key")) > 0 AND "markets"."series_key" IS NOT NULL AND "markets"."round_key" IS NOT NULL));
--> statement-breakpoint
CREATE FUNCTION public.validate_market_definition(p_market_id uuid, p_complete boolean)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE m public.markets; spec public.market_observation_specs; n integer; row_data record;
BEGIN
 SELECT * INTO STRICT m FROM public.markets WHERE id=p_market_id FOR UPDATE;
 SELECT count(*) INTO n FROM public.market_outcomes WHERE market_id=m.id;
 IF n>m.outcome_count THEN RAISE EXCEPTION 'too many atomic outcomes'; END IF;
 IF EXISTS(SELECT 1 FROM public.market_outcomes WHERE market_id=m.id AND outcome_index>=m.outcome_count) THEN RAISE EXCEPTION 'outcome index exceeds declared count'; END IF;
 IF m.market_type='BINARY' AND EXISTS(SELECT 1 FROM public.market_outcomes WHERE market_id=m.id AND NOT ((outcome_index=0 AND outcome_label='YES') OR (outcome_index=1 AND outcome_label='NO'))) THEN RAISE EXCEPTION 'binary outcome labels and indexes must remain YES/NO'; END IF;
 IF m.market_type<>'PRICE_RANGE' AND EXISTS(SELECT 1 FROM public.market_outcomes WHERE market_id=m.id AND (range_lower IS NOT NULL OR range_upper IS NOT NULL)) THEN RAISE EXCEPTION 'numeric bounds require a price-range market'; END IF;
 IF m.market_type='PRICE_RANGE' THEN
  SELECT * INTO spec FROM public.market_observation_specs WHERE market_id=m.id;
  IF NOT FOUND AND (n>0 OR p_complete) THEN RAISE EXCEPTION 'range market needs exact observation terms'; END IF;
  IF EXISTS(SELECT 1 FROM public.market_outcomes a JOIN public.market_outcomes b ON a.market_id=b.market_id AND a.id<b.id WHERE a.market_id=m.id AND (a.range_upper IS NULL OR b.range_lower IS NULL OR b.range_lower<a.range_upper) AND (b.range_upper IS NULL OR a.range_lower IS NULL OR a.range_lower<b.range_upper)) THEN RAISE EXCEPTION 'overlapping outcome ranges'; END IF;
  IF EXISTS(SELECT 1 FROM public.market_outcomes WHERE market_id=m.id AND ((spec.domain_lower IS NOT NULL AND (range_lower IS NULL OR range_lower<spec.domain_lower)) OR (spec.domain_upper IS NOT NULL AND (range_upper IS NULL OR range_upper>spec.domain_upper)))) THEN RAISE EXCEPTION 'range exceeds observation domain'; END IF;
  IF p_complete THEN
   FOR row_data IN SELECT outcome_index, range_lower, range_upper, lag(range_upper) OVER(ORDER BY outcome_index) AS previous_upper FROM public.market_outcomes WHERE market_id=m.id ORDER BY outcome_index LOOP
    IF row_data.outcome_index=0 AND row_data.range_lower IS DISTINCT FROM spec.domain_lower THEN RAISE EXCEPTION 'missing lower domain coverage'; END IF;
    IF row_data.outcome_index>0 AND (row_data.range_lower IS NULL OR row_data.previous_upper IS NULL OR row_data.range_lower IS DISTINCT FROM row_data.previous_upper) THEN RAISE EXCEPTION 'range gap or inconsistent slot ordering'; END IF;
    IF row_data.outcome_index=m.outcome_count-1 AND row_data.range_upper IS DISTINCT FROM spec.domain_upper THEN RAISE EXCEPTION 'missing upper domain coverage'; END IF;
   END LOOP;
  END IF;
 END IF;
 IF p_complete THEN
  IF n<>m.outcome_count OR (SELECT count(*) FROM public.market_questions WHERE market_id=m.id)<>1 THEN RAISE EXCEPTION 'complete question and declared atomic outcomes required before freezing'; END IF;
  -- Unique indexes plus bounded indexes and exact count imply contiguous slots 0..N-1.
 END IF;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.protect_frozen_market_terms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
	market_is_frozen boolean;
	binary_outcome_count integer;
BEGIN
	IF TG_TABLE_NAME = 'markets' THEN
		IF TG_OP = 'INSERT' THEN
			IF NEW.lifecycle_status <> 'DRAFT'
				OR NEW.trading_status <> 'NOT_STARTED'
				OR NEW.resolution_status <> 'UNRESOLVED'
				OR NEW.terms_frozen_at IS NOT NULL
				OR NEW.terms_hash IS NOT NULL THEN
				RAISE EXCEPTION 'market must be created in an unfrozen draft state';
			END IF;

			RETURN NEW;
		END IF;

		IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
			AND NOT (
				(OLD.lifecycle_status = 'DRAFT' AND NEW.lifecycle_status IN ('REVIEW', 'CANCELLED'))
				OR (OLD.lifecycle_status = 'REVIEW' AND NEW.lifecycle_status IN ('DRAFT', 'SCHEDULED', 'CANCELLED'))
				OR (OLD.lifecycle_status = 'SCHEDULED' AND NEW.lifecycle_status IN ('ACTIVE', 'CANCELLED'))
				OR (OLD.lifecycle_status = 'ACTIVE' AND NEW.lifecycle_status IN ('ARCHIVED', 'CANCELLED'))
			) THEN
			RAISE EXCEPTION 'invalid market lifecycle transition';
		END IF;

		IF NEW.trading_status IS DISTINCT FROM OLD.trading_status
			AND NOT (
				(OLD.trading_status = 'NOT_STARTED' AND NEW.trading_status IN ('OPEN', 'CLOSED'))
				OR (OLD.trading_status = 'OPEN' AND NEW.trading_status IN ('PAUSED', 'CLOSED'))
				OR (OLD.trading_status = 'PAUSED' AND NEW.trading_status IN ('OPEN', 'CLOSED'))
			) THEN
			RAISE EXCEPTION 'invalid market trading transition';
		END IF;

		IF NEW.resolution_status IS DISTINCT FROM OLD.resolution_status
			AND NOT (
				(OLD.resolution_status = 'UNRESOLVED' AND NEW.resolution_status IN ('PENDING', 'INVALID'))
				OR (OLD.resolution_status = 'PENDING' AND NEW.resolution_status IN ('RESOLVED', 'INVALID'))
			) THEN
			RAISE EXCEPTION 'invalid market resolution transition';
		END IF;

		IF NEW.lifecycle_status = 'CANCELLED' AND NEW.trading_status <> 'CLOSED' THEN
			RAISE EXCEPTION 'cancelled market trading must be closed';
		END IF;

		IF NEW.lifecycle_status = 'ARCHIVED'
			AND (
				NEW.trading_status <> 'CLOSED'
				OR NEW.resolution_status NOT IN ('RESOLVED', 'INVALID')
			) THEN
			RAISE EXCEPTION 'archived market must be closed and resolved';
		END IF;


        IF TG_OP <> 'DELETE' AND (NEW.market_type IS DISTINCT FROM OLD.market_type OR NEW.outcome_count IS DISTINCT FROM OLD.outcome_count) AND EXISTS(SELECT 1 FROM public.ctf_conditions c JOIN public.market_questions q ON q.id=c.market_question_id WHERE q.market_id=OLD.id) THEN
            RAISE EXCEPTION 'registered condition freezes market type and outcome count';
        END IF;
        IF OLD.terms_frozen_at IS NULL AND NEW.terms_frozen_at IS NOT NULL THEN
            IF NEW.market_type IS DISTINCT FROM OLD.market_type OR NEW.outcome_count IS DISTINCT FROM OLD.outcome_count THEN RAISE EXCEPTION 'configure market before freezing'; END IF;
            PERFORM public.validate_market_definition(OLD.id, true);
        END IF;

		IF OLD.terms_frozen_at IS NOT NULL THEN
			IF TG_OP = 'DELETE' THEN
				RAISE EXCEPTION 'frozen market terms cannot be deleted';
			END IF;

			IF NEW.category_id IS DISTINCT FROM OLD.category_id
				OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
				OR NEW.slug IS DISTINCT FROM OLD.slug
				OR NEW.title IS DISTINCT FROM OLD.title
				OR NEW.description IS DISTINCT FROM OLD.description
				OR NEW.trading_starts_at IS DISTINCT FROM OLD.trading_starts_at
				OR NEW.trading_ends_at IS DISTINCT FROM OLD.trading_ends_at
				OR NEW.resolution_deadline IS DISTINCT FROM OLD.resolution_deadline
				OR NEW.terms_hash IS DISTINCT FROM OLD.terms_hash
				OR NEW.terms_frozen_at IS DISTINCT FROM OLD.terms_frozen_at
                OR NEW.market_type IS DISTINCT FROM OLD.market_type
                OR NEW.outcome_count IS DISTINCT FROM OLD.outcome_count
                OR NEW.series_key IS DISTINCT FROM OLD.series_key
                OR NEW.round_key IS DISTINCT FROM OLD.round_key THEN
				RAISE EXCEPTION 'frozen market terms cannot be changed';
			END IF;
		END IF;

		IF TG_OP = 'DELETE' THEN
			RETURN OLD;
		END IF;

		RETURN NEW;
	END IF;

    -- Serialize child mutations against freezing, including old/new parent reassignment.
    IF TG_OP='INSERT' THEN
        PERFORM id FROM public.markets WHERE id=NEW.market_id FOR UPDATE;
        SELECT terms_frozen_at IS NOT NULL INTO market_is_frozen FROM public.markets WHERE id=NEW.market_id;
    ELSIF TG_OP='DELETE' THEN
        PERFORM id FROM public.markets WHERE id=OLD.market_id FOR UPDATE;
        SELECT terms_frozen_at IS NOT NULL INTO market_is_frozen FROM public.markets WHERE id=OLD.market_id;
    ELSE
        PERFORM id FROM public.markets WHERE id IN(OLD.market_id, NEW.market_id) ORDER BY id FOR UPDATE;
        SELECT EXISTS(SELECT 1 FROM public.markets WHERE id IN(OLD.market_id, NEW.market_id) AND terms_frozen_at IS NOT NULL) INTO market_is_frozen;
    END IF;
    IF market_is_frozen THEN RAISE EXCEPTION 'frozen market questions and outcomes cannot be changed'; END IF;
    IF EXISTS(SELECT 1 FROM public.ctf_conditions c JOIN public.market_questions q ON q.id=c.market_question_id WHERE q.market_id=CASE WHEN TG_OP='DELETE' THEN OLD.market_id ELSE NEW.market_id END)
       OR (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.ctf_conditions c JOIN public.market_questions q ON q.id=c.market_question_id WHERE q.market_id=OLD.market_id)) THEN
       RAISE EXCEPTION 'registered condition protects question, outcomes and observation terms';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION public.check_market_definition_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='market_observation_specs' THEN
  IF TG_OP<>'DELETE' THEN
   IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.observation_timezone) THEN RAISE EXCEPTION 'unknown observation timezone'; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='markets' THEN PERFORM public.validate_market_definition(NEW.id, NEW.terms_frozen_at IS NOT NULL);
 ELSIF TG_OP='DELETE' THEN PERFORM public.validate_market_definition(OLD.market_id,false);
 ELSE
  PERFORM public.validate_market_definition(NEW.market_id,false);
  IF TG_OP='UPDATE' AND OLD.market_id IS DISTINCT FROM NEW.market_id THEN PERFORM public.validate_market_definition(OLD.market_id,false); END IF;
 END IF;
 RETURN NULL;
END $$;

--> statement-breakpoint
CREATE TRIGGER market_observation_specs_protect_terms BEFORE INSERT OR UPDATE OR DELETE ON public.market_observation_specs FOR EACH ROW EXECUTE FUNCTION public.protect_frozen_market_terms();

--> statement-breakpoint
CREATE TRIGGER markets_validate_definition AFTER INSERT OR UPDATE ON public.markets FOR EACH ROW EXECUTE FUNCTION public.check_market_definition_change();

--> statement-breakpoint
CREATE TRIGGER market_outcomes_validate_definition AFTER INSERT OR UPDATE OR DELETE ON public.market_outcomes FOR EACH ROW EXECUTE FUNCTION public.check_market_definition_change();

--> statement-breakpoint
CREATE TRIGGER market_observation_specs_validate_definition AFTER INSERT OR UPDATE OR DELETE ON public.market_observation_specs FOR EACH ROW EXECUTE FUNCTION public.check_market_definition_change();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_ctf_condition_registry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog
AS $$
BEGIN
    PERFORM m.id FROM public.markets m JOIN public.market_questions q ON q.market_id=m.id WHERE q.id=NEW.market_question_id FOR UPDATE OF m;
    IF NEW.outcome_slot_count BETWEEN 2 AND 256 AND NOT EXISTS(SELECT 1 FROM public.market_questions q JOIN public.markets m ON m.id=q.market_id WHERE q.id=NEW.market_question_id AND m.outcome_count=NEW.outcome_slot_count) THEN
        RAISE EXCEPTION 'condition slot count does not match declared atomic outcomes' USING ERRCODE='23514', CONSTRAINT='ctf_conditions_market_count_check';
    END IF;
    IF TG_OP='INSERT' THEN PERFORM public.validate_market_definition((SELECT market_id FROM public.market_questions WHERE id=NEW.market_question_id),true); END IF;
	IF NOT EXISTS (
		SELECT 1
		FROM public.contract_deployments deployment
		WHERE deployment.id = NEW.ctf_contract_deployment_id
			AND deployment.chain_id = NEW.chain_id
			AND deployment.contract_role = 'GNOSIS_CTF'
			AND deployment.deployment_status = 'CONFIRMED'
			AND deployment.contract_address IS NOT NULL
	) THEN
		RAISE EXCEPTION 'CTF condition requires a confirmed GNOSIS_CTF deployment on its chain';
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM public.chain_assets asset
		WHERE asset.id = NEW.collateral_asset_id
			AND asset.chain_id = NEW.chain_id
			AND asset.asset_type = 'ERC20'
	) THEN
		RAISE EXCEPTION 'CTF condition collateral must be an ERC20 asset on its chain';
	END IF;

	IF NEW.oracle_contract_deployment_id IS NOT NULL AND NOT EXISTS (
		SELECT 1
		FROM public.contract_deployments deployment
		WHERE deployment.id = NEW.oracle_contract_deployment_id
			AND deployment.chain_id = NEW.chain_id
			AND deployment.contract_role = 'ORACLE'
			AND deployment.deployment_status = 'CONFIRMED'
			AND deployment.contract_address = NEW.oracle_address
	) THEN
		RAISE EXCEPTION 'CTF condition oracle deployment does not match its chain, role, status, or address';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM public.market_questions question
		WHERE question.id = NEW.market_question_id
			AND question.oracle_contract_deployment_id IS NOT NULL
			AND question.oracle_contract_deployment_id IS DISTINCT FROM NEW.oracle_contract_deployment_id
	) THEN
		RAISE EXCEPTION 'CTF condition oracle does not match the market question';
	END IF;

	IF TG_OP = 'INSERT' THEN
		IF NEW.registration_status <> 'DERIVED'
			OR NEW.preparation_tx_hash IS NOT NULL
			OR NEW.preparation_block_number IS NOT NULL THEN
			RAISE EXCEPTION 'new CTF condition must start as locally derived';
		END IF;
		RETURN NEW;
	END IF;

	IF NEW.market_question_id IS DISTINCT FROM OLD.market_question_id
		OR NEW.chain_id IS DISTINCT FROM OLD.chain_id
		OR NEW.ctf_contract_deployment_id IS DISTINCT FROM OLD.ctf_contract_deployment_id
		OR NEW.oracle_contract_deployment_id IS DISTINCT FROM OLD.oracle_contract_deployment_id
		OR NEW.oracle_address IS DISTINCT FROM OLD.oracle_address
		OR NEW.ctf_question_id IS DISTINCT FROM OLD.ctf_question_id
		OR NEW.condition_id IS DISTINCT FROM OLD.condition_id
		OR NEW.outcome_slot_count IS DISTINCT FROM OLD.outcome_slot_count
		OR NEW.collateral_asset_id IS DISTINCT FROM OLD.collateral_asset_id THEN
		RAISE EXCEPTION 'CTF condition identity is immutable';
	END IF;

	IF OLD.registration_status = 'DERIVED'
		AND NEW.registration_status NOT IN ('DERIVED', 'SUBMITTED', 'FAILED') THEN
		RAISE EXCEPTION 'invalid CTF condition status transition';
	ELSIF OLD.registration_status = 'SUBMITTED'
		AND NEW.registration_status NOT IN ('SUBMITTED', 'PREPARED', 'FAILED') THEN
		RAISE EXCEPTION 'invalid CTF condition status transition';
	ELSIF OLD.registration_status = 'FAILED'
		AND NEW.registration_status NOT IN ('FAILED', 'SUBMITTED') THEN
		RAISE EXCEPTION 'invalid CTF condition status transition';
	ELSIF OLD.registration_status = 'PREPARED'
		AND NEW IS DISTINCT FROM OLD THEN
		RAISE EXCEPTION 'prepared CTF condition cannot be changed';
	END IF;

	RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_ctf_position_token_registry() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c public.ctf_conditions; o public.market_outcomes; full_mask numeric; singleton boolean;
BEGIN
 SELECT * INTO STRICT c FROM public.ctf_conditions WHERE id=NEW.condition_id;
 IF NEW.chain_id<>c.chain_id OR NEW.ctf_contract_deployment_id<>c.ctf_contract_deployment_id OR NEW.collateral_asset_id<>c.collateral_asset_id THEN RAISE EXCEPTION 'CTF position token must match its condition chain, deployment, and collateral'; END IF;
 full_mask:=power(2::numeric,c.outcome_slot_count)-1;
 IF NEW.index_set<=0 OR NEW.index_set>=full_mask THEN RAISE EXCEPTION 'invalid condition index set' USING ERRCODE='23514',CONSTRAINT='ctf_position_tokens_index_set_check'; END IF;
 SELECT EXISTS(SELECT 1 FROM generate_series(0,c.outcome_slot_count-1) i WHERE NEW.index_set=power(2::numeric,i)) INTO singleton;
 IF singleton THEN
  SELECT * INTO o FROM public.market_outcomes WHERE id=NEW.market_outcome_id;
  IF o.id IS NULL OR o.question_id<>c.market_question_id OR o.outcome_index IS DISTINCT FROM NEW.outcome_index OR NEW.index_set<>power(2::numeric,o.outcome_index) THEN RAISE EXCEPTION 'CTF position token outcome does not match its condition'; END IF;
 ELSIF NEW.market_outcome_id IS NOT NULL OR NEW.outcome_index IS NOT NULL THEN RAISE EXCEPTION 'composite token cannot masquerade as an atomic outcome'; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at']) THEN RAISE EXCEPTION 'CTF position token identity is immutable'; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.protect_market_outcome_token() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o public.market_outcomes; c public.ctf_conditions; t public.ctf_position_tokens; expected numeric;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'claim token mappings are immutable'; END IF;
 SELECT * INTO STRICT o FROM public.market_outcomes WHERE id=NEW.market_outcome_id;
 SELECT * INTO STRICT t FROM public.ctf_position_tokens WHERE id=NEW.token_id;
 SELECT * INTO STRICT c FROM public.ctf_conditions WHERE id=t.condition_id;
 expected:=CASE NEW.polarity WHEN 'YES' THEN power(2::numeric,o.outcome_index) WHEN 'NO' THEN power(2::numeric,c.outcome_slot_count)-1-power(2::numeric,o.outcome_index) ELSE NULL END;
 IF o.question_id<>c.market_question_id OR expected IS NULL OR t.index_set<>expected THEN RAISE EXCEPTION 'claim does not match canonical token'; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER market_outcome_tokens_protect_identity BEFORE INSERT OR UPDATE OR DELETE ON public.market_outcome_tokens FOR EACH ROW EXECUTE FUNCTION public.protect_market_outcome_token();

--> statement-breakpoint
CREATE FUNCTION public.map_registered_outcome_token() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public.market_outcome_tokens(market_outcome_id,polarity,token_id)
 SELECT o.id,p.polarity,NEW.id FROM public.ctf_conditions c JOIN public.market_outcomes o ON o.question_id=c.market_question_id CROSS JOIN (VALUES('YES'),('NO')) p(polarity)
 WHERE c.id=NEW.condition_id AND NEW.index_set=CASE p.polarity WHEN 'YES' THEN power(2::numeric,o.outcome_index) ELSE power(2::numeric,c.outcome_slot_count)-1-power(2::numeric,o.outcome_index) END;
 RETURN NULL;
END $$;

--> statement-breakpoint
CREATE TRIGGER ctf_position_tokens_map_claims AFTER INSERT ON public.ctf_position_tokens FOR EACH ROW EXECUTE FUNCTION public.map_registered_outcome_token();

--> statement-breakpoint
-- Backfill aliases only: no token, balance, journal or existing identity is changed.
INSERT INTO public.market_outcome_tokens(market_outcome_id,polarity,token_id)
SELECT o.id,p.polarity,t.id FROM public.ctf_conditions c JOIN public.market_outcomes o ON o.question_id=c.market_question_id JOIN public.ctf_position_tokens t ON t.condition_id=c.id CROSS JOIN (VALUES('YES'),('NO')) p(polarity)
WHERE t.index_set=CASE p.polarity WHEN 'YES' THEN power(2::numeric,o.outcome_index) ELSE power(2::numeric,c.outcome_slot_count)-1-power(2::numeric,o.outcome_index) END;

--> statement-breakpoint
-- Preserve every accounting rule; resolve market through the canonical condition.
CREATE OR REPLACE FUNCTION public.position_validate(p_kind text,p_id bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.position_journals; a public.position_accounts; r public.position_reservations; x public.cash_position_settlements; original public.position_journals;
BEGIN
 IF p_kind='POSITION_JOURNAL' THEN
  SELECT * INTO STRICT j FROM public.position_journals WHERE id=p_id;
  IF j.status<>'POSTED' OR (SELECT count(*) FROM public.position_journal_entries WHERE journal_id=j.id)<2 OR EXISTS(SELECT 1 FROM public.position_journal_entries WHERE journal_id=j.id GROUP BY token_id HAVING sum(CASE side WHEN 'IN' THEN quantity::numeric ELSE -quantity::numeric END)<>0) THEN RAISE EXCEPTION 'position journal must be posted and balanced per token' USING ERRCODE='23514'; END IF;
  IF j.purpose='RECOGNITION' THEN
   IF NOT EXISTS(SELECT 1 FROM public.financial_operations WHERE id=j.operation_id AND action='POSITION_FIXTURE_RECOGNITION') OR (SELECT count(*) FROM public.position_journal_entries WHERE journal_id=j.id)<>2 OR NOT EXISTS(SELECT 1 FROM public.position_journal_entries e JOIN public.position_accounts a1 ON a1.id=e.account_id WHERE e.journal_id=j.id AND a1.kind='EXTERNAL_CONTROL' AND e.side='OUT') OR NOT EXISTS(SELECT 1 FROM public.position_journal_entries e JOIN public.position_accounts a1 ON a1.id=e.account_id WHERE e.journal_id=j.id AND a1.kind='UNALLOCATED' AND e.side='IN') THEN RAISE EXCEPTION 'invalid test inventory recognition'; END IF;
  ELSIF EXISTS(SELECT 1 FROM public.position_journal_entries e JOIN public.position_accounts a1 ON a1.id=e.account_id WHERE e.journal_id=j.id AND a1.kind='EXTERNAL_CONTROL') THEN RAISE EXCEPTION 'external control is not spendable inventory'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.financial_operations o WHERE o.id=j.operation_id AND o.action=CASE j.purpose WHEN 'POST' THEN 'POSITION_POST' WHEN 'TRANSFER' THEN 'POSITION_TRANSFER' WHEN 'CONSUMPTION' THEN 'POSITION_CONSUME' WHEN 'REVERSAL' THEN 'POSITION_REVERSE' WHEN 'RECOGNITION' THEN 'POSITION_FIXTURE_RECOGNITION' WHEN 'SETTLEMENT' THEN 'SETTLE' END) THEN RAISE EXCEPTION 'position journal operation mismatch'; END IF;
  IF (j.purpose='SETTLEMENT') IS DISTINCT FROM EXISTS(SELECT 1 FROM public.cash_position_settlements WHERE position_journal_id=j.id) THEN RAISE EXCEPTION 'incomplete settlement position journal'; END IF;
  IF j.purpose='CONSUMPTION' AND NOT EXISTS(SELECT 1 FROM public.position_reservation_events WHERE journal_id=j.id AND kind='CONSUME' AND operation_id=j.operation_id) THEN RAISE EXCEPTION 'missing consumption event'; END IF;
  IF (j.purpose='REVERSAL') IS DISTINCT FROM (j.reversal_of IS NOT NULL) THEN RAISE EXCEPTION 'invalid reversal relationship'; END IF;
  IF j.reversal_of IS NOT NULL THEN
   SELECT * INTO STRICT original FROM public.position_journals WHERE id=j.reversal_of;
   IF original.purpose NOT IN ('POST','TRANSFER') OR original.reversal_of IS NOT NULL OR
    EXISTS(SELECT account_id,token_id,side,sum(quantity::numeric) FROM public.position_journal_entries WHERE journal_id=j.id GROUP BY account_id,token_id,side EXCEPT SELECT account_id,token_id,CASE side WHEN 'IN' THEN 'OUT' ELSE 'IN' END,sum(quantity::numeric) FROM public.position_journal_entries WHERE journal_id=original.id GROUP BY account_id,token_id,side) OR
    EXISTS(SELECT account_id,token_id,CASE side WHEN 'IN' THEN 'OUT' ELSE 'IN' END,sum(quantity::numeric) FROM public.position_journal_entries WHERE journal_id=original.id GROUP BY account_id,token_id,side EXCEPT SELECT account_id,token_id,side,sum(quantity::numeric) FROM public.position_journal_entries WHERE journal_id=j.id GROUP BY account_id,token_id,side) THEN RAISE EXCEPTION 'position reversal must exactly compensate eligible journal'; END IF;
  END IF;
 ELSIF p_kind='POSITION_ACCOUNT' THEN
  SELECT * INTO STRICT a FROM public.position_accounts WHERE id=p_id;
  IF NOT EXISTS(SELECT 1 FROM public.position_balance_projections p WHERE p.account_id=a.id AND p.posted::numeric=COALESCE((SELECT sum(CASE side WHEN 'IN' THEN quantity::numeric ELSE -quantity::numeric END) FROM public.position_journal_entries WHERE account_id=a.id),0) AND p.reserved::numeric=COALESCE((SELECT sum(quantity::numeric-consumed-released) FROM public.position_reservations WHERE account_id=a.id),0)) THEN RAISE EXCEPTION 'position projection differs from history'; END IF;
 ELSIF p_kind='POSITION_RESERVATION' THEN
  SELECT * INTO STRICT r FROM public.position_reservations WHERE id=p_id;
  IF r.quantity::numeric<>COALESCE((SELECT sum(quantity::numeric) FROM public.position_reservation_events WHERE reservation_id=r.id AND kind='RESERVE'),0) OR r.consumed::numeric<>COALESCE((SELECT sum(quantity::numeric) FROM public.position_reservation_events WHERE reservation_id=r.id AND kind='CONSUME'),0) OR r.released::numeric<>COALESCE((SELECT sum(quantity::numeric) FROM public.position_reservation_events WHERE reservation_id=r.id AND kind IN ('RELEASE','CANCEL')),0) THEN RAISE EXCEPTION 'position reservation differs from immutable event history'; END IF;
  IF EXISTS(SELECT 1 FROM public.position_reservation_events v WHERE v.reservation_id=r.id AND (NOT EXISTS(SELECT 1 FROM public.financial_operations o WHERE o.id=v.operation_id AND o.action=CASE v.kind WHEN 'RESERVE' THEN 'POSITION_RESERVE' WHEN 'RELEASE' THEN 'POSITION_RELEASE' WHEN 'CANCEL' THEN 'POSITION_CANCEL' WHEN 'CONSUME' THEN CASE WHEN EXISTS(SELECT 1 FROM public.cash_position_settlements s1 WHERE s1.operation_id=v.operation_id) THEN 'SETTLE' ELSE 'POSITION_CONSUME' END END) OR (v.kind='CONSUME' AND ((SELECT count(*) FROM public.position_journal_entries WHERE journal_id=v.journal_id)<>2 OR NOT EXISTS(SELECT 1 FROM public.position_journal_entries WHERE journal_id=v.journal_id AND account_id=r.account_id AND side='OUT' AND quantity=v.quantity))))) THEN RAISE EXCEPTION 'position reservation operation or consumption mismatch'; END IF;
 ELSIF p_kind='SETTLEMENT' THEN
  SELECT * INTO STRICT x FROM public.cash_position_settlements WHERE id=p_id;
  IF NOT EXISTS(SELECT 1 FROM public.financial_operations WHERE id=x.operation_id AND action='SETTLE') OR
   NOT EXISTS(SELECT 1 FROM public.financial_journals WHERE id=x.cash_journal_id AND operation_id=x.operation_id AND status='POSTED' AND reversal_of IS NULL) OR
   NOT EXISTS(SELECT 1 FROM public.position_journals WHERE id=x.position_journal_id AND operation_id=x.operation_id AND status='POSTED' AND purpose='SETTLEMENT') OR
   (SELECT count(*) FROM public.financial_journal_entries WHERE journal_id=x.cash_journal_id)<>2 OR (SELECT count(*) FROM public.position_journal_entries WHERE journal_id=x.position_journal_id)<>2 OR
   NOT EXISTS(SELECT 1 FROM public.financial_journal_entries WHERE journal_id=x.cash_journal_id AND account_id=x.buyer_cash_account_id AND asset='USD' AND side='DEBIT' AND amount=x.consideration_cents) OR
   NOT EXISTS(SELECT 1 FROM public.financial_journal_entries WHERE journal_id=x.cash_journal_id AND account_id=x.seller_cash_account_id AND asset='USD' AND side='CREDIT' AND amount=x.consideration_cents) OR
   NOT EXISTS(SELECT 1 FROM public.position_journal_entries WHERE journal_id=x.position_journal_id AND account_id=x.seller_position_account_id AND token_id=x.token_id AND side='OUT' AND quantity=x.quantity) OR
   NOT EXISTS(SELECT 1 FROM public.position_journal_entries WHERE journal_id=x.position_journal_id AND account_id=x.buyer_position_account_id AND token_id=x.token_id AND side='IN' AND quantity=x.quantity) OR
   NOT EXISTS(SELECT 1 FROM public.cash_reservation_events v JOIN public.cash_reservations r1 ON r1.id=v.reservation_id WHERE v.operation_id=x.operation_id AND v.journal_id=x.cash_journal_id AND v.reservation_id=x.cash_reservation_id AND v.kind='CONSUME' AND v.amount=x.consideration_cents AND r1.account_id=x.buyer_cash_account_id) OR
   NOT EXISTS(SELECT 1 FROM public.position_reservation_events v JOIN public.position_reservations r1 ON r1.id=v.reservation_id WHERE v.operation_id=x.operation_id AND v.journal_id=x.position_journal_id AND v.reservation_id=x.position_reservation_id AND v.kind='CONSUME' AND v.quantity=x.quantity AND r1.account_id=x.seller_position_account_id) THEN RAISE EXCEPTION 'incomplete or mismatched cash and position settlement'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.financial_operations o JOIN public.cash_reservations cr ON cr.id=x.cash_reservation_id JOIN public.position_reservations pr ON pr.id=x.position_reservation_id WHERE o.id=x.operation_id AND o.terms @> jsonb_build_object('matchReference',x.match_reference,'marketId',x.market_id::text,'tokenId',x.token_id::text,'buyerCashAccountId',x.buyer_cash_account_id::text,'sellerCashAccountId',x.seller_cash_account_id::text,'buyerPositionAccountId',x.buyer_position_account_id::text,'sellerPositionAccountId',x.seller_position_account_id::text,'cashReservationId',x.cash_reservation_id::text,'positionReservationId',x.position_reservation_id::text,'cashReservationReference',cr.reference,'positionReservationReference',pr.reference,'quantity',x.quantity::text,'priceCents',x.price_cents::text)) THEN RAISE EXCEPTION 'settlement differs from authorized operation terms or reservation references'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.financial_accounts bc JOIN public.financial_accounts sc ON sc.id=x.seller_cash_account_id JOIN public.position_accounts bp ON bp.id=x.buyer_position_account_id JOIN public.position_accounts sp ON sp.id=x.seller_position_account_id WHERE bc.id=x.buyer_cash_account_id AND bc.kind='CUSTOMER' AND sc.kind='CUSTOMER' AND bp.kind='CUSTOMER' AND sp.kind='CUSTOMER' AND bc.asset='USD' AND sc.asset='USD' AND bc.owner_user_id=bp.owner_user_id AND sc.owner_user_id=sp.owner_user_id AND bc.owner_user_id<>sc.owner_user_id AND bp.token_id=x.token_id AND sp.token_id=x.token_id) THEN RAISE EXCEPTION 'settlement account ownership or token mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ctf_position_tokens t JOIN public.ctf_conditions c ON c.id=t.condition_id JOIN public.market_questions o ON o.id=c.market_question_id WHERE t.id=x.token_id AND o.market_id=x.market_id) THEN RAISE EXCEPTION 'settlement market token mismatch'; END IF;
 ELSE RAISE EXCEPTION 'unknown position audit target'; END IF;
END $$;

--> statement-breakpoint
-- Preserve every accounting rule; resolve market through the canonical condition.
CREATE OR REPLACE FUNCTION public.position_execute(p_actor text,p_action text,p_key text,p_terms jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
<<positions>>
DECLARE op public.financial_operations; a public.position_accounts; target public.position_accounts; r public.position_reservations; original public.position_journals;
 ids bigint[]; lines jsonb; entry jsonb; result jsonb; op_id bigint; journal_id bigint; reservation_id bigint; q bigint; remaining bigint; target_id bigint; expected text[]; item record;
 bc public.financial_accounts; sc public.financial_accounts; bp public.position_accounts; sp public.position_accounts; cr public.cash_reservations; m public.markets;
 cash_report jsonb; cash_journal bigint; price bigint; consideration bigint; settlement_id bigint;
BEGIN
 IF p_actor IS NULL OR p_actor !~ '^(user:[1-9][0-9]*|system:[a-z][a-z0-9_-]{0,60})$' OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9:_-]{1,120}$' OR jsonb_typeof(p_terms) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid position request'; END IF;
 IF p_action NOT IN ('POSITION_ACCOUNT','POSITION_BALANCE','POSITION_POST','POSITION_TRANSFER','POSITION_RESERVE','POSITION_CONSUME','POSITION_RELEASE','POSITION_CANCEL','POSITION_REVERSE','POSITION_REBUILD','POSITION_RECONCILE','SETTLE') THEN RAISE EXCEPTION 'unknown position action'; END IF;
 IF p_action IN ('POSITION_ACCOUNT','POSITION_POST','POSITION_CONSUME','POSITION_REVERSE','POSITION_REBUILD','POSITION_RECONCILE','SETTLE') AND p_actor NOT LIKE 'system:%' THEN RAISE EXCEPTION 'system capability required' USING ERRCODE='42501'; END IF;
 expected:=CASE p_action WHEN 'POSITION_ACCOUNT' THEN ARRAY['tokenId','ownerUserId','accountKey','kind'] WHEN 'POSITION_BALANCE' THEN ARRAY['accountId'] WHEN 'POSITION_POST' THEN ARRAY['entries','reference'] WHEN 'POSITION_TRANSFER' THEN ARRAY['sourceAccountId','targetAccountId','quantity','reference'] WHEN 'POSITION_RESERVE' THEN ARRAY['accountId','quantity','reference'] WHEN 'POSITION_CONSUME' THEN ARRAY['reservationId','quantity','targetAccountId'] WHEN 'POSITION_RELEASE' THEN ARRAY['reservationId','quantity'] WHEN 'POSITION_CANCEL' THEN ARRAY['reservationId'] WHEN 'POSITION_REVERSE' THEN ARRAY['journalId'] WHEN 'SETTLE' THEN ARRAY['buyerCashAccountId','sellerCashAccountId','buyerPositionAccountId','sellerPositionAccountId','cashReservationId','positionReservationId','cashReservationReference','positionReservationReference','marketId','tokenId','quantity','priceCents','matchReference'] ELSE ARRAY[]::text[] END;
 IF p_terms-expected<>'{}'::jsonb THEN RAISE EXCEPTION 'unexpected position terms'; END IF;
 -- Same gate as cash operations: maintenance excludes all cash/position writers.
 IF p_action IN ('POSITION_REBUILD','POSITION_RECONCILE') THEN PERFORM pg_advisory_xact_lock(727190001); ELSE PERFORM pg_advisory_xact_lock_shared(727190001); END IF;
 IF p_action='POSITION_REBUILD' THEN cash_report:=public.financial_reconcile(p_actor); END IF;
 IF p_action NOT IN ('POSITION_BALANCE','POSITION_RECONCILE') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('financial-key:'||p_key,0));
  SELECT * INTO op FROM public.financial_operations WHERE operation_key=p_key;
  IF FOUND THEN
   IF op.actor<>p_actor OR op.action<>p_action OR op.terms<>p_terms THEN RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505'; END IF;
   RETURN op.result;
  END IF;
  INSERT INTO public.financial_operations(operation_key,actor,action,terms,request_hash) VALUES(p_key,p_actor,p_action,p_terms,encode(sha256(convert_to(jsonb_build_array(p_actor,p_action,p_terms)::text,'UTF8')),'hex')) RETURNING id INTO op_id;
 END IF;
 IF p_action IN ('POSITION_TRANSFER','POSITION_RESERVE','POSITION_CONSUME','POSITION_RELEASE','SETTLE') THEN
  IF jsonb_typeof(p_terms->'quantity') IS DISTINCT FROM 'string' OR (p_terms->>'quantity') !~ '^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'quantity requires whole-share integer string'; END IF;
  q:=(p_terms->>'quantity')::bigint;
  IF q%1000000<>0 THEN RAISE EXCEPTION 'quantity requires whole shares'; END IF;
 END IF;
 IF p_action='POSITION_ACCOUNT' THEN
  IF jsonb_typeof(p_terms->'accountKey') IS DISTINCT FROM 'string' OR length(p_terms->>'accountKey') NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'position account key required'; END IF;
  INSERT INTO public.position_accounts(token_id,owner_user_id,account_key,kind) VALUES((p_terms->>'tokenId')::bigint,(p_terms->>'ownerUserId')::bigint,p_terms->>'accountKey',p_terms->>'kind') RETURNING * INTO a;
  INSERT INTO public.position_balance_projections(account_id) VALUES(a.id);
  result:=jsonb_build_object('accountId',a.id::text);
 ELSIF p_action IN ('POSITION_REBUILD','POSITION_RECONCILE') THEN
  IF p_action='POSITION_REBUILD' THEN
   PERFORM id FROM public.position_accounts ORDER BY id FOR UPDATE;
   UPDATE public.position_balance_projections p SET posted=COALESCE((SELECT sum(CASE e.side WHEN 'IN' THEN e.quantity::numeric ELSE -e.quantity::numeric END) FROM public.position_journal_entries e WHERE e.account_id=p.account_id),0)::bigint,
    reserved=COALESCE((SELECT sum(CASE v.kind WHEN 'RESERVE' THEN v.quantity::numeric ELSE -v.quantity::numeric END) FROM public.position_reservation_events v JOIN public.position_reservations r1 ON r1.id=v.reservation_id WHERE r1.account_id=p.account_id),0)::bigint;
  END IF;
  FOR item IN SELECT id FROM public.position_journals LOOP PERFORM public.position_validate('POSITION_JOURNAL',item.id); END LOOP;
  FOR item IN SELECT id FROM public.position_accounts LOOP PERFORM public.position_validate('POSITION_ACCOUNT',item.id); END LOOP;
  FOR item IN SELECT id FROM public.position_reservations LOOP PERFORM public.position_validate('POSITION_RESERVATION',item.id); END LOOP;
  FOR item IN SELECT id FROM public.cash_position_settlements LOOP PERFORM public.position_validate('SETTLEMENT',item.id); END LOOP;
  result:=jsonb_build_object('reconciled',true,'cash',CASE WHEN p_action='POSITION_REBUILD' THEN cash_report ELSE public.financial_reconcile(p_actor) END,'journals',(SELECT count(*)::text FROM public.position_journals),'settlements',(SELECT count(*)::text FROM public.cash_position_settlements));
  IF p_action='POSITION_RECONCILE' THEN RETURN result; END IF;
 ELSIF p_action='SETTLE' THEN
  IF jsonb_typeof(p_terms->'priceCents') IS DISTINCT FROM 'string' OR (p_terms->>'priceCents') !~ '^[1-9][0-9]{0,18}$' OR jsonb_typeof(p_terms->'matchReference') IS DISTINCT FROM 'string' OR length(p_terms->>'matchReference') NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'invalid settlement price or reference'; END IF;
  IF jsonb_typeof(p_terms->'cashReservationReference') IS DISTINCT FROM 'string' OR length(p_terms->>'cashReservationReference') NOT BETWEEN 1 AND 120 OR jsonb_typeof(p_terms->'positionReservationReference') IS DISTINCT FROM 'string' OR length(p_terms->>'positionReservationReference') NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'settlement reservation business references required'; END IF;
  price:=(p_terms->>'priceCents')::bigint;
  consideration:=((q::numeric/1000000)*price)::bigint;
  -- Global order: market, ascending cash accounts, ascending position accounts, cash hold, position hold.
  SELECT * INTO STRICT m FROM public.markets WHERE id=(p_terms->>'marketId')::uuid FOR SHARE;
  IF m.lifecycle_status<>'ACTIVE' OR m.trading_status<>'OPEN' OR m.resolution_status<>'UNRESOLVED' OR m.terms_frozen_at IS NULL OR clock_timestamp()<m.trading_starts_at OR clock_timestamp()>=m.trading_ends_at THEN RAISE EXCEPTION 'market not open or trading cutoff reached'; END IF;
  PERFORM id FROM public.financial_accounts WHERE id IN ((p_terms->>'buyerCashAccountId')::bigint,(p_terms->>'sellerCashAccountId')::bigint) ORDER BY id FOR UPDATE;
  PERFORM id FROM public.position_accounts WHERE id IN ((p_terms->>'buyerPositionAccountId')::bigint,(p_terms->>'sellerPositionAccountId')::bigint) ORDER BY id FOR UPDATE;
  SELECT * INTO STRICT bc FROM public.financial_accounts WHERE id=(p_terms->>'buyerCashAccountId')::bigint;
  SELECT * INTO STRICT sc FROM public.financial_accounts WHERE id=(p_terms->>'sellerCashAccountId')::bigint;
  SELECT * INTO STRICT bp FROM public.position_accounts WHERE id=(p_terms->>'buyerPositionAccountId')::bigint;
  SELECT * INTO STRICT sp FROM public.position_accounts WHERE id=(p_terms->>'sellerPositionAccountId')::bigint;
  IF bc.kind<>'CUSTOMER' OR sc.kind<>'CUSTOMER' OR bp.kind<>'CUSTOMER' OR sp.kind<>'CUSTOMER' OR bc.asset<>'USD' OR sc.asset<>'USD' OR bc.owner_user_id<>bp.owner_user_id OR sc.owner_user_id<>sp.owner_user_id OR bc.owner_user_id=sc.owner_user_id THEN RAISE EXCEPTION 'settlement owner mismatch or self trade'; END IF;
  IF bp.token_id<>sp.token_id OR bp.token_id<>(p_terms->>'tokenId')::bigint OR NOT EXISTS(SELECT 1 FROM public.ctf_position_tokens t JOIN public.ctf_conditions c ON c.id=t.condition_id JOIN public.market_questions o ON o.id=c.market_question_id WHERE t.id=bp.token_id AND o.market_id=m.id) THEN RAISE EXCEPTION 'settlement market token mismatch'; END IF;
  SELECT * INTO STRICT cr FROM public.cash_reservations WHERE id=(p_terms->>'cashReservationId')::bigint FOR UPDATE;
  SELECT * INTO STRICT r FROM public.position_reservations WHERE id=(p_terms->>'positionReservationId')::bigint FOR UPDATE;
  IF cr.reference IS DISTINCT FROM p_terms->>'cashReservationReference' OR r.reference IS DISTINCT FROM p_terms->>'positionReservationReference' THEN RAISE EXCEPTION 'settlement reservation business reference mismatch'; END IF;
  IF cr.account_id<>bc.id OR r.account_id<>sp.id OR cr.status<>'OPEN' OR r.status<>'OPEN' OR cr.amount-cr.consumed-cr.released<consideration OR r.quantity-r.consumed-r.released<q THEN RAISE EXCEPTION 'settlement reservation mismatch or insufficient remaining'; END IF;
  UPDATE public.cash_reservations SET consumed=consumed+consideration,status=CASE WHEN consumed+released+consideration=amount THEN 'CLOSED' ELSE 'OPEN' END WHERE id=cr.id;
  INSERT INTO public.financial_journals(operation_id) VALUES(op_id) RETURNING id INTO cash_journal;
  INSERT INTO public.financial_journal_entries(journal_id,account_id,asset,side,amount) VALUES(cash_journal,bc.id,'USD','DEBIT',consideration),(cash_journal,sc.id,'USD','CREDIT',consideration);
  UPDATE public.financial_journals SET status='POSTED' WHERE id=cash_journal;
  INSERT INTO public.cash_reservation_events(reservation_id,operation_id,kind,amount,journal_id) VALUES(cr.id,op_id,'CONSUME',consideration,cash_journal);
  UPDATE public.position_reservations SET consumed=consumed+q,status=CASE WHEN consumed+released+q=quantity THEN 'CLOSED' ELSE 'OPEN' END WHERE id=r.id;
  INSERT INTO public.position_journals(operation_id,reference,purpose) VALUES(op_id,p_terms->>'matchReference','SETTLEMENT') RETURNING id INTO journal_id;
  INSERT INTO public.position_journal_entries(journal_id,account_id,token_id,side,quantity) VALUES(journal_id,sp.id,sp.token_id,'OUT',q),(journal_id,bp.id,bp.token_id,'IN',q);
  UPDATE public.position_journals SET status='POSTED' WHERE id=journal_id;
  INSERT INTO public.position_reservation_events(reservation_id,operation_id,kind,quantity,journal_id) VALUES(r.id,op_id,'CONSUME',q,journal_id);
  INSERT INTO public.cash_position_settlements(operation_id,match_reference,market_id,token_id,buyer_cash_account_id,seller_cash_account_id,buyer_position_account_id,seller_position_account_id,cash_reservation_id,position_reservation_id,cash_journal_id,position_journal_id,quantity,price_cents,consideration_cents) VALUES(op_id,p_terms->>'matchReference',m.id,bp.token_id,bc.id,sc.id,bp.id,sp.id,cr.id,r.id,cash_journal,journal_id,q,price,consideration) RETURNING id INTO settlement_id;
  -- Recheck after possible lock waits and all writes; historical reconciliation uses immutable links, not today's market state.
  IF clock_timestamp()>=m.trading_ends_at THEN RAISE EXCEPTION 'trading cutoff reached during settlement'; END IF;
  result:=jsonb_build_object('settlementId',settlement_id::text,'cashJournalId',cash_journal::text,'positionJournalId',journal_id::text,'quantity',q::text,'considerationCents',consideration::text);
 ELSE
  IF p_action IN ('POSITION_CONSUME','POSITION_RELEASE','POSITION_CANCEL') THEN
   SELECT * INTO STRICT r FROM public.position_reservations WHERE id=(p_terms->>'reservationId')::bigint;
   ids:=ARRAY[r.account_id];
   IF p_action='POSITION_CONSUME' THEN ids:=ids||ARRAY[(p_terms->>'targetAccountId')::bigint]; END IF;
  ELSIF p_action='POSITION_POST' THEN
   lines:=p_terms->'entries';
   IF jsonb_typeof(lines) IS DISTINCT FROM 'array' OR jsonb_array_length(lines) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'position journal requires 2 to 100 entries'; END IF;
   SELECT array_agg(DISTINCT (v->>'accountId')::bigint) INTO ids FROM jsonb_array_elements(lines) v;
  ELSIF p_action='POSITION_REVERSE' THEN
   SELECT * INTO STRICT original FROM public.position_journals WHERE id=(p_terms->>'journalId')::bigint;
   IF original.purpose NOT IN ('POST','TRANSFER') OR original.reversal_of IS NOT NULL THEN RAISE EXCEPTION 'position journal ineligible for reversal'; END IF;
   SELECT jsonb_agg(jsonb_build_object('accountId',e.account_id::text,'tokenId',e.token_id::text,'side',CASE e.side WHEN 'IN' THEN 'OUT' ELSE 'IN' END,'quantity',e.quantity::text) ORDER BY e.id),array_agg(DISTINCT e.account_id) INTO lines,ids FROM public.position_journal_entries e WHERE e.journal_id=original.id;
  ELSIF p_action='POSITION_TRANSFER' THEN ids:=ARRAY[(p_terms->>'sourceAccountId')::bigint,(p_terms->>'targetAccountId')::bigint];
  ELSE ids:=ARRAY[(p_terms->>'accountId')::bigint]; END IF;
  IF ids IS NULL OR array_position(ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'missing position account'; END IF;
  PERFORM id FROM public.position_accounts WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.position_accounts WHERE id=ANY(ids))<>(SELECT count(DISTINCT v) FROM unnest(ids) v) THEN RAISE EXCEPTION 'unknown position account'; END IF;
  IF p_action IN ('POSITION_CONSUME','POSITION_RELEASE','POSITION_CANCEL') THEN
   SELECT * INTO STRICT r FROM public.position_reservations WHERE id=r.id FOR UPDATE;
   IF r.status<>'OPEN' THEN RAISE EXCEPTION 'position reservation closed'; END IF;
   SELECT * INTO STRICT a FROM public.position_accounts WHERE id=r.account_id;
  ELSE SELECT * INTO STRICT a FROM public.position_accounts WHERE id=ids[1]; END IF;
  IF p_actor LIKE 'user:%' AND (a.owner_user_id IS NULL OR p_actor<>'user:'||a.owner_user_id::text) THEN RAISE EXCEPTION 'position access denied' USING ERRCODE='42501'; END IF;
  IF p_action='POSITION_BALANCE' THEN
   RETURN (SELECT jsonb_build_object('accountId',p.account_id::text,'tokenId',a.token_id::text,'posted',p.posted::text,'reserved',p.reserved::text,'available',CASE WHEN a.kind='EXTERNAL_CONTROL' THEN '0' ELSE (p.posted-p.reserved)::text END,'spendable',a.kind<>'EXTERNAL_CONTROL') FROM public.position_balance_projections p WHERE account_id=a.id);
  END IF;
  IF a.kind='EXTERNAL_CONTROL' OR EXISTS(SELECT 1 FROM public.position_accounts WHERE id=ANY(ids) AND kind='EXTERNAL_CONTROL') THEN RAISE EXCEPTION 'external control is not spendable inventory'; END IF;
  IF p_action='POSITION_RESERVE' THEN
   IF jsonb_typeof(p_terms->'reference') IS DISTINCT FROM 'string' OR length(p_terms->>'reference') NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'position reservation reference required'; END IF;
   INSERT INTO public.position_reservations(account_id,operation_id,reference,quantity) VALUES(a.id,op_id,p_terms->>'reference',q) RETURNING id INTO reservation_id;
   INSERT INTO public.position_reservation_events(reservation_id,operation_id,kind,quantity) VALUES(reservation_id,op_id,'RESERVE',q);
   result:=jsonb_build_object('reservationId',reservation_id::text);
  ELSIF p_action IN ('POSITION_CONSUME','POSITION_RELEASE','POSITION_CANCEL') THEN
   remaining:=r.quantity-r.consumed-r.released;
   IF p_action='POSITION_CANCEL' THEN q:=remaining; END IF;
   IF q>remaining THEN RAISE EXCEPTION 'position reservation quantity exceeds remaining'; END IF;
   UPDATE public.position_reservations SET consumed=consumed+CASE WHEN p_action='POSITION_CONSUME' THEN q ELSE 0 END,released=released+CASE WHEN p_action<>'POSITION_CONSUME' THEN q ELSE 0 END,status=CASE WHEN p_action='POSITION_CANCEL' THEN 'CANCELLED' WHEN q=remaining THEN 'CLOSED' ELSE 'OPEN' END WHERE id=r.id;
   IF p_action='POSITION_CONSUME' THEN
    target_id:=(p_terms->>'targetAccountId')::bigint;
    lines:=jsonb_build_array(jsonb_build_object('accountId',r.account_id::text,'tokenId',a.token_id::text,'side','OUT','quantity',q::text),jsonb_build_object('accountId',target_id::text,'tokenId',a.token_id::text,'side','IN','quantity',q::text));
   END IF;
   result:=jsonb_build_object('reservationId',r.id::text);
  ELSIF p_action='POSITION_TRANSFER' THEN
   target_id:=(p_terms->>'targetAccountId')::bigint;
   lines:=jsonb_build_array(jsonb_build_object('accountId',a.id::text,'tokenId',a.token_id::text,'side','OUT','quantity',q::text),jsonb_build_object('accountId',target_id::text,'tokenId',a.token_id::text,'side','IN','quantity',q::text));
  END IF;
  IF p_action IN ('POSITION_POST','POSITION_TRANSFER','POSITION_CONSUME','POSITION_REVERSE') THEN
   IF p_action IN ('POSITION_TRANSFER','POSITION_CONSUME') AND (target_id=a.id OR NOT EXISTS(SELECT 1 FROM public.position_accounts WHERE id=target_id AND token_id=a.token_id AND kind<>'EXTERNAL_CONTROL')) THEN RAISE EXCEPTION 'position transfer target or token mismatch'; END IF;
   IF p_action IN ('POSITION_POST','POSITION_TRANSFER') AND (jsonb_typeof(p_terms->'reference') IS DISTINCT FROM 'string' OR length(p_terms->>'reference') NOT BETWEEN 1 AND 120) THEN RAISE EXCEPTION 'position posting reference required'; END IF;
   INSERT INTO public.position_journals(operation_id,reference,purpose,reversal_of) VALUES(op_id,COALESCE(p_terms->>'reference',p_key),CASE p_action WHEN 'POSITION_POST' THEN 'POST' WHEN 'POSITION_TRANSFER' THEN 'TRANSFER' WHEN 'POSITION_CONSUME' THEN 'CONSUMPTION' ELSE 'REVERSAL' END,CASE WHEN p_action='POSITION_REVERSE' THEN original.id ELSE NULL END) RETURNING id INTO journal_id;
   FOR entry IN SELECT value FROM jsonb_array_elements(lines) LOOP
    IF entry-ARRAY['accountId','tokenId','side','quantity']<>'{}'::jsonb OR jsonb_typeof(entry->'quantity') IS DISTINCT FROM 'string' OR (entry->>'quantity') !~ '^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'invalid position entry'; END IF;
    INSERT INTO public.position_journal_entries(journal_id,account_id,token_id,side,quantity) VALUES(journal_id,(entry->>'accountId')::bigint,(entry->>'tokenId')::bigint,entry->>'side',(entry->>'quantity')::bigint);
   END LOOP;
   UPDATE public.position_journals SET status='POSTED' WHERE id=journal_id;
   result:=COALESCE(result,'{}'::jsonb)||jsonb_build_object('journalId',journal_id::text);
  END IF;
  IF p_action IN ('POSITION_CONSUME','POSITION_RELEASE','POSITION_CANCEL') THEN INSERT INTO public.position_reservation_events(reservation_id,operation_id,kind,quantity,journal_id) VALUES(r.id,op_id,substring(p_action from 10),q,journal_id); END IF;
 END IF;
 UPDATE public.financial_operations SET result=positions.result WHERE id=op_id;
 RETURN result;
END $$;

--> statement-breakpoint
REVOKE ALL ON public.market_observation_specs,public.market_outcome_tokens FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_market_definition(uuid,boolean),public.check_market_definition_change(),public.protect_market_outcome_token(),public.map_registered_outcome_token() FROM PUBLIC;

--> statement-breakpoint
-- Registry approval does not authorize categorical accounting. No runtime override exists.
CREATE FUNCTION public.block_unsupported_position_accounting() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE token bigint; account bigint;
BEGIN
 token := (to_jsonb(NEW)->>'token_id')::bigint;
 account := (to_jsonb(NEW)->>'account_id')::bigint;
 IF token IS NULL AND account IS NOT NULL THEN
  SELECT token_id INTO token FROM public.position_accounts WHERE id=account;
 END IF;
 IF EXISTS (SELECT 1 FROM public.ctf_position_tokens t
  JOIN public.ctf_conditions c ON c.id=t.condition_id
  JOIN public.market_questions q ON q.id=c.market_question_id
  JOIN public.markets m ON m.id=q.market_id
  WHERE t.id=token AND m.market_type<>'BINARY') THEN
  RAISE EXCEPTION 'categorical accounting requires Phase 4.4 approval' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER position_accounts_binary_accounting_only BEFORE INSERT OR UPDATE ON public.position_accounts FOR EACH ROW EXECUTE FUNCTION public.block_unsupported_position_accounting();
--> statement-breakpoint
CREATE TRIGGER position_journal_entries_binary_accounting_only BEFORE INSERT OR UPDATE ON public.position_journal_entries FOR EACH ROW EXECUTE FUNCTION public.block_unsupported_position_accounting();
--> statement-breakpoint
CREATE TRIGGER position_reservations_binary_accounting_only BEFORE INSERT OR UPDATE ON public.position_reservations FOR EACH ROW EXECUTE FUNCTION public.block_unsupported_position_accounting();
--> statement-breakpoint
CREATE TRIGGER position_balance_projections_binary_accounting_only BEFORE INSERT OR UPDATE ON public.position_balance_projections FOR EACH ROW EXECUTE FUNCTION public.block_unsupported_position_accounting();
--> statement-breakpoint
CREATE TRIGGER cash_position_settlements_binary_accounting_only BEFORE INSERT OR UPDATE ON public.cash_position_settlements FOR EACH ROW EXECUTE FUNCTION public.block_unsupported_position_accounting();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.block_unsupported_position_accounting() FROM PUBLIC;
