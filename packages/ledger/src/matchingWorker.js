import { setTimeout as delay } from 'node:timers/promises'

// PostgreSQL owns progress; a lost response requires another step, never a guessed fill.
// No transaction is held open during polling or external work. Multiple processes are safe.
export async function runMatchingWorker({ service, actor, signal, pollMs = 250, concurrency = 4, onError = () => {} }) {
  if (!service || !signal || !/^system:[a-z][a-z0-9_-]{0,60}$/.test(actor) || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16 || !Number.isInteger(pollMs) || pollMs < 25) throw new TypeError('Invalid opt-in matching worker configuration.')
  while (!signal.aborted) {
    try {
      const markets = await service.pending(actor)
      // Each market advances one bounded transaction per poll. Never skip an earlier request.
      for (let offset = 0; offset < markets.length && !signal.aborted; offset += concurrency) {
        await Promise.all(markets.slice(offset, offset + concurrency).map(async market => {
          try { await service.step(actor, market) } catch (error) { onError({ marketId: market, code: error.code || 'MATCH_FAILED', commitOutcome: error.commitOutcome }) }
        }))
      }
    } catch (error) { onError({ code: error.code || 'MATCH_DISCOVERY_FAILED' }) }
    try { await delay(pollMs, undefined, { signal }) } catch (error) { if (error.name !== 'AbortError') throw error }
  }
}
