CREATE TABLE "market_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "market_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_id" bigint,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_categories_slug_key" UNIQUE("slug"),
	CONSTRAINT "market_categories_name_check" CHECK (length(btrim("market_categories"."name")) > 0),
	CONSTRAINT "market_categories_slug_check" CHECK ("market_categories"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "market_categories_parent_check" CHECK ("market_categories"."parent_id" IS NULL OR "market_categories"."parent_id" <> "market_categories"."id")
);
--> statement-breakpoint
CREATE TABLE "market_outcomes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "market_outcomes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"market_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"outcome_index" smallint NOT NULL,
	"outcome_label" varchar(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_outcomes_question_index_key" UNIQUE("question_id","outcome_index"),
	CONSTRAINT "market_outcomes_question_label_key" UNIQUE("question_id","outcome_label"),
	CONSTRAINT "market_outcomes_binary_pair_check" CHECK (("market_outcomes"."outcome_index" = 0 AND "market_outcomes"."outcome_label" = 'YES')
        OR ("market_outcomes"."outcome_index" = 1 AND "market_outcomes"."outcome_label" = 'NO'))
);
--> statement-breakpoint
CREATE TABLE "market_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"oracle_contract_deployment_id" bigint,
	"question_text" text NOT NULL,
	"resolution_rules" text NOT NULL,
	"resolution_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_questions_market_id_key" UNIQUE("market_id"),
	CONSTRAINT "market_questions_market_id_id_key" UNIQUE("market_id","id"),
	CONSTRAINT "market_questions_text_check" CHECK (length(btrim("market_questions"."question_text")) > 0),
	CONSTRAINT "market_questions_resolution_rules_check" CHECK (length(btrim("market_questions"."resolution_rules")) > 0),
	CONSTRAINT "market_questions_resolution_source_check" CHECK (length(btrim("market_questions"."resolution_source")) > 0)
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" bigint NOT NULL,
	"created_by_user_id" bigint,
	"slug" varchar(160) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"lifecycle_status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"trading_status" varchar(20) DEFAULT 'NOT_STARTED' NOT NULL,
	"resolution_status" varchar(20) DEFAULT 'UNRESOLVED' NOT NULL,
	"trading_starts_at" timestamp with time zone NOT NULL,
	"trading_ends_at" timestamp with time zone NOT NULL,
	"resolution_deadline" timestamp with time zone NOT NULL,
	"terms_hash" char(66),
	"terms_frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_slug_key" UNIQUE("slug"),
	CONSTRAINT "markets_title_check" CHECK (length(btrim("markets"."title")) > 0),
	CONSTRAINT "markets_description_check" CHECK (length(btrim("markets"."description")) > 0),
	CONSTRAINT "markets_slug_check" CHECK ("markets"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "markets_lifecycle_status_check" CHECK ("markets"."lifecycle_status" IN (
        'DRAFT', 'REVIEW', 'SCHEDULED', 'ACTIVE', 'CANCELLED', 'ARCHIVED'
      )),
	CONSTRAINT "markets_trading_status_check" CHECK ("markets"."trading_status" IN ('NOT_STARTED', 'OPEN', 'PAUSED', 'CLOSED')),
	CONSTRAINT "markets_resolution_status_check" CHECK ("markets"."resolution_status" IN (
        'UNRESOLVED', 'PENDING', 'RESOLVED', 'INVALID'
      )),
	CONSTRAINT "markets_trading_window_check" CHECK ("markets"."trading_ends_at" > "markets"."trading_starts_at"),
	CONSTRAINT "markets_resolution_deadline_check" CHECK ("markets"."resolution_deadline" >= "markets"."trading_ends_at"),
	CONSTRAINT "markets_terms_hash_check" CHECK ("markets"."terms_hash" IS NULL OR "markets"."terms_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "markets_terms_freeze_pair_check" CHECK (("markets"."terms_hash" IS NULL) = ("markets"."terms_frozen_at" IS NULL)),
	CONSTRAINT "markets_frozen_before_trading_check" CHECK ("markets"."trading_status" = 'NOT_STARTED'
        OR ("markets"."terms_hash" IS NOT NULL AND "markets"."terms_frozen_at" IS NOT NULL)),
	CONSTRAINT "markets_frozen_lifecycle_check" CHECK ("markets"."lifecycle_status" IN ('DRAFT', 'REVIEW', 'CANCELLED')
        OR ("markets"."terms_hash" IS NOT NULL AND "markets"."terms_frozen_at" IS NOT NULL)),
	CONSTRAINT "markets_open_lifecycle_check" CHECK ("markets"."trading_status" <> 'OPEN' OR "markets"."lifecycle_status" = 'ACTIVE'),
	CONSTRAINT "markets_resolution_requires_closed_check" CHECK ("markets"."resolution_status" = 'UNRESOLVED'
        OR "markets"."trading_status" = 'CLOSED')
);
--> statement-breakpoint
ALTER TABLE "market_categories" ADD CONSTRAINT "market_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."market_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_outcomes" ADD CONSTRAINT "market_outcomes_market_question_fkey" FOREIGN KEY ("market_id","question_id") REFERENCES "public"."market_questions"("market_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_questions" ADD CONSTRAINT "market_questions_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_questions" ADD CONSTRAINT "market_questions_oracle_contract_deployment_id_fkey" FOREIGN KEY ("oracle_contract_deployment_id") REFERENCES "public"."contract_deployments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."market_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_market_categories_parent_active" ON "market_categories" USING btree ("parent_id","active");--> statement-breakpoint
CREATE INDEX "idx_markets_category_lifecycle" ON "markets" USING btree ("category_id","lifecycle_status");--> statement-breakpoint
CREATE INDEX "idx_markets_trading_end" ON "markets" USING btree ("trading_status","trading_ends_at");--> statement-breakpoint
CREATE INDEX "idx_markets_resolution_deadline" ON "markets" USING btree ("resolution_status","resolution_deadline");
--> statement-breakpoint
CREATE FUNCTION protect_frozen_market_terms()
RETURNS trigger
LANGUAGE plpgsql
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

		IF OLD.terms_frozen_at IS NULL AND NEW.terms_frozen_at IS NOT NULL THEN
			SELECT count(*) INTO binary_outcome_count
			FROM market_outcomes
			WHERE market_id = OLD.id;

			IF binary_outcome_count <> 2 THEN
				RAISE EXCEPTION 'binary market requires exactly two outcomes before terms are frozen';
			END IF;
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
				OR NEW.terms_frozen_at IS DISTINCT FROM OLD.terms_frozen_at THEN
				RAISE EXCEPTION 'frozen market terms cannot be changed';
			END IF;
		END IF;

		IF TG_OP = 'DELETE' THEN
			RETURN OLD;
		END IF;

		RETURN NEW;
	END IF;

	IF TG_OP = 'INSERT' THEN
		SELECT EXISTS (
			SELECT 1 FROM markets
			WHERE id = NEW.market_id AND terms_frozen_at IS NOT NULL
		) INTO market_is_frozen;
	ELSIF TG_OP = 'DELETE' THEN
		SELECT EXISTS (
			SELECT 1 FROM markets
			WHERE id = OLD.market_id AND terms_frozen_at IS NOT NULL
		) INTO market_is_frozen;
	ELSE
		SELECT EXISTS (
			SELECT 1 FROM markets
			WHERE id IN (OLD.market_id, NEW.market_id)
				AND terms_frozen_at IS NOT NULL
		) INTO market_is_frozen;
	END IF;

	IF market_is_frozen THEN
		RAISE EXCEPTION 'frozen market questions and outcomes cannot be changed';
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER markets_protect_frozen_terms
BEFORE INSERT OR UPDATE OR DELETE ON markets
FOR EACH ROW
EXECUTE FUNCTION protect_frozen_market_terms();
--> statement-breakpoint
CREATE TRIGGER market_questions_protect_frozen_terms
BEFORE INSERT OR UPDATE OR DELETE ON market_questions
FOR EACH ROW
EXECUTE FUNCTION protect_frozen_market_terms();
--> statement-breakpoint
CREATE TRIGGER market_outcomes_protect_frozen_terms
BEFORE INSERT OR UPDATE OR DELETE ON market_outcomes
FOR EACH ROW
EXECUTE FUNCTION protect_frozen_market_terms();
