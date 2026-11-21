import { runTradingApiCases } from './apiCases.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createLedger, createTradingService, createMatchingService, createMarketLifecycleService } from '../src/index.js';
import { createPositionFixture } from './positionCases.js';
import { runMarketSchedulerWorker } from '../src/marketScheduler.js';
import { verifyMockTokenIdentity } from '../src/tokenVerification.js';
const configured = Boolean(process.env.LEDGER_DISPOSABLE_TARGET);
if (process.env.LEDGER_REQUIRE_POSTGRES === 'true' && !configured) throw new Error('Required disposable scheduler target missing');
test('required authenticated custodial trading API and browser integration', {
  skip: !configured
}, async t => {
  const config = JSON.parse(process.env.LEDGER_DISPOSABLE_TARGET);
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.database, 'khmerfp_ledger_test');
  const inspection = spawnSync('docker', ['inspect', process.env.LEDGER_CONTAINER_ID], {
    encoding: 'utf8',
    timeout: 10000
  });
  assert.equal(inspection.status, 0);
  const meta = JSON.parse(inspection.stdout)[0];
  assert.equal(meta.Config.Labels['khmerfp.disposable'], 'ledger');
  assert.equal(meta.Config.Image, 'postgres:16');
  assert.equal(meta.NetworkSettings.Ports['5432/tcp'][0].HostPort, String(config.port));
  const parent = new pg.Pool(config),
    database = 'khmerfp_api_test',
    password = randomBytes(24).toString('hex');
  let admin, runtime;
  try {
    assert.equal((await parent.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
    await parent.query('CREATE DATABASE ' + database);
    admin = new pg.Pool({
      ...config,
      database,
      statement_timeout: 20000
    });
    try {
      await migrate(drizzle(admin), {
        migrationsFolder: fileURLToPath(new URL('../../db/migrations/', import.meta.url))
      });
    } catch (error) {
      throw new Error('Scheduler migration: ' + (error.cause?.message || error.message));
    }
    await admin.query('CREATE ROLE api_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT');
    await admin.query("CREATE ROLE api_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '" + password + "'");
    await admin.query('GRANT USAGE ON SCHEMA public TO api_owner,api_runtime');
    const owned = (await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'financial_%' OR tablename LIKE 'cash_%' OR tablename IN ('position_accounts','position_journals','position_journal_entries','position_balance_projections','position_reservations','position_reservation_events') OR tablename LIKE 'trading_%' OR tablename LIKE 'matching_%' OR tablename IN ('market_templates','market_template_controls','market_rounds','market_round_requirements','market_round_observations','market_lifecycle_events','market_lifecycle_cursors'))")).rows;
    for (const row of owned) await admin.query('ALTER TABLE public.' + row.tablename + ' OWNER TO api_owner');
    for (const row of (await admin.query("SELECT oid::regprocedure::text AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'financial_%' OR proname LIKE 'trading_%' OR proname LIKE 'matching_%' OR proname LIKE 'market_schedule_%' OR proname IN ('position_execute','position_guard','position_validate'))")).rows) await admin.query('ALTER FUNCTION ' + row.signature + ' OWNER TO api_owner');
    await admin.query('GRANT SELECT,INSERT,UPDATE ON public.markets,public.market_questions,public.market_outcomes,public.market_observation_specs,public.ctf_conditions,public.ctf_position_tokens TO api_owner');
    await admin.query('GRANT SELECT ON public.chains,public.contract_deployments,public.chain_assets,public.market_categories,public.market_outcome_tokens,public.position_token_verifications TO api_owner');
    await admin.query('GRANT USAGE,SELECT ON SEQUENCE public.market_outcomes_id_seq,public.ctf_conditions_id_seq,public.ctf_position_tokens_id_seq TO api_owner');
    await admin.query('GRANT EXECUTE ON FUNCTION public.validate_market_definition(uuid,boolean) TO api_owner');
    await admin.query('GRANT INSERT ON public.market_outcome_tokens TO api_owner');
    await admin.query('GRANT EXECUTE ON FUNCTION public.financial_execute(text,text,text,jsonb),public.financial_reconcile(text),public.trading_execute(text,text,text,jsonb),public.matching_quote(text,jsonb),public.matching_status(text,text),public.matching_step(text,uuid),public.matching_pending(text),public.matching_expire(text,uuid,integer),public.matching_expiring(text),public.market_schedule_plan(text,uuid),public.market_schedule_create_round(text,jsonb),public.market_schedule_step(text,uuid),public.market_schedule_execute(text,text,jsonb),public.market_schedule_read(text,text,jsonb),public.market_schedule_event_streams(text),public.market_schedule_event_batch(text,uuid,integer,bigint),public.market_schedule_event_ack(text,uuid,bigint,jsonb) TO api_runtime');
    runtime = new pg.Pool({
      ...config,
      database,
      user: 'api_runtime',
      password,
      max: 8
    });
    const options = {
        pool: runtime,
        enabled: true,
        environment: 'test',
        authorize: () => true
      },
      ledger = createLedger(options),
      service = createMarketLifecycleService(options),
      trading = createTradingService(options),
      engine = createMatchingService(options);
    const sys = 'system:scheduler-tests',
      key = randomUUID,
      one = async (sql, args) => (await admin.query(sql, args)).rows[0];
    const ownerTx = async work => {
      const c = await admin.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE api_owner');
        await work(c);
        await c.query('COMMIT');
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      } finally {
        c.release();
      }
    };
    const fixture = async (amount = 1000000n) => {
      const users = (await admin.query("INSERT INTO users(email,display_name) VALUES($1,'Mock buyer'),($2,'Mock seller') RETURNING id", [key() + '@example.test', key() + '@example.test'])).rows;
      const account = async (ownerUserId, kind, normalSide) => (await ledger.createAccount(sys, key(), {
        ownerUserId,
        asset: 'USD',
        kind,
        normalSide,
        accountKey: key()
      })).accountId;
      const a = await account(users[0].id, 'CUSTOMER', 'CREDIT'),
        b = await account(users[1].id, 'CUSTOMER', 'CREDIT'),
        cash = await account(null, 'ASSET', 'DEBIT');
      await ledger.post(sys, key(), [{
        accountId: cash,
        asset: 'USD',
        side: 'DEBIT',
        amount
      }, {
        accountId: a,
        asset: 'USD',
        side: 'CREDIT',
        amount
      }], key());
      return {
        a,
        b,
        cash,
        actor: 'user:' + users[0].id,
        other: 'user:' + users[1].id
      };
    };
    const base = await createPositionFixture({
      admin,
      runtime,
      ledger,
      sys,
      key,
      fixture,
      ownerTx,
      chainSeed: 2700000
    });
    const refs = await one('SELECT m.category_id,c.ctf_contract_deployment_id,c.oracle_contract_deployment_id,c.collateral_asset_id FROM markets m JOIN market_questions q ON q.market_id=m.id JOIN ctf_conditions c ON c.market_question_id=q.id WHERE m.id=$1', [base.market.marketId]);
    const anchor = seconds => new Date(Date.now() + seconds * 1000).toISOString().slice(0, 19);
    const definition = (type = 'BINARY', overrides = {}) => ({
      scope: 'MOCK_ONLY',
      title: type === 'BINARY' ? 'Mock Bitcoin five-minute fixture' : 'Mock ' + type,
      description: 'Disposable local fixture; no live price or payout',
      marketType: type,
      schedule: {
        mode: 'FIXED',
        timezone: 'UTC',
        anchorLocal: anchor(20),
        dstPolicy: 'REJECT',
        stepSeconds: '300',
        months: '1',
        durationMode: 'SECONDS',
        tradingSeconds: '300',
        observationStartOffset: '0',
        observationEndOffset: '0',
        resultDelaySeconds: '15',
        resolutionDelaySeconds: '3600',
        lookaheadSeconds: '600',
        openingGraceSeconds: '10'
      },
      outcomes: type === 'BINARY' ? [{
        label: 'YES'
      }, {
        label: 'NO'
      }] : type === 'CATEGORICAL' ? ['Team A', 'Team B', 'Team C', 'Team D', 'Team E', 'OTHER'].map(label => ({
        label
      })) : ['0', '4000', '4100', '4200', '4300', '4400'].map((lower, i, a) => ({
        label: 'Range ' + i,
        lower,
        upper: a[i + 1] ?? null
      })),
      observation: {
        sourceId: 'MOCK_FIXTURE_ONLY',
        unit: 'MOCK_USD',
        decimals: '6',
        referenceAsset: 'BTC',
        revisionPolicy: 'REQUIRE_FINAL',
        domainLower: '0',
        domainUpper: null
      },
      rules: 'Mock fixture only. For the binary fixture ties would be NO; no winner is selected here.',
      ruleVersion: 'fixture-v1',
      requireOther: type === 'CATEGORICAL',
      ...overrides
    });
    const template = async (def = definition(), templateKey = 'fixture-' + key(), version = 1n) => {
      const terms = {
        templateKey,
        version,
        categoryId: refs.category_id,
        ctfDeploymentId: refs.ctf_contract_deployment_id,
        oracleDeploymentId: refs.oracle_contract_deployment_id,
        collateralAssetId: refs.collateral_asset_id,
        definition: def
      };
      const result = await service.createTemplate(sys, terms);
      await service.enable(sys, result.templateId, true);
      return {
        ...result,
        terms
      };
    };
    const roundData = async marketId => {
      const c = await one('SELECT c.*,a.contract_address AS collateral_address FROM ctf_conditions c JOIN market_questions q ON q.id=c.market_question_id JOIN chain_assets a ON a.id=c.collateral_asset_id WHERE q.market_id=$1', [marketId]);
      const tokens = (await admin.query('SELECT * FROM ctf_position_tokens WHERE condition_id=$1 ORDER BY id', [c.id])).rows;
      return {
        c,
        tokens
      };
    };
    const enroll = async marketId => {
      const {
        c,
        tokens
      } = await roundData(marketId);
      for (const token of tokens) {
        const proof = verifyMockTokenIdentity({
          condition: c,
          token,
          collateralAddress: c.collateral_address
        });
        await admin.query('INSERT INTO position_token_verifications(token_id,condition_id,collection_id,position_id,evidence_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(token_id) DO NOTHING', [proof.tokenId, proof.conditionId, proof.collectionId, proof.positionId, proof.evidenceHash]);
      }
      return tokens;
    };
    const waitAt = async (marketId, col) => {
      const row = await one('SELECT ' + col + ' AS time FROM market_rounds WHERE market_id=$1', [marketId]);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, row.time.getTime() - Date.now() + 20)));
    };
    const reconcile = async () => {
      assert.equal((await trading.reconcile(sys)).reconciled, true);
      assert.equal((await base.positions.reconcile(sys)).reconciled, true);
    };
    const registered = [];
    for (const type of ['BINARY', 'CATEGORICAL', 'PRICE_RANGE']) {
      const def = definition(type);
      def.schedule = {
        ...def.schedule,
        anchorLocal: anchor(3),
        tradingSeconds: '600'
      };
      const parentTemplate = await template(def),
        round = await service.createNext(sys, parentTemplate.templateId),
        tokens = await enroll(round.marketId);
      await waitAt(round.marketId, 'opens_at');
      await service.step(sys, round.marketId);
      registered.push({
        type,
        marketId: round.marketId,
        tokens
      });
    }
    const inventory = new Map();
    async function person(tok) {
      const f = await fixture(1000000n);
      const position = (await base.positions.createAccount(sys, key(), {
        tokenId: tok.id,
        ownerUserId: f.actor.slice(5),
        accountKey: key(),
        kind: 'CUSTOMER'
      })).accountId;
      if (!inventory.has(tok.id)) inventory.set(tok.id, await base.accounts(tok.id));
      const store = inventory.get(tok.id);
      await store.recognize(100n * 1000000n);
      await base.positions.transfer(sys, key(), {
        sourceAccountId: store.unallocated,
        targetAccountId: position,
        quantity: 100n * 1000000n,
        reference: key()
      });
      return {
        actor: f.actor,
        cash: f.a,
        position
      };
    }
    const makeClosingMarket = async () => {
      const def = definition();
      def.schedule = {
        ...def.schedule,
        anchorLocal: anchor(3),
        tradingSeconds: '6'
      };
      const parent = await template(def),
        round = await service.createNext(sys, parent.templateId),
        tokens = await enroll(round.marketId);
      await waitAt(round.marketId, 'opens_at');
      await service.step(sys, round.marketId);
      return {
        marketId: round.marketId,
        tokens
      };
    };
    // Only this verified disposable fixture provisions mock inventory for browser acceptance.
    const makeBrowserRounds = async () => {
      const def=definition();def.schedule={...def.schedule,anchorLocal:anchor(4),stepSeconds:'24',tradingSeconds:'24'};
      const parentTemplate=await template(def),first=await service.createNext(sys,parentTemplate.templateId),second=await service.createNext(sys,parentTemplate.templateId);
      const firstTokens=await enroll(first.marketId),secondTokens=await enroll(second.marketId);
      const buyer=await person(firstTokens[0]),seller=await person(firstTokens[0]);
      for(const token of secondTokens){
        if(!inventory.has(token.id))inventory.set(token.id,await base.accounts(token.id));
        const store=inventory.get(token.id);
        for(const who of [buyer,seller]){
          const id=(await base.positions.createAccount(sys,key(),{tokenId:token.id,ownerUserId:who.actor.slice(5),accountKey:key(),kind:'CUSTOMER'})).accountId;
          await store.recognize(10000000n);await base.positions.transfer(sys,key(),{sourceAccountId:store.unallocated,targetAccountId:id,quantity:10000000n,reference:key()});
        }
      }
      const control=new AbortController(),ids=[first.marketId,second.marketId],errors=[];
      const scheduler=runMarketSchedulerWorker({actor:sys,signal:control.signal,pollMs:25,matching:engine,service:{...service,discover:async actor=>{const work=await service.discover(actor);return {templates:[],markets:work.markets.filter(id=>ids.includes(id))}}},onError:error=>errors.push(error.code)});
      await waitAt(first.marketId,'opens_at');await service.step(sys,first.marketId);
      return {first:{...first,tokens:firstTokens},second:{...second,tokens:secondTokens},buyer,seller,async close(){control.abort();await scheduler;assert.deepEqual(errors,[])}};
    };
    await runTradingApiCases(t, {
      makeClosingMarket,
      makeBrowserRounds,
      admin,
      runtime,
      config: {
        ...config,
        database
      },
      registered,
      person,
      engine,
      trading,
      sys,
      key,
      reconcile
    });
  } finally {
    await runtime?.end();
    await admin?.end();
    await parent.end();
  }
});
