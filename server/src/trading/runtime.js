import pg from 'pg';
import { createMatchingService, createLifecycleService, createMarketLifecycleService, runMatchingWorker, runExpirationWorker, runMarketSchedulerWorker } from '../../../packages/ledger/src/index.js';
import { createTradingReads } from './readRepository.js';
import { createCustodialTradingService } from './service.js';
export function validateLocalTradingConfiguration(env = process.env) {
  if (env.CUSTODIAL_TRADING_LOCAL !== 'true') return null;
  if (!['development', 'test'].includes(env.NODE_ENV) || env.CUSTODIAL_TRADING_DISPOSABLE !== 'true') throw new Error('Trading requires explicit disposable local configuration.');
  const urls = ['DATABASE_URL', 'TRADING_RUNTIME_DATABASE_URL', 'TRADING_READ_DATABASE_URL'].map(name => {
    const url = new URL(env[name] || '');
    if (url.search || url.hash || url.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/test|disposable/.test(url.pathname)) throw new Error('Trading database must be disposable and loopback-only.');
    return url;
  });
  if (urls.some(url => url.host !== urls[0].host || url.pathname !== urls[0].pathname)) throw new Error('Trading and authentication database identities differ.');
  if (urls[1].username === urls[0].username || urls[2].username === urls[1].username || urls[2].username === urls[0].username) throw new Error('Separate authentication, trading runtime and read roles required.');
  return urls.map(url => url.href);
}
export function createLocalTradingRuntime(env = process.env) {
  const urls = validateLocalTradingConfiguration(env);
  if (!urls) return null;
  const write = new pg.Pool({
      connectionString: urls[1],
      max: 8,
      connectionTimeoutMillis: 5000
    }),
    read = new pg.Pool({
      connectionString: urls[2],
      max: 8,
      connectionTimeoutMillis: 5000
    });
  for (const pool of [write, read]) pool.on('error', () => console.error('Local trading connection unavailable.'));
  const reads = createTradingReads(read),
    service = createCustodialTradingService({
      pool: write,
      reads,
      environment: env.NODE_ENV
    });
  const actor = 'system:http-trading',
    controller = new AbortController();
  const options = {
    pool: write,
    enabled: true,
    environment: env.NODE_ENV,
    authorize: r => r.actor === actor
  };
  const matching = createMatchingService(options),
    lifecycle = createLifecycleService(options),
    schedule = createMarketLifecycleService(options);
  const workerOptions = {
    actor,
    signal: controller.signal,
    onError: event => console.error('Local trading worker:', event.code)
  };
  const workers = [runMatchingWorker({
    ...workerOptions,
    service: matching
  }), runExpirationWorker({
    ...workerOptions,
    lifecycle,
    matching
  }), runMarketSchedulerWorker({
    ...workerOptions,
    service: schedule,
    matching
  })];
  return {
    options: {
      service
    },
    async close() {
      controller.abort();
      await Promise.allSettled(workers);
      await Promise.all([read.end(), write.end()]);
    }
  };
}
