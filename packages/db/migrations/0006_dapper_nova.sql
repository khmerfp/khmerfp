CREATE TABLE "ctf_conditions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ctf_conditions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"market_question_id" uuid NOT NULL,
	"chain_id" numeric(78, 0) NOT NULL,
	"ctf_contract_deployment_id" bigint NOT NULL,
	"oracle_contract_deployment_id" bigint,
	"oracle_address" char(42) NOT NULL,
	"ctf_question_id" char(66) NOT NULL,
	"condition_id" char(66) NOT NULL,
	"outcome_slot_count" smallint DEFAULT 2 NOT NULL,
	"collateral_asset_id" bigint NOT NULL,
	"registration_status" varchar(20) DEFAULT 'DERIVED' NOT NULL,
	"preparation_tx_hash" char(66),
	"preparation_block_number" numeric(78, 0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ctf_conditions_market_question_key" UNIQUE("market_question_id"),
	CONSTRAINT "ctf_conditions_chain_condition_key" UNIQUE("chain_id","ctf_contract_deployment_id","condition_id"),
	CONSTRAINT "ctf_conditions_id_question_key" UNIQUE("id","market_question_id"),
	CONSTRAINT "ctf_conditions_oracle_address_check" CHECK ("ctf_conditions"."oracle_address" ~ '^0x[0-9a-f]{40}$'
        AND "ctf_conditions"."oracle_address" = lower("ctf_conditions"."oracle_address")),
	CONSTRAINT "ctf_conditions_question_id_check" CHECK ("ctf_conditions"."ctf_question_id" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "ctf_conditions_condition_id_check" CHECK ("ctf_conditions"."condition_id" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "ctf_conditions_outcome_slot_count_check" CHECK ("ctf_conditions"."outcome_slot_count" = 2),
	CONSTRAINT "ctf_conditions_status_check" CHECK ("ctf_conditions"."registration_status" IN (
        'DERIVED', 'SUBMITTED', 'PREPARED', 'FAILED'
      )),
	CONSTRAINT "ctf_conditions_tx_hash_check" CHECK ("ctf_conditions"."preparation_tx_hash" IS NULL
        OR "ctf_conditions"."preparation_tx_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "ctf_conditions_block_number_check" CHECK ("ctf_conditions"."preparation_block_number" IS NULL
        OR "ctf_conditions"."preparation_block_number" >= 0),
	CONSTRAINT "ctf_conditions_status_evidence_check" CHECK ((
        "ctf_conditions"."registration_status" = 'DERIVED'
        AND "ctf_conditions"."preparation_tx_hash" IS NULL
        AND "ctf_conditions"."preparation_block_number" IS NULL
      ) OR (
        "ctf_conditions"."registration_status" = 'SUBMITTED'
        AND "ctf_conditions"."preparation_tx_hash" IS NOT NULL
        AND "ctf_conditions"."preparation_block_number" IS NULL
      ) OR (
        "ctf_conditions"."registration_status" = 'PREPARED'
        AND "ctf_conditions"."preparation_tx_hash" IS NOT NULL
        AND "ctf_conditions"."preparation_block_number" IS NOT NULL
      ) OR (
        "ctf_conditions"."registration_status" = 'FAILED'
        AND "ctf_conditions"."preparation_block_number" IS NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "ctf_position_tokens" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ctf_position_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"condition_id" bigint NOT NULL,
	"market_outcome_id" bigint NOT NULL,
	"chain_id" numeric(78, 0) NOT NULL,
	"ctf_contract_deployment_id" bigint NOT NULL,
	"collateral_asset_id" bigint NOT NULL,
	"outcome_index" smallint NOT NULL,
	"index_set" numeric(78, 0) NOT NULL,
	"parent_collection_id" char(66) DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	"collection_id" char(66) NOT NULL,
	"position_id" numeric(78, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ctf_position_tokens_condition_outcome_key" UNIQUE("condition_id","market_outcome_id"),
	CONSTRAINT "ctf_position_tokens_condition_index_key" UNIQUE("condition_id","outcome_index"),
	CONSTRAINT "ctf_position_tokens_condition_index_set_key" UNIQUE("condition_id","index_set"),
	CONSTRAINT "ctf_position_tokens_chain_position_key" UNIQUE("chain_id","ctf_contract_deployment_id","position_id"),
	CONSTRAINT "ctf_position_tokens_condition_collection_key" UNIQUE("condition_id","collection_id"),
	CONSTRAINT "ctf_position_tokens_binary_mapping_check" CHECK (("ctf_position_tokens"."outcome_index" = 0 AND "ctf_position_tokens"."index_set" = 1)
        OR ("ctf_position_tokens"."outcome_index" = 1 AND "ctf_position_tokens"."index_set" = 2)),
	CONSTRAINT "ctf_position_tokens_root_collection_check" CHECK ("ctf_position_tokens"."parent_collection_id" =
        '0x0000000000000000000000000000000000000000000000000000000000000000'),
	CONSTRAINT "ctf_position_tokens_collection_id_check" CHECK ("ctf_position_tokens"."collection_id" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "ctf_position_tokens_position_id_check" CHECK ("ctf_position_tokens"."position_id" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ctf_conditions" ADD CONSTRAINT "ctf_conditions_market_question_id_fkey" FOREIGN KEY ("market_question_id") REFERENCES "public"."market_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ctf_conditions" ADD CONSTRAINT "ctf_conditions_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ctf_conditions" ADD CONSTRAINT "ctf_conditions_ctf_contract_deployment_id_fkey" FOREIGN KEY ("ctf_contract_deployment_id") REFERENCES "public"."contract_deployments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ctf_conditions" ADD CONSTRAINT "ctf_conditions_oracle_contract_deployment_id_fkey" FOREIGN KEY ("oracle_contract_deployment_id") REFERENCES "public"."contract_deployments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ctf_conditions" ADD CONSTRAINT "ctf_conditions_collateral_asset_id_fkey" FOREIGN KEY ("collateral_asset_id") REFERENCES "public"."chain_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ctf_position_tokens" ADD CONSTRAINT "ctf_position_tokens_condition_id_fkey" FOREIGN KEY ("condition_id") REFERENCES "public"."ctf_conditions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ctf_position_tokens" ADD CONSTRAINT "ctf_position_tokens_market_outcome_id_fkey" FOREIGN KEY ("market_outcome_id") REFERENCES "public"."market_outcomes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ctf_position_tokens" ADD CONSTRAINT "ctf_position_tokens_collateral_asset_id_fkey" FOREIGN KEY ("collateral_asset_id") REFERENCES "public"."chain_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ctf_conditions_chain_status" ON "ctf_conditions" USING btree ("chain_id","registration_status");--> statement-breakpoint
CREATE INDEX "idx_ctf_conditions_ctf_question" ON "ctf_conditions" USING btree ("chain_id","ctf_question_id");--> statement-breakpoint
CREATE FUNCTION enforce_ctf_condition_registry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM contract_deployments deployment
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
		FROM chain_assets asset
		WHERE asset.id = NEW.collateral_asset_id
			AND asset.chain_id = NEW.chain_id
			AND asset.asset_type = 'ERC20'
	) THEN
		RAISE EXCEPTION 'CTF condition collateral must be an ERC20 asset on its chain';
	END IF;

	IF NEW.oracle_contract_deployment_id IS NOT NULL AND NOT EXISTS (
		SELECT 1
		FROM contract_deployments deployment
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
		FROM market_questions question
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
$$;--> statement-breakpoint
CREATE TRIGGER ctf_conditions_enforce_registry
	BEFORE INSERT OR UPDATE ON ctf_conditions
	FOR EACH ROW
	EXECUTE FUNCTION enforce_ctf_condition_registry();--> statement-breakpoint
CREATE FUNCTION enforce_ctf_position_token_registry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	condition_question_id uuid;
	outcome_question_id uuid;
	outcome_position_index smallint;
BEGIN
	SELECT condition.market_question_id
	INTO condition_question_id
	FROM ctf_conditions condition
	WHERE condition.id = NEW.condition_id
		AND condition.chain_id = NEW.chain_id
		AND condition.ctf_contract_deployment_id = NEW.ctf_contract_deployment_id
		AND condition.collateral_asset_id = NEW.collateral_asset_id;

	IF condition_question_id IS NULL THEN
		RAISE EXCEPTION 'CTF position token must match its condition chain, deployment, and collateral';
	END IF;

	SELECT outcome.question_id, outcome.outcome_index
	INTO outcome_question_id, outcome_position_index
	FROM market_outcomes outcome
	WHERE outcome.id = NEW.market_outcome_id;

	IF outcome_question_id IS DISTINCT FROM condition_question_id
		OR outcome_position_index IS DISTINCT FROM NEW.outcome_index THEN
		RAISE EXCEPTION 'CTF position token outcome does not match its condition';
	END IF;

	IF TG_OP = 'UPDATE' AND (
		NEW.condition_id IS DISTINCT FROM OLD.condition_id
		OR NEW.market_outcome_id IS DISTINCT FROM OLD.market_outcome_id
		OR NEW.chain_id IS DISTINCT FROM OLD.chain_id
		OR NEW.ctf_contract_deployment_id IS DISTINCT FROM OLD.ctf_contract_deployment_id
		OR NEW.collateral_asset_id IS DISTINCT FROM OLD.collateral_asset_id
		OR NEW.outcome_index IS DISTINCT FROM OLD.outcome_index
		OR NEW.index_set IS DISTINCT FROM OLD.index_set
		OR NEW.parent_collection_id IS DISTINCT FROM OLD.parent_collection_id
		OR NEW.collection_id IS DISTINCT FROM OLD.collection_id
		OR NEW.position_id IS DISTINCT FROM OLD.position_id
	) THEN
		RAISE EXCEPTION 'CTF position token identity is immutable';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER ctf_position_tokens_enforce_registry
	BEFORE INSERT OR UPDATE ON ctf_position_tokens
	FOR EACH ROW
	EXECUTE FUNCTION enforce_ctf_position_token_registry();
