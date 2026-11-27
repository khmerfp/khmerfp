import pg from 'pg';
import { createTradingReads } from './readRepository.js';
import { createCustodialTradingService } from './service.js';
import { verifyDatabaseCompatibility } from '../db/schemaCompatibility.js';

// Build the HTTP trading runtime with separate database identities:
// authentication, order mutation, public reads and session-bound private reads.
// Matching and scheduling credentials are intentionally rejected in this process.
export function validateLocalTradingConfiguration(env = process.env) {
  if (env.CUSTODIAL_TRADING_LOCAL !== 'true') return null;
  if (['TRADING_MATCHING_DATABASE_URL','TRADING_SCHEDULER_DATABASE_URL','FUNDING_DATABASE_URL','MIGRATION_DATABASE_URL','LEDGER_DISPOSABLE_TARGET'].some(name=>env[name])) throw new Error('Unrelated privileged credentials in HTTP environment.');
  if (!['development', 'test'].includes(env.NODE_ENV) || env.CUSTODIAL_TRADING_DISPOSABLE !== 'true') throw new Error('Trading requires explicit disposable local configuration.');
  const urls = ['DATABASE_URL', 'TRADING_RUNTIME_DATABASE_URL', 'TRADING_READ_DATABASE_URL', 'TRADING_PRIVATE_READ_DATABASE_URL'].map(name => {
    const url = new URL(env[name] || '');
    if (url.search || url.hash || url.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/test|disposable/.test(url.pathname)) throw new Error('Trading database must be disposable and loopback-only.');
    return url;
  });
  if (urls.some(url => url.host !== urls[0].host || url.pathname !== urls[0].pathname)) throw new Error('Trading and authentication database identities differ.');
  if (new Set(urls.map(url => url.username)).size !== urls.length) throw new Error('Separate authentication, trading runtime, public-read and private-read roles required.');
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
    }),
    privateRead = new pg.Pool({
      connectionString: urls[3],
      max: 8,
      connectionTimeoutMillis: 5000
    });
  for (const pool of [write, read, privateRead]) pool.on('error', () => console.error('Local trading connection unavailable.'));
  const reads = createTradingReads(read,{privatePool:privateRead}),
    service = createCustodialTradingService({
      pool: write,
      reads,
      environment: env.NODE_ENV
    });
  return {
    options: {
      service
    },
    async verifyCompatibility() {
      // Startup is verification-only. Schema changes belong to the dedicated
      // migration process and cannot be performed with runtime credentials.
      await verifyDatabaseCompatibility(write, { mode: 'trading-http' });
      await verifyDatabaseCompatibility(read, { mode: 'public-read' });
      await verifyDatabaseCompatibility(privateRead, { mode: 'private-read' });
    },
    async close() {
      await Promise.all([privateRead.end(), read.end(), write.end()]);
    }
  };
}
