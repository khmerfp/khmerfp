import test from 'node:test';
import assert from 'node:assert/strict';
import { integer, createCustodialTradingService } from '../src/trading/service.js';
import { validateLocalTradingConfiguration } from '../src/trading/runtime.js';
test('custodial HTTP units reject Number floats zero and bigint overflow', () => {
  for (const value of [1, 1.5, '1.5', '0', '-1', '9223372036854775808']) assert.throws(() => integer(value, 'AMOUNT'));
  assert.equal(integer('9007199254740993', 'AMOUNT'), 9007199254740993n);
});
test('custodial configuration is disabled by default and rejects hosted or production databases', () => {
  assert.equal(validateLocalTradingConfiguration({}), null);
  assert.throws(() => validateLocalTradingConfiguration({
    CUSTODIAL_TRADING_LOCAL: 'true',
    NODE_ENV: 'production'
  }));
  const env = {
    NODE_ENV: 'test',
    CUSTODIAL_TRADING_LOCAL: 'true',
    CUSTODIAL_TRADING_DISPOSABLE: 'true',
    DATABASE_URL: 'postgresql://auth@127.0.0.1/disposable_test',
    TRADING_RUNTIME_DATABASE_URL: 'postgresql://runtime@127.0.0.1/disposable_test',
    TRADING_READ_DATABASE_URL: 'postgresql://read@127.0.0.1/disposable_test'
  };
  assert.equal(validateLocalTradingConfiguration(env).length, 3);
  for(const key of ['TRADING_MATCHING_DATABASE_URL','TRADING_SCHEDULER_DATABASE_URL','FUNDING_DATABASE_URL','MIGRATION_DATABASE_URL'])assert.throws(()=>validateLocalTradingConfiguration({...env,[key]:'privileged'}),/Unrelated/);
  assert.throws(()=>validateLocalTradingConfiguration({...env,TRADING_READ_DATABASE_URL:env.TRADING_READ_DATABASE_URL+'?host=hosted.invalid'}));
  assert.throws(() => validateLocalTradingConfiguration({
    ...env,
    TRADING_READ_DATABASE_URL: 'postgresql://read@hosted.invalid/disposable_test'
  }));
  assert.throws(() => validateLocalTradingConfiguration({
    ...env,
    TRADING_READ_DATABASE_URL: env.DATABASE_URL
  }));
});
test('custodial services cannot activate in production', () => assert.throws(() => createCustodialTradingService({
  environment: 'production'
})));
