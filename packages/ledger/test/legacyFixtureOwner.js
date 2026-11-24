// Historical adoption suites intentionally exercise the old trusted fixture boundary.
// Never import this administrator-only helper into an HTTP runtime or worker.
export async function restoreLegacyFixtureOwner(admin,owner,runtime) {
 if(process.env.NODE_ENV!=='test'||![owner,runtime].every(v=>/^[a-z_][a-z0-9_]*$/.test(v)))throw new Error('Test fixture owner required.');
 for(const {tablename} of (await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'financial_%' OR tablename LIKE 'cash_%' OR tablename LIKE 'position_%' OR tablename LIKE 'trading_%' OR tablename LIKE 'matching_%' OR tablename IN ('market_templates','market_template_controls','market_rounds','market_round_requirements','market_round_observations','market_lifecycle_events','market_lifecycle_cursors'))")).rows)await admin.query('ALTER TABLE public.'+tablename+' OWNER TO '+owner);
 for(const {signature} of (await admin.query("SELECT oid::regprocedure::text AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'financial_%' OR proname LIKE 'position_%' OR proname LIKE 'trading_%' OR proname LIKE 'matching_%' OR proname LIKE 'market_schedule_%')")).rows)await admin.query('ALTER FUNCTION '+signature+' OWNER TO '+owner);
 await admin.query('GRANT EXECUTE ON FUNCTION public.financial_execute(text,text,text,jsonb),public.financial_reconcile(text) TO '+runtime);
}
