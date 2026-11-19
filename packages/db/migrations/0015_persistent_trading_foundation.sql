-- Establish the induction base before introducing incremental validation.
SELECT pg_advisory_xact_lock(727190001);
--> statement-breakpoint
LOCK TABLE public.financial_accounts,public.financial_operations,public.financial_journals,public.financial_journal_entries,public.financial_balance_projections,public.cash_reservations,public.cash_reservation_events,public.position_accounts,public.position_journals,public.position_journal_entries,public.position_balance_projections,public.position_reservations,public.position_reservation_events,public.cash_position_settlements,public.financial_audit_targets IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$ DECLARE item record; BEGIN
 PERFORM public.financial_reconcile('system:migration');
 FOR item IN SELECT id FROM public.position_accounts LOOP PERFORM public.position_validate('POSITION_ACCOUNT',item.id); END LOOP;
 FOR item IN SELECT id FROM public.position_journals LOOP PERFORM public.position_validate('POSITION_JOURNAL',item.id); END LOOP;
 FOR item IN SELECT id FROM public.position_reservations LOOP PERFORM public.position_validate('POSITION_RESERVATION',item.id); END LOOP;
 FOR item IN SELECT id FROM public.cash_position_settlements LOOP PERFORM public.position_validate('SETTLEMENT',item.id); END LOOP;
 IF EXISTS(SELECT 1 FROM public.financial_audit_targets) OR EXISTS(SELECT 1 FROM public.financial_operations o WHERE o.action='SETTLE' AND NOT EXISTS(SELECT 1 FROM public.cash_position_settlements s WHERE s.operation_id=o.id)) THEN RAISE EXCEPTION 'inconsistent pre-existing audit or settlement state'; END IF;
 IF EXISTS(SELECT 1 FROM public.financial_accounts a JOIN public.financial_balance_projections p ON p.account_id=a.id WHERE a.kind='CUSTOMER' AND (p.posted<0 OR p.reserved<0 OR p.reserved>p.posted)) OR EXISTS(SELECT 1 FROM public.position_accounts a JOIN public.position_balance_projections p ON p.account_id=a.id WHERE (a.kind<>'EXTERNAL_CONTROL' AND p.posted<p.reserved) OR p.reserved<0 OR (a.kind='EXTERNAL_CONTROL' AND p.reserved<>0)) THEN RAISE EXCEPTION 'inconsistent pre-existing available balances'; END IF;
END $$;


--> statement-breakpoint
CREATE TABLE "trading_books" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trading_books_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"token_id" bigint NOT NULL,
	"market_id" uuid NOT NULL,
	"command_sequence" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_books_token_id_unique" UNIQUE("token_id"),
	CONSTRAINT "trading_books_sequence_check" CHECK ("trading_books"."command_sequence">=0)
);
--> statement-breakpoint
CREATE TABLE "trading_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" bigint NOT NULL,
	"sequence" bigint NOT NULL,
	"operation_key" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"terms" jsonb NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_commands_operation_key_unique" UNIQUE("operation_key"),
	CONSTRAINT "trading_commands_book_sequence_key" UNIQUE("book_id","sequence"),
	CONSTRAINT "trading_commands_state_check" CHECK ("trading_commands"."state" IN ('PENDING','APPLIED')),
	CONSTRAINT "trading_commands_action_check" CHECK ("trading_commands"."action" IN ('PLACE','CANCEL','EXPIRE','FILL'))
);
--> statement-breakpoint
CREATE TABLE "trading_fills" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trading_fills_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"command_id" uuid NOT NULL,
	"book_id" bigint NOT NULL,
	"buyer_order_id" bigint NOT NULL,
	"seller_order_id" bigint NOT NULL,
	"settlement_id" bigint NOT NULL,
	"quantity" bigint NOT NULL,
	"price_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_fills_command_id_unique" UNIQUE("command_id"),
	CONSTRAINT "trading_fills_settlement_id_unique" UNIQUE("settlement_id"),
	CONSTRAINT "trading_fills_units_check" CHECK ("trading_fills"."quantity">0 AND "trading_fills"."quantity"%1000000=0 AND "trading_fills"."price_cents" BETWEEN 1 AND 99 AND "trading_fills"."buyer_order_id"<>"trading_fills"."seller_order_id")
);
--> statement-breakpoint
CREATE TABLE "trading_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_id" uuid NOT NULL,
	"order_id" bigint NOT NULL,
	"ordinal" smallint NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_events_command_order_key" UNIQUE("command_id","order_id"),
	CONSTRAINT "trading_events_command_ordinal_key" UNIQUE("command_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "trading_orders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trading_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"book_id" bigint NOT NULL,
	"command_id" uuid NOT NULL,
	"user_id" bigint NOT NULL,
	"side" text NOT NULL,
	"limit_price_cents" bigint NOT NULL,
	"original_quantity" bigint NOT NULL,
	"filled_quantity" bigint DEFAULT 0 NOT NULL,
	"cancelled_quantity" bigint DEFAULT 0 NOT NULL,
	"remaining_quantity" bigint GENERATED ALWAYS AS (original_quantity - filled_quantity - cancelled_quantity) STORED,
	"priority_sequence" bigint NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"cash_account_id" bigint NOT NULL,
	"position_account_id" bigint NOT NULL,
	"cash_reservation_id" bigint,
	"position_reservation_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_orders_command_id_unique" UNIQUE("command_id"),
	CONSTRAINT "trading_orders_cash_reservation_id_unique" UNIQUE("cash_reservation_id"),
	CONSTRAINT "trading_orders_position_reservation_id_unique" UNIQUE("position_reservation_id"),
	CONSTRAINT "trading_orders_terms_check" CHECK ("trading_orders"."side" IN ('BUY','SELL') AND "trading_orders"."limit_price_cents" BETWEEN 1 AND 99 AND "trading_orders"."original_quantity">0 AND "trading_orders"."original_quantity"%1000000=0 AND "trading_orders"."filled_quantity">=0 AND "trading_orders"."filled_quantity"%1000000=0 AND "trading_orders"."cancelled_quantity">=0 AND "trading_orders"."cancelled_quantity"%1000000=0 AND "trading_orders"."filled_quantity"::numeric+"trading_orders"."cancelled_quantity"<="trading_orders"."original_quantity"),
	CONSTRAINT "trading_orders_status_check" CHECK ("trading_orders"."status" IN ('PENDING','OPEN','PARTIAL','FILLED','CANCELLED','EXPIRED','REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "trading_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_outbox_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "trading_books" ADD CONSTRAINT "trading_books_token_id_ctf_position_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."ctf_position_tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_books" ADD CONSTRAINT "trading_books_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_commands" ADD CONSTRAINT "trading_commands_book_id_trading_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."trading_books"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_fills" ADD CONSTRAINT "trading_fills_command_id_trading_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."trading_commands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_fills" ADD CONSTRAINT "trading_fills_book_id_trading_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."trading_books"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_fills" ADD CONSTRAINT "trading_fills_buyer_order_id_trading_orders_id_fk" FOREIGN KEY ("buyer_order_id") REFERENCES "public"."trading_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_fills" ADD CONSTRAINT "trading_fills_seller_order_id_trading_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."trading_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_fills" ADD CONSTRAINT "trading_fills_settlement_id_cash_position_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."cash_position_settlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_order_events" ADD CONSTRAINT "trading_order_events_command_id_trading_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."trading_commands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_order_events" ADD CONSTRAINT "trading_order_events_order_id_trading_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."trading_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_orders" ADD CONSTRAINT "trading_orders_book_id_trading_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."trading_books"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_orders" ADD CONSTRAINT "trading_orders_command_id_trading_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."trading_commands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_orders" ADD CONSTRAINT "trading_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_orders" ADD CONSTRAINT "trading_orders_cash_account_id_financial_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_orders" ADD CONSTRAINT "trading_orders_position_account_id_position_accounts_id_fk" FOREIGN KEY ("position_account_id") REFERENCES "public"."position_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_orders" ADD CONSTRAINT "trading_orders_cash_reservation_id_cash_reservations_id_fk" FOREIGN KEY ("cash_reservation_id") REFERENCES "public"."cash_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_orders" ADD CONSTRAINT "trading_orders_position_reservation_fk" FOREIGN KEY ("position_reservation_id") REFERENCES "public"."position_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_outbox" ADD CONSTRAINT "trading_outbox_event_id_trading_order_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."trading_order_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trading_fills_buyer_idx" ON "trading_fills" USING btree ("buyer_order_id");--> statement-breakpoint
CREATE INDEX "trading_fills_seller_idx" ON "trading_fills" USING btree ("seller_order_id");--> statement-breakpoint
CREATE INDEX "trading_orders_book_priority_idx" ON "trading_orders" USING btree ("book_id","side","limit_price_cents","priority_sequence");
--> statement-breakpoint
-- All terms and append-only execution history are protected independently of the application.
CREATE FUNCTION public.trading_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'trading history is immutable'; END IF;
 IF TG_TABLE_NAME='trading_books' THEN
  IF NOT EXISTS(SELECT 1 FROM public.ctf_position_tokens t JOIN public.ctf_conditions c ON c.id=t.condition_id JOIN public.market_questions q ON q.id=c.market_question_id WHERE t.id=NEW.token_id AND q.market_id=NEW.market_id) THEN RAISE EXCEPTION 'book canonical market mismatch'; END IF;
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'command_sequence') IS DISTINCT FROM (to_jsonb(OLD)-'command_sequence') OR NEW.command_sequence<>OLD.command_sequence+1) THEN RAISE EXCEPTION 'immutable book identity or invalid sequence'; END IF;
 ELSIF TG_TABLE_NAME='trading_orders' AND TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['filled_quantity','cancelled_quantity','remaining_quantity','status','cash_reservation_id','position_reservation_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['filled_quantity','cancelled_quantity','remaining_quantity','status','cash_reservation_id','position_reservation_id']) THEN RAISE EXCEPTION 'order terms are immutable'; END IF;
  IF OLD.status IN ('FILLED','CANCELLED','EXPIRED','REJECTED') OR NEW.filled_quantity<OLD.filled_quantity OR NEW.cancelled_quantity<OLD.cancelled_quantity OR
   (OLD.status='PENDING' AND NEW.status NOT IN ('OPEN','REJECTED')) OR
   (OLD.status IN ('OPEN','PARTIAL') AND NEW.status NOT IN ('PARTIAL','FILLED','CANCELLED','EXPIRED')) THEN RAISE EXCEPTION 'invalid order state transition'; END IF;
  IF OLD.status<>'PENDING' AND (NEW.cash_reservation_id IS DISTINCT FROM OLD.cash_reservation_id OR NEW.position_reservation_id IS DISTINCT FROM OLD.position_reservation_id) THEN RAISE EXCEPTION 'order reservation is immutable'; END IF;
 ELSIF TG_TABLE_NAME='trading_commands' AND TG_OP='UPDATE' THEN
  IF OLD.state<>'PENDING' OR NEW.state<>'APPLIED' OR (to_jsonb(NEW)-ARRAY['state','result']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','result']) THEN RAISE EXCEPTION 'command history is immutable'; END IF;
 ELSIF TG_OP='UPDATE' THEN RAISE EXCEPTION 'trading history is immutable';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.trading_validate_order(p_id bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o public.trading_orders; b public.trading_books; c public.cash_reservations; p public.position_reservations; filled numeric; paid numeric;
BEGIN
 SELECT * INTO STRICT o FROM public.trading_orders WHERE id=p_id;
 SELECT * INTO STRICT b FROM public.trading_books WHERE id=o.book_id;
 IF NOT EXISTS(SELECT 1 FROM public.financial_accounts a JOIN public.position_accounts p1 ON p1.id=o.position_account_id WHERE a.id=o.cash_account_id AND a.kind='CUSTOMER' AND a.asset='USD' AND p1.kind='CUSTOMER' AND a.owner_user_id=o.user_id AND p1.owner_user_id=o.user_id AND p1.token_id=b.token_id) THEN RAISE EXCEPTION 'order account ownership or token mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.trading_commands cmd WHERE cmd.id=o.command_id AND cmd.action='PLACE' AND cmd.book_id=o.book_id AND cmd.sequence=o.priority_sequence AND cmd.actor='user:'||o.user_id::text AND cmd.terms @> jsonb_build_object('marketId',b.market_id::text,'tokenId',b.token_id::text,'side',o.side,'quantity',o.original_quantity::text,'priceCents',o.limit_price_cents::text,'cashAccountId',o.cash_account_id::text,'positionAccountId',o.position_account_id::text)) THEN RAISE EXCEPTION 'order differs from authorized command'; END IF;
 SELECT COALESCE(sum(f.quantity),0),COALESCE(sum(f.quantity::numeric/1000000*f.price_cents),0) INTO filled,paid FROM public.trading_fills f WHERE f.buyer_order_id=o.id OR f.seller_order_id=o.id;
 IF o.filled_quantity<>filled OR o.status='PENDING' OR
  (o.status='OPEN' AND (filled<>0 OR o.cancelled_quantity<>0)) OR
  (o.status='PARTIAL' AND (filled<=0 OR o.remaining_quantity<=0 OR o.cancelled_quantity<>0)) OR
  (o.status='FILLED' AND (o.remaining_quantity<>0 OR o.cancelled_quantity<>0)) OR
  (o.status IN ('CANCELLED','EXPIRED','REJECTED') AND o.remaining_quantity<>0) THEN RAISE EXCEPTION 'order quantities or state differ from immutable fills'; END IF;
 IF o.status='REJECTED' THEN
  IF o.filled_quantity<>0 OR o.cancelled_quantity<>o.original_quantity OR o.cash_reservation_id IS NOT NULL OR o.position_reservation_id IS NOT NULL THEN RAISE EXCEPTION 'invalid rejected order'; END IF;
  RETURN;
 END IF;
 IF o.side='BUY' THEN
  SELECT * INTO STRICT c FROM public.cash_reservations WHERE id=o.cash_reservation_id;
  IF o.position_reservation_id IS NOT NULL OR c.account_id<>o.cash_account_id OR c.reference<>'order:'||o.id::text OR c.amount::numeric<>o.original_quantity::numeric/1000000*o.limit_price_cents OR c.consumed::numeric<>paid OR (c.amount::numeric-c.consumed-c.released)<>o.remaining_quantity::numeric/1000000*o.limit_price_cents THEN RAISE EXCEPTION 'order cash reservation mismatch'; END IF;
 ELSE
  SELECT * INTO STRICT p FROM public.position_reservations WHERE id=o.position_reservation_id;
  IF o.cash_reservation_id IS NOT NULL OR p.account_id<>o.position_account_id OR p.reference<>'order:'||o.id::text OR p.quantity<>o.original_quantity OR p.consumed<>o.filled_quantity OR p.released<>o.cancelled_quantity THEN RAISE EXCEPTION 'order position reservation mismatch'; END IF;
 END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.trading_validate_command(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.trading_commands; f public.trading_fills; buy public.trading_orders; sell public.trading_orders; b public.trading_books; x public.cash_position_settlements; n bigint;
BEGIN
 SELECT * INTO STRICT c FROM public.trading_commands WHERE id=p_id;
 IF c.sequence<1 OR NOT EXISTS(SELECT 1 FROM public.trading_books b1 WHERE b1.id=c.book_id AND b1.command_sequence>=c.sequence) THEN RAISE EXCEPTION 'invalid persistent command sequence'; END IF;
 IF c.state<>'APPLIED' OR c.result IS NULL THEN RAISE EXCEPTION 'incomplete trading command'; END IF;
 SELECT count(*) INTO n FROM public.trading_order_events WHERE command_id=c.id;
 IF n<>(CASE WHEN c.action='FILL' THEN 2 ELSE 1 END) OR EXISTS(SELECT 1 FROM public.trading_order_events e LEFT JOIN public.trading_outbox o ON o.event_id=e.id WHERE e.command_id=c.id AND o.id IS NULL) THEN RAISE EXCEPTION 'incomplete trading events or outbox'; END IF;
 IF EXISTS(SELECT 1 FROM public.trading_order_events e JOIN public.trading_orders o ON o.id=e.order_id WHERE e.command_id=c.id AND (o.book_id<>c.book_id OR e.kind<>c.action)) THEN RAISE EXCEPTION 'trading event identity mismatch'; END IF;
 IF c.action='PLACE' THEN
  IF NOT EXISTS(SELECT 1 FROM public.trading_orders o1 WHERE o1.command_id=c.id AND c.result->>'orderId'=o1.id::text AND c.result->>'bookId'=o1.book_id::text AND c.result->>'sequence'=o1.priority_sequence::text) THEN RAISE EXCEPTION 'command result does not identify accepted order'; END IF;
 ELSIF c.action IN ('CANCEL','EXPIRE') THEN
  IF c.result->>'orderId' IS DISTINCT FROM c.terms->>'orderId' OR NOT EXISTS(SELECT 1 FROM public.trading_order_events e WHERE e.command_id=c.id AND e.order_id=(c.terms->>'orderId')::bigint) THEN RAISE EXCEPTION 'cancellation command identity mismatch'; END IF;
 END IF;
 IF c.action='FILL' THEN
  SELECT * INTO STRICT f FROM public.trading_fills WHERE command_id=c.id;
  SELECT * INTO STRICT buy FROM public.trading_orders WHERE id=f.buyer_order_id;
  SELECT * INTO STRICT sell FROM public.trading_orders WHERE id=f.seller_order_id;
  SELECT * INTO STRICT b FROM public.trading_books WHERE id=f.book_id;
  SELECT * INTO STRICT x FROM public.cash_position_settlements WHERE id=f.settlement_id;
  IF c.result->>'fillId' IS DISTINCT FROM f.id::text OR c.result->>'settlementId' IS DISTINCT FROM x.id::text OR c.result->>'settlementScope' IS DISTINCT FROM 'INTERNAL_LEDGER' THEN RAISE EXCEPTION 'fill result identity mismatch'; END IF;
  IF c.actor NOT LIKE 'system:%' OR buy.book_id<>b.id OR sell.book_id<>b.id OR c.book_id<>b.id OR buy.side<>'BUY' OR sell.side<>'SELL' OR buy.user_id=sell.user_id OR f.price_cents>buy.limit_price_cents OR f.price_cents<sell.limit_price_cents OR
   c.terms<>jsonb_build_object('buyerOrderId',buy.id::text,'sellerOrderId',sell.id::text,'quantity',f.quantity::text,'priceCents',f.price_cents::text) OR
   x.token_id<>b.token_id OR x.market_id<>b.market_id OR x.quantity<>f.quantity OR x.price_cents<>f.price_cents OR x.match_reference<>'trading:'||c.id::text OR
   x.buyer_cash_account_id<>buy.cash_account_id OR x.seller_cash_account_id<>sell.cash_account_id OR x.buyer_position_account_id<>buy.position_account_id OR x.seller_position_account_id<>sell.position_account_id OR x.cash_reservation_id<>buy.cash_reservation_id OR x.position_reservation_id<>sell.position_reservation_id THEN RAISE EXCEPTION 'fill accounting settlement mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.trading_order_events WHERE command_id=c.id AND order_id=buy.id) OR NOT EXISTS(SELECT 1 FROM public.trading_order_events WHERE command_id=c.id AND order_id=sell.id) THEN RAISE EXCEPTION 'fill order events mismatch'; END IF;
 END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.trading_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record; command uuid;
BEGIN
 IF TG_TABLE_NAME='trading_orders' THEN PERFORM public.trading_validate_order(NEW.id); command:=NEW.command_id;
 ELSIF TG_TABLE_NAME='trading_fills' THEN PERFORM public.trading_validate_order(NEW.buyer_order_id); PERFORM public.trading_validate_order(NEW.seller_order_id); command:=NEW.command_id;
 ELSIF TG_TABLE_NAME='trading_commands' THEN
  command:=NEW.id;
  IF NEW.action IN ('PLACE','FILL') AND EXISTS(SELECT 1 FROM public.trading_books b JOIN public.markets m ON m.id=b.market_id WHERE b.id=NEW.book_id AND clock_timestamp()>=m.trading_ends_at) THEN RAISE EXCEPTION 'trading cutoff reached before command commit'; END IF;
 ELSIF TG_TABLE_NAME='trading_order_events' THEN command:=NEW.command_id;
 ELSIF TG_TABLE_NAME='trading_outbox' THEN SELECT command_id INTO command FROM public.trading_order_events WHERE id=NEW.event_id;
 ELSIF TG_TABLE_NAME='trading_books' THEN
  IF NEW.command_sequence>(SELECT count(*) FROM public.trading_commands WHERE book_id=NEW.id) THEN RAISE EXCEPTION 'book sequence without command'; END IF;
 ELSIF TG_TABLE_NAME='cash_reservations' THEN
  FOR item IN SELECT id FROM public.trading_orders WHERE cash_reservation_id=NEW.id LOOP PERFORM public.trading_validate_order(item.id); END LOOP;
 ELSIF TG_TABLE_NAME='position_reservations' THEN
  FOR item IN SELECT id FROM public.trading_orders WHERE position_reservation_id=NEW.id LOOP PERFORM public.trading_validate_order(item.id); END LOOP;
 END IF;
 IF command IS NOT NULL THEN PERFORM public.trading_validate_command(command); END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.trading_emit(p_command uuid,p_order bigint,p_kind text,p_ordinal smallint) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE event uuid;
BEGIN
 INSERT INTO public.trading_order_events(command_id,order_id,kind,ordinal,payload) SELECT p_command,id,p_kind,p_ordinal,jsonb_build_object('orderId',id::text,'status',status,'filledQuantity',filled_quantity::text,'remainingQuantity',remaining_quantity::text) FROM public.trading_orders WHERE id=p_order RETURNING id INTO event;
 INSERT INTO public.trading_outbox(event_id) VALUES(event);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.trading_execute(p_actor text,p_action text,p_key text,p_terms jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE market public.markets; book public.trading_books; command public.trading_commands; prior public.trading_commands;
 o public.trading_orders; buy public.trading_orders; sell public.trading_orders; item record; v_result jsonb; accounting jsonb;
 q bigint; price bigint; hold bigint; released bigint; fill_id bigint; expected text[]; user_id bigint;
BEGIN
 IF p_action='RECONCILE' THEN PERFORM pg_advisory_xact_lock(727190001); ELSE PERFORM pg_advisory_xact_lock_shared(727190001); END IF;
 IF p_actor IS NULL OR p_action IS NULL OR p_key IS NULL OR p_terms IS NULL OR p_actor !~ '^(user:[1-9][0-9]*|system:[a-z][a-z0-9_-]{0,60})$' OR p_key !~ '^[A-Za-z0-9:_-]{1,120}$' OR jsonb_typeof(p_terms)<>'object' THEN RAISE EXCEPTION 'invalid trading request'; END IF;
 IF p_action='RECOVER' THEN
  IF p_terms<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid recovery request'; END IF;
  SELECT * INTO prior FROM public.trading_commands WHERE operation_key=p_key;
  IF FOUND AND prior.actor<>p_actor THEN RAISE EXCEPTION 'command belongs to another actor' USING ERRCODE='42501'; END IF;
  RETURN CASE WHEN prior.id IS NULL THEN jsonb_build_object('state','NOT_FOUND') ELSE prior.result END;
 END IF;
 IF p_action='RECONCILE' THEN
  IF p_actor NOT LIKE 'system:%' OR p_terms<>'{}'::jsonb THEN RAISE EXCEPTION 'trading reconciliation requires system authorization' USING ERRCODE='42501'; END IF;
  v_result:=public.financial_execute(p_actor,'POSITION_RECONCILE',p_key,'{}'::jsonb);
  FOR item IN SELECT id FROM public.trading_orders LOOP PERFORM public.trading_validate_order(item.id); END LOOP;
  FOR item IN SELECT id FROM public.trading_commands LOOP PERFORM public.trading_validate_command(item.id); END LOOP;
  RETURN jsonb_build_object('reconciled',true,'accounting',v_result);
 END IF;
 expected:=CASE p_action WHEN 'PLACE' THEN ARRAY['marketId','tokenId','side','quantity','priceCents','cashAccountId','positionAccountId'] WHEN 'CANCEL' THEN ARRAY['orderId'] WHEN 'EXPIRE' THEN ARRAY['orderId'] WHEN 'FILL' THEN ARRAY['buyerOrderId','sellerOrderId','quantity','priceCents'] END;
 IF expected IS NULL OR p_terms-expected<>'{}'::jsonb OR (SELECT count(*) FROM jsonb_object_keys(p_terms))<>cardinality(expected) THEN RAISE EXCEPTION 'unsupported trading action or terms'; END IF;
 IF p_action IN ('FILL','EXPIRE') AND p_actor NOT LIKE 'system:%' OR p_action IN ('PLACE','CANCEL') AND p_actor NOT LIKE 'user:%' THEN RAISE EXCEPTION 'trading actor capability denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM public.trading_commands WHERE operation_key=p_key;
 IF FOUND THEN
  IF prior.actor<>p_actor THEN RAISE EXCEPTION 'command belongs to another actor' USING ERRCODE='42501'; END IF;
  IF prior.action<>p_action OR prior.terms<>p_terms THEN RAISE EXCEPTION 'conflicting trading idempotency terms'; END IF;
  RETURN prior.result;
 END IF;
 IF p_action='PLACE' THEN
  SELECT * INTO STRICT market FROM public.markets WHERE id=(p_terms->>'marketId')::uuid FOR SHARE;
 ELSE
  SELECT * INTO STRICT o FROM public.trading_orders WHERE id=(p_terms->>CASE WHEN p_action='FILL' THEN 'buyerOrderId' ELSE 'orderId' END)::bigint;
  SELECT * INTO STRICT book FROM public.trading_books WHERE id=o.book_id;
  SELECT * INTO STRICT market FROM public.markets WHERE id=book.market_id FOR SHARE;
 END IF;
 IF p_action IN ('PLACE','FILL') AND (market.lifecycle_status<>'ACTIVE' OR market.trading_status<>'OPEN' OR market.resolution_status<>'UNRESOLVED' OR market.terms_frozen_at IS NULL OR clock_timestamp()<market.trading_starts_at OR clock_timestamp()>=market.trading_ends_at) THEN RAISE EXCEPTION 'market closed, paused or trading cutoff reached'; END IF;
 IF p_action='PLACE' THEN
  INSERT INTO public.trading_books(token_id,market_id) VALUES((p_terms->>'tokenId')::bigint,market.id) ON CONFLICT(token_id) DO NOTHING;
  SELECT * INTO STRICT book FROM public.trading_books WHERE token_id=(p_terms->>'tokenId')::bigint FOR UPDATE;
  IF book.market_id<>market.id THEN RAISE EXCEPTION 'book market mismatch'; END IF;
 ELSE SELECT * INTO STRICT book FROM public.trading_books WHERE id=book.id FOR UPDATE;
 END IF;
 IF p_action IN ('PLACE','FILL') AND clock_timestamp()>=market.trading_ends_at THEN RAISE EXCEPTION 'trading cutoff reached while waiting for book'; END IF;
 -- Retry after the book lock: a concurrent identical command may have committed while waiting.
 SELECT * INTO prior FROM public.trading_commands WHERE operation_key=p_key;
 IF FOUND THEN
  IF prior.actor<>p_actor OR prior.action<>p_action OR prior.terms<>p_terms THEN RAISE EXCEPTION 'conflicting trading command'; END IF;
  RETURN prior.result;
 END IF;
 UPDATE public.trading_books SET command_sequence=command_sequence+1 WHERE id=book.id RETURNING * INTO book;
 INSERT INTO public.trading_commands(book_id,sequence,operation_key,actor,action,terms) VALUES(book.id,book.command_sequence,p_key,p_actor,p_action,p_terms) RETURNING * INTO command;
 IF p_action='PLACE' THEN
  user_id:=substring(p_actor FROM 6)::bigint;
  IF jsonb_typeof(p_terms->'quantity')<>'string' OR (p_terms->>'quantity') !~ '^[1-9][0-9]{0,18}$' OR jsonb_typeof(p_terms->'priceCents')<>'string' OR (p_terms->>'priceCents') !~ '^[1-9][0-9]?$' THEN RAISE EXCEPTION 'invalid exact order quantity or price'; END IF;
  q:=(p_terms->>'quantity')::bigint;price:=(p_terms->>'priceCents')::bigint;
  IF q%1000000<>0 OR p_terms->>'side' NOT IN ('BUY','SELL') THEN RAISE EXCEPTION 'whole shares and BUY/SELL required'; END IF;
  hold:=(q::numeric/1000000*price)::bigint;
  INSERT INTO public.trading_orders(book_id,command_id,user_id,side,limit_price_cents,original_quantity,priority_sequence,cash_account_id,position_account_id)
   VALUES(book.id,command.id,user_id,p_terms->>'side',price,q,book.command_sequence,(p_terms->>'cashAccountId')::bigint,(p_terms->>'positionAccountId')::bigint) RETURNING * INTO o;
  BEGIN
  IF o.side='BUY' THEN
   accounting:=public.financial_execute(p_actor,'RESERVE',command.id::text,jsonb_build_object('accountId',o.cash_account_id::text,'amount',hold::text,'reference','order:'||o.id::text));
   UPDATE public.trading_orders SET cash_reservation_id=(accounting->>'reservationId')::bigint,status='OPEN' WHERE id=o.id;
  ELSE
   accounting:=public.financial_execute(p_actor,'POSITION_RESERVE',command.id::text,jsonb_build_object('accountId',o.position_account_id::text,'quantity',q::text,'reference','order:'||o.id::text));
   UPDATE public.trading_orders SET position_reservation_id=(accounting->>'reservationId')::bigint,status='OPEN' WHERE id=o.id;
  END IF;
  EXCEPTION WHEN check_violation THEN
   IF SQLERRM NOT IN ('insufficient available funds','insufficient available positions') THEN RAISE; END IF;
   UPDATE public.trading_orders SET status='REJECTED',cancelled_quantity=original_quantity WHERE id=o.id;
  END;
  PERFORM public.trading_emit(command.id,o.id,'PLACE',0::smallint);
  v_result:=jsonb_build_object('orderId',o.id::text,'bookId',book.id::text,'sequence',book.command_sequence::text,'status',(SELECT status FROM public.trading_orders WHERE id=o.id));
 ELSIF p_action IN ('CANCEL','EXPIRE') THEN
  SELECT * INTO STRICT o FROM public.trading_orders WHERE id=o.id FOR UPDATE;
  IF o.status NOT IN ('OPEN','PARTIAL') THEN RAISE EXCEPTION 'order is terminal'; END IF;
  IF p_action='CANCEL' AND p_actor<>'user:'||o.user_id::text THEN RAISE EXCEPTION 'order access denied' USING ERRCODE='42501'; END IF;
  IF p_action='EXPIRE' AND clock_timestamp()<market.trading_ends_at THEN RAISE EXCEPTION 'order has not expired'; END IF;
  IF o.side='BUY' THEN
   PERFORM public.financial_execute('user:'||o.user_id::text,'CANCEL',command.id::text,jsonb_build_object('reservationId',o.cash_reservation_id::text));
  ELSE PERFORM public.financial_execute('user:'||o.user_id::text,'POSITION_CANCEL',command.id::text,jsonb_build_object('reservationId',o.position_reservation_id::text)); END IF;
  UPDATE public.trading_orders SET cancelled_quantity=cancelled_quantity+remaining_quantity,status=CASE WHEN p_action='EXPIRE' THEN 'EXPIRED' ELSE 'CANCELLED' END WHERE id=o.id;
  PERFORM public.trading_emit(command.id,o.id,p_action,0::smallint);
  v_result:=jsonb_build_object('orderId',o.id::text);
 ELSE
  PERFORM id FROM public.trading_orders WHERE id IN ((p_terms->>'buyerOrderId')::bigint,(p_terms->>'sellerOrderId')::bigint) ORDER BY id FOR UPDATE;
  SELECT * INTO STRICT buy FROM public.trading_orders WHERE id=(p_terms->>'buyerOrderId')::bigint;
  SELECT * INTO STRICT sell FROM public.trading_orders WHERE id=(p_terms->>'sellerOrderId')::bigint;
  IF buy.book_id<>book.id OR sell.book_id<>book.id OR buy.side<>'BUY' OR sell.side<>'SELL' OR buy.user_id=sell.user_id OR buy.status NOT IN ('OPEN','PARTIAL') OR sell.status NOT IN ('OPEN','PARTIAL') THEN RAISE EXCEPTION 'incompatible orders or self trade'; END IF;
  IF jsonb_typeof(p_terms->'quantity')<>'string' OR (p_terms->>'quantity') !~ '^[1-9][0-9]{0,18}$' OR jsonb_typeof(p_terms->'priceCents')<>'string' OR (p_terms->>'priceCents') !~ '^[1-9][0-9]?$' THEN RAISE EXCEPTION 'invalid exact fill units'; END IF;
  q:=(p_terms->>'quantity')::bigint;price:=(p_terms->>'priceCents')::bigint;
  IF q%1000000<>0 OR q>buy.remaining_quantity OR q>sell.remaining_quantity OR price>buy.limit_price_cents OR price<sell.limit_price_cents THEN RAISE EXCEPTION 'fill exceeds quantity or price limits'; END IF;
  accounting:=public.financial_execute(p_actor,'SETTLE',command.id::text,jsonb_build_object('marketId',market.id::text,'tokenId',book.token_id::text,'buyerCashAccountId',buy.cash_account_id::text,'sellerCashAccountId',sell.cash_account_id::text,'buyerPositionAccountId',buy.position_account_id::text,'sellerPositionAccountId',sell.position_account_id::text,'cashReservationId',buy.cash_reservation_id::text,'positionReservationId',sell.position_reservation_id::text,'cashReservationReference','order:'||buy.id::text,'positionReservationReference','order:'||sell.id::text,'quantity',q::text,'priceCents',price::text,'matchReference','trading:'||command.id::text));
  released:=(q::numeric/1000000*(buy.limit_price_cents-price))::bigint;
  IF released>0 THEN PERFORM public.financial_execute('user:'||buy.user_id::text,'RELEASE',command.id::text||':improvement',jsonb_build_object('reservationId',buy.cash_reservation_id::text,'amount',released::text)); END IF;
  UPDATE public.trading_orders SET filled_quantity=filled_quantity+q,status=CASE WHEN remaining_quantity=q THEN 'FILLED' ELSE 'PARTIAL' END WHERE id IN (buy.id,sell.id);
  INSERT INTO public.trading_fills(command_id,book_id,buyer_order_id,seller_order_id,settlement_id,quantity,price_cents) VALUES(command.id,book.id,buy.id,sell.id,(accounting->>'settlementId')::bigint,q,price) RETURNING id INTO fill_id;
  PERFORM public.trading_emit(command.id,buy.id,'FILL',0::smallint); PERFORM public.trading_emit(command.id,sell.id,'FILL',1::smallint);
  v_result:=jsonb_build_object('fillId',fill_id::text,'settlementId',accounting->>'settlementId','settlementScope','INTERNAL_LEDGER');
 END IF;
 UPDATE public.trading_commands SET state='APPLIED',result=v_result WHERE id=command.id;
 RETURN v_result;
END $$;

--> statement-breakpoint
CREATE TRIGGER trading_books_guard BEFORE INSERT OR UPDATE OR DELETE ON public.trading_books FOR EACH ROW EXECUTE FUNCTION public.trading_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trading_books_audit AFTER INSERT OR UPDATE ON public.trading_books DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trading_audit();
--> statement-breakpoint
REVOKE ALL ON TABLE public.trading_books FROM PUBLIC;

--> statement-breakpoint
CREATE TRIGGER trading_commands_guard BEFORE INSERT OR UPDATE OR DELETE ON public.trading_commands FOR EACH ROW EXECUTE FUNCTION public.trading_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trading_commands_audit AFTER INSERT OR UPDATE ON public.trading_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trading_audit();
--> statement-breakpoint
REVOKE ALL ON TABLE public.trading_commands FROM PUBLIC;

--> statement-breakpoint
CREATE TRIGGER trading_orders_guard BEFORE INSERT OR UPDATE OR DELETE ON public.trading_orders FOR EACH ROW EXECUTE FUNCTION public.trading_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trading_orders_audit AFTER INSERT OR UPDATE ON public.trading_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trading_audit();
--> statement-breakpoint
REVOKE ALL ON TABLE public.trading_orders FROM PUBLIC;

--> statement-breakpoint
CREATE TRIGGER trading_fills_guard BEFORE INSERT OR UPDATE OR DELETE ON public.trading_fills FOR EACH ROW EXECUTE FUNCTION public.trading_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trading_fills_audit AFTER INSERT OR UPDATE ON public.trading_fills DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trading_audit();
--> statement-breakpoint
REVOKE ALL ON TABLE public.trading_fills FROM PUBLIC;

--> statement-breakpoint
CREATE TRIGGER trading_order_events_guard BEFORE INSERT OR UPDATE OR DELETE ON public.trading_order_events FOR EACH ROW EXECUTE FUNCTION public.trading_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trading_order_events_audit AFTER INSERT OR UPDATE ON public.trading_order_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trading_audit();
--> statement-breakpoint
REVOKE ALL ON TABLE public.trading_order_events FROM PUBLIC;

--> statement-breakpoint
CREATE TRIGGER trading_outbox_guard BEFORE INSERT OR UPDATE OR DELETE ON public.trading_outbox FOR EACH ROW EXECUTE FUNCTION public.trading_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trading_outbox_audit AFTER INSERT OR UPDATE ON public.trading_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trading_audit();
--> statement-breakpoint
REVOKE ALL ON TABLE public.trading_outbox FROM PUBLIC;

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cash_reservations_trading_audit AFTER INSERT OR UPDATE ON public.cash_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trading_audit();

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER position_reservations_trading_audit AFTER INSERT OR UPDATE ON public.position_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trading_audit();

--> statement-breakpoint
CREATE TRIGGER trading_books_token_eligibility BEFORE INSERT OR UPDATE ON public.trading_books FOR EACH ROW EXECUTE FUNCTION public.block_unsupported_position_accounting();

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trading_guard() FROM PUBLIC;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trading_validate_order(bigint) FROM PUBLIC;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trading_validate_command(uuid) FROM PUBLIC;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trading_audit() FROM PUBLIC;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trading_emit(uuid,bigint,text,smallint) FROM PUBLIC;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trading_execute(text,text,text,jsonb) FROM PUBLIC;
