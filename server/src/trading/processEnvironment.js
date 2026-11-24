const COMMON=['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','ComSpec','HOME','USERPROFILE'];
export function tradingProcessEnvironment(mode,env) {
  const selected={http:['DATABASE_URL','TRADING_RUNTIME_DATABASE_URL','TRADING_READ_DATABASE_URL','APP_ORIGINS','PORT'],matching:['TRADING_MATCHING_DATABASE_URL'],scheduler:['TRADING_SCHEDULER_DATABASE_URL']}[mode];
  if(!selected)throw new Error('Unknown trading process.');
  const result={};
  for(const key of [...COMMON,...selected])if(env[key]!==undefined)result[key]=env[key];
  return {...result,NODE_ENV:env.NODE_ENV,CUSTODIAL_TRADING_LOCAL:env.CUSTODIAL_TRADING_LOCAL,CUSTODIAL_TRADING_DISPOSABLE:env.CUSTODIAL_TRADING_DISPOSABLE,WALLET_LINK_ENABLED:'false',CDP_EMBEDDED_WALLET_ENABLED:'false',PAYWAY_CHECKOUT_ENABLED:'false'};
}
export function validateWorkerDatabase(mode,env) {
  if(!['matching','scheduler'].includes(mode)||!['test','development'].includes(env.NODE_ENV)||env.CUSTODIAL_TRADING_LOCAL!=='true'||env.CUSTODIAL_TRADING_DISPOSABLE!=='true')throw new Error('Local worker configuration required.');
  const key=mode==='matching'?'TRADING_MATCHING_DATABASE_URL':'TRADING_SCHEDULER_DATABASE_URL';
  const url=new URL(env[key]||'');
  if(url.protocol!=='postgresql:'||url.search||url.hash||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/test|disposable/.test(url.pathname))throw new Error('Disposable loopback worker database required.');
  for(const other of ['DATABASE_URL','TRADING_RUNTIME_DATABASE_URL','TRADING_READ_DATABASE_URL','TRADING_MATCHING_DATABASE_URL','TRADING_SCHEDULER_DATABASE_URL','LEDGER_DISPOSABLE_TARGET'])if(other!==key&&env[other])throw new Error('Unrelated database credentials in worker environment.');
  return url.href;
}
