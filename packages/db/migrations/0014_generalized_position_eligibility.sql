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
CREATE TABLE "position_token_verifications" (
	"token_id" bigint PRIMARY KEY NOT NULL,
	"condition_id" char(66) NOT NULL,
	"collection_id" char(66) NOT NULL,
	"position_id" text NOT NULL,
	"scope" text DEFAULT 'MOCK_ONLY' NOT NULL,
	"evidence_hash" char(64) NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_token_verifications_scope_check" CHECK ("position_token_verifications"."scope" = 'MOCK_ONLY'),
	CONSTRAINT "position_token_verifications_evidence_check" CHECK ("position_token_verifications"."evidence_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "position_token_verifications" ADD CONSTRAINT "position_token_verifications_token_id_ctf_position_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."ctf_position_tokens"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Evidence is provisioned only by a trusted offline verifier, never by runtime actors.
CREATE FUNCTION public.protect_position_token_verification() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'token verification evidence is immutable'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.ctf_position_tokens t JOIN public.ctf_conditions c ON c.id=t.condition_id
  WHERE t.id=NEW.token_id AND c.condition_id=NEW.condition_id AND t.collection_id=NEW.collection_id
   AND t.position_id::text=NEW.position_id) THEN
  RAISE EXCEPTION 'verification evidence does not match canonical token' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER position_token_verifications_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.position_token_verifications FOR EACH ROW EXECUTE FUNCTION public.protect_position_token_verification();
--> statement-breakpoint
-- Keep all five authoritative write boundaries. Replace rejection with exact-token eligibility.
CREATE OR REPLACE FUNCTION public.block_unsupported_position_accounting() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE token bigint; account bigint; market_type text;
BEGIN
 token := (to_jsonb(NEW)->>'token_id')::bigint;
 account := (to_jsonb(NEW)->>'account_id')::bigint;
 IF token IS NULL AND account IS NOT NULL THEN
  SELECT token_id INTO token FROM public.position_accounts WHERE id=account;
 END IF;
 SELECT m.market_type INTO market_type FROM public.ctf_position_tokens t
 JOIN public.ctf_conditions c ON c.id=t.condition_id
 JOIN public.market_questions q ON q.id=c.market_question_id
 JOIN public.markets m ON m.id=q.market_id WHERE t.id=token;
 IF market_type IS NULL THEN RAISE EXCEPTION 'unknown canonical accounting token' USING ERRCODE='42501'; END IF;
 -- Preserve historical binary eligibility; it is not evidence of cryptographic verification.
 IF market_type='BINARY' THEN RETURN NEW; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.position_token_verifications v
  JOIN public.ctf_position_tokens t ON t.id=v.token_id
  JOIN public.ctf_conditions c ON c.id=t.condition_id
  JOIN public.market_questions q ON q.id=c.market_question_id
  JOIN public.markets m ON m.id=q.market_id
  JOIN public.chain_assets a ON a.id=c.collateral_asset_id
  JOIN public.chains ch ON ch.chain_id=c.chain_id
  JOIN public.contract_deployments d ON d.id=c.ctf_contract_deployment_id
  JOIN public.contract_deployments o ON o.id=c.oracle_contract_deployment_id
  WHERE t.id=token AND v.scope='MOCK_ONLY'
   AND v.condition_id=c.condition_id AND v.collection_id=t.collection_id AND v.position_id=t.position_id::text
   AND m.terms_frozen_at IS NOT NULL AND c.outcome_slot_count=m.outcome_count
   AND c.registration_status IN ('DERIVED','PREPARED')
   AND t.chain_id=c.chain_id AND t.collateral_asset_id=c.collateral_asset_id AND t.ctf_contract_deployment_id=c.ctf_contract_deployment_id
   AND a.chain_id=c.chain_id AND a.asset_type='ERC20' AND a.decimals=6
   AND ch.environment='testnet'
   AND d.chain_id=c.chain_id AND d.contract_role='GNOSIS_CTF' AND d.deployment_status='CONFIRMED'
   AND o.chain_id=c.chain_id AND o.contract_role='ORACLE' AND o.deployment_status='CONFIRMED' AND o.contract_address=c.oracle_address
   AND t.index_set>0 AND t.index_set<power(2::numeric,c.outcome_slot_count)-1
   AND EXISTS (SELECT 1 FROM public.market_outcome_tokens alias WHERE alias.token_id=t.id)
 ) THEN RAISE EXCEPTION 'categorical accounting requires Phase 4.4 approved mock token verification' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON TABLE public.position_token_verifications FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_position_token_verification() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.block_unsupported_position_accounting() FROM PUBLIC;
