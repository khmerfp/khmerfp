import pg from 'pg';
import {createApp} from '../app.js';
import {connectToDatabase,disconnectFromDatabase} from '../config/database.js';
import {createLocalTradingRuntime,validateLocalTradingConfiguration} from './runtime.js';
import {createMatchingCapabilities,createSchedulerCapabilities} from './capabilityWorkers.js';
import {validateWorkerDatabase} from './processEnvironment.js';
import {runMatchingWorker} from '../../../packages/ledger/src/matchingWorker.js';
import {runExpirationWorker} from '../../../packages/ledger/src/lifecycleWorker.js';
import {runMarketSchedulerWorker} from '../../../packages/ledger/src/marketScheduler.js';
const mode=process.argv[2];
let close=async()=>{},port;
try {
 if(mode==='http') {
  if(process.env.TRADING_MATCHING_DATABASE_URL||process.env.TRADING_SCHEDULER_DATABASE_URL||process.env.LEDGER_DISPOSABLE_TARGET)throw new Error('Worker credentials in HTTP environment.');
  validateLocalTradingConfiguration();
  await connectToDatabase(process.env.DATABASE_URL);
  const runtime=createLocalTradingRuntime();
  if(!runtime)throw new Error('Local trading disabled.');
  const server=await new Promise((resolve,reject)=>{const value=createApp({custodialTradingOptions:runtime.options}).listen(Number(process.env.PORT||3000),'127.0.0.1',()=>resolve(value));value.on('error',reject)});
  port=server.address().port;
  close=async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await runtime.close();await disconnectFromDatabase()};
 } else {
  const pool=new pg.Pool({connectionString:validateWorkerDatabase(mode,process.env),max:4,connectionTimeoutMillis:5000});
  pool.on('error',()=>console.error('Trading worker database unavailable.'));
  const controller=new AbortController(),options={actor:'system:http-trading',signal:controller.signal,onError:e=>console.error('Trading worker:',e.code)};
  // Fail startup if the credential does not have its specific capability.
  const service=mode==='matching'?createMatchingCapabilities(pool,process.env.NODE_ENV):createSchedulerCapabilities(pool,process.env.NODE_ENV);
  await (mode==='matching'?service.pending():service.discover());
  const workers=mode==='matching'?[runMatchingWorker({...options,service}),runExpirationWorker({...options,lifecycle:service,matching:service})]:[runMarketSchedulerWorker({...options,service})];
  close=async()=>{controller.abort();await Promise.allSettled(workers);await pool.end()};
 }
 process.send?.({type:'ready',mode,port});
 await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);process.on('message',m=>{if(m?.type==='stop')resolve()});process.once('disconnect',resolve)});
 await close();
 if(process.connected)process.disconnect();
 process.removeAllListeners('message');
} catch {
 console.error('Trading process failed; inspect configuration and capability grants.');
 await close().catch(()=>{});process.exitCode=1;
}
