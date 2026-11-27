CREATE TABLE "binary_complementary_pairs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "binary_complementary_pairs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"market_id" uuid NOT NULL,
	"condition_id" bigint NOT NULL,
	"yes_token_id" bigint NOT NULL,
	"no_token_id" bigint NOT NULL,
	"collateral_asset_id" bigint NOT NULL,
	"full_partition_mask" bigint NOT NULL,
	"outcome_slot_count" integer NOT NULL,
	"mock_only" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "binary_complementary_pairs_market_key" UNIQUE("market_id"),
	CONSTRAINT "binary_complementary_pairs_condition_key" UNIQUE("condition_id"),
	CONSTRAINT "binary_complementary_pairs_tokens_key" UNIQUE("yes_token_id","no_token_id"),
	CONSTRAINT "binary_complementary_pairs_shape_check" CHECK ("binary_complementary_pairs"."yes_token_id"<>"binary_complementary_pairs"."no_token_id" AND "binary_complementary_pairs"."outcome_slot_count"=2 AND "binary_complementary_pairs"."full_partition_mask"=3 AND "binary_complementary_pairs"."mock_only")
);
--> statement-breakpoint
CREATE TABLE "custodial_collateral_accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custodial_collateral_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"pair_id" bigint,
	"asset_id" bigint NOT NULL,
	"account_key" text NOT NULL,
	"kind" text NOT NULL,
	"mock_only" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_collateral_accounts_account_key_unique" UNIQUE("account_key"),
	CONSTRAINT "custodial_collateral_accounts_pair_kind_key" UNIQUE("pair_id","kind"),
	CONSTRAINT "custodial_collateral_accounts_id_asset_key" UNIQUE("id","asset_id"),
	CONSTRAINT "custodial_collateral_accounts_kind_check" CHECK (("custodial_collateral_accounts"."kind"='MOCK_FUNDING_CONTROL' AND "custodial_collateral_accounts"."pair_id" IS NULL) OR ("custodial_collateral_accounts"."kind" IN ('TREASURY_AVAILABLE','CTF_LOCKED') AND "custodial_collateral_accounts"."pair_id" IS NOT NULL)),
	CONSTRAINT "custodial_collateral_accounts_mock_check" CHECK ("custodial_collateral_accounts"."mock_only")
);
--> statement-breakpoint
CREATE TABLE "custodial_collateral_projections" (
	"account_id" bigint PRIMARY KEY NOT NULL,
	"posted" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "custodial_collateral_projections_units_check" CHECK ("custodial_collateral_projections"."posted"%1000000=0)
);
--> statement-breakpoint
CREATE TABLE "custodial_collateral_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custodial_collateral_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"journal_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"asset_id" bigint NOT NULL,
	"side" text NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "custodial_collateral_entries_amount_check" CHECK ("custodial_collateral_entries"."amount">0),
	CONSTRAINT "custodial_collateral_entries_side_check" CHECK ("custodial_collateral_entries"."side" IN ('DEBIT','CREDIT'))
);
--> statement-breakpoint
CREATE TABLE "custodial_collateral_journals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custodial_collateral_journals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"operation_id" bigint NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_collateral_journals_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "custodial_collateral_journals_purpose_check" CHECK ("custodial_collateral_journals"."purpose" IN ('MOCK_FUND','MINT_LOCK','MERGE_RELEASE')),
	CONSTRAINT "custodial_collateral_journals_status_check" CHECK ("custodial_collateral_journals"."status" IN ('DRAFT','POSTED'))
);
--> statement-breakpoint
CREATE TABLE "ctf_collateral_backing" (
	"pair_id" bigint PRIMARY KEY NOT NULL,
	"minted_quantity" bigint DEFAULT 0 NOT NULL,
	"merged_quantity" bigint DEFAULT 0 NOT NULL,
	"locked_collateral" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "ctf_collateral_backing_check" CHECK ("ctf_collateral_backing"."minted_quantity">=0 AND "ctf_collateral_backing"."merged_quantity">=0 AND "ctf_collateral_backing"."merged_quantity"<="ctf_collateral_backing"."minted_quantity" AND "ctf_collateral_backing"."locked_collateral"=("ctf_collateral_backing"."minted_quantity"-"ctf_collateral_backing"."merged_quantity"))
);
--> statement-breakpoint
CREATE TABLE "position_backing_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "position_backing_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"journal_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"side" text NOT NULL,
	"quantity" bigint NOT NULL,
	CONSTRAINT "position_backing_entries_side_check" CHECK ("position_backing_entries"."side" IN ('IN','OUT')),
	CONSTRAINT "position_backing_entries_quantity_check" CHECK ("position_backing_entries"."quantity">0 AND "position_backing_entries"."quantity"%1000000=0)
);
--> statement-breakpoint
CREATE TABLE "position_backing_journals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "position_backing_journals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"operation_id" bigint NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_backing_journals_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "position_backing_journals_purpose_check" CHECK ("position_backing_journals"."purpose" IN ('MINT','DIRECT_TRANSFER','MERGE')),
	CONSTRAINT "position_backing_journals_status_check" CHECK ("position_backing_journals"."status" IN ('DRAFT','POSTED'))
);
--> statement-breakpoint
CREATE TABLE "position_backing_projections" (
	"account_id" bigint PRIMARY KEY NOT NULL,
	"backed_posted" bigint DEFAULT 0 NOT NULL,
	"backed_reserved" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "position_backing_projections_units_check" CHECK ("position_backing_projections"."backed_posted">=0 AND "position_backing_projections"."backed_reserved">=0 AND "position_backing_projections"."backed_reserved"<="position_backing_projections"."backed_posted" AND "position_backing_projections"."backed_posted"%1000000=0 AND "position_backing_projections"."backed_reserved"%1000000=0)
);
--> statement-breakpoint
CREATE TABLE "position_reservation_backing" (
	"reservation_id" bigint PRIMARY KEY NOT NULL,
	"backed_amount" bigint NOT NULL,
	"unbacked_amount" bigint NOT NULL,
	"backed_consumed" bigint DEFAULT 0 NOT NULL,
	"unbacked_consumed" bigint DEFAULT 0 NOT NULL,
	"backed_released" bigint DEFAULT 0 NOT NULL,
	"unbacked_released" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "position_reservation_backing_amounts_check" CHECK ("position_reservation_backing"."backed_amount">=0 AND "position_reservation_backing"."unbacked_amount">=0 AND "position_reservation_backing"."backed_consumed">=0 AND "position_reservation_backing"."unbacked_consumed">=0 AND "position_reservation_backing"."backed_released">=0 AND "position_reservation_backing"."unbacked_released">=0 AND "position_reservation_backing"."backed_consumed"+"position_reservation_backing"."backed_released"<="position_reservation_backing"."backed_amount" AND "position_reservation_backing"."unbacked_consumed"+"position_reservation_backing"."unbacked_released"<="position_reservation_backing"."unbacked_amount")
);
--> statement-breakpoint
CREATE TABLE "position_reservation_backing_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "position_reservation_backing_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"reservation_id" bigint NOT NULL,
	"operation_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"backed_quantity" bigint NOT NULL,
	"unbacked_quantity" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_reservation_backing_events_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "position_reservation_backing_events_kind_check" CHECK ("position_reservation_backing_events"."kind" IN ('ALLOCATE','CONSUME','RELEASE','CANCEL')),
	CONSTRAINT "position_reservation_backing_events_quantity_check" CHECK ("position_reservation_backing_events"."backed_quantity">=0 AND "position_reservation_backing_events"."unbacked_quantity">=0 AND "position_reservation_backing_events"."backed_quantity"+"position_reservation_backing_events"."unbacked_quantity">0 AND "position_reservation_backing_events"."backed_quantity"%1000000=0 AND "position_reservation_backing_events"."unbacked_quantity"%1000000=0)
);
--> statement-breakpoint
ALTER TABLE "binary_complementary_pairs" ADD CONSTRAINT "binary_complementary_pairs_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binary_complementary_pairs" ADD CONSTRAINT "binary_complementary_pairs_condition_id_ctf_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."ctf_conditions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binary_complementary_pairs" ADD CONSTRAINT "binary_complementary_pairs_yes_token_id_ctf_position_tokens_id_fk" FOREIGN KEY ("yes_token_id") REFERENCES "public"."ctf_position_tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binary_complementary_pairs" ADD CONSTRAINT "binary_complementary_pairs_no_token_id_ctf_position_tokens_id_fk" FOREIGN KEY ("no_token_id") REFERENCES "public"."ctf_position_tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binary_complementary_pairs" ADD CONSTRAINT "binary_complementary_pairs_collateral_asset_id_chain_assets_id_fk" FOREIGN KEY ("collateral_asset_id") REFERENCES "public"."chain_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_collateral_accounts" ADD CONSTRAINT "custodial_collateral_accounts_pair_id_binary_complementary_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."binary_complementary_pairs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_collateral_accounts" ADD CONSTRAINT "custodial_collateral_accounts_asset_id_chain_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."chain_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_collateral_projections" ADD CONSTRAINT "custodial_collateral_projections_account_id_custodial_collateral_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."custodial_collateral_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_collateral_entries" ADD CONSTRAINT "custodial_collateral_entries_journal_id_custodial_collateral_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."custodial_collateral_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_collateral_entries" ADD CONSTRAINT "custodial_collateral_entries_account_asset_fk" FOREIGN KEY ("account_id","asset_id") REFERENCES "public"."custodial_collateral_accounts"("id","asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_collateral_journals" ADD CONSTRAINT "custodial_collateral_journals_operation_id_financial_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."financial_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ctf_collateral_backing" ADD CONSTRAINT "ctf_collateral_backing_pair_id_binary_complementary_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."binary_complementary_pairs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_backing_entries" ADD CONSTRAINT "position_backing_entries_journal_id_position_backing_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."position_backing_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_backing_entries" ADD CONSTRAINT "position_backing_entries_account_id_position_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."position_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_backing_journals" ADD CONSTRAINT "position_backing_journals_operation_id_financial_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."financial_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_backing_projections" ADD CONSTRAINT "position_backing_projections_account_id_position_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."position_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_reservation_backing" ADD CONSTRAINT "position_reservation_backing_reservation_id_position_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."position_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_reservation_backing_events" ADD CONSTRAINT "position_reservation_backing_events_reservation_id_position_reservation_backing_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."position_reservation_backing"("reservation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_reservation_backing_events" ADD CONSTRAINT "position_reservation_backing_events_operation_id_financial_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."financial_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_custodial_collateral_entries_journal" ON "custodial_collateral_entries" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "idx_custodial_collateral_entries_account" ON "custodial_collateral_entries" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "idx_position_backing_entries_journal" ON "position_backing_entries" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "idx_position_backing_entries_account" ON "position_backing_entries" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "idx_position_reservation_backing_events_reservation" ON "position_reservation_backing_events" USING btree ("reservation_id","id");
--> statement-breakpoint
-- Existing inventory and reservations adopt as unbacked. No historical position row is rewritten.
INSERT INTO public.position_backing_projections(account_id,backed_posted,backed_reserved)
SELECT id,0,0 FROM public.position_accounts WHERE kind<>'EXTERNAL_CONTROL';
INSERT INTO public.position_reservation_backing(
  reservation_id,
  backed_amount,
  unbacked_amount,
  unbacked_consumed,
  unbacked_released
)
SELECT id,0,quantity,consumed,released FROM public.position_reservations;
--> statement-breakpoint
CREATE FUNCTION public.complementary_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'complementary accounting history is immutable' USING ERRCODE='42501'; END $$;
--> statement-breakpoint
CREATE FUNCTION public.complementary_pair_validate() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE y record; n record; c record;
BEGIN
 SELECT * INTO y FROM public.ctf_position_tokens WHERE id=NEW.yes_token_id;
 SELECT * INTO n FROM public.ctf_position_tokens WHERE id=NEW.no_token_id;
 SELECT * INTO c FROM public.ctf_conditions WHERE id=NEW.condition_id;
 IF y.id IS NULL OR n.id IS NULL OR c.id IS NULL OR c.outcome_slot_count<>2 OR NEW.outcome_slot_count<>2
    OR y.condition_id<>c.id OR n.condition_id<>c.id OR y.index_set<>1 OR n.index_set<>2
    OR y.chain_id<>n.chain_id OR y.ctf_contract_deployment_id<>n.ctf_contract_deployment_id
    OR y.collateral_asset_id<>n.collateral_asset_id OR y.collateral_asset_id<>NEW.collateral_asset_id
    OR y.parent_collection_id<>n.parent_collection_id
    OR NOT EXISTS(SELECT 1 FROM public.market_questions q WHERE q.id=c.market_question_id AND q.market_id=NEW.market_id)
    OR NOT EXISTS(SELECT 1 FROM public.chain_assets a WHERE a.id=NEW.collateral_asset_id AND a.asset_type='ERC20' AND a.decimals=6)
 THEN RAISE EXCEPTION 'invalid binary complementary pair' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER binary_complementary_pairs_validate BEFORE INSERT ON public.binary_complementary_pairs
FOR EACH ROW EXECUTE FUNCTION public.complementary_pair_validate();
CREATE TRIGGER binary_complementary_pairs_immutable BEFORE UPDATE OR DELETE ON public.binary_complementary_pairs
FOR EACH ROW EXECUTE FUNCTION public.complementary_immutable();
--> statement-breakpoint
CREATE FUNCTION public.collateral_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE debit numeric; credit numeric;
BEGIN
 IF TG_TABLE_NAME='custodial_collateral_journals' AND TG_OP='UPDATE' AND OLD.status='DRAFT' AND NEW.status='POSTED' THEN
   SELECT COALESCE(sum(amount) FILTER(WHERE side='DEBIT'),0),COALESCE(sum(amount) FILTER(WHERE side='CREDIT'),0)
     INTO debit,credit FROM public.custodial_collateral_entries WHERE journal_id=NEW.id;
   IF debit=0 OR debit<>credit THEN RAISE EXCEPTION 'unbalanced collateral journal' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='position_backing_journals' AND TG_OP='UPDATE' AND OLD.status='DRAFT' AND NEW.status='POSTED' THEN
   SELECT COALESCE(sum(quantity) FILTER(WHERE side='IN'),0),COALESCE(sum(quantity) FILTER(WHERE side='OUT'),0)
     INTO debit,credit FROM public.position_backing_entries WHERE journal_id=NEW.id;
   IF debit=0 OR debit<>credit THEN RAISE EXCEPTION 'unbalanced position backing journal' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'collateral history is immutable' USING ERRCODE='42501'; END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER custodial_collateral_journals_guard BEFORE UPDATE OR DELETE ON public.custodial_collateral_journals FOR EACH ROW EXECUTE FUNCTION public.collateral_guard();
CREATE TRIGGER custodial_collateral_entries_guard BEFORE UPDATE OR DELETE ON public.custodial_collateral_entries FOR EACH ROW EXECUTE FUNCTION public.complementary_immutable();
CREATE TRIGGER position_backing_journals_guard BEFORE UPDATE OR DELETE ON public.position_backing_journals FOR EACH ROW EXECUTE FUNCTION public.collateral_guard();
CREATE TRIGGER position_backing_entries_guard BEFORE UPDATE OR DELETE ON public.position_backing_entries FOR EACH ROW EXECUTE FUNCTION public.complementary_immutable();
CREATE TRIGGER position_reservation_backing_events_guard BEFORE UPDATE OR DELETE ON public.position_reservation_backing_events FOR EACH ROW EXECUTE FUNCTION public.complementary_immutable();
--> statement-breakpoint
-- Reservation provenance is allocated unbacked-first. Consumption/release reuses that exact allocation.
CREATE FUNCTION public.position_backing_reservation_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record; p record; b record; a record; uq bigint; bq bigint; uleft bigint; bleft bigint; src bigint; dst bigint; bj bigint;
BEGIN
 SELECT * INTO r FROM public.position_reservations WHERE id=NEW.reservation_id FOR UPDATE;
 INSERT INTO public.position_backing_projections(account_id) VALUES(r.account_id) ON CONFLICT DO NOTHING;
 SELECT * INTO p FROM public.position_balance_projections WHERE account_id=r.account_id;
 SELECT * INTO b FROM public.position_backing_projections WHERE account_id=r.account_id FOR UPDATE;
 IF NEW.kind='RESERVE' THEN
   uq:=least(NEW.quantity,greatest(0,(p.posted-(p.reserved-NEW.quantity))-(b.backed_posted-b.backed_reserved)));
   bq:=NEW.quantity-uq;
   INSERT INTO public.position_reservation_backing(reservation_id,backed_amount,unbacked_amount) VALUES(r.id,bq,uq);
   UPDATE public.position_backing_projections SET backed_reserved=backed_reserved+bq WHERE account_id=r.account_id;
   INSERT INTO public.position_reservation_backing_events(reservation_id,operation_id,kind,backed_quantity,unbacked_quantity) VALUES(r.id,NEW.operation_id,'ALLOCATE',bq,uq);
 ELSE
   SELECT * INTO a FROM public.position_reservation_backing WHERE reservation_id=r.id FOR UPDATE;
   uleft:=a.unbacked_amount-a.unbacked_consumed-a.unbacked_released;
   bleft:=a.backed_amount-a.backed_consumed-a.backed_released;
   uq:=least(NEW.quantity,uleft); bq:=NEW.quantity-uq;
   IF bq>bleft THEN RAISE EXCEPTION 'position backing reservation mismatch' USING ERRCODE='23514'; END IF;
   IF NEW.kind='CONSUME' THEN
     UPDATE public.position_reservation_backing SET unbacked_consumed=unbacked_consumed+uq,backed_consumed=backed_consumed+bq WHERE reservation_id=r.id;
   ELSE
     UPDATE public.position_reservation_backing SET unbacked_released=unbacked_released+uq,backed_released=backed_released+bq WHERE reservation_id=r.id;
   END IF;
   UPDATE public.position_backing_projections SET backed_reserved=backed_reserved-bq WHERE account_id=r.account_id;
   INSERT INTO public.position_reservation_backing_events(reservation_id,operation_id,kind,backed_quantity,unbacked_quantity) VALUES(r.id,NEW.operation_id,NEW.kind,bq,uq);
   IF NEW.kind='CONSUME' AND bq>0 THEN
     SELECT e.account_id INTO src FROM public.position_journal_entries e WHERE e.journal_id=NEW.journal_id AND e.side='OUT';
     SELECT e.account_id INTO dst FROM public.position_journal_entries e WHERE e.journal_id=NEW.journal_id AND e.side='IN';
     IF src<>r.account_id OR dst IS NULL THEN RAISE EXCEPTION 'invalid direct backing movement' USING ERRCODE='23514'; END IF;
     INSERT INTO public.position_backing_journals(operation_id,purpose) VALUES(NEW.operation_id,'DIRECT_TRANSFER') RETURNING id INTO bj;
     INSERT INTO public.position_backing_entries(journal_id,account_id,side,quantity) VALUES(bj,src,'OUT',bq),(bj,dst,'IN',bq);
     INSERT INTO public.position_backing_projections(account_id) VALUES(dst) ON CONFLICT DO NOTHING;
     UPDATE public.position_backing_projections SET backed_posted=backed_posted-bq WHERE account_id=src;
     UPDATE public.position_backing_projections SET backed_posted=backed_posted+bq WHERE account_id=dst;
     UPDATE public.position_backing_journals SET status='POSTED' WHERE id=bj;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER position_reservation_backing_capture AFTER INSERT ON public.position_reservation_events
FOR EACH ROW EXECUTE FUNCTION public.position_backing_reservation_event();
--> statement-breakpoint
-- Only a separately granted disposable-fixture role may recognize bounded mock USDC inventory.
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kf_mock_fixture') THEN CREATE ROLE kf_mock_fixture NOLOGIN; END IF; END $$;
CREATE FUNCTION public.collateral_mock_fund(p_pair_id bigint,p_key text,p_amount bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pair record; op bigint; control_id bigint; available_id bigint; journal_id bigint; existing record;
BEGIN
 IF NOT pg_has_role(session_user,'kf_mock_fixture','MEMBER') THEN RAISE EXCEPTION 'mock funding capability required' USING ERRCODE='42501'; END IF;
 IF p_amount<=0 OR p_amount%1000000<>0 THEN RAISE EXCEPTION 'invalid mock collateral amount' USING ERRCODE='22003'; END IF;
 SELECT * INTO pair FROM public.binary_complementary_pairs WHERE id=p_pair_id;
 IF pair.id IS NULL OR NOT pair.mock_only THEN RAISE EXCEPTION 'mock complementary pair required' USING ERRCODE='23514'; END IF;
 SELECT * INTO existing FROM public.financial_operations WHERE operation_key='mock-collateral:'||p_key;
 IF FOUND THEN
   IF existing.actor<>'system:mock-fixture' OR existing.action<>'COLLATERAL_MOCK_FUND' OR existing.terms<>jsonb_build_object('pairId',p_pair_id::text,'amount',p_amount::text) THEN RAISE EXCEPTION 'conflicting mock funding idempotency key' USING ERRCODE='23505'; END IF;
   RETURN existing.result;
 END IF;
 INSERT INTO public.financial_operations(operation_key,actor,action,terms,request_hash)
 VALUES('mock-collateral:'||p_key,'system:mock-fixture','COLLATERAL_MOCK_FUND',jsonb_build_object('pairId',p_pair_id::text,'amount',p_amount::text),md5(p_pair_id::text||':'||p_amount::text)) RETURNING id INTO op;
 INSERT INTO public.custodial_collateral_accounts(asset_id,account_key,kind) VALUES(pair.collateral_asset_id,'mock-control:'||pair.collateral_asset_id::text,'MOCK_FUNDING_CONTROL')
 ON CONFLICT(account_key) DO UPDATE SET account_key=EXCLUDED.account_key RETURNING id INTO control_id;
 INSERT INTO public.custodial_collateral_accounts(pair_id,asset_id,account_key,kind) VALUES(pair.id,pair.collateral_asset_id,'mock-available:'||pair.id::text,'TREASURY_AVAILABLE')
 ON CONFLICT(account_key) DO UPDATE SET account_key=EXCLUDED.account_key RETURNING id INTO available_id;
 INSERT INTO public.custodial_collateral_projections(account_id) VALUES(control_id),(available_id) ON CONFLICT DO NOTHING;
 INSERT INTO public.custodial_collateral_journals(operation_id,purpose) VALUES(op,'MOCK_FUND') RETURNING id INTO journal_id;
 INSERT INTO public.custodial_collateral_entries(journal_id,account_id,asset_id,side,amount) VALUES(journal_id,available_id,pair.collateral_asset_id,'DEBIT',p_amount),(journal_id,control_id,pair.collateral_asset_id,'CREDIT',p_amount);
 UPDATE public.custodial_collateral_projections SET posted=posted+p_amount WHERE account_id=available_id;
 UPDATE public.custodial_collateral_projections SET posted=posted-p_amount WHERE account_id=control_id;
 UPDATE public.custodial_collateral_journals SET status='POSTED' WHERE id=journal_id;
 UPDATE public.financial_operations SET result=jsonb_build_object('pairId',p_pair_id::text,'amount',p_amount::text,'journalId',journal_id::text) WHERE id=op RETURNING result INTO existing;
 RETURN existing.result;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.complementary_reconcile() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE bad_journals bigint; bad_collateral bigint; bad_backing bigint; bad_reservations bigint; bad_supply bigint;
BEGIN
 SELECT count(*) INTO bad_journals FROM public.custodial_collateral_journals j WHERE j.status='POSTED' AND (SELECT COALESCE(sum(CASE side WHEN 'DEBIT' THEN amount ELSE -amount END),0) FROM public.custodial_collateral_entries WHERE journal_id=j.id)<>0;
 SELECT count(*) INTO bad_collateral FROM public.custodial_collateral_projections p WHERE p.posted<>(SELECT COALESCE(sum(CASE e.side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END),0) FROM public.custodial_collateral_entries e JOIN public.custodial_collateral_journals j ON j.id=e.journal_id AND j.status='POSTED' WHERE e.account_id=p.account_id);
 SELECT count(*) INTO bad_backing FROM public.position_backing_projections b JOIN public.position_balance_projections p ON p.account_id=b.account_id WHERE b.backed_posted<0 OR b.backed_reserved<0 OR b.backed_reserved>b.backed_posted OR b.backed_posted>p.posted OR b.backed_posted<>(SELECT COALESCE(sum(CASE e.side WHEN 'IN' THEN e.quantity ELSE -e.quantity END),0) FROM public.position_backing_entries e JOIN public.position_backing_journals j ON j.id=e.journal_id AND j.status='POSTED' WHERE e.account_id=b.account_id);
 SELECT count(*) INTO bad_reservations FROM public.position_reservation_backing b JOIN public.position_reservations r ON r.id=b.reservation_id WHERE b.backed_amount+b.unbacked_amount<>r.quantity OR b.backed_consumed+b.unbacked_consumed<>r.consumed OR b.backed_released+b.unbacked_released<>r.released;
 SELECT count(*) INTO bad_supply FROM public.binary_complementary_pairs pair JOIN public.ctf_collateral_backing supply ON supply.pair_id=pair.id WHERE
   supply.locked_collateral<>(SELECT COALESCE(sum(p.posted),0) FROM public.custodial_collateral_accounts a JOIN public.custodial_collateral_projections p ON p.account_id=a.id WHERE a.pair_id=pair.id AND a.kind='CTF_LOCKED')
   OR supply.minted_quantity-supply.merged_quantity<>(SELECT COALESCE(sum(b.backed_posted),0) FROM public.position_accounts a JOIN public.position_backing_projections b ON b.account_id=a.id WHERE a.token_id=pair.yes_token_id)
   OR supply.minted_quantity-supply.merged_quantity<>(SELECT COALESCE(sum(b.backed_posted),0) FROM public.position_accounts a JOIN public.position_backing_projections b ON b.account_id=a.id WHERE a.token_id=pair.no_token_id);
 IF bad_journals+bad_collateral+bad_backing+bad_reservations+bad_supply<>0 THEN RAISE EXCEPTION 'complementary reconciliation failed' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('collateralJournals','ok','collateralProjections','ok','positionBacking','ok','reservationBacking','ok','completeSetSupply','ok');
END $$;
--> statement-breakpoint
REVOKE ALL ON TABLE public.binary_complementary_pairs,public.custodial_collateral_accounts,public.custodial_collateral_journals,public.custodial_collateral_entries,public.custodial_collateral_projections,public.ctf_collateral_backing,public.position_backing_journals,public.position_backing_entries,public.position_backing_projections,public.position_reservation_backing,public.position_reservation_backing_events FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complementary_immutable(),public.complementary_pair_validate(),public.collateral_guard(),public.position_backing_reservation_event(),public.collateral_mock_fund(bigint,text,bigint),public.complementary_reconcile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collateral_mock_fund(bigint,text,bigint) TO kf_mock_fixture;
GRANT EXECUTE ON FUNCTION public.complementary_reconcile() TO kf_reconciliation;

--> statement-breakpoint
-- Authenticated reads use their own non-writing capability. They must not reuse
-- the HTTP order-submission credential, and public readers cannot call this API.
DO $$ DECLARE role_row record; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kf_private_read') THEN
  CREATE ROLE kf_private_read NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
 END IF;
 SELECT * INTO STRICT role_row FROM pg_roles WHERE rolname='kf_private_read';
 IF role_row.rolcanlogin OR role_row.rolsuper OR role_row.rolcreatedb OR role_row.rolcreaterole OR role_row.rolreplication OR role_row.rolbypassrls THEN
  RAISE EXCEPTION 'unsafe private-read capability role';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=role_row.oid) THEN
  RAISE EXCEPTION 'private-read capability must not inherit another role';
 END IF;
END $$;
GRANT USAGE ON SCHEMA custodial_api TO kf_private_read;
GRANT USAGE ON SCHEMA drizzle TO kf_private_read;
GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO kf_private_read;
GRANT EXECUTE ON FUNCTION custodial_api.private_read(text,text,jsonb),custodial_api.public_read(text,jsonb) TO kf_private_read;
REVOKE EXECUTE ON FUNCTION custodial_api.private_read(text,text,jsonb) FROM kf_trading_http;
