CREATE TABLE "financial_audit_targets" (
	"transaction_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" bigint NOT NULL,
	CONSTRAINT "financial_audit_targets_pkey" PRIMARY KEY("transaction_id","target_kind","target_id"),
	CONSTRAINT "financial_audit_targets_identity_check" CHECK ("financial_audit_targets"."transaction_id" ~ '^[0-9]+$' AND "financial_audit_targets"."target_id" > 0),
	CONSTRAINT "financial_audit_targets_kind_check" CHECK ("financial_audit_targets"."target_kind" IN ('OPERATION','JOURNAL','ACCOUNT','RESERVATION'))
);

--> statement-breakpoint
REVOKE ALL ON TABLE public.financial_audit_targets FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.financial_schedule_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE tx text := pg_current_xact_id()::text;
BEGIN
 IF TG_TABLE_NAME='financial_operations' THEN
   INSERT INTO public.financial_audit_targets VALUES(tx,'OPERATION',NEW.id) ON CONFLICT DO NOTHING;
 ELSIF TG_TABLE_NAME='financial_journals' THEN
   INSERT INTO public.financial_audit_targets VALUES(tx,'JOURNAL',NEW.id) ON CONFLICT DO NOTHING;
 ELSIF TG_TABLE_NAME='financial_journal_entries' THEN
   INSERT INTO public.financial_audit_targets VALUES(tx,'JOURNAL',NEW.journal_id),(tx,'ACCOUNT',NEW.account_id) ON CONFLICT DO NOTHING;
 ELSIF TG_TABLE_NAME='financial_accounts' THEN
   INSERT INTO public.financial_audit_targets VALUES(tx,'ACCOUNT',NEW.id) ON CONFLICT DO NOTHING;
 ELSIF TG_TABLE_NAME='financial_balance_projections' THEN
   INSERT INTO public.financial_audit_targets VALUES(tx,'ACCOUNT',NEW.account_id) ON CONFLICT DO NOTHING;
 ELSIF TG_TABLE_NAME='cash_reservations' THEN
   INSERT INTO public.financial_audit_targets VALUES(tx,'RESERVATION',NEW.id),(tx,'ACCOUNT',NEW.account_id) ON CONFLICT DO NOTHING;
 ELSIF TG_TABLE_NAME='cash_reservation_events' THEN
   INSERT INTO public.financial_audit_targets VALUES(tx,'RESERVATION',NEW.reservation_id) ON CONFLICT DO NOTHING;
   IF NEW.journal_id IS NOT NULL THEN
     INSERT INTO public.financial_audit_targets VALUES(tx,'JOURNAL',NEW.journal_id) ON CONFLICT DO NOTHING;
   END IF;
 ELSE RAISE EXCEPTION 'unexpected audit source';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.financial_validate_target() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE j public.financial_journals; a public.financial_accounts;
 p public.financial_balance_projections; r public.cash_reservations;
BEGIN
 IF NEW.transaction_id IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'audit transaction mismatch'; END IF;
 IF NEW.target_kind='OPERATION' THEN
   IF NOT EXISTS(SELECT 1 FROM public.financial_operations WHERE id=NEW.target_id AND result IS NOT NULL) THEN RAISE EXCEPTION 'incomplete financial operation'; END IF;
 ELSIF NEW.target_kind='JOURNAL' THEN
   SELECT * INTO STRICT j FROM public.financial_journals WHERE id=NEW.target_id;
   IF j.status<>'POSTED' OR (SELECT count(*) FROM public.financial_journal_entries WHERE journal_id=j.id)<2 OR
     EXISTS(SELECT 1 FROM public.financial_journal_entries WHERE journal_id=j.id GROUP BY asset
       HAVING sum(CASE side WHEN 'DEBIT' THEN amount::numeric ELSE -amount::numeric END)<>0) THEN
     RAISE EXCEPTION 'journal must be posted and balanced per asset' USING ERRCODE='23514';
   END IF;
   IF j.reversal_of IS NOT NULL AND (
     EXISTS(SELECT account_id,asset,side,sum(amount::numeric) FROM public.financial_journal_entries WHERE journal_id=j.id GROUP BY account_id,asset,side
       EXCEPT SELECT account_id,asset,CASE side WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,sum(amount::numeric) FROM public.financial_journal_entries WHERE journal_id=j.reversal_of GROUP BY account_id,asset,side)
     OR EXISTS(SELECT account_id,asset,CASE side WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,sum(amount::numeric) FROM public.financial_journal_entries WHERE journal_id=j.reversal_of GROUP BY account_id,asset,side
       EXCEPT SELECT account_id,asset,side,sum(amount::numeric) FROM public.financial_journal_entries WHERE journal_id=j.id GROUP BY account_id,asset,side)
     OR EXISTS(SELECT 1 FROM public.cash_reservation_events WHERE journal_id=j.reversal_of)) THEN
     RAISE EXCEPTION 'reversal must exactly compensate eligible journal';
   END IF;
 ELSIF NEW.target_kind='ACCOUNT' THEN
   SELECT * INTO STRICT a FROM public.financial_accounts WHERE id=NEW.target_id;
   SELECT * INTO p FROM public.financial_balance_projections WHERE account_id=a.id;
   IF NOT FOUND OR p.posted::numeric <> COALESCE((SELECT sum(CASE WHEN e.side=a.normal_side THEN e.amount::numeric ELSE -e.amount::numeric END)
      FROM public.financial_journal_entries e WHERE e.account_id=a.id),0)
      OR p.reserved::numeric <> COALESCE((SELECT sum(r2.amount::numeric-r2.consumed-r2.released) FROM public.cash_reservations r2 WHERE r2.account_id=a.id),0) THEN
      RAISE EXCEPTION 'financial projection differs from history' USING ERRCODE='23514';
   END IF;
 ELSIF NEW.target_kind='RESERVATION' THEN
   SELECT * INTO STRICT r FROM public.cash_reservations WHERE id=NEW.target_id;
   IF r.amount::numeric <> COALESCE((SELECT sum(e.amount::numeric) FROM public.cash_reservation_events e WHERE e.reservation_id=r.id AND e.kind='RESERVE'),0)
      OR r.consumed::numeric <> COALESCE((SELECT sum(e.amount::numeric) FROM public.cash_reservation_events e WHERE e.reservation_id=r.id AND e.kind='CONSUME'),0)
      OR r.released::numeric <> COALESCE((SELECT sum(e.amount::numeric) FROM public.cash_reservation_events e WHERE e.reservation_id=r.id AND e.kind IN ('RELEASE','CANCEL')),0) THEN
      RAISE EXCEPTION 'reservation differs from immutable event history' USING ERRCODE='23514';
   END IF;
   IF EXISTS(SELECT 1 FROM public.cash_reservation_events v WHERE v.reservation_id=r.id AND v.kind='CONSUME' AND
     ((SELECT count(*) FROM public.financial_journal_entries e WHERE e.journal_id=v.journal_id)<>2 OR
      NOT EXISTS(SELECT 1 FROM public.financial_journal_entries e WHERE e.journal_id=v.journal_id AND e.account_id=r.account_id AND e.side='DEBIT' AND e.amount=v.amount))) THEN
      RAISE EXCEPTION 'reservation consumption journal mismatch';
   END IF;
 ELSE RAISE EXCEPTION 'unknown audit target';
 END IF;
 DELETE FROM public.financial_audit_targets WHERE transaction_id=NEW.transaction_id AND target_kind=NEW.target_kind AND target_id=NEW.target_id;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER financial_target_commit_check
AFTER INSERT ON public.financial_audit_targets DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.financial_validate_target();

--> statement-breakpoint
DROP TRIGGER financial_accounts_audit ON public.financial_accounts;
--> statement-breakpoint
CREATE TRIGGER financial_accounts_audit AFTER INSERT OR UPDATE ON public.financial_accounts FOR EACH ROW EXECUTE FUNCTION public.financial_schedule_audit();

--> statement-breakpoint
DROP TRIGGER financial_operations_audit ON public.financial_operations;
--> statement-breakpoint
CREATE TRIGGER financial_operations_audit AFTER INSERT OR UPDATE ON public.financial_operations FOR EACH ROW EXECUTE FUNCTION public.financial_schedule_audit();

--> statement-breakpoint
DROP TRIGGER financial_journals_audit ON public.financial_journals;
--> statement-breakpoint
CREATE TRIGGER financial_journals_audit AFTER INSERT OR UPDATE ON public.financial_journals FOR EACH ROW EXECUTE FUNCTION public.financial_schedule_audit();

--> statement-breakpoint
DROP TRIGGER financial_journal_entries_audit ON public.financial_journal_entries;
--> statement-breakpoint
CREATE TRIGGER financial_journal_entries_audit AFTER INSERT OR UPDATE ON public.financial_journal_entries FOR EACH ROW EXECUTE FUNCTION public.financial_schedule_audit();

--> statement-breakpoint
DROP TRIGGER financial_balance_projections_audit ON public.financial_balance_projections;
--> statement-breakpoint
CREATE TRIGGER financial_balance_projections_audit AFTER INSERT OR UPDATE ON public.financial_balance_projections FOR EACH ROW EXECUTE FUNCTION public.financial_schedule_audit();

--> statement-breakpoint
DROP TRIGGER cash_reservations_audit ON public.cash_reservations;
--> statement-breakpoint
CREATE TRIGGER cash_reservations_audit AFTER INSERT OR UPDATE ON public.cash_reservations FOR EACH ROW EXECUTE FUNCTION public.financial_schedule_audit();

--> statement-breakpoint
DROP TRIGGER cash_reservation_events_audit ON public.cash_reservation_events;
--> statement-breakpoint
CREATE TRIGGER cash_reservation_events_audit AFTER INSERT OR UPDATE ON public.cash_reservation_events FOR EACH ROW EXECUTE FUNCTION public.financial_schedule_audit();

--> statement-breakpoint
CREATE FUNCTION public.financial_reconcile(p_actor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
 IF p_actor IS NULL OR p_actor !~ '^system:[a-z][a-z0-9_-]{0,60}$' THEN RAISE EXCEPTION 'system reconciliation capability required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(727190001);
 IF EXISTS(SELECT 1 FROM public.financial_journals j WHERE j.status <> 'POSTED' OR
   (SELECT count(*) FROM public.financial_journal_entries e WHERE e.journal_id=j.id)<2) OR
   EXISTS(SELECT 1 FROM public.financial_journal_entries GROUP BY journal_id,asset
     HAVING sum(CASE side WHEN 'DEBIT' THEN amount::numeric ELSE -amount::numeric END) <> 0) THEN
   RAISE EXCEPTION 'journal must be posted and balanced per asset' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.financial_operations WHERE result IS NULL) THEN RAISE EXCEPTION 'incomplete financial operation'; END IF;
 IF EXISTS(SELECT 1 FROM public.financial_accounts a LEFT JOIN public.financial_balance_projections p ON p.account_id=a.id
   WHERE p.account_id IS NULL OR p.posted::numeric <> COALESCE((SELECT sum(CASE WHEN e.side=a.normal_side THEN e.amount::numeric ELSE -e.amount::numeric END) FROM public.financial_journal_entries e WHERE e.account_id=a.id),0)
   OR p.reserved::numeric <> COALESCE((SELECT sum(r.amount::numeric-r.consumed-r.released) FROM public.cash_reservations r WHERE r.account_id=a.id),0)) THEN
   RAISE EXCEPTION 'financial projection differs from history' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.cash_reservations r WHERE
   r.amount::numeric <> COALESCE((SELECT sum(e.amount::numeric) FROM public.cash_reservation_events e WHERE e.reservation_id=r.id AND e.kind='RESERVE'),0)
   OR r.consumed::numeric <> COALESCE((SELECT sum(e.amount::numeric) FROM public.cash_reservation_events e WHERE e.reservation_id=r.id AND e.kind='CONSUME'),0)
   OR r.released::numeric <> COALESCE((SELECT sum(e.amount::numeric) FROM public.cash_reservation_events e WHERE e.reservation_id=r.id AND e.kind IN ('RELEASE','CANCEL')),0)) THEN
   RAISE EXCEPTION 'reservation differs from immutable event history' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.cash_reservation_events v JOIN public.cash_reservations r ON r.id=v.reservation_id WHERE v.kind='CONSUME' AND
   ((SELECT count(*) FROM public.financial_journal_entries e WHERE e.journal_id=v.journal_id)<>2 OR
    NOT EXISTS(SELECT 1 FROM public.financial_journal_entries e WHERE e.journal_id=v.journal_id AND e.account_id=r.account_id AND e.side='DEBIT' AND e.amount=v.amount))) THEN
   RAISE EXCEPTION 'reservation consumption journal mismatch';
 END IF;
 IF EXISTS(SELECT 1 FROM public.financial_journals j WHERE j.reversal_of IS NOT NULL AND
   (EXISTS(SELECT account_id,asset,side,sum(amount::numeric) FROM public.financial_journal_entries WHERE journal_id=j.id GROUP BY account_id,asset,side
     EXCEPT SELECT account_id,asset,CASE side WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,sum(amount::numeric) FROM public.financial_journal_entries WHERE journal_id=j.reversal_of GROUP BY account_id,asset,side)
    OR EXISTS(SELECT account_id,asset,CASE side WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,sum(amount::numeric) FROM public.financial_journal_entries WHERE journal_id=j.reversal_of GROUP BY account_id,asset,side
     EXCEPT SELECT account_id,asset,side,sum(amount::numeric) FROM public.financial_journal_entries WHERE journal_id=j.id GROUP BY account_id,asset,side)
    OR EXISTS(SELECT 1 FROM public.cash_reservation_events WHERE journal_id=j.reversal_of))) THEN
   RAISE EXCEPTION 'reversal must exactly compensate eligible journal';
 END IF;
 RETURN jsonb_build_object('consistent',true,
   'journals',(SELECT count(*)::text FROM public.financial_journals),
   'accounts',(SELECT count(*)::text FROM public.financial_accounts),
   'reservations',(SELECT count(*)::text FROM public.cash_reservations));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.financial_schedule_audit(),public.financial_validate_target(),public.financial_reconcile(text) FROM PUBLIC;
