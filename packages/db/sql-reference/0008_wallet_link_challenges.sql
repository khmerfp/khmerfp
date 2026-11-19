-- READING COPY ONLY: do not execute or use as a migration.
-- Executable source: packages/db/migrations/0008_wallet_link_challenges.sql
-- Original statement order, object names, quoted values and Drizzle boundaries are preserved.
-- Function versions are historical: apply the migration chain to determine the current definition.

-- ============================================================================
-- TABLES (original execution order preserved)
-- ============================================================================
-- Single-use wallet ownership challenges bound to user, session, chain and action.
CREATE TABLE "wallet_link_challenges"(
    "id" uuid PRIMARY KEY NOT NULL,
    "user_id" bigint NOT NULL,
    "session_hash" char(64) NOT NULL,
    "chain_id" numeric(78, 0) NOT NULL,
    "wallet_address" char(42) NOT NULL,
    "action" varchar(10) NOT NULL,
    "app_origin" text NOT NULL,
    "nonce" char(66) NOT NULL,
    "typed_data" jsonb NOT NULL,
    "payload_hash" char(66) NOT NULL,
    "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    CONSTRAINT "wallet_link_challenges_nonce_key" UNIQUE ("nonce"),
    CONSTRAINT "wallet_link_challenges_address_check" CHECK ("wallet_link_challenges"."wallet_address" ~ '^0x[0-9a-f]{40}$' AND "wallet_link_challenges"."wallet_address" <> '0x0000000000000000000000000000000000000000'),
    CONSTRAINT "wallet_link_challenges_session_hash_check" CHECK ("wallet_link_challenges"."session_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "wallet_link_challenges_action_check" CHECK ("wallet_link_challenges"."action" IN ('LINK', 'UNLINK', 'RELINK')),
    CONSTRAINT "wallet_link_challenges_origin_check" CHECK (length("wallet_link_challenges"."app_origin") BETWEEN 1 AND 512),
    CONSTRAINT "wallet_link_challenges_nonce_check" CHECK ("wallet_link_challenges"."nonce" ~ '^0x[0-9a-f]{64}$'),
    CONSTRAINT "wallet_link_challenges_hash_check" CHECK ("wallet_link_challenges"."payload_hash" ~ '^0x[0-9a-f]{64}$'),
    CONSTRAINT "wallet_link_challenges_expiry_check" CHECK ("wallet_link_challenges"."expires_at" > "wallet_link_challenges"."created_at" AND "wallet_link_challenges"."expires_at" <= "wallet_link_challenges"."created_at" + interval '2 minutes'),
    CONSTRAINT "wallet_link_challenges_consumed_check" CHECK ("wallet_link_challenges"."consumed_at" IS NULL OR ("wallet_link_challenges"."consumed_at" >= "wallet_link_challenges"."created_at" AND "wallet_link_challenges"."consumed_at" < "wallet_link_challenges"."expires_at")),
    CONSTRAINT "wallet_link_challenges_payload_check" CHECK ((jsonb_typeof("wallet_link_challenges"."typed_data") = 'object' AND "wallet_link_challenges"."typed_data" ->> 'primaryType' = 'WalletLink' AND "wallet_link_challenges"."typed_data" #>> '{domain,name}' = 'KhmerFP Wallet Ownership' AND "wallet_link_challenges"."typed_data" #>> '{domain,version}' = '1' AND "wallet_link_challenges"."typed_data" #>> '{domain,chainId}' = "wallet_link_challenges"."chain_id"::text AND "wallet_link_challenges"."typed_data" #>> '{message,challengeId}' = "wallet_link_challenges"."id"::text AND "wallet_link_challenges"."typed_data" #>> '{message,userId}' = "wallet_link_challenges"."user_id"::text AND "wallet_link_challenges"."typed_data" #>> '{message,wallet}' = "wallet_link_challenges"."wallet_address"::text AND "wallet_link_challenges"."typed_data" #>> '{message,action}' = "wallet_link_challenges"."action" AND "wallet_link_challenges"."typed_data" #>> '{message,appOrigin}' = "wallet_link_challenges"."app_origin" AND "wallet_link_challenges"."typed_data" #>> '{message,nonce}' = "wallet_link_challenges"."nonce"::text) IS TRUE)
);

--> statement-breakpoint

-- ============================================================================
-- CONSTRAINTS AND TABLE ALTERATIONS (original execution order preserved)
-- ============================================================================
ALTER TABLE "wallet_link_challenges"
    ADD CONSTRAINT "wallet_link_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "wallet_link_challenges"
    ADD CONSTRAINT "wallet_link_challenges_session_hash_fkey" FOREIGN KEY ("session_hash") REFERENCES "public"."sessions"("token_hash") ON DELETE CASCADE ON UPDATE NO action;

--> statement-breakpoint
ALTER TABLE "wallet_link_challenges"
    ADD CONSTRAINT "wallet_link_challenges_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE RESTRICT ON UPDATE NO action;

--> statement-breakpoint

-- ============================================================================
-- INDEXES (original execution order preserved)
-- ============================================================================
CREATE INDEX "idx_wallet_link_challenges_user_created" ON "wallet_link_challenges" USING btree("user_id", "created_at" DESC NULLS FIRST);

--> statement-breakpoint
CREATE INDEX "idx_wallet_link_challenges_session" ON "wallet_link_challenges" USING btree("session_hash");

--> statement-breakpoint
CREATE INDEX "idx_wallet_link_challenges_expiry" ON "wallet_link_challenges" USING btree("expires_at");

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Protects immutable, session-bound challenge terms and atomic one-time consumption.
CREATE FUNCTION public.protect_wallet_link_challenge()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.consumed_at IS NOT NULL OR NEW.created_at > clock_timestamp() OR NEW.expires_at <= clock_timestamp() THEN
            RAISE EXCEPTION 'invalid initial wallet challenge state'
                USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS(
            SELECT
                1
            FROM
                public.sessions
            WHERE
                token_hash = NEW.session_hash
                AND user_id = NEW.user_id
                AND revoked_at IS NULL
                AND expires_at > clock_timestamp()
                AND idle_expires_at > clock_timestamp()) THEN
            RAISE EXCEPTION 'wallet challenge session does not belong to active user'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF(to_jsonb(NEW) - 'consumed_at') IS DISTINCT FROM(to_jsonb(OLD) - 'consumed_at') THEN
            RAISE EXCEPTION 'wallet challenge terms are immutable'
                USING ERRCODE = '23514';
        END IF;
        IF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL OR NEW.consumed_at > clock_timestamp() OR NEW.expires_at <= clock_timestamp() THEN
            RAISE EXCEPTION 'wallet challenge may only be consumed once before expiry'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

--> statement-breakpoint

-- ============================================================================
-- TRIGGERS (original execution order preserved)
-- ============================================================================
-- Protects immutable, session-bound challenge terms and atomic one-time consumption.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER wallet_link_challenges_protect_state
    BEFORE INSERT OR UPDATE ON public.wallet_link_challenges
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_wallet_link_challenge();
