import { setTimeout as delay } from 'node:timers/promises'

// PostgreSQL owns progress; a lost response requires another step, never a guessed fill.
// No transaction is held open during polling or external work. Multiple processes are safe.
export async function runMatchingWorker({
  service,
  actor,
  signal,
  pollMs = 250,
  concurrency = 4,
  onError = () => {},
  onDiagnostic = () => {},
}) {
  if (
    !service ||
    !signal ||
    !/^system:[a-z][a-z0-9_-]{0,60}$/.test(actor) ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 16 ||
    !Number.isInteger(pollMs) ||
    pollMs < 25
  )
    throw new TypeError('Invalid opt-in matching worker configuration.')
  // Backoff is capped; successful polls restore the normal polling interval.
  let failures = 0,
    attempts = 0
  while (!signal.aborted) {
    try {
      // Discover durable work again on every poll, including after connection failures.
      const markets = await service.pending(actor)
      let failed = false
      // Each market advances one bounded transaction per poll. Never skip an earlier request.
      for (let offset = 0; offset < markets.length && !signal.aborted; offset += concurrency) {
        await Promise.all(
          markets.slice(offset, offset + concurrency).map(async (market) => {
            attempts++
            try {
              await service.step(actor, market)
            } catch (error) {
              failed = true
              onError({
                marketId: market,
                code: /^[0-9A-Z]{5}$/.test(error.code || '') ? error.code : 'MATCH_FAILED',
                commitOutcome: error.commitOutcome,
              })
            }
          }),
        )
      }
      failures = failed ? Math.min(failures + 1, 5) : 0
      onDiagnostic({
        pendingMarkets: markets.length,
        recoveryAttempts: attempts,
        consecutiveFailures: failures,
      })
    } catch (error) {
      failures = Math.min(failures + 1, 5)
      onError({
        code: /^[0-9A-Z]{5}$/.test(error.code || '') ? error.code : 'MATCH_DISCOVERY_FAILED',
      })
    }
    // Abort interrupts the polling delay without keeping a database transaction open.
    try {
      await delay(Math.min(pollMs * 2 ** failures, 5000), undefined, { signal })
    } catch (error) {
      if (error.name !== 'AbortError') throw error
    }
  }
}
