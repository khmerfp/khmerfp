import { executionDepth } from './bookDepth.js';
// Read-only projections for the HTTP boundary. Never accepts caller-selected SQL or actors.
export const READ_TABLES = ['market_templates', 'markets', 'market_categories', 'market_outcomes', 'market_outcome_tokens', 'ctf_position_tokens', 'ctf_conditions', 'market_questions', 'market_rounds', 'market_round_requirements', 'market_round_observations', 'trading_books', 'trading_orders', 'trading_order_events', 'trading_fills', 'matching_requests', 'matching_markets', 'financial_accounts', 'financial_balance_projections', 'position_accounts', 'position_balance_projections', 'cash_reservations', 'position_reservations', 'trading_event_stream', 'market_lifecycle_events'];
export function createTradingReads(pool) {
  async function snapshot(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout='5s'");
      await client.query("SET LOCAL search_path=pg_catalog,public,pg_temp");
      const role = (await client.query(`SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR EXISTS (
        SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')
        AND (pg_has_role(current_user,c.relowner,'MEMBER') OR has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE'))
      ) AS unsafe FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
      if (!role || role.unsafe) throw new Error('Restricted read-only database role required.');
      const meta = (await client.query('SELECT clock_timestamp() AS "serverTime", pg_snapshot_xmax(pg_current_snapshot())::text AS revision, pg_current_snapshot()::text AS "snapshotId"')).rows[0];
      const data = await work(client);
      await client.query('COMMIT');
      return {
        ...meta,
        ...data,
        mode: 'LOCAL_MOCK_ONLY'
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  const markets = async (c,after='',limit=25,current=false) => {
    const rows=(await c.query(`SELECT m.id,m.title,m.description,m.market_type,m.trading_status,m.resolution_status,m.trading_starts_at,m.trading_ends_at,m.series_key,m.round_key,c.slug AS category_slug,c.name AS category_name,r.template_id,r.ordinal::text,mt.template_key,mt.definition->'schedule' AS schedule_config,mt.definition->'observation' AS observation_spec,(SELECT coalesce(sum(f.price_cents::numeric*(f.quantity/1000000)),0)::text FROM trading_fills f JOIN trading_books b ON b.id=f.book_id WHERE b.market_id=m.id) AS volume_cents,coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id::text,'label',o.outcome_label,'index',o.outcome_index) ORDER BY o.outcome_index) FROM market_outcomes o WHERE o.market_id=m.id),'[]'::jsonb) AS outcomes FROM markets m JOIN market_categories c ON c.id=m.category_id LEFT JOIN market_rounds r ON r.market_id=m.id LEFT JOIN market_templates mt ON mt.id=r.template_id WHERE m.terms_frozen_at IS NOT NULL AND (NOT $3::boolean OR (r.template_id IS NULL AND m.trading_status IN ('OPEN','PAUSED') AND m.trading_ends_at>statement_timestamp()) OR m.id=(SELECT mm.id FROM markets mm JOIN market_rounds rr ON rr.market_id=mm.id JOIN market_templates tt ON tt.id=rr.template_id WHERE tt.template_key=mt.template_key ORDER BY CASE WHEN mm.trading_starts_at<=statement_timestamp() AND mm.trading_ends_at>statement_timestamp() THEN 0 WHEN mm.trading_starts_at>statement_timestamp() THEN 1 ELSE 2 END,CASE WHEN mm.trading_starts_at>statement_timestamp() THEN mm.trading_starts_at END ASC,mm.trading_starts_at DESC LIMIT 1)) AND ($1='' OR m.id>nullif($1,'')::uuid) ORDER BY m.id LIMIT $2`,[after,limit,current])).rows;
    if(!rows.length)return rows;
    const prices=(await c.query(`SELECT o.market_id,o.id::text AS outcome_id,a.polarity,last.price_cents::text FROM market_outcomes o JOIN market_outcome_tokens a ON a.market_outcome_id=o.id JOIN trading_books b ON b.token_id=a.token_id LEFT JOIN LATERAL (SELECT f.price_cents FROM trading_fills f WHERE f.book_id=b.id ORDER BY f.id DESC LIMIT 1) last ON true WHERE o.market_id=ANY($1::uuid[])`,[rows.map(r=>r.id)])).rows;
    return rows.map(row=>({...row,outcomes:row.outcomes.map(o=>({...o,yesPriceCents:prices.find(p=>p.outcome_id===o.id&&p.polarity==='YES')?.price_cents??null,noPriceCents:prices.find(p=>p.outcome_id===o.id&&p.polarity==='NO')?.price_cents??null}))}));
  };
  const detail = async (c, id) => {
    const market = (await c.query(`SELECT m.id,m.title,m.description,m.market_type,m.trading_status,m.resolution_status,m.trading_starts_at,m.trading_ends_at,m.series_key,m.round_key,c.slug AS category_slug,c.name AS category_name,mt.template_key,mt.definition->'schedule' AS schedule_config,mt.definition->'observation' AS observation_spec FROM markets m JOIN market_categories c ON c.id=m.category_id LEFT JOIN market_rounds r ON r.market_id=m.id LEFT JOIN market_templates mt ON mt.id=r.template_id WHERE m.id=$1 AND m.terms_frozen_at IS NOT NULL`, [id])).rows[0];
    if (!market) return null;
    const claims = (await c.query(`SELECT o.id::text AS outcome_id,o.outcome_index,o.outcome_label,o.range_lower::text,o.range_upper::text,a.polarity,a.token_id::text,t.position_id::text,b.id::text AS book_id,last.price_cents::text AS last_price_cents FROM market_outcomes o JOIN market_outcome_tokens a ON a.market_outcome_id=o.id JOIN ctf_position_tokens t ON t.id=a.token_id LEFT JOIN trading_books b ON b.token_id=t.id LEFT JOIN LATERAL (SELECT f.price_cents FROM trading_fills f WHERE f.book_id=b.id ORDER BY f.id DESC LIMIT 1) last ON true WHERE o.market_id=$1 ORDER BY o.outcome_index,a.polarity`, [id])).rows;
    const observations = (await c.query('SELECT kind,observed_at,value::text,evidence_ref,is_final,recorded_at FROM market_round_observations WHERE market_id=$1 ORDER BY recorded_at DESC LIMIT 20', [id])).rows;
    const requirements = (await c.query('SELECT kind,source_id,unit,decimals,window_start,window_end,expected_available_at,revision_policy FROM market_round_requirements WHERE market_id=$1 ORDER BY kind', [id])).rows;
    return {
      ...market,
      claims,
      observations,
      requirements
    };
  };
  const account = async (c, userId, tokenId) => {
    const cash = (await c.query("SELECT id::text FROM financial_accounts WHERE owner_user_id=$1 AND kind='CUSTOMER' AND asset='USD'", [userId])).rows[0];
    const position = (await c.query("SELECT id::text FROM position_accounts WHERE owner_user_id=$1 AND kind='CUSTOMER' AND token_id=$2", [userId, tokenId])).rows[0];
    return {
      cashAccountId: cash?.id,
      positionAccountId: position?.id
    };
  };
  return {
    markets: (after, limit, current = false) => snapshot(async c => ({
      markets: await markets(c, after, limit, current)
    })),
    market: id => snapshot(async c => ({
      market: await detail(c, id)
    })),
    rounds: id => snapshot(async c => ({
      rounds: (await c.query(`SELECT m.id,m.title,m.trading_status,m.resolution_status,r.ordinal::text,r.opens_at,r.cutoff_at,r.expected_available_at,r.missed,r.expiration_complete FROM market_rounds r JOIN markets m ON m.id=r.market_id WHERE r.template_id IN (SELECT mt.id FROM market_templates mt WHERE mt.template_key=(SELECT t.template_key FROM market_rounds rr JOIN market_templates t ON t.id=rr.template_id WHERE rr.market_id=$1)) ORDER BY r.ordinal DESC LIMIT 100`, [id])).rows
    })),
    book: (marketId, tokenId, viewerUserId = null) => snapshot(async c => {
      const marketState=(await c.query('SELECT lifecycle_status,trading_status,resolution_status,terms_frozen_at,trading_starts_at,trading_ends_at FROM markets WHERE id=$1',[marketId])).rows[0] || null;
      const book = (await c.query('SELECT id::text,command_sequence::text,market_id,token_id::text FROM trading_books WHERE market_id=$1 AND token_id=$2', [marketId, tokenId])).rows[0];
      if (!book) return {
        book: null,
        levels: [],
        trades: []
      };
      const levels = (await c.query(`SELECT o.side,o.limit_price_cents::text AS price_cents,sum(o.remaining_quantity)::text AS quantity FROM trading_orders o JOIN matching_requests r ON r.order_id=o.id AND r.action='PLACE' WHERE o.book_id=$1 AND o.status IN ('OPEN','PARTIAL') AND r.state='DONE' AND r.resting='YES' GROUP BY o.side,o.limit_price_cents ORDER BY o.side,o.limit_price_cents LIMIT 198`, [book.id])).rows;
      const makers = viewerUserId == null ? levels.slice().sort((a,b)=>a.side.localeCompare(b.side)||(a.side==='BUY'?Number(b.price_cents)-Number(a.price_cents):Number(a.price_cents)-Number(b.price_cents))) : (await c.query(`SELECT o.side,o.limit_price_cents::text AS price_cents,o.remaining_quantity::text AS quantity,(o.user_id::text=$2) AS own FROM trading_orders o JOIN matching_requests r ON r.order_id=o.id AND r.action='PLACE' WHERE o.book_id=$1 AND o.status IN ('OPEN','PARTIAL') AND r.state='DONE' AND r.resting='YES' ORDER BY o.side,CASE WHEN o.side='BUY' THEN -o.limit_price_cents ELSE o.limit_price_cents END,r.sequence,o.id`,[book.id,String(viewerUserId)])).rows;
      const depth = executionDepth(makers);
      const trades = (await c.query('SELECT f.id::text,f.quantity::text,f.price_cents::text,f.created_at FROM trading_fills f WHERE f.book_id=$1 ORDER BY f.id DESC LIMIT 50', [book.id])).rows;
      return {
        marketId, tokenId: String(tokenId), viewerUserId: viewerUserId == null ? null : String(viewerUserId), marketState,
        book,
        levels,
        executionDepth: depth,
        trades
      };
    }),
    accounts: (userId, tokenId) => snapshot(async c => account(c, userId, tokenId)),
    portfolio: userId => snapshot(async c => ({
      cash: (await c.query(`SELECT p.posted::text,p.reserved::text,(p.posted-p.reserved)::text AS available FROM financial_accounts a JOIN financial_balance_projections p ON p.account_id=a.id WHERE a.owner_user_id=$1 AND a.kind='CUSTOMER' AND a.asset='USD'`, [userId])).rows[0] || null,
      positions: (await c.query(`SELECT a.token_id::text,q.market_id,m.title,m.round_key,(SELECT jsonb_agg(jsonb_build_object('outcome',o.outcome_label,'polarity',alias.polarity)) FROM market_outcome_tokens alias JOIN market_outcomes o ON o.id=alias.market_outcome_id WHERE alias.token_id=a.token_id) AS claims,p.posted::text,p.reserved::text,(p.posted-p.reserved)::text AS available FROM position_accounts a JOIN position_balance_projections p ON p.account_id=a.id JOIN ctf_position_tokens t ON t.id=a.token_id JOIN ctf_conditions cc ON cc.id=t.condition_id JOIN market_questions q ON q.id=cc.market_question_id JOIN markets m ON m.id=q.market_id WHERE a.owner_user_id=$1 AND a.kind='CUSTOMER' ORDER BY a.id LIMIT 200`, [userId])).rows
    })),
    orders: (userId, before, limit, openOnly = false) => snapshot(async c => ({
      orders: (await c.query(`SELECT o.id::text,b.market_id,m.title,m.round_key,(SELECT jsonb_agg(jsonb_build_object('outcome',mo.outcome_label,'polarity',a.polarity)) FROM market_outcome_tokens a JOIN market_outcomes mo ON mo.id=a.market_outcome_id WHERE a.token_id=b.token_id) AS claims,b.token_id::text,o.side,o.limit_price_cents::text,o.original_quantity::text,o.filled_quantity::text,o.remaining_quantity::text,o.status,o.created_at,r.state AS command_state,coalesce((cr.amount-cr.consumed-cr.released)::text,(pr.quantity-pr.consumed-pr.released)::text) AS reserved FROM trading_orders o JOIN trading_books b ON b.id=o.book_id JOIN markets m ON m.id=b.market_id JOIN matching_requests r ON r.order_id=o.id AND r.action='PLACE' LEFT JOIN cash_reservations cr ON cr.id=o.cash_reservation_id LEFT JOIN position_reservations pr ON pr.id=o.position_reservation_id WHERE o.user_id=$1 AND ($2::bigint IS NULL OR o.id<$2) AND (NOT $4::boolean OR o.status IN ('PENDING','OPEN','PARTIAL')) ORDER BY o.id DESC LIMIT $3`, [userId, before, limit, openOnly])).rows
    })),
    trades: (userId, before, limit) => snapshot(async c => ({
      trades: (await c.query(`SELECT f.id::text,b.market_id,m.title,m.round_key,(SELECT jsonb_agg(jsonb_build_object('outcome',mo.outcome_label,'polarity',a.polarity)) FROM market_outcome_tokens a JOIN market_outcomes mo ON mo.id=a.market_outcome_id WHERE a.token_id=b.token_id) AS claims,b.token_id::text,f.quantity::text,f.price_cents::text,f.created_at,CASE WHEN buyer.user_id=$1 THEN 'BUY' ELSE 'SELL' END AS side FROM trading_fills f JOIN trading_books b ON b.id=f.book_id JOIN markets m ON m.id=b.market_id JOIN trading_orders buyer ON buyer.id=f.buyer_order_id JOIN trading_orders seller ON seller.id=f.seller_order_id WHERE (buyer.user_id=$1 OR seller.user_id=$1) AND ($2::bigint IS NULL OR f.id<$2) ORDER BY f.id DESC LIMIT $3`, [userId, before, limit])).rows
    })),
    ownsOrder: (userId, id) => snapshot(async c => ({
      owned: (await c.query('SELECT 1 FROM trading_orders WHERE id=$1 AND user_id=$2', [id, userId])).rowCount === 1
    })),
    command: (actor, key) => snapshot(async c => ({
      command: (await c.query('SELECT id,sequence::text,action,state,result,order_id::text FROM matching_requests WHERE actor=$1 AND operation_key=$2', [actor, key])).rows[0] || null
    })),
    // Durable event IDs are invalidation watermarks. Reconnect always starts with a fresh snapshot.
    watermark: userId => snapshot(async c => ({
      publicSequence: (await c.query('SELECT (coalesce((SELECT sum(command_sequence) FROM trading_books),0)+coalesce((SELECT sum(n) FROM (SELECT max(sequence) AS n FROM market_lifecycle_events GROUP BY template_id) e),0))::text AS value')).rows[0].value,
      privateSequence: userId ? (await c.query(`SELECT count(*)::text AS value FROM trading_order_events e JOIN trading_orders o ON o.id=e.order_id WHERE 'user:'||o.user_id::text=$1`, [`user:${userId}`])).rows[0].value : null
    }))
  };
}
