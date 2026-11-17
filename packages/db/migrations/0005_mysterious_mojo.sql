CREATE TABLE "user_wallets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_wallets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"chain_id" numeric(78, 0) NOT NULL,
	"wallet_address" char(42) NOT NULL,
	"wallet_type" varchar(20) NOT NULL,
	"custody_model" varchar(30) DEFAULT 'USER_CONTROLLED' NOT NULL,
	"wallet_provider" varchar(50),
	"provider_external_reference" varchar(255),
	"ownership_verification_status" varchar(20) DEFAULT 'UNVERIFIED' NOT NULL,
	"ownership_verified_at" timestamp with time zone,
	"is_primary" boolean DEFAULT false NOT NULL,
	"wallet_status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_wallets_chain_address_key" UNIQUE("chain_id","wallet_address"),
	CONSTRAINT "user_wallets_address_check" CHECK ("user_wallets"."wallet_address" ~ '^0x[0-9a-f]{40}$'
        AND "user_wallets"."wallet_address" = lower("user_wallets"."wallet_address")),
	CONSTRAINT "user_wallets_wallet_type_check" CHECK ("user_wallets"."wallet_type" IN ('EOA', 'SMART_ACCOUNT')),
	CONSTRAINT "user_wallets_custody_model_check" CHECK ("user_wallets"."custody_model" IN ('USER_CONTROLLED', 'HYBRID_RESTRICTED')),
	CONSTRAINT "user_wallets_provider_pair_check" CHECK (("user_wallets"."wallet_provider" IS NULL) =
        ("user_wallets"."provider_external_reference" IS NULL)),
	CONSTRAINT "user_wallets_provider_check" CHECK ("user_wallets"."wallet_provider" IS NULL
        OR length(btrim("user_wallets"."wallet_provider")) > 0),
	CONSTRAINT "user_wallets_verification_status_check" CHECK ("user_wallets"."ownership_verification_status" IN (
        'UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'
      )),
	CONSTRAINT "user_wallets_verification_timestamp_check" CHECK (("user_wallets"."ownership_verification_status" = 'VERIFIED') =
        ("user_wallets"."ownership_verified_at" IS NOT NULL)),
	CONSTRAINT "user_wallets_status_check" CHECK ("user_wallets"."wallet_status" IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
	CONSTRAINT "user_wallets_active_verification_check" CHECK ("user_wallets"."wallet_status" <> 'ACTIVE'
        OR "user_wallets"."ownership_verification_status" = 'VERIFIED'),
	CONSTRAINT "user_wallets_primary_active_check" CHECK (NOT "user_wallets"."is_primary" OR "user_wallets"."wallet_status" = 'ACTIVE')
);
--> statement-breakpoint
CREATE TABLE "wallet_authorizations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wallet_authorizations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"wallet_id" bigint NOT NULL,
	"authorization_type" varchar(30) NOT NULL,
	"authorization_scope" varchar(50) NOT NULL,
	"authorized_contract_deployment_id" bigint,
	"authorized_operator_address" char(42),
	"eip712_domain_name" varchar(100),
	"eip712_domain_version" varchar(50),
	"authorization_reference" varchar(255) NOT NULL,
	"authorization_nonce" numeric(78, 0),
	"payload_hash" char(66) NOT NULL,
	"signature_hash" char(66),
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"authorization_status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_authorizations_wallet_reference_key" UNIQUE("wallet_id","authorization_reference"),
	CONSTRAINT "wallet_authorizations_type_check" CHECK ("wallet_authorizations"."authorization_type" IN (
        'EIP712_SIGNATURE', 'ONCHAIN_APPROVAL', 'SESSION_POLICY'
      )),
	CONSTRAINT "wallet_authorizations_scope_check" CHECK ("wallet_authorizations"."authorization_scope" IN (
        'ORDER_SIGNING', 'TRADE_SETTLEMENT', 'CTF_OPERATIONS', 'REDEMPTION'
      )),
	CONSTRAINT "wallet_authorizations_operator_check" CHECK (num_nonnulls(
        "wallet_authorizations"."authorized_contract_deployment_id",
        "wallet_authorizations"."authorized_operator_address"
      ) = 1),
	CONSTRAINT "wallet_authorizations_operator_address_check" CHECK ("wallet_authorizations"."authorized_operator_address" IS NULL
        OR (
          "wallet_authorizations"."authorized_operator_address" ~ '^0x[0-9a-f]{40}$'
          AND "wallet_authorizations"."authorized_operator_address" =
            lower("wallet_authorizations"."authorized_operator_address")
        )),
	CONSTRAINT "wallet_authorizations_domain_pair_check" CHECK (("wallet_authorizations"."eip712_domain_name" IS NULL) =
        ("wallet_authorizations"."eip712_domain_version" IS NULL)),
	CONSTRAINT "wallet_authorizations_eip712_domain_check" CHECK ("wallet_authorizations"."authorization_type" <> 'EIP712_SIGNATURE'
		OR "wallet_authorizations"."eip712_domain_name" IS NOT NULL),
	CONSTRAINT "wallet_authorizations_nonce_check" CHECK ("wallet_authorizations"."authorization_nonce" IS NULL
        OR "wallet_authorizations"."authorization_nonce" >= 0),
	CONSTRAINT "wallet_authorizations_payload_hash_check" CHECK ("wallet_authorizations"."payload_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "wallet_authorizations_signature_hash_check" CHECK ("wallet_authorizations"."signature_hash" IS NULL
        OR "wallet_authorizations"."signature_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "wallet_authorizations_validity_check" CHECK ("wallet_authorizations"."expires_at" > "wallet_authorizations"."valid_from"),
	CONSTRAINT "wallet_authorizations_status_check" CHECK ("wallet_authorizations"."authorization_status" IN (
        'PENDING', 'VERIFIED', 'REVOKED', 'EXPIRED'
      )),
	CONSTRAINT "wallet_authorizations_verified_metadata_check" CHECK ("wallet_authorizations"."authorization_status" <> 'VERIFIED'
        OR "wallet_authorizations"."signature_hash" IS NOT NULL),
	CONSTRAINT "wallet_authorizations_revocation_check" CHECK (("wallet_authorizations"."authorization_status" = 'REVOKED') =
        ("wallet_authorizations"."revoked_at" IS NOT NULL)),
	CONSTRAINT "wallet_authorizations_expired_metadata_check" CHECK ("wallet_authorizations"."authorization_status" <> 'EXPIRED'
        OR "wallet_authorizations"."expires_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_authorizations" ADD CONSTRAINT "wallet_authorizations_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."user_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_authorizations" ADD CONSTRAINT "wallet_authorizations_contract_deployment_id_fkey" FOREIGN KEY ("authorized_contract_deployment_id") REFERENCES "public"."contract_deployments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_wallets_active_primary_unique" ON "user_wallets" USING btree ("user_id","chain_id") WHERE "user_wallets"."is_primary" AND "user_wallets"."wallet_status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "idx_user_wallets_user_chain_status" ON "user_wallets" USING btree ("user_id","chain_id","wallet_status");--> statement-breakpoint
CREATE INDEX "idx_user_wallets_verification_status" ON "user_wallets" USING btree ("ownership_verification_status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wallet_authorizations_verified_contract_unique" ON "wallet_authorizations" USING btree ("wallet_id","authorization_type","authorization_scope","authorized_contract_deployment_id") WHERE "wallet_authorizations"."authorization_status" = 'VERIFIED'
        AND "wallet_authorizations"."authorized_contract_deployment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wallet_authorizations_verified_operator_unique" ON "wallet_authorizations" USING btree ("wallet_id","authorization_type","authorization_scope","authorized_operator_address") WHERE "wallet_authorizations"."authorization_status" = 'VERIFIED'
        AND "wallet_authorizations"."authorized_operator_address" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_wallet_authorizations_wallet_status" ON "wallet_authorizations" USING btree ("wallet_id","authorization_status");--> statement-breakpoint
CREATE INDEX "idx_wallet_authorizations_expiry" ON "wallet_authorizations" USING btree ("authorization_status","expires_at");--> statement-breakpoint
CREATE FUNCTION protect_user_wallet_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.user_id IS DISTINCT FROM OLD.user_id
		OR NEW.chain_id IS DISTINCT FROM OLD.chain_id
		OR NEW.wallet_address IS DISTINCT FROM OLD.wallet_address THEN
		RAISE EXCEPTION 'blockchain wallet ownership identity cannot be reassigned';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER user_wallets_protect_identity
	BEFORE UPDATE ON user_wallets
	FOR EACH ROW
	EXECUTE FUNCTION protect_user_wallet_identity();--> statement-breakpoint
CREATE FUNCTION protect_wallet_authorization_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.authorized_contract_deployment_id IS NOT NULL
		AND NOT EXISTS (
			SELECT 1
			FROM user_wallets wallet
			JOIN contract_deployments deployment
				ON deployment.id = NEW.authorized_contract_deployment_id
			WHERE wallet.id = NEW.wallet_id
				AND wallet.chain_id = deployment.chain_id
		) THEN
		RAISE EXCEPTION 'wallet authorization target must use the wallet chain';
	END IF;

	IF TG_OP = 'INSERT' THEN
		RETURN NEW;
	END IF;

	IF NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
		OR NEW.authorization_type IS DISTINCT FROM OLD.authorization_type
		OR NEW.authorization_scope IS DISTINCT FROM OLD.authorization_scope
		OR NEW.authorized_contract_deployment_id IS DISTINCT FROM OLD.authorized_contract_deployment_id
		OR NEW.authorized_operator_address IS DISTINCT FROM OLD.authorized_operator_address
		OR NEW.eip712_domain_name IS DISTINCT FROM OLD.eip712_domain_name
		OR NEW.eip712_domain_version IS DISTINCT FROM OLD.eip712_domain_version
		OR NEW.authorization_reference IS DISTINCT FROM OLD.authorization_reference
		OR NEW.authorization_nonce IS DISTINCT FROM OLD.authorization_nonce
		OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
		OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
		OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
		RAISE EXCEPTION 'wallet authorization scope and evidence are immutable';
	END IF;

	IF OLD.authorization_status = 'PENDING' THEN
		IF NEW.authorization_status NOT IN ('PENDING', 'VERIFIED', 'REVOKED', 'EXPIRED') THEN
			RAISE EXCEPTION 'invalid wallet authorization transition';
		END IF;
	ELSIF OLD.authorization_status = 'VERIFIED' THEN
		IF NEW.authorization_status NOT IN ('VERIFIED', 'REVOKED', 'EXPIRED')
			OR NEW.signature_hash IS DISTINCT FROM OLD.signature_hash THEN
			RAISE EXCEPTION 'invalid wallet authorization transition';
		END IF;
	ELSIF NEW IS DISTINCT FROM OLD THEN
		RAISE EXCEPTION 'terminal wallet authorization cannot be changed';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER wallet_authorizations_protect_state
	BEFORE INSERT OR UPDATE ON wallet_authorizations
	FOR EACH ROW
	EXECUTE FUNCTION protect_wallet_authorization_state();
