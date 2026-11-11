CREATE TABLE "chain_assets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chain_assets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"chain_id" numeric(78, 0) NOT NULL,
	"contract_address" char(42) NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"name" varchar(100) NOT NULL,
	"decimals" smallint NOT NULL,
	"asset_type" varchar(20) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_assets_chain_address_key" UNIQUE("chain_id","contract_address"),
	CONSTRAINT "chain_assets_contract_address_check" CHECK ("chain_assets"."contract_address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "chain_assets_symbol_check" CHECK ("chain_assets"."symbol" ~ '^[A-Z][A-Z0-9_]{0,31}$'),
	CONSTRAINT "chain_assets_decimals_check" CHECK ("chain_assets"."decimals" BETWEEN 0 AND 255),
	CONSTRAINT "chain_assets_asset_type_check" CHECK ("chain_assets"."asset_type" IN ('ERC20', 'ERC1155'))
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chains_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"chain_id" numeric(78, 0) NOT NULL,
	"name" varchar(100) NOT NULL,
	"environment" varchar(20) NOT NULL,
	"native_symbol" varchar(20) NOT NULL,
	"rpc_config_reference" varchar(255),
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chains_chain_id_key" UNIQUE("chain_id"),
	CONSTRAINT "chains_name_environment_key" UNIQUE("name","environment"),
	CONSTRAINT "chains_chain_id_positive" CHECK ("chains"."chain_id" > 0),
	CONSTRAINT "chains_environment_check" CHECK ("chains"."environment" IN ('testnet', 'mainnet')),
	CONSTRAINT "chains_native_symbol_check" CHECK ("chains"."native_symbol" ~ '^[A-Z][A-Z0-9_]{0,19}$'),
	CONSTRAINT "chains_rpc_config_reference_check" CHECK ("chains"."rpc_config_reference" IS NULL
        OR "chains"."rpc_config_reference" ~ '^[A-Z][A-Z0-9_]{0,254}$')
);
--> statement-breakpoint
CREATE TABLE "contract_deployments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contract_deployments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"chain_id" numeric(78, 0) NOT NULL,
	"contract_address" char(42),
	"contract_role" varchar(40) NOT NULL,
	"contract_version" varchar(50) NOT NULL,
	"deployment_tx_hash" char(66),
	"deployment_block_number" numeric(78, 0),
	"deployment_status" varchar(20) DEFAULT 'PLANNED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_deployments_role_version_key" UNIQUE("chain_id","contract_role","contract_version"),
	CONSTRAINT "contract_deployments_address_check" CHECK ("contract_deployments"."contract_address" IS NULL
        OR "contract_deployments"."contract_address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "contract_deployments_role_check" CHECK ("contract_deployments"."contract_role" ~ '^[A-Z][A-Z0-9_]{0,39}$'),
	CONSTRAINT "contract_deployments_version_check" CHECK (length(btrim("contract_deployments"."contract_version")) > 0),
	CONSTRAINT "contract_deployments_tx_hash_check" CHECK ("contract_deployments"."deployment_tx_hash" IS NULL
        OR "contract_deployments"."deployment_tx_hash" ~ '^0x[0-9a-f]{64}$'),
	CONSTRAINT "contract_deployments_block_number_check" CHECK ("contract_deployments"."deployment_block_number" IS NULL
        OR "contract_deployments"."deployment_block_number" >= 0),
	CONSTRAINT "contract_deployments_status_check" CHECK ("contract_deployments"."deployment_status" IN (
        'PLANNED',
        'PENDING',
        'CONFIRMED',
        'FAILED',
        'RETIRED'
      )),
	CONSTRAINT "contract_deployments_metadata_check" CHECK ((
        "contract_deployments"."deployment_status" = 'PLANNED'
        AND "contract_deployments"."contract_address" IS NULL
        AND "contract_deployments"."deployment_tx_hash" IS NULL
        AND "contract_deployments"."deployment_block_number" IS NULL
      ) OR (
        "contract_deployments"."deployment_status" = 'PENDING'
        AND "contract_deployments"."deployment_tx_hash" IS NOT NULL
        AND "contract_deployments"."deployment_block_number" IS NULL
      ) OR (
        "contract_deployments"."deployment_status" IN ('CONFIRMED', 'RETIRED')
        AND "contract_deployments"."contract_address" IS NOT NULL
        AND "contract_deployments"."deployment_tx_hash" IS NOT NULL
        AND "contract_deployments"."deployment_block_number" IS NOT NULL
      ) OR "contract_deployments"."deployment_status" = 'FAILED')
);
--> statement-breakpoint
ALTER TABLE "chain_assets" ADD CONSTRAINT "chain_assets_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_deployments" ADD CONSTRAINT "contract_deployments_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chain_assets_chain_enabled" ON "chain_assets" USING btree ("chain_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_contract_deployments_chain_address_unique" ON "contract_deployments" USING btree ("chain_id","contract_address") WHERE "contract_deployments"."contract_address" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_contract_deployments_active_role_unique" ON "contract_deployments" USING btree ("chain_id","contract_role") WHERE "contract_deployments"."deployment_status" = 'CONFIRMED';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_contract_deployments_chain_tx_hash_unique" ON "contract_deployments" USING btree ("chain_id","deployment_tx_hash") WHERE "contract_deployments"."deployment_tx_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_contract_deployments_status" ON "contract_deployments" USING btree ("deployment_status","chain_id");