// Local mock platform only: fresh verified Docker PostgreSQL, never configured/hosted databases.
import { localMarketDefinitions } from './localMarketDefinitions.js';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createLedger, createTradingService, createMatchingService, createMarketLifecycleService } from '../packages/ledger/src/index.js';
import { createPositionFixture } from '../packages/ledger/test/positionCases.js';
import { verifyMockTokenIdentity } from '../packages/ledger/src/tokenVerification.js';

import { createServer as createVite } from 'vite'
import { createApp } from '../server/src/app.js'
import { connectToDatabase,disconnectFromDatabase } from '../server/src/config/database.js'
import { hashPassword } from '../server/src/services/passwordService.js'
import { createTradingReads,READ_TABLES } from '../server/src/trading/readRepository.js'
import { createCustodialTradingService } from '../server/src/trading/service.js'
import { createLifecycleService,runMatchingWorker,runExpirationWorker,runMarketSchedulerWorker } from '../packages/ledger/src/index.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// Refuse production before clearing inherited variables or creating Docker fixtures.
if (['production', 'staging'].includes(process.env.NODE_ENV)) throw new Error('Local mock funding refuses production and staging.');
for(const name of Object.keys(process.env))if(/^(DATABASE|PG|GOOGLE|FACEBOOK|TELEGRAM|TG_|PAYWAY|BAKONG|WALLET_LINK|CDP|VITE_|BASE_|SEPOLIA)/.test(name))delete process.env[name]
Object.assign(process.env,{NODE_ENV:'test',CUSTODIAL_TRADING_LOCAL:'true',CUSTODIAL_TRADING_DISPOSABLE:'true',APP_ORIGINS:'http://127.0.0.1:5173',WALLET_LINK_ENABLED:'false',CDP_EMBEDDED_WALLET_ENABLED:'false',PAYWAY_CHECKOUT_ENABLED:'false'})
const docker=args=>{const r=spawnSync('docker',args,{encoding:'utf8',timeout:45000});if(r.status!==0)throw new Error('Disposable Docker operation failed: '+args[0]);return r.stdout.trim()}
const localPassword=randomBytes(24).toString('hex'),containerName='khmerfp-custodial-local-'+randomBytes(4).toString('hex')
const ownedContainer=docker(['run','-d','--rm','--name',containerName,'--label','khmerfp.disposable=ledger','--tmpfs','/var/lib/postgresql/data','-p','127.0.0.1::5432','-e','POSTGRES_DB=khmerfp_ledger_test','-e','POSTGRES_USER=postgres','-e','POSTGRES_PASSWORD='+localPassword,'postgres:16'])
let http,vite,readPool,authPool,workerController,workers=[]
try {
 const deadline=Date.now()+30000
 while(spawnSync('docker',['exec',ownedContainer,'pg_isready','-U','postgres','-d','khmerfp_ledger_test'],{stdio:'ignore',timeout:5000}).status!==0){if(Date.now()>deadline)throw new Error('Local database readiness timeout');await new Promise(r=>setTimeout(r,300))}
 const identity=JSON.parse(docker(['inspect',ownedContainer]))[0],binding=identity.NetworkSettings.Ports['5432/tcp'][0]
 if(identity.Id!==ownedContainer||identity.Config.Image!=='postgres:16'||binding.HostIp!=='127.0.0.1'||identity.Config.Labels['khmerfp.disposable']!=='ledger'||identity.Mounts.some(m=>m.Type==='bind'||m.Type==='volume'))throw new Error('Disposable database identity mismatch')
 process.env.LEDGER_DISPOSABLE_TARGET=JSON.stringify({host:'127.0.0.1',port:Number(binding.HostPort),database:'khmerfp_ledger_test',user:'postgres',password:localPassword})
 process.env.LEDGER_CONTAINER_ID=ownedContainer
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
    // The container's temporary initialization server can pass pg_isready before
    // the final TCP server is available. Retry only a read, before any mutation.
    parent.on('error', () => console.error('Disposable setup connection unavailable.'));
    for (let attempt = 0; ; attempt++) {
      try { await parent.query('SELECT 1'); break; }
      catch (error) {
        if (attempt >= 30) throw error;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    assert.equal((await parent.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
    await parent.query('CREATE DATABASE ' + database);
    admin = new pg.Pool({
      ...config,
      database,
      statement_timeout: 20000
    });
    try {
      await migrate(drizzle(admin), {
        migrationsFolder: fileURLToPath(new URL('../packages/db/migrations/', import.meta.url))
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
    const template = async (def, templateKey = 'fixture-' + key(), version = 1n, categoryId = refs.category_id) => {
      const terms = {
        templateKey,
        version,
        categoryId,
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
    const reconcile = async () => {
      assert.equal((await trading.reconcile(sys)).reconciled, true);
      assert.equal((await base.positions.reconcile(sys)).reconciled, true);
    };
    console.log('Disposable database migrated; preparing the original local market catalog.')
    const buyerFixture=await fixture(1000000n),sellerFixture=await fixture(1000000n)
    const users=[{id:buyerFixture.actor.slice(5),email:'buyer@local.khmerfp.test'},{id:sellerFixture.actor.slice(5),email:'seller@local.khmerfp.test'}]
    const loginPassword='LocalTradingDemo!2026'
    for(const user of users)await admin.query('UPDATE users SET email=$1,password_hash=$2,display_name=$3 WHERE id=$4',[user.email,await hashPassword(loginPassword),user.email.startsWith('buyer')?'Mock Buyer':'Mock Seller',user.id])
    // Hide the low-level registry fixture from the current catalog, preserving its history.
    await admin.query("UPDATE markets SET trading_status='CLOSED' WHERE id=$1",[base.market.marketId]);
    for(const spec of localMarketDefinitions()){
      const category=await one("INSERT INTO market_categories(name,slug) VALUES($1,$2) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id",[spec.category==='crypto'?'Crypto':'Economy',spec.category]);
      const made=await template(spec.definition,spec.key,spec.version,category.id);
      await service.createNext(sys,made.templateId);
    }
    const prepared=new Map(),seeded=new Set();
    async function prepareMockRounds(){
      const rounds=(await admin.query("SELECT r.market_id,m.trading_status,m.trading_ends_at FROM market_rounds r JOIN markets m ON m.id=r.market_id WHERE m.trading_status IN ('NOT_STARTED','OPEN') ORDER BY r.opens_at")).rows;
      for(const round of rounds){
        if(!prepared.has(round.market_id)){
          const tokens=await enroll(round.market_id),accounts=new Map();
          for(const token of tokens){
            const store=await base.accounts(token.id),holders=[];
            for(const user of users){
              const account=(await base.positions.createAccount(sys,key(),{tokenId:token.id,ownerUserId:user.id,accountKey:key(),kind:'CUSTOMER'})).accountId;
              await store.recognize(100000000n);
              await base.positions.transfer(sys,key(),{sourceAccountId:store.unallocated,targetAccountId:account,quantity:100000000n,reference:key()});
              holders.push(account);
            }
            accounts.set(String(token.id),holders);
          }
          prepared.set(round.market_id,{tokens,accounts});
          console.log(JSON.stringify({localFixture:'round-ready',marketId:round.market_id,tokens:tokens.length}));
        }
        if(round.trading_status!=='OPEN'||seeded.has(round.market_id))continue;
        const {tokens,accounts}=prepared.get(round.market_id);
        for(const token of tokens){
          const holders=accounts.get(String(token.id));
          // Test traders submit genuine limit orders. Only matching creates prices,
          // fills, cash movements and positions; no projection or fill is edited.
          const place=async(index,side,price,quantity)=>{
            await trading.place('user:'+users[index].id,key(),{marketId:round.market_id,tokenId:token.id,side,priceCents:price,quantity,cashAccountId:index? sellerFixture.a:buyerFixture.a,positionAccountId:holders[index]});
            await engine.step(sys,round.market_id);
          };
          const price=BigInt(process.env.LOCAL_LIQUIDITY_PRICE_CENTS||'50');
          if(price<3n||price>97n)throw new Error('Local mock order limit must be 3..97 cents');
          await place(1,'SELL',price,5000000n);await place(0,'BUY',price,5000000n);
          await place(1,'SELL',price+1n,3000000n);await place(0,'BUY',price+1n,3000000n);
          await place(1,'SELL',price+3n,10000000n);await place(0,'BUY',price-2n,10000000n);
        }
        seeded.add(round.market_id);await reconcile();
        console.log(JSON.stringify({localFixture:'liquidity-matched',marketId:round.market_id,reconciled:true}));
      }
    }
    await prepareMockRounds();
    await reconcile()
    await admin.query(`CREATE ROLE local_auth LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`)
    await admin.query('GRANT SELECT,INSERT,UPDATE ON users,sessions,auth_audit_logs,auth_rate_limits,wallets TO local_auth')
    await admin.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO local_auth')
    await admin.query(`CREATE ROLE local_read LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`)
    await admin.query('GRANT SELECT ON '+READ_TABLES.join(',')+' TO local_read')
    readPool=new pg.Pool({...config,database,user:'local_read',password,max:8})
    const authUrl=new URL('postgresql://127.0.0.1');authUrl.username='local_auth';authUrl.password=password;authUrl.port=String(config.port);authUrl.pathname='/'+database
    authPool=await connectToDatabase(authUrl.href)
    const reads=createTradingReads(readPool),httpService=createCustodialTradingService({pool:runtime,reads,environment:'test'})
    const app=createApp({custodialTradingOptions:{service:httpService},databaseIsReady:()=>true})
    http=await new Promise((resolve,reject)=>{const server=app.listen(3000,'127.0.0.1',()=>resolve(server));server.on('error',reject)})
    workerController=new AbortController()
    const lifecycle=createLifecycleService({...options,authorize:r=>r.actor===sys}),workerOptions={actor:sys,signal:workerController.signal,onError:e=>console.error('Local worker:',e.code)}
    workers=[(async()=>{while(!workerController.signal.aborted){try{await prepareMockRounds()}catch(error){console.error('Local fixture preparation failed:',error.code||error.name)}await new Promise(resolve=>setTimeout(resolve,1000))}})(),runMatchingWorker({...workerOptions,service:engine}),runExpirationWorker({...workerOptions,lifecycle,matching:engine}),runMarketSchedulerWorker({...workerOptions,service,matching:engine})]
    vite=await createVite({root:fileURLToPath(new URL('../client/',import.meta.url)),configFile:fileURLToPath(new URL('../client/vite.config.js',import.meta.url)),envDir:mkdtempSync(join(tmpdir(),'khmerfp-demo-env-')),server:{host:'127.0.0.1',port:5173,strictPort:true},define:{'import.meta.env.VITE_API_URL':JSON.stringify('http://127.0.0.1:3000'),'import.meta.env.VITE_CUSTODIAL_TRADING_LOCAL':JSON.stringify('true'),'import.meta.env.VITE_SIMULATED_TRADING':JSON.stringify('false'),'import.meta.env.VITE_CDP_EMBEDDED_WALLET_ENABLED':JSON.stringify('false'),'import.meta.env.VITE_WALLET_LINK_ENABLED':JSON.stringify('false')}})
    await vite.listen()
    const health=await fetch('http://127.0.0.1:3000/api/health');if(!health.ok)throw new Error('Backend health check failed')
    const listing=await fetch('http://127.0.0.1:3000/api/trading/markets');if(!listing.ok)throw new Error('Trading read-role readiness failed')
    const authCheck=await fetch('http://127.0.0.1:3000/api/auth/login',{method:'POST',headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json'},body:JSON.stringify({email:users[0].email,password:loginPassword})});if(!authCheck.ok)throw new Error('Local authenticated login readiness failed')
    console.log(JSON.stringify({status:'READY',frontend:'http://127.0.0.1:5173',backend:'http://127.0.0.1:3000',mode:'LOCAL MOCK FUNDS ONLY',buyer:users[0].email,seller:users[1].email,testOnlyPassword:loginPassword,mockUsdPerUser:'10000.00',initialMockSharesPerToken:'100 per test user, before matched trades',tradingWindow:'real 300-second Bitcoin rounds; calendar commodity markets; no automatic payouts',workers:['matching','expiration','scheduler'],pid:process.pid,container:containerName},null,2))
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve)})
  } finally {
    workerController?.abort();await Promise.allSettled(workers)
    await vite?.close();if(http){http.closeAllConnections();await new Promise(resolve=>http.close(resolve))}
    if(authPool)await disconnectFromDatabase();await readPool?.end();await runtime?.end();await admin?.end();await parent.end()
  }
} finally {
 const identity=JSON.parse(docker(['inspect',ownedContainer]))[0]
 if(identity.Id!==ownedContainer||identity.Config.Labels['khmerfp.disposable']!=='ledger')throw new Error('Refusing mismatched cleanup target')
 docker(['stop',ownedContainer])
}
