SELECT pg_advisory_xact_lock(727190001);
--> statement-breakpoint
-- A multi-migration adoption may create 0017's table under the migration login
-- while existing SECURITY DEFINER validators retain their restricted NOLOGIN owner.
-- Align only this table with that already trusted owner before invoking validators.
DO $$ DECLARE trusted record; table_owner oid; BEGIN
 SELECT r.oid,r.rolname,r.rolcanlogin,r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolbypassrls INTO STRICT trusted FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='public.trading_validate_order(bigint)'::regprocedure;
 SELECT relowner INTO STRICT table_owner FROM pg_class WHERE oid='public.trading_order_policies'::regclass;
 IF table_owner<>trusted.oid THEN
  IF trusted.rolcanlogin OR trusted.rolsuper OR trusted.rolcreaterole OR trusted.rolcreatedb OR trusted.rolbypassrls THEN RAISE EXCEPTION 'policy ownership requires the existing restricted validator owner'; END IF;
  EXECUTE format('ALTER TABLE public.trading_order_policies OWNER TO %I',trusted.rolname);
 END IF;
END $$;
--> statement-breakpoint
SELECT public.financial_reconcile('system:matching_adoption');
--> statement-breakpoint
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT id FROM public.position_accounts LOOP PERFORM public.position_validate('POSITION_ACCOUNT',r.id); END LOOP;
 FOR r IN SELECT id FROM public.position_journals LOOP PERFORM public.position_validate('POSITION_JOURNAL',r.id); END LOOP;
 FOR r IN SELECT id FROM public.position_reservations LOOP PERFORM public.position_validate('POSITION_RESERVATION',r.id); END LOOP;
 FOR r IN SELECT id FROM public.cash_position_settlements LOOP PERFORM public.position_validate('SETTLEMENT',r.id); END LOOP;
 FOR r IN SELECT id FROM public.trading_orders LOOP PERFORM public.trading_validate_order(r.id); END LOOP;
 FOR r IN SELECT id FROM public.trading_commands LOOP PERFORM public.trading_validate_command(r.id); END LOOP;
END $$;
--> statement-breakpoint

--> statement-breakpoint
DO $$ DECLARE audit_item record; BEGIN
 FOR audit_item IN SELECT id FROM public.matching_requests LOOP PERFORM public.matching_validate_request(audit_item.id); END LOOP;
 IF EXISTS(SELECT 1 FROM public.matching_markets m WHERE accepted_sequence<>(SELECT count(*) FROM public.matching_requests r WHERE r.market_id=m.market_id)) THEN RAISE EXCEPTION 'inconsistent pre-existing matching sequence'; END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "trading_event_cursors" (
	"consumer" text NOT NULL,
	"market_id" uuid NOT NULL,
	"sequence" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_event_cursors_consumer_market_id_pk" PRIMARY KEY("consumer","market_id"),
	CONSTRAINT "trading_event_cursors_identity_check" CHECK ("trading_event_cursors"."consumer" ~ '^system:[a-z][a-z0-9_-]{0,60}$' AND "trading_event_cursors"."sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trading_event_stream" (
	"outbox_id" uuid PRIMARY KEY NOT NULL,
	"market_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	CONSTRAINT "trading_event_stream_market_sequence_key" UNIQUE("market_id","sequence"),
	CONSTRAINT "trading_event_stream_sequence_check" CHECK ("trading_event_stream"."sequence" > 0)
);
--> statement-breakpoint
ALTER TABLE "trading_event_cursors" ADD CONSTRAINT "trading_event_cursors_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_event_stream" ADD CONSTRAINT "trading_event_stream_outbox_id_trading_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."trading_outbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_event_stream" ADD CONSTRAINT "trading_event_stream_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trading_orders_lifecycle_idx" ON "trading_orders" USING btree ("status","book_id","id");
--> statement-breakpoint
-- Existing identities are retained. Historical cross-book delivery order was not recorded;
-- this deterministic adoption order does not assert a historical global execution order.
INSERT INTO public.trading_event_stream(outbox_id,market_id,sequence)
SELECT x.id,b.market_id,row_number() OVER(PARTITION BY b.market_id ORDER BY c.created_at,c.book_id,c.sequence,e.ordinal,e.id)
FROM public.trading_outbox x JOIN public.trading_order_events e ON e.id=x.event_id
JOIN public.trading_commands c ON c.id=e.command_id JOIN public.trading_books b ON b.id=c.book_id;
--> statement-breakpoint
-- Expiration only appends authoritative commands. Matching executes the same queue.
CREATE FUNCTION public.matching_expiring(p_actor text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' THEN RAISE EXCEPTION 'expiration discovery requires system authorization' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(id ORDER BY trading_ends_at,id) FROM (SELECT m.id,m.trading_ends_at FROM public.markets m WHERE m.trading_ends_at<=statement_timestamp() AND EXISTS(SELECT 1 FROM public.trading_orders o JOIN public.trading_books b ON b.id=o.book_id WHERE b.market_id=m.id AND o.status IN ('OPEN','PARTIAL')) ORDER BY m.trading_ends_at,m.id LIMIT 64) q),'[]'::jsonb);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.matching_expire(p_actor text,p_market uuid,p_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record; market public.markets; queued integer:=0;
BEGIN
 IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' OR p_market IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid authorized expiration batch' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock_shared(727190001);
 PERFORM pg_advisory_xact_lock(hashtextextended('matching:'||p_market::text,0));
 SELECT * INTO STRICT market FROM public.markets WHERE id=p_market FOR SHARE;
 IF clock_timestamp()<market.trading_ends_at THEN RETURN jsonb_build_object('queued',0,'state','NOT_DUE'); END IF;
 FOR item IN SELECT o.id FROM public.trading_orders o JOIN public.trading_books b ON b.id=o.book_id
  WHERE b.market_id=p_market AND o.status IN ('OPEN','PARTIAL') AND NOT EXISTS(SELECT 1 FROM public.matching_requests r WHERE r.order_id=o.id AND r.action IN ('CANCEL','EXPIRE') AND r.state='QUEUED')
  ORDER BY o.id LIMIT p_limit LOOP
  -- Invalid ownership or hold history fails safely; age alone never authorizes release.
  PERFORM public.trading_validate_order(item.id);
  PERFORM public.trading_execute(p_actor,'EXPIRE','engine:expiry:'||p_market::text||':'||item.id::text,jsonb_build_object('orderId',item.id::text));
  queued:=queued+1;
 END LOOP;
 RETURN jsonb_build_object('queued',queued,'state','QUEUED');
END $$;
--> statement-breakpoint
CREATE FUNCTION public.matching_status(p_actor text,p_key text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE request public.matching_requests; item public.trading_orders;
BEGIN
 IF p_actor IS NULL OR p_actor !~ '^(user:[1-9][0-9]*|system:[a-z][a-z0-9_-]{0,60})$' OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9:_-]{1,120}$' THEN RAISE EXCEPTION 'invalid recovery identity' USING ERRCODE='42501'; END IF;
 SELECT * INTO request FROM public.matching_requests WHERE operation_key=p_key;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','NOT_FOUND'); END IF;
 IF request.actor<>p_actor THEN RAISE EXCEPTION 'command belongs to another actor' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT item FROM public.trading_orders WHERE id=request.order_id;
 RETURN jsonb_build_object('requestId',request.id,'sequence',request.sequence::text,'state',request.state,'steps',request.steps::text,'result',request.result,'orderId',item.id::text,'orderStatus',item.status,'filledQuantity',item.filled_quantity::text,'remainingQuantity',item.remaining_quantity::text,
  'fills',coalesce((SELECT jsonb_agg(jsonb_build_object('fillId',f.id::text,'settlementId',f.settlement_id::text,'commandId',f.command_id) ORDER BY f.id) FROM public.trading_fills f WHERE f.buyer_order_id=item.id OR f.seller_order_id=item.id),'[]'::jsonb));
END $$;
--> statement-breakpoint
-- Ordered, immutable event identities are independent from financial execution.
CREATE FUNCTION public.trading_stream_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE expected_market uuid; expected_sequence bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'event stream is immutable'; END IF;
 PERFORM pg_advisory_xact_lock_shared(727190001);
 SELECT b.market_id INTO STRICT expected_market FROM public.trading_outbox x JOIN public.trading_order_events e ON e.id=x.event_id JOIN public.trading_commands c ON c.id=e.command_id JOIN public.trading_books b ON b.id=c.book_id WHERE x.id=NEW.outbox_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('matching:'||expected_market::text,0));
 SELECT coalesce(max(sequence),0)+1 INTO expected_sequence FROM public.trading_event_stream WHERE market_id=expected_market;
 IF NEW.market_id<>expected_market OR NEW.sequence<>expected_sequence THEN RAISE EXCEPTION 'invalid event stream identity or sequence'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.trading_stream_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE market uuid; next_sequence bigint;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(727190001);
 SELECT b.market_id INTO STRICT market FROM public.trading_order_events e JOIN public.trading_commands c ON c.id=e.command_id JOIN public.trading_books b ON b.id=c.book_id WHERE e.id=NEW.event_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('matching:'||market::text,0));
 SELECT coalesce(max(sequence),0)+1 INTO next_sequence FROM public.trading_event_stream WHERE market_id=market;
 INSERT INTO public.trading_event_stream(outbox_id,market_id,sequence) VALUES(NEW.id,market,next_sequence);
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.trading_stream_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='trading_outbox' THEN target:=NEW.id; ELSE target:=NEW.outbox_id; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.trading_event_stream s JOIN public.trading_outbox x ON x.id=s.outbox_id JOIN public.trading_order_events e ON e.id=x.event_id JOIN public.trading_commands c ON c.id=e.command_id JOIN public.trading_books b ON b.id=c.book_id WHERE s.outbox_id=target AND s.market_id=b.market_id) THEN RAISE EXCEPTION 'missing or mismatched durable event stream'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER trading_event_stream_guard BEFORE INSERT OR UPDATE OR DELETE ON public.trading_event_stream FOR EACH ROW EXECUTE FUNCTION public.trading_stream_guard();
--> statement-breakpoint
CREATE TRIGGER trading_outbox_capture AFTER INSERT ON public.trading_outbox FOR EACH ROW EXECUTE FUNCTION public.trading_stream_capture();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trading_outbox_stream_audit AFTER INSERT ON public.trading_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trading_stream_audit();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trading_event_stream_audit AFTER INSERT ON public.trading_event_stream DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trading_stream_audit();
--> statement-breakpoint
CREATE FUNCTION public.trading_cursor_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'delivery cursors cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW.consumer<>OLD.consumer OR NEW.market_id<>OLD.market_id OR NEW.sequence<=OLD.sequence) THEN RAISE EXCEPTION 'delivery cursor must advance for the same consumer and market'; END IF;
 IF NEW.sequence>(SELECT coalesce(max(sequence),0) FROM public.trading_event_stream WHERE market_id=NEW.market_id) THEN RAISE EXCEPTION 'cursor exceeds committed event stream'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trading_event_cursors_guard BEFORE INSERT OR UPDATE OR DELETE ON public.trading_event_cursors FOR EACH ROW EXECUTE FUNCTION public.trading_cursor_guard();
--> statement-breakpoint
CREATE FUNCTION public.trading_event_markets(p_actor text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' THEN RAISE EXCEPTION 'event replay requires system authorization' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(market_id ORDER BY market_id) FROM (SELECT DISTINCT s.market_id FROM public.trading_event_stream s LEFT JOIN public.trading_event_cursors c ON c.market_id=s.market_id AND c.consumer=p_actor WHERE s.sequence>coalesce(c.sequence,0) ORDER BY s.market_id LIMIT 64) q),'[]'::jsonb);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.trading_event_batch(p_actor text,p_market uuid,p_limit integer,p_after bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE start_sequence bigint; events jsonb;
BEGIN
 IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' OR p_market IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_after<0 THEN RAISE EXCEPTION 'invalid authorized event batch' USING ERRCODE='42501'; END IF;
 SELECT coalesce((SELECT sequence FROM public.trading_event_cursors WHERE consumer=p_actor AND market_id=p_market),0) INTO start_sequence;
 start_sequence:=coalesce(p_after,start_sequence);
 SELECT coalesce(jsonb_agg(jsonb_build_object('sequence',q.sequence::text,'outboxId',q.outbox_id,'eventId',q.event_id,'kind',q.kind,'ordinal',q.ordinal,'payload',jsonb_build_object('marketId',p_market,'kind',q.kind)) ORDER BY q.sequence),'[]'::jsonb) INTO events
 FROM (SELECT s.sequence,s.outbox_id,e.id AS event_id,e.kind,e.ordinal FROM public.trading_event_stream s JOIN public.trading_outbox x ON x.id=s.outbox_id JOIN public.trading_order_events e ON e.id=x.event_id WHERE s.market_id=p_market AND s.sequence>start_sequence ORDER BY s.sequence LIMIT p_limit) q;
 RETURN jsonb_build_object('consumer',p_actor,'marketId',p_market,'afterSequence',start_sequence::text,'events',events);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.trading_event_ack(p_actor text,p_market uuid,p_after bigint,p_events jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actual bigint; through_sequence bigint; expected jsonb; count_events integer;
BEGIN
 IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' OR p_market IS NULL OR p_after IS NULL OR p_after<0 OR p_events IS NULL OR jsonb_typeof(p_events)<>'array' THEN RAISE EXCEPTION 'invalid event acknowledgement' USING ERRCODE='42501'; END IF;
 count_events:=jsonb_array_length(p_events);
 IF count_events NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'acknowledgement batch must contain 1-100 event identities'; END IF;
 PERFORM pg_advisory_xact_lock_shared(727190001);
 -- Consumer lock is separate from market execution; publication never holds a trading lock.
 PERFORM pg_advisory_xact_lock(hashtextextended('delivery:'||p_actor||':'||p_market::text,0));
 SELECT coalesce((SELECT sequence FROM public.trading_event_cursors WHERE consumer=p_actor AND market_id=p_market),0) INTO actual;
 SELECT jsonb_agg(event_id::text ORDER BY sequence),max(sequence) INTO expected,through_sequence FROM (SELECT s.sequence,x.event_id FROM public.trading_event_stream s JOIN public.trading_outbox x ON x.id=s.outbox_id WHERE s.market_id=p_market AND s.sequence>p_after ORDER BY s.sequence LIMIT count_events) q;
 IF expected IS DISTINCT FROM p_events THEN RAISE EXCEPTION 'acknowledgement must identify the exact next event prefix'; END IF;
 IF actual=through_sequence THEN RETURN jsonb_build_object('sequence',actual::text,'replayed',true); END IF;
 IF actual<>p_after THEN RAISE EXCEPTION 'stale delivery cursor'; END IF;
 INSERT INTO public.trading_event_cursors(consumer,market_id,sequence,updated_at) VALUES(p_actor,p_market,through_sequence,clock_timestamp()) ON CONFLICT(consumer,market_id) DO UPDATE SET sequence=EXCLUDED.sequence,updated_at=EXCLUDED.updated_at;
 RETURN jsonb_build_object('sequence',through_sequence::text,'replayed',false);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.matching_diagnostics(p_actor text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE issues jsonb;
BEGIN
 IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' THEN RAISE EXCEPTION 'operational inspection requires system authorization' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
  'cashHoldMismatch',(SELECT count(*) FROM public.trading_orders o LEFT JOIN public.cash_reservations r ON r.id=o.cash_reservation_id LEFT JOIN public.trading_order_policies policy ON policy.order_id=o.id WHERE o.side='BUY' AND o.status<>'REJECTED' AND (r.id IS NULL OR r.account_id<>o.cash_account_id OR r.reference<>'order:'||o.id::text OR r.amount::numeric-r.consumed-r.released<>CASE WHEN o.status IN ('OPEN','PARTIAL') THEN CASE WHEN policy.order_id IS NOT NULL THEN policy.max_spend_cents::numeric-r.consumed ELSE o.remaining_quantity::numeric/1000000*o.limit_price_cents END ELSE 0 END)),
  'positionHoldMismatch',(SELECT count(*) FROM public.trading_orders o LEFT JOIN public.position_reservations r ON r.id=o.position_reservation_id WHERE o.side='SELL' AND o.status<>'REJECTED' AND (r.id IS NULL OR r.account_id<>o.position_account_id OR r.quantity-r.consumed-r.released<>o.remaining_quantity)),
  'ownershipMismatch',(SELECT count(*) FROM public.trading_orders o JOIN public.financial_accounts c ON c.id=o.cash_account_id JOIN public.position_accounts p ON p.id=o.position_account_id JOIN public.trading_books b ON b.id=o.book_id WHERE c.owner_user_id IS DISTINCT FROM o.user_id OR p.owner_user_id IS DISTINCT FROM o.user_id OR p.token_id<>b.token_id),
  'negativeAvailable',(SELECT count(*) FROM public.financial_balance_projections p JOIN public.financial_accounts a ON a.id=p.account_id WHERE a.kind='CUSTOMER' AND p.posted<p.reserved)+(SELECT count(*) FROM public.position_balance_projections p JOIN public.position_accounts a ON a.id=p.account_id WHERE a.kind<>'EXTERNAL_CONTROL' AND p.posted<p.reserved),
  'orphanTradingCashHolds',(SELECT count(*) FROM public.cash_reservations r JOIN public.financial_operations f ON f.id=r.operation_id JOIN public.trading_commands c ON f.operation_key=c.id::text AND c.action='PLACE' WHERE NOT EXISTS(SELECT 1 FROM public.trading_orders o WHERE o.cash_reservation_id=r.id)),
  'orphanTradingPositionHolds',(SELECT count(*) FROM public.position_reservations r JOIN public.financial_operations f ON f.id=r.operation_id JOIN public.trading_commands c ON f.operation_key=c.id::text AND c.action='PLACE' WHERE NOT EXISTS(SELECT 1 FROM public.trading_orders o WHERE o.position_reservation_id=r.id)),
  'missingEvents',(SELECT count(*) FROM public.trading_outbox x LEFT JOIN public.trading_event_stream s ON s.outbox_id=x.id WHERE s.outbox_id IS NULL),
  'restingIOC',(SELECT count(*) FROM public.matching_requests r JOIN public.trading_order_policies p ON p.order_id=r.order_id WHERE r.resting='YES')) INTO issues;
 RETURN jsonb_build_object('inspectedAt',statement_timestamp(),'pendingCommands',(SELECT count(*) FROM public.matching_requests WHERE state='QUEUED'),
  'oldestPendingAgeSeconds',(SELECT coalesce(extract(epoch FROM statement_timestamp()-min(created_at)),0) FROM public.matching_requests WHERE state='QUEUED'),
  'staleCommands',(SELECT count(*) FROM public.matching_requests WHERE state='QUEUED' AND created_at<statement_timestamp()-interval '60 seconds'),
  'expirationBacklog',(SELECT count(*) FROM public.trading_orders o JOIN public.trading_books b ON b.id=o.book_id JOIN public.markets m ON m.id=b.market_id WHERE o.status IN ('OPEN','PARTIAL') AND m.trading_ends_at<=statement_timestamp()),
  'undeliveredEvents',(SELECT count(*) FROM public.trading_event_stream s LEFT JOIN public.trading_event_cursors c ON c.market_id=s.market_id AND c.consumer=p_actor WHERE s.sequence>coalesce(c.sequence,0)),
  'lockWaiters',(SELECT count(DISTINCT pid) FROM pg_locks WHERE NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())),'issues',issues);
END $$;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trading_event_stream,public.trading_event_cursors FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.matching_expiring(text),public.matching_expire(text,uuid,integer),public.matching_status(text,text),public.matching_diagnostics(text),public.trading_stream_guard(),public.trading_stream_capture(),public.trading_stream_audit(),public.trading_cursor_guard(),public.trading_event_markets(text),public.trading_event_batch(text,uuid,integer,bigint),public.trading_event_ack(text,uuid,bigint,jsonb) FROM PUBLIC;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.matching_pending(p_actor text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' THEN RAISE EXCEPTION 'matching discovery requires system authorization' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(market_id ORDER BY market_id) FROM (
 SELECT DISTINCT market_id FROM public.matching_requests WHERE state='QUEUED'
 UNION SELECT value::uuid FROM jsonb_array_elements_text(public.matching_expiring(p_actor))) q),'[]'::jsonb);
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.trading_execute(p_actor text,p_action text,p_key text,p_terms jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.matching_requests; o public.trading_orders; m uuid; receipt jsonb; seq bigint; old public.trading_commands;
BEGIN
 IF p_actor IS NULL OR p_actor !~ '^(user:[1-9][0-9]*|system:[a-z][a-z0-9_-]{0,60})$' OR p_action IS NULL OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9:_-]{1,120}$' OR p_terms IS NULL OR jsonb_typeof(p_terms)<>'object' THEN RAISE EXCEPTION 'invalid trading request'; END IF;
 IF p_action='PLACE_MARKET' THEN
  IF p_terms-ARRAY['marketId','tokenId','side','quantity','priceCents','cashAccountId','positionAccountId','maxSpendCents']<>'{}'::jsonb OR (SELECT count(*) FROM jsonb_object_keys(p_terms))<>(CASE WHEN p_terms->>'side'='BUY' THEN 8 ELSE 7 END) OR NOT p_terms ?& ARRAY['marketId','tokenId','side','quantity','priceCents','cashAccountId','positionAccountId'] THEN RAISE EXCEPTION 'invalid market order terms'; END IF;
  IF p_terms->>'side'='SELL' AND p_terms ? 'maxSpendCents' THEN RAISE EXCEPTION 'market SELL cannot have a spending cap'; END IF;
  p_action:='PLACE';p_terms:=p_terms||jsonb_build_object('orderType','MARKET','timeInForce','IOC');
 ELSIF p_action='PLACE' AND (p_terms-ARRAY['marketId','tokenId','side','quantity','priceCents','cashAccountId','positionAccountId']<>'{}'::jsonb OR (SELECT count(*) FROM jsonb_object_keys(p_terms))<>7) THEN RAISE EXCEPTION 'invalid limit order terms'; END IF;
 IF p_action='FILL' THEN RAISE EXCEPTION 'direct fill disabled; matching worker selects execution' USING ERRCODE='42501'; END IF;
 IF p_key LIKE 'engine:%' AND NOT (p_action='EXPIRE' AND p_actor LIKE 'system:%' AND p_key LIKE 'engine:expiry:%') THEN RAISE EXCEPTION 'reserved engine operation key' USING ERRCODE='42501'; END IF;
 IF p_action='RECONCILE' THEN PERFORM pg_advisory_xact_lock(727190001); ELSE PERFORM pg_advisory_xact_lock_shared(727190001); END IF;
 SELECT * INTO r FROM public.matching_requests WHERE operation_key=p_key;
 IF FOUND THEN
  IF r.actor<>p_actor THEN RAISE EXCEPTION 'command belongs to another actor' USING ERRCODE='42501'; END IF;
  IF p_action='RECOVER' AND p_terms='{}'::jsonb THEN RETURN r.result; END IF;
  IF r.action<>p_action OR r.terms<>p_terms THEN RAISE EXCEPTION 'conflicting trading idempotency terms'; END IF;
  RETURN r.result;
 END IF;
 IF p_action='RECONCILE' THEN
  receipt:=public.trading_execute_foundation(p_actor,p_action,p_key,p_terms);
  FOR r IN SELECT * FROM public.matching_requests LOOP PERFORM public.matching_validate_request(r.id); END LOOP;
  IF EXISTS(SELECT 1 FROM public.matching_markets mm WHERE mm.accepted_sequence<>(SELECT count(*) FROM public.matching_requests mr WHERE mr.market_id=mm.market_id)) THEN RAISE EXCEPTION 'market command reconciliation mismatch'; END IF;
  RETURN receipt;
 END IF;
 IF p_action='RECOVER' THEN RETURN public.trading_execute_foundation(p_actor,p_action,p_key,p_terms); END IF;
 IF p_action NOT IN ('PLACE','CANCEL','EXPIRE') THEN RAISE EXCEPTION 'unsupported trading action'; END IF;
 IF (p_action IN ('PLACE','CANCEL') AND p_actor NOT LIKE 'user:%') OR (p_action='EXPIRE' AND p_actor NOT LIKE 'system:%') THEN RAISE EXCEPTION 'trading actor capability denied' USING ERRCODE='42501'; END IF;
 IF p_action='PLACE' THEN m:=(p_terms->>'marketId')::uuid;
 ELSE
  IF p_terms-ARRAY['orderId']<>'{}'::jsonb OR NOT p_terms ? 'orderId' THEN RAISE EXCEPTION 'invalid cancel terms'; END IF;
  SELECT * INTO STRICT o FROM public.trading_orders WHERE id=(p_terms->>'orderId')::bigint;
  IF p_action='CANCEL' AND p_actor<>'user:'||o.user_id::text THEN RAISE EXCEPTION 'order access denied' USING ERRCODE='42501'; END IF;
  IF o.status NOT IN ('OPEN','PARTIAL') THEN RAISE EXCEPTION 'order is terminal'; END IF;
  SELECT market_id INTO STRICT m FROM public.trading_books WHERE id=o.book_id;
  IF p_action='EXPIRE' AND clock_timestamp()<(SELECT trading_ends_at FROM public.markets WHERE id=m) THEN RAISE EXCEPTION 'order has not expired'; END IF;
 END IF;
 -- Gate order is shared maintenance, market advisory lock, market row, book and accounts.
 PERFORM pg_advisory_xact_lock(hashtextextended('matching:'||m::text,0));
 SELECT * INTO r FROM public.matching_requests WHERE operation_key=p_key;
 IF FOUND THEN
  IF r.actor<>p_actor OR r.action<>p_action OR r.terms<>p_terms THEN RAISE EXCEPTION 'conflicting trading command'; END IF;
  RETURN r.result;
 END IF;
 SELECT * INTO old FROM public.trading_commands WHERE operation_key=p_key;
 IF FOUND THEN RETURN public.trading_execute_foundation(p_actor,p_action,p_key,p_terms); END IF;
 INSERT INTO public.matching_markets(market_id) VALUES(m) ON CONFLICT DO NOTHING;
 UPDATE public.matching_markets SET accepted_sequence=accepted_sequence+1 WHERE market_id=m RETURNING accepted_sequence INTO seq;
 IF p_action='PLACE' THEN
  -- Lock before INSERT obtains FK KEY SHARE locks: avoid cross-book lock-upgrade deadlocks.
  PERFORM id FROM public.financial_accounts WHERE id=(p_terms->>'cashAccountId')::bigint FOR UPDATE;
  PERFORM id FROM public.position_accounts WHERE id=(p_terms->>'positionAccountId')::bigint FOR UPDATE;
  IF p_terms->>'orderType'='MARKET' THEN receipt:=public.trading_accept_market(p_actor,p_key,p_terms); ELSE receipt:=public.trading_execute_foundation(p_actor,p_action,p_key,p_terms); END IF;
  o.id:=(receipt->>'orderId')::bigint;
 ELSE receipt:=jsonb_build_object('orderId',o.id::text,'processing','QUEUED'); END IF;
 INSERT INTO public.matching_requests(market_id,sequence,operation_key,actor,action,terms,order_id,result)
 VALUES(m,seq,p_key,p_actor,p_action,p_terms,o.id,receipt);
 RETURN receipt;
END $$;
