-- NON-EXECUTABLE READING COPY. Execute only the reviewed migration through the migration runner.
-- Capability boundary only: no financial history, balances, orders or terms are rewritten.
-- Run with reviewed migration administration privileges; runtime roles never receive CREATEROLE.
SELECT pg_advisory_xact_lock(727190001);
--> statement-breakpoint
-- The exclusive maintenance gate above prevents trading writers racing key allocation.
-- Legacy users may already own any predictable string, including this new namespace.
DO $$
DECLARE reconciliation_key text;
BEGIN
 LOOP
  reconciliation_key := 'system:reconcile:' || pg_catalog.gen_random_uuid()::text;
  EXIT WHEN NOT EXISTS (
   SELECT 1 FROM public.matching_requests WHERE operation_key=reconciliation_key
  );
 END LOOP;
 PERFORM public.trading_execute('system:migration','RECONCILE',reconciliation_key,'{}'::jsonb);
END $$;
--> statement-breakpoint
DO $$ DECLARE name text; r record; BEGIN
 FOREACH name IN ARRAY ARRAY['kf_core_owner','kf_api_owner','kf_trading_http','kf_matching_worker','kf_market_scheduler','kf_market_admin','kf_reconciliation','kf_public_read','kf_funding','kf_migration'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=name) THEN EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',name); END IF;
  SELECT * INTO STRICT r FROM pg_roles WHERE rolname=name;
  IF r.rolcanlogin OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls THEN RAISE EXCEPTION 'unsafe pre-existing capability role'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles membership_role ON membership_role.oid=m.member WHERE membership_role.rolname=ANY(ARRAY['kf_core_owner','kf_api_owner','kf_trading_http','kf_matching_worker','kf_market_scheduler','kf_market_admin','kf_reconciliation','kf_public_read','kf_funding'])) THEN RAISE EXCEPTION 'capability roles must not inherit other roles'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles owner_role ON owner_role.oid=m.roleid JOIN pg_roles member_role ON member_role.oid=m.member WHERE owner_role.rolname IN ('kf_core_owner','kf_api_owner') AND member_role.rolname<>'kf_migration') THEN RAISE EXCEPTION 'untrusted owner-role membership'; END IF;
END $$;
--> statement-breakpoint
-- Migration membership is administrative only and must never be granted to runtime logins.
GRANT kf_core_owner,kf_api_owner TO kf_migration WITH INHERIT FALSE, SET TRUE;
CREATE SCHEMA custodial_api AUTHORIZATION kf_api_owner;
REVOKE ALL ON SCHEMA custodial_api FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA custodial_api REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE kf_api_owner IN SCHEMA custodial_api REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO kf_core_owner,kf_api_owner;
GRANT CREATE ON SCHEMA public TO kf_core_owner;
GRANT USAGE ON SCHEMA custodial_api TO kf_trading_http,kf_matching_worker,kf_market_scheduler,kf_market_admin,kf_reconciliation,kf_public_read;
--> statement-breakpoint
-- Helpers retain their existing bodies and transaction semantics. Only trusted owners can call them.
DO $$ DECLARE f record; t record; g record; privilege_role text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'financial_%' OR tablename LIKE 'cash_%' OR tablename LIKE 'position_%' OR tablename LIKE 'trading_%' OR tablename LIKE 'matching_%' OR tablename IN ('market_templates','market_template_controls','market_rounds','market_round_requirements','market_round_observations','market_lifecycle_events','market_lifecycle_cursors')) LOOP
  FOR g IN SELECT DISTINCT a.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.relnamespace='public'::regnamespace AND c.relname=t.tablename LOOP
   IF g.grantee=0 THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t.tablename);
   ELSE
    SELECT rolname INTO privilege_role FROM pg_roles WHERE oid=g.grantee;
    IF privilege_role NOT IN (current_user,'kf_core_owner') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t.tablename,privilege_role); END IF;
   END IF;
  END LOOP;
  FOR g IN SELECT DISTINCT grantee FROM information_schema.column_privileges WHERE table_schema='public' AND table_name=t.tablename AND grantee NOT IN (current_user,'kf_core_owner') LOOP
   FOR privilege_role IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=t.tablename LOOP
    IF g.grantee='PUBLIC' THEN EXECUTE format('REVOKE ALL (%I) ON TABLE public.%I FROM PUBLIC',privilege_role,t.tablename);
    ELSE EXECUTE format('REVOKE ALL (%I) ON TABLE public.%I FROM %I',privilege_role,t.tablename,g.grantee); END IF;
   END LOOP;
  END LOOP;
  EXECUTE format('ALTER TABLE public.%I OWNER TO kf_core_owner',t.tablename);
  EXECUTE format('GRANT ALL ON TABLE public.%I TO kf_core_owner',t.tablename);
 END LOOP;
 FOR f IN SELECT oid,oid::regprocedure::text AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'financial_%' OR proname LIKE 'position_%' OR proname LIKE 'trading_%' OR proname LIKE 'matching_%' OR proname LIKE 'market_schedule_%') LOOP
  FOR g IN SELECT DISTINCT grantee FROM information_schema.routine_privileges WHERE specific_schema='public' AND specific_name=(SELECT proname||'_'||oid::text FROM pg_proc WHERE oid=f.oid) AND grantee NOT IN ('PUBLIC',current_user,'kf_core_owner') LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,g.grantee);
  END LOOP;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  EXECUTE format('ALTER FUNCTION %s OWNER TO kf_core_owner',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO kf_core_owner,kf_api_owner',f.signature);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON public.markets,public.market_questions,public.market_outcomes,public.market_observation_specs,public.ctf_conditions,public.ctf_position_tokens,public.market_outcome_tokens TO kf_core_owner;
GRANT SELECT ON public.chains,public.contract_deployments,public.chain_assets,public.market_categories,public.user_wallets TO kf_core_owner;
GRANT USAGE,SELECT ON SEQUENCE public.market_outcomes_id_seq,public.ctf_conditions_id_seq,public.ctf_position_tokens_id_seq TO kf_core_owner;
GRANT EXECUTE ON FUNCTION public.validate_market_definition(uuid,boolean) TO kf_core_owner;
GRANT SELECT ON public.markets,public.market_categories,public.market_rounds,public.market_templates,public.trading_fills,public.trading_books,public.market_outcomes,public.market_outcome_tokens,public.ctf_position_tokens,public.ctf_conditions,public.market_questions,public.market_round_observations,public.market_round_requirements,public.market_observation_specs,public.financial_accounts,public.position_accounts,public.trading_orders,public.matching_requests,public.financial_balance_projections,public.position_balance_projections,public.cash_reservations,public.position_reservations,public.trading_order_events,public.market_lifecycle_events,public.sessions TO kf_api_owner;
--> statement-breakpoint
-- Read checks do not renew idle expiry. Mutations lock the session before financial locks.
CREATE FUNCTION custodial_api.session_user_id(p_hash text,p_lock boolean DEFAULT false) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result bigint; BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'valid session required' USING ERRCODE='28000'; END IF;
 IF p_lock THEN
  SELECT user_id INTO result FROM public.sessions WHERE token_hash=p_hash AND revoked_at IS NULL AND idle_expires_at>clock_timestamp() AND expires_at>clock_timestamp() FOR SHARE;
 ELSE
  SELECT user_id INTO result FROM public.sessions WHERE token_hash=p_hash AND revoked_at IS NULL AND idle_expires_at>clock_timestamp() AND expires_at>clock_timestamp();
 END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'valid session required' USING ERRCODE='28000'; END IF;
 RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION custodial_api.http_order(p_session text,p_action text,p_key text,p_terms jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid bigint; BEGIN
 IF p_action IS NULL OR p_action NOT IN ('PLACE','PLACE_MARKET','CANCEL') THEN RAISE EXCEPTION 'HTTP capability denied' USING ERRCODE='42501'; END IF;
 uid:=custodial_api.session_user_id(p_session,true);
 -- Ordinary callers cannot allocate privileged reconciliation keys. Allow only
 -- an existing user's own legacy replay; the original dispatcher still verifies
 -- its action and exact terms, so a replay cannot create a new financial effect.
 IF p_key LIKE 'system:reconcile:%' AND NOT EXISTS (
  SELECT 1 FROM public.matching_requests
  WHERE operation_key=p_key AND actor='user:'||uid::text
 ) THEN
  RAISE EXCEPTION 'reserved reconciliation namespace' USING ERRCODE='42501';
 END IF;
 RETURN public.trading_execute('user:'||uid::text,p_action,p_key,p_terms);
END $$;
--> statement-breakpoint
CREATE FUNCTION custodial_api.http_quote(p_session text,p_terms jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RETURN public.matching_quote('user:'||custodial_api.session_user_id(p_session)::text,p_terms); END $$;
--> statement-breakpoint
CREATE FUNCTION custodial_api.http_status(p_session text,p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RETURN public.matching_status('user:'||custodial_api.session_user_id(p_session)::text,p_key); END $$;
--> statement-breakpoint
-- This fixed dispatcher contains only existing read queries, never caller-selected SQL.
CREATE FUNCTION custodial_api.public_read(p_query text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_args IS NULL OR jsonb_typeof(p_args)<>'array' OR jsonb_array_length(p_args)>4 THEN RAISE EXCEPTION 'invalid read arguments'; END IF;
 IF p_query='READ_0' AND ((p_args->>1)::integer NOT BETWEEN 1 AND 100 OR p_args->>1 IS NULL) THEN RAISE EXCEPTION 'invalid page limit'; END IF;
 CASE p_query
 WHEN 'READ_0' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT m.id,m.title,m.description,m.market_type,m.trading_status,m.resolution_status,m.trading_starts_at,m.trading_ends_at,m.series_key,m.round_key,c.slug AS category_slug,c.name AS category_name,r.template_id,r.ordinal::text,mt.template_key,mt.definition->'schedule' AS schedule_config,mt.definition->'observation' AS observation_spec,(SELECT coalesce(sum(f.price_cents::numeric*(f.quantity/1000000)),0)::text FROM public.trading_fills f JOIN public.trading_books b ON b.id=f.book_id WHERE b.market_id=m.id) AS volume_cents,coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id::text,'label',o.outcome_label,'index',o.outcome_index) ORDER BY o.outcome_index) FROM public.market_outcomes o WHERE o.market_id=m.id),'[]'::jsonb) AS outcomes FROM public.markets m JOIN public.market_categories c ON c.id=m.category_id LEFT JOIN public.market_rounds r ON r.market_id=m.id LEFT JOIN public.market_templates mt ON mt.id=r.template_id WHERE m.terms_frozen_at IS NOT NULL AND (NOT (p_args->>2)::boolean::boolean OR (r.template_id IS NULL AND m.trading_status IN ('OPEN','PAUSED') AND m.trading_ends_at>statement_timestamp()) OR m.id=(SELECT mm.id FROM public.markets mm JOIN public.market_rounds rr ON rr.market_id=mm.id JOIN public.market_templates tt ON tt.id=rr.template_id WHERE tt.template_key=mt.template_key ORDER BY CASE WHEN mm.trading_starts_at<=statement_timestamp() AND mm.trading_ends_at>statement_timestamp() THEN 0 WHEN mm.trading_starts_at>statement_timestamp() THEN 1 ELSE 2 END,CASE WHEN mm.trading_starts_at>statement_timestamp() THEN mm.trading_starts_at END ASC,mm.trading_starts_at DESC LIMIT 1)) AND ((p_args->>0)::text='' OR m.id>nullif((p_args->>0)::text,'')::uuid) ORDER BY m.id LIMIT (p_args->>1)::integer) result_row);
 WHEN 'READ_1' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT o.market_id,o.id::text AS outcome_id,a.polarity,last.price_cents::text FROM public.market_outcomes o JOIN public.market_outcome_tokens a ON a.market_outcome_id=o.id JOIN public.trading_books b ON b.token_id=a.token_id LEFT JOIN LATERAL (SELECT f.price_cents FROM public.trading_fills f WHERE f.book_id=b.id ORDER BY f.id DESC LIMIT 1) last ON true WHERE o.market_id=ANY(ARRAY(SELECT jsonb_array_elements_text(p_args->0))::uuid[]::uuid[])) result_row);
 WHEN 'READ_2' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT m.id,m.title,m.description,m.market_type,m.trading_status,m.resolution_status,m.trading_starts_at,m.trading_ends_at,m.series_key,m.round_key,c.slug AS category_slug,c.name AS category_name,mt.template_key,mt.definition->'schedule' AS schedule_config,mt.definition->'observation' AS observation_spec FROM public.markets m JOIN public.market_categories c ON c.id=m.category_id LEFT JOIN public.market_rounds r ON r.market_id=m.id LEFT JOIN public.market_templates mt ON mt.id=r.template_id WHERE m.id=(p_args->>0)::uuid AND m.terms_frozen_at IS NOT NULL) result_row);
 WHEN 'READ_3' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT o.id::text AS outcome_id,o.outcome_index,o.outcome_label,o.range_lower::text,o.range_upper::text,a.polarity,a.token_id::text,t.position_id::text,b.id::text AS book_id,last.price_cents::text AS last_price_cents FROM public.market_outcomes o JOIN public.market_outcome_tokens a ON a.market_outcome_id=o.id JOIN public.ctf_position_tokens t ON t.id=a.token_id LEFT JOIN public.trading_books b ON b.token_id=t.id LEFT JOIN LATERAL (SELECT f.price_cents FROM public.trading_fills f WHERE f.book_id=b.id ORDER BY f.id DESC LIMIT 1) last ON true WHERE o.market_id=(p_args->>0)::uuid ORDER BY o.outcome_index,a.polarity) result_row);
 WHEN 'READ_4' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT kind,observed_at,value::text,evidence_ref,is_final,recorded_at FROM public.market_round_observations WHERE market_id=(p_args->>0)::uuid ORDER BY recorded_at DESC LIMIT 20) result_row);
 WHEN 'READ_5' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT kind,source_id,unit,decimals,window_start,window_end,expected_available_at,revision_policy FROM public.market_round_requirements WHERE market_id=(p_args->>0)::uuid ORDER BY kind) result_row);
 WHEN 'READ_6' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT reference_asset,unit,decimals FROM public.market_observation_specs WHERE market_id=(p_args->>0)::uuid) result_row);
 WHEN 'READ_7' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT question_text,resolution_rules,resolution_source FROM public.market_questions WHERE market_id=(p_args->>0)::uuid) result_row);
 WHEN 'READ_10' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT m.id,m.title,m.trading_status,m.resolution_status,r.ordinal::text,r.opens_at,r.cutoff_at,r.expected_available_at,r.missed,r.expiration_complete FROM public.market_rounds r JOIN public.markets m ON m.id=r.market_id WHERE r.template_id IN (SELECT mt.id FROM public.market_templates mt WHERE mt.template_key=(SELECT t.template_key FROM public.market_rounds rr JOIN public.market_templates t ON t.id=rr.template_id WHERE rr.market_id=(p_args->>0)::uuid)) ORDER BY r.ordinal DESC LIMIT 100) result_row);
 WHEN 'READ_11' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT lifecycle_status,trading_status,resolution_status,terms_frozen_at,trading_starts_at,trading_ends_at FROM public.markets WHERE id=(p_args->>0)::uuid) result_row);
 WHEN 'READ_12' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT id::text,command_sequence::text,market_id,token_id::text FROM public.trading_books WHERE market_id=(p_args->>0)::uuid AND token_id=(p_args->>1)::bigint) result_row);
 WHEN 'READ_13' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT o.side,o.limit_price_cents::text AS price_cents,sum(o.remaining_quantity)::text AS quantity FROM public.trading_orders o JOIN public.matching_requests r ON r.order_id=o.id AND r.action='PLACE' WHERE o.book_id=(p_args->>0)::bigint AND o.status IN ('OPEN','PARTIAL') AND r.state='DONE' AND r.resting='YES' GROUP BY o.side,o.limit_price_cents ORDER BY o.side,o.limit_price_cents LIMIT 198) result_row);
 WHEN 'READ_15' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT f.id::text,f.quantity::text,f.price_cents::text,f.created_at FROM public.trading_fills f WHERE f.book_id=(p_args->>0)::bigint ORDER BY f.id DESC LIMIT 50) result_row);
 WHEN 'READ_22' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT (coalesce((SELECT sum(command_sequence) FROM public.trading_books),0)+coalesce((SELECT sum(n) FROM (SELECT max(sequence) AS n FROM public.market_lifecycle_events GROUP BY template_id) e),0))::text AS value) result_row);
 ELSE RAISE EXCEPTION 'public read capability denied' USING ERRCODE='42501'; END CASE;
END $$;
--> statement-breakpoint
CREATE FUNCTION custodial_api.private_read(p_session text,p_query text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid bigint; BEGIN
 uid:=custodial_api.session_user_id(p_session);
 IF p_args IS NULL OR jsonb_typeof(p_args)<>'array' OR jsonb_array_length(p_args)>4 THEN RAISE EXCEPTION 'invalid read arguments'; END IF;
 -- Ignore supplied ownership selectors: ownership always comes from the verified session.
 IF p_query IN ('READ_14','READ_20') THEN p_args:=jsonb_set(p_args,'{1}',to_jsonb(uid::text));
 ELSIF p_query IN ('READ_21','READ_23') THEN p_args:=jsonb_set(p_args,'{0}',to_jsonb('user:'||uid::text));
 ELSE p_args:=jsonb_set(p_args,'{0}',to_jsonb(uid::text)); END IF;
 CASE p_query
 WHEN 'READ_8' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT id::text FROM public.financial_accounts WHERE owner_user_id=(p_args->>0)::bigint AND kind='CUSTOMER' AND asset='USD') result_row);
 WHEN 'READ_9' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT id::text FROM public.position_accounts WHERE owner_user_id=(p_args->>0)::bigint AND kind='CUSTOMER' AND token_id=(p_args->>1)::bigint) result_row);
 WHEN 'READ_14' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT o.side,o.limit_price_cents::text AS price_cents,o.remaining_quantity::text AS quantity,(o.user_id::text=(p_args->>1)::text) AS own FROM public.trading_orders o JOIN public.matching_requests r ON r.order_id=o.id AND r.action='PLACE' WHERE o.book_id=(p_args->>0)::bigint AND o.status IN ('OPEN','PARTIAL') AND r.state='DONE' AND r.resting='YES' ORDER BY o.side,CASE WHEN o.side='BUY' THEN -o.limit_price_cents ELSE o.limit_price_cents END,r.sequence,o.id) result_row);
 WHEN 'READ_16' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT p.posted::text,p.reserved::text,(p.posted-p.reserved)::text AS available FROM public.financial_accounts a JOIN public.financial_balance_projections p ON p.account_id=a.id WHERE a.owner_user_id=(p_args->>0)::bigint AND a.kind='CUSTOMER' AND a.asset='USD') result_row);
 WHEN 'READ_17' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT a.token_id::text,q.market_id,m.title,m.round_key,(SELECT jsonb_agg(jsonb_build_object('outcome',o.outcome_label,'polarity',alias.polarity)) FROM public.market_outcome_tokens alias JOIN public.market_outcomes o ON o.id=alias.market_outcome_id WHERE alias.token_id=a.token_id) AS claims,p.posted::text,p.reserved::text,(p.posted-p.reserved)::text AS available FROM public.position_accounts a JOIN public.position_balance_projections p ON p.account_id=a.id JOIN public.ctf_position_tokens t ON t.id=a.token_id JOIN public.ctf_conditions cc ON cc.id=t.condition_id JOIN public.market_questions q ON q.id=cc.market_question_id JOIN public.markets m ON m.id=q.market_id WHERE a.owner_user_id=(p_args->>0)::bigint AND a.kind='CUSTOMER' ORDER BY a.id LIMIT 200) result_row);
 WHEN 'READ_18' THEN
  IF (p_args->>2)::integer NOT BETWEEN 1 AND 100 OR p_args->>2 IS NULL THEN RAISE EXCEPTION 'invalid page limit'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT o.id::text,b.market_id,m.title,m.round_key,(SELECT jsonb_agg(jsonb_build_object('outcome',mo.outcome_label,'polarity',a.polarity)) FROM public.market_outcome_tokens a JOIN public.market_outcomes mo ON mo.id=a.market_outcome_id WHERE a.token_id=b.token_id) AS claims,b.token_id::text,o.side,o.limit_price_cents::text,o.original_quantity::text,o.filled_quantity::text,o.remaining_quantity::text,o.status,o.created_at,r.state AS command_state,coalesce((cr.amount-cr.consumed-cr.released)::text,(pr.quantity-pr.consumed-pr.released)::text) AS reserved FROM public.trading_orders o JOIN public.trading_books b ON b.id=o.book_id JOIN public.markets m ON m.id=b.market_id JOIN public.matching_requests r ON r.order_id=o.id AND r.action='PLACE' LEFT JOIN public.cash_reservations cr ON cr.id=o.cash_reservation_id LEFT JOIN public.position_reservations pr ON pr.id=o.position_reservation_id WHERE o.user_id=(p_args->>0)::bigint AND ((p_args->>1)::bigint::bigint IS NULL OR o.id<(p_args->>1)::bigint) AND (NOT (p_args->>3)::boolean::boolean OR o.status IN ('PENDING','OPEN','PARTIAL')) ORDER BY o.id DESC LIMIT (p_args->>2)::integer) result_row);
 WHEN 'READ_19' THEN
  IF (p_args->>2)::integer NOT BETWEEN 1 AND 100 OR p_args->>2 IS NULL THEN RAISE EXCEPTION 'invalid page limit'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT f.id::text,b.market_id,m.title,m.round_key,(SELECT jsonb_agg(jsonb_build_object('outcome',mo.outcome_label,'polarity',a.polarity)) FROM public.market_outcome_tokens a JOIN public.market_outcomes mo ON mo.id=a.market_outcome_id WHERE a.token_id=b.token_id) AS claims,b.token_id::text,f.quantity::text,f.price_cents::text,f.created_at,CASE WHEN buyer.user_id=(p_args->>0)::bigint THEN 'BUY' ELSE 'SELL' END AS side FROM public.trading_fills f JOIN public.trading_books b ON b.id=f.book_id JOIN public.markets m ON m.id=b.market_id JOIN public.trading_orders buyer ON buyer.id=f.buyer_order_id JOIN public.trading_orders seller ON seller.id=f.seller_order_id WHERE (buyer.user_id=(p_args->>0)::bigint OR seller.user_id=(p_args->>0)::bigint) AND ((p_args->>1)::bigint::bigint IS NULL OR f.id<(p_args->>1)::bigint) ORDER BY f.id DESC LIMIT (p_args->>2)::integer) result_row);
 WHEN 'READ_20' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT 1 FROM public.trading_orders WHERE id=(p_args->>0)::bigint AND user_id=(p_args->>1)::bigint) result_row);
 WHEN 'READ_21' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT id,sequence::text,action,state,result,order_id::text FROM public.matching_requests WHERE actor=(p_args->>0)::text AND operation_key=(p_args->>1)::text) result_row);
 WHEN 'READ_23' THEN
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(result_row)),'[]'::jsonb) FROM (SELECT count(*)::text AS value FROM public.trading_order_events e JOIN public.trading_orders o ON o.id=e.order_id WHERE 'user:'||o.user_id::text=(p_args->>0)::text) result_row);
 ELSE RAISE EXCEPTION 'private read capability denied' USING ERRCODE='42501'; END CASE;
END $$;
--> statement-breakpoint
CREATE FUNCTION custodial_api.matching(p_action text,p_terms jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 CASE p_action
 WHEN 'PENDING' THEN RETURN public.matching_pending('system:http-trading');
 WHEN 'STEP' THEN RETURN public.matching_step('system:http-trading',(p_terms->>'marketId')::uuid);
 WHEN 'EXPIRING' THEN RETURN public.matching_expiring('system:http-trading');
 WHEN 'EXPIRE' THEN
  IF (p_terms->>'limit')::integer NOT BETWEEN 1 AND 100 OR p_terms->>'limit' IS NULL THEN RAISE EXCEPTION 'invalid expiry limit'; END IF;
  RETURN public.matching_expire('system:http-trading',(p_terms->>'marketId')::uuid,(p_terms->>'limit')::integer);
 WHEN 'DIAGNOSTICS' THEN RETURN public.matching_diagnostics('system:http-trading');
 ELSE RAISE EXCEPTION 'matching capability denied' USING ERRCODE='42501'; END CASE;
END $$;
--> statement-breakpoint
CREATE FUNCTION custodial_api.scheduler(p_action text,p_terms jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 CASE p_action
 WHEN 'DISCOVER' THEN RETURN public.market_schedule_read('system:http-trading','DISCOVER','{}'::jsonb);
 WHEN 'PLAN' THEN RETURN public.market_schedule_plan('system:http-trading',(p_terms->>'templateId')::uuid);
 WHEN 'CREATE_ROUND' THEN RETURN public.market_schedule_create_round('system:http-trading',p_terms);
 WHEN 'LIFECYCLE_STEP' THEN RETURN public.market_schedule_step('system:http-trading',(p_terms->>'marketId')::uuid);
 WHEN 'FAILURE','RECOVERED' THEN RETURN public.market_schedule_execute('system:http-trading',p_action,p_terms);
 ELSE RAISE EXCEPTION 'scheduler capability denied' USING ERRCODE='42501'; END CASE;
END $$;
--> statement-breakpoint
CREATE FUNCTION custodial_api.market_admin(p_action text,p_terms jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('CREATE_TEMPLATE','ENABLE','PAUSE','RESUME') THEN RAISE EXCEPTION 'market admin capability denied' USING ERRCODE='42501'; END IF;
 RETURN public.market_schedule_execute('system:http-trading',p_action,p_terms);
END $$;
--> statement-breakpoint
CREATE FUNCTION custodial_api.reconcile() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reconciliation_key text;
BEGIN
 -- Reconciliation is observational. Each attempt gets a fresh key, but never
 -- posts a journal, changes a reservation or retries a financial mutation.
 PERFORM pg_advisory_xact_lock(727190001);
 LOOP
  reconciliation_key := 'system:reconcile:' || pg_catalog.gen_random_uuid()::text;
  EXIT WHEN NOT EXISTS (
   SELECT 1 FROM public.matching_requests WHERE operation_key=reconciliation_key
  );
 END LOOP;
 RETURN public.trading_execute('system:http-trading','RECONCILE',reconciliation_key,'{}'::jsonb);
END $$;
--> statement-breakpoint
-- Session row locking requires UPDATE privilege for SELECT FOR SHARE; no runtime receives it.
GRANT UPDATE(token_hash) ON public.sessions TO kf_api_owner;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure::text AS signature FROM pg_proc WHERE pronamespace='custodial_api'::regnamespace LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO kf_api_owner',f.signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION custodial_api.http_order(text,text,text,jsonb),custodial_api.http_quote(text,jsonb),custodial_api.http_status(text,text),custodial_api.private_read(text,text,jsonb),custodial_api.public_read(text,jsonb) TO kf_trading_http;
GRANT EXECUTE ON FUNCTION custodial_api.public_read(text,jsonb) TO kf_public_read;
GRANT EXECUTE ON FUNCTION custodial_api.matching(text,jsonb) TO kf_matching_worker;
GRANT EXECUTE ON FUNCTION custodial_api.scheduler(text,jsonb) TO kf_market_scheduler;
GRANT EXECUTE ON FUNCTION custodial_api.market_admin(text,jsonb) TO kf_market_admin;
GRANT EXECUTE ON FUNCTION custodial_api.reconcile() TO kf_reconciliation;
-- Funding has no schema access, executable wrapper or runtime login.
