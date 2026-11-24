import {createCapabilityClient} from '../../../packages/ledger/src/capabilities.js';
import {deriveRoundRegistry} from '../../../packages/ledger/src/marketScheduler.js';

// The actor argument is retained for the existing worker interface. SQL derives
// the fixed system actor and the caller role determines which operations exist.
export function createMatchingCapabilities(pool, environment) {
  const call=createCapabilityClient(pool,{environment});
  const run=(action,terms={},readOnly=false)=>call('matching',[action,JSON.stringify(terms)],{readOnly});
  return {
    pending:()=>run('PENDING',{},true),
    step:(_,marketId)=>run('STEP',{marketId}),
    expiring:()=>run('EXPIRING',{},true),
    expire:(_,marketId,limit=25n)=>run('EXPIRE',{marketId,limit:String(limit)}),
    diagnostics:()=>run('DIAGNOSTICS',{},true),
  };
}
export function createSchedulerCapabilities(pool,environment) {
  const call=createCapabilityClient(pool,{environment});
  const run=(action,terms={},readOnly=false)=>call('scheduler',[action,JSON.stringify(terms)],{readOnly});
  return {
    discover:()=>run('DISCOVER',{},true),
    async createNext(_,templateId) {
      const plan=await run('PLAN',{templateId},true);
      return plan.state==='READY'?run('CREATE_ROUND',deriveRoundRegistry(plan)):plan;
    },
    step:(_,marketId)=>run('LIFECYCLE_STEP',{marketId}),
    failure:(_,templateId,code)=>run('FAILURE',{templateId,code}),
    recovered:(_,templateId)=>run('RECOVERED',{templateId}),
  };
}
