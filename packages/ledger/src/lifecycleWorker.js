import { setTimeout as delay } from 'node:timers/promises'
import { runMatchingWorker } from './matchingWorker.js'

function coordinatedWorker({ lifecycle, matching, expirationOnly, batchSize = 25n, ...options }) {
  if (!lifecycle || !matching || typeof batchSize !== 'bigint' || batchSize < 1n || batchSize > 100n)
    throw new TypeError('Invalid opt-in lifecycle worker configuration.')
  return runMatchingWorker({
    ...options,
    service: {
      pending: actor => expirationOnly ? lifecycle.expiring(actor) : matching.pending(actor),
      step: async (actor, marketId) => {
        // Two bounded transactions: durable expiry acceptance, then the same queue head.
        // A crash between them leaves a recoverable command, never a guessed release.
        await lifecycle.expire(actor, marketId, batchSize)
        return matching.step(actor, marketId)
      },
    },
  })
}

export const runExpirationWorker = options => coordinatedWorker({ ...options, expirationOnly: true })
export const runRecoveryWorker = options => coordinatedWorker({ ...options, expirationOnly: false })

// Transport is supplied explicitly by a trusted backend. No public transport is enabled.
// Delivery is at least once: consumers must deduplicate by eventId before applying effects.
export async function runOutboxWorker({ service, actor, signal, onEvents, onError = () => {}, pollMs = 250, batchSize = 50n }) {
  if (!service || !signal || typeof onEvents !== 'function' || !/^system:[a-z][a-z0-9_-]{0,60}$/.test(actor) || !Number.isInteger(pollMs) || pollMs < 25 || typeof batchSize !== 'bigint' || batchSize < 1n || batchSize > 100n)
    throw new TypeError('Invalid opt-in event replay worker configuration.')
  let failures = 0
  while (!signal.aborted) {
    try {
      for (const market of await service.eventMarkets(actor)) {
        if (signal.aborted) break
        const batch = await service.events(actor, market, batchSize)
        if (!batch.events.length) continue
        // All network work happens after the read transaction commits.
        await onEvents(batch)
        if (signal.aborted) break
        await service.acknowledge(actor, market, batch.afterSequence, batch.events.map(event => event.eventId))
      }
      failures = 0
    } catch (error) {
      failures = Math.min(failures + 1, 5)
      onError({ code: /^[0-9A-Z]{5}$/.test(error.code || '') ? error.code : 'OUTBOX_DELIVERY_FAILED', commitOutcome: error.commitOutcome })
    }
    try { await delay(Math.min(pollMs * 2 ** failures, 5000), undefined, { signal }) }
    catch (error) { if (error.name !== 'AbortError') throw error }
  }
}
