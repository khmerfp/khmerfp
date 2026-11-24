import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTradingReads} from '../src/trading/readRepository.js';
function pool(results={}){const calls=[];const client={async query(sql,args){calls.push({sql,args});if(sql.includes('AS unsafe'))return {rows:[{unsafe:false}]};if(sql.includes('pg_snapshot_xmax'))return {rows:[{serverTime:new Date(0),revision:'1',snapshotId:'1:2:'}]};if(sql.startsWith('SELECT custodial_api.'))return {rows:[{rows:results[sql.includes('private_read')?args[1]:args[0]]||[]}]};return {rows:[]}},release(){calls.push({sql:'release'})}};return {calls,pool:{connect:async()=>client}}}
test('public round history does not require or invent a private session',async()=>{
 const f=pool();const result=await createTradingReads(f.pool).rounds('11111111-1111-1111-1111-111111111111');
 assert.deepEqual(result.rounds,[]);assert.ok(f.calls.some(c=>c.sql==='SELECT custodial_api.public_read($1,$2::jsonb) AS rows'&&c.args[0]==='READ_10'));assert.equal(f.calls.at(-1).sql,'release');
});
test('private read uses only the private pool and passes session evidence to SQL',async()=>{
 const publicDb=pool(),privateDb=pool();await createTradingReads(publicDb.pool,{privatePool:privateDb.pool}).orders({userId:'7',sessionHash:'a'.repeat(64)},null,25);
 assert.equal(publicDb.calls.length,0);assert.ok(privateDb.calls.some(c=>c.sql.startsWith('SELECT custodial_api.private_read')&&c.args[0]==='a'.repeat(64)&&c.args[1]==='READ_18'));
});

test('authenticated book keeps the verified viewer ID scalar and never returns session evidence',async()=>{
 const f=pool({READ_11:[{trading_status:'OPEN'}],READ_12:[{id:'1'}]});
 const result=await createTradingReads(f.pool).book('11111111-1111-1111-1111-111111111111','2',{userId:'7',sessionHash:'a'.repeat(64)});
 assert.equal(result.viewerUserId,'7');assert.equal(JSON.stringify(result).includes('a'.repeat(64)),false);
});
