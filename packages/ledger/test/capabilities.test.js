import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCapabilityClient,requireTradingSession} from '../src/capabilities.js';
import {tradingProcessEnvironment,validateWorkerDatabase} from '../../../server/src/trading/processEnvironment.js';
test('capabilities reject production, actor strings and missing session evidence',()=>{
 assert.throws(()=>createCapabilityClient(null,{environment:'production'}));
 for(const actor of ['user:1',{userId:'1'},{userId:'1',sessionHash:'bad'},null])assert.throws(()=>requireTradingSession(actor));
 assert.deepEqual(requireTradingSession({userId:'1',sessionHash:'a'.repeat(64)}),{userId:'1',sessionHash:'a'.repeat(64)});
});
function fixture({commitError,rollbackError,unsafe=false}={}){
 const calls=[];let released;
 const client={async query(sql,args){calls.push({sql,args});if(sql==='COMMIT'&&commitError)throw commitError;if(sql==='ROLLBACK'&&rollbackError)throw rollbackError;if(sql.includes('AS unsafe'))return {rows:[{unsafe}]};return {rows:[{result:{accepted:true}}]}},release(error){released=error||true}};
 return {calls,get released(){return released},run:createCapabilityClient({connect:async()=>client},{environment:'test'})};
}
test('capability calls keep commit, deferred validation and rollback on one connection',async()=>{
 const f=fixture();assert.deepEqual(await f.run('order',['hash','CANCEL','key','{}']),{accepted:true});
 assert.equal(f.calls[0].sql,'BEGIN');assert.equal(f.calls.at(-1).sql,'COMMIT');assert.equal(f.released,true);
});
test('quotes are read only and unknown capabilities never reach SQL',async()=>{
 const f=fixture();await assert.rejects(f.run('funding',[]));assert.equal(f.calls.length,0);
 await f.run('quote',['hash','{}'],{readOnly:true});assert.match(f.calls[0].sql,/READ ONLY/);
});
test('unsafe roles fail before execution and failed rollback destroys connection',async()=>{
 const bad=fixture({unsafe:true});await assert.rejects(bad.run('matching',['STEP','{}']),/Restricted/);assert.equal(bad.calls.some(c=>c.sql.startsWith('SELECT custodial_api.')),false);
 const rollback=Object.assign(new Error('rollback failed'),{code:'08006'}),f=fixture({commitError:Object.assign(new Error('connection lost'),{code:'08006'}),rollbackError:rollback});
 await assert.rejects(f.run('order',[]),error=>error.commitOutcome==='UNKNOWN');assert.equal(f.released,rollback);
});
test('credential allowlists isolate HTTP matching and scheduler environments',()=>{
 const env={NODE_ENV:'test',CUSTODIAL_TRADING_LOCAL:'true',CUSTODIAL_TRADING_DISPOSABLE:'true',DATABASE_URL:'auth',TRADING_RUNTIME_DATABASE_URL:'http',TRADING_READ_DATABASE_URL:'read',TRADING_PRIVATE_READ_DATABASE_URL:'private-read',TRADING_MATCHING_DATABASE_URL:'postgresql://matching@127.0.0.1/disposable_test',TRADING_SCHEDULER_DATABASE_URL:'postgresql://scheduler@127.0.0.1/disposable_test',FUNDING_DATABASE_URL:'funding',LEDGER_DISPOSABLE_TARGET:'migration',CDP_API_KEY_SECRET:'secret'};
 for(const mode of ['http','matching','scheduler']){const child=tradingProcessEnvironment(mode,env);assert.equal(child.FUNDING_DATABASE_URL,undefined);assert.equal(child.CDP_API_KEY_SECRET,undefined);assert.equal(child.LEDGER_DISPOSABLE_TARGET,undefined);if(mode!=='http'){assert.equal(child.DATABASE_URL,undefined);assert.ok(validateWorkerDatabase(mode,child));}else{assert.equal(child.TRADING_MATCHING_DATABASE_URL,undefined);assert.equal(child.TRADING_SCHEDULER_DATABASE_URL,undefined);}}
 assert.throws(()=>validateWorkerDatabase('matching',env),/Unrelated/);
});
