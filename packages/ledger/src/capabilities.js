// Database capabilities deliberately do not expose arbitrary actors or SQL actions.
// PostgreSQL still owns locks, idempotency, reservations and atomic settlement.
// Each process receives a different login role, and each role can execute only
// the narrow wrapper required for its responsibility.
export function createCapabilityClient(pool, { environment = process.env.NODE_ENV } = {}) {
  if (!['test', 'development'].includes(environment) || ['production', 'staging'].includes(process.env.NODE_ENV)) {
    throw new Error('Custodial capabilities are disabled outside explicit local testing.');
  }
  const statements = {
    order: 'SELECT custodial_api.http_order($1,$2,$3,$4::jsonb) AS result',
    quote: 'SELECT custodial_api.http_quote($1,$2::jsonb) AS result',
    status: 'SELECT custodial_api.http_status($1,$2) AS result',
    matching: 'SELECT custodial_api.matching($1,$2::jsonb) AS result',
    scheduler: 'SELECT custodial_api.scheduler($1,$2::jsonb) AS result',
  };
  return async function call(capability, args, { readOnly = false } = {}) {
    if (!Object.hasOwn(statements, capability)) throw new TypeError('Unknown capability.');
    const client = await pool.connect();
    let committing = false, discard;
    try {
      // All statements, commit checks and rollback handling stay on one physical
      // connection. This is required for PostgreSQL transaction correctness.
      await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      await client.query("SET LOCAL statement_timeout='10s'");
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
      const role = (await client.query(`SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls
        OR has_function_privilege(current_user,'public.financial_execute(text,text,text,jsonb)','EXECUTE')
        OR has_function_privilege(current_user,'public.trading_execute(text,text,text,jsonb)','EXECUTE')
        OR has_function_privilege(current_user,'public.market_schedule_execute(text,text,jsonb)','EXECUTE') OR EXISTS (
        SELECT 1 FROM pg_class c WHERE c.relnamespace IN ('public'::regnamespace,'custodial_api'::regnamespace)
        AND c.relkind IN ('r','p') AND (pg_has_role(current_user,c.relowner,'MEMBER')
        OR has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE'))
      ) OR EXISTS (
        SELECT 1 FROM pg_proc f JOIN pg_roles owner_role ON owner_role.oid=f.proowner
        WHERE (f.pronamespace='custodial_api'::regnamespace OR (f.pronamespace='public'::regnamespace AND (f.proname LIKE 'financial_%' OR f.proname LIKE 'position_%' OR f.proname LIKE 'trading_%' OR f.proname LIKE 'matching_%' OR f.proname LIKE 'market_schedule_%')))
        AND has_function_privilege(current_user,f.oid,'EXECUTE')
        AND (pg_has_role(current_user,f.proowner,'MEMBER') OR owner_role.rolsuper OR owner_role.rolcreaterole OR owner_role.rolcreatedb OR owner_role.rolbypassrls OR owner_role.rolcanlogin OR NOT coalesce(f.proconfig @> ARRAY['search_path=pg_catalog'],false))
      ) AS unsafe FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
      if (!role || role.unsafe !== false) throw new Error('Restricted capability role required.');

      // Call a fixed SECURITY DEFINER wrapper; arbitrary SQL and action names
      // supplied by an HTTP caller are never executed here.
      const result = await client.query(statements[capability], args);
      committing = true;
      await client.query('COMMIT');
      return result.rows[0].result;
    } catch (error) {
      if (committing) {
        const rejected = /^(22|23|28|P0)/.test(error.code || '') || ['40001','40P01'].includes(error.code);
        error.commitOutcome = rejected ? 'ROLLED_BACK' : 'UNKNOWN';
        if (!rejected) discard = error;
      }
      try { await client.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
      throw error;
    } finally { client.release(discard); }
  };
}

export function requireTradingSession(session) {
  // Session binding is checked again inside PostgreSQL before private reads or
  // mutations are authorized. This check rejects malformed calls early.
  if (!session || typeof session.userId !== 'string' || !/^[1-9][0-9]*$/.test(session.userId) || !/^[a-f0-9]{64}$/.test(session.sessionHash || '')) {
    throw Object.assign(new Error('Trading session required.'), {code: '28000'});
  }
  return {userId: String(session.userId), sessionHash: session.sessionHash};
}
