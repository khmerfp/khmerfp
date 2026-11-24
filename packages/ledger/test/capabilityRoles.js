import pg from 'pg';
import {randomBytes} from 'node:crypto';
export async function provisionCapabilityRoles(admin,config,prefix='cap') {
 if(process.env.NODE_ENV!=='test'||config.host!=='127.0.0.1'||!/test/.test(config.database))throw new Error('Disposable capability fixture required.');
 const pools={},urls={},names={};
 for(const [kind,capability] of Object.entries({http:'kf_trading_http',matching:'kf_matching_worker',scheduler:'kf_market_scheduler',read:'kf_public_read',admin:'kf_market_admin',reconcile:'kf_reconciliation',funding:'kf_funding'})) {
  const name=prefix+'_'+kind+'_'+randomBytes(4).toString('hex'),password=randomBytes(24).toString('hex');
  await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
  await admin.query(`GRANT ${capability} TO ${name} WITH INHERIT TRUE, SET FALSE`);
  pools[kind]=new pg.Pool({...config,user:name,password,max:8});names[kind]=name;
  const url=new URL('postgresql://127.0.0.1');url.username=name;url.password=password;url.port=String(config.port);url.pathname='/'+config.database;urls[kind]=url.href;
 }
 return {pools,urls,names,async close(){await Promise.all(Object.values(pools).map(pool=>pool.end()))}};
}
