// Recurring market coordination and canonical CTF identity derivation.
// Deriving token IDs does not deploy contracts or confirm blockchain preparation.

import { setTimeout as delay } from 'node:timers/promises'
import {
  deriveConditionId,
  deriveCollectionId,
  derivePositionId,
} from '../../contracts/src/ctfIdentifiers.js'
import { claimIndexSet } from '../../domain/src/marketRegistry.js'

// Uses the existing verified CTF utility. DERIVED never means prepared on-chain.
export function deriveRoundRegistry(plan) {
  const count = plan.definition.outcomes.length
  const conditionId = deriveConditionId({
    oracle: plan.registry.oracleAddress,
    questionId: plan.ctfQuestionId,
    outcomeSlotCount: count,
  })
  const tokens = new Map()
  for (let index = 0; index < count; index++)
    for (const polarity of ['YES', 'NO']) {
      const mask = claimIndexSet(count, index, polarity)
      // Binary YES/NO aliases can share a mask; register each canonical position once.
      if (tokens.has(String(mask))) continue
      const collectionId = deriveCollectionId({ conditionId, indexSet: mask })
      tokens.set(String(mask), {
        mask: String(mask),
        collectionId,
        positionId: BigInt(
          derivePositionId({ collateralAddress: plan.registry.collateralAddress, collectionId }),
        ).toString(),
      })
    }
  return {
    templateId: plan.templateId,
    ordinal: plan.ordinal,
    ctfQuestionId: plan.ctfQuestionId,
    conditionId,
    tokens: [...tokens.values()],
  }
}

// Translate service methods into the fixed database scheduler actions.
export function marketFacade(execute) {
  const call = (actor, action, terms = {}) => execute(actor, action, 'market-schedule', terms)
  return {
    createTemplate: (actor, terms) => call(actor, 'CREATE_TEMPLATE', terms),
    enable: (actor, templateId, enabled) => call(actor, 'ENABLE', { templateId, enabled }),
    plan: (actor, templateId) => call(actor, 'PLAN', { templateId }),
    createNext: async (actor, templateId) => {
      // No database transaction is held during elliptic-curve derivation.
      const plan = await call(actor, 'PLAN', { templateId })
      if (plan.state !== 'READY') return plan
      return call(actor, 'CREATE_ROUND', deriveRoundRegistry(plan))
    },
    step: (actor, marketId) => call(actor, 'LIFECYCLE_STEP', { marketId }),
    pause: (actor, marketId) => call(actor, 'PAUSE', { marketId }),
    resume: (actor, marketId) => call(actor, 'RESUME', { marketId }),
    observe: (actor, terms) => call(actor, 'OBSERVE', terms),
    discover: (actor) => call(actor, 'DISCOVER'),
    history: (actor, templateId) => call(actor, 'HISTORY', { templateId }),
    diagnostics: (actor) => call(actor, 'SCHEDULE_DIAGNOSTICS'),
    failure: (actor, templateId, code) => call(actor, 'FAILURE', { templateId, code }),
    recovered: (actor, templateId) => call(actor, 'RECOVERED', { templateId }),
    // Same batch/ack interface as runOutboxWorker; streams are template IDs here.
    eventMarkets: (actor) => call(actor, 'SCHEDULE_EVENT_STREAMS'),
    events: (actor, templateId, limit = 50n, after = null) =>
      call(actor, 'SCHEDULE_EVENT_BATCH', { templateId, limit, after }),
    acknowledge: (actor, templateId, after, eventIds) =>
      call(actor, 'SCHEDULE_EVENT_ACK', { templateId, after, eventIds }),
  }
}

// Discover durable scheduling work on each poll, so restarts resume from database state.
export async function runMarketSchedulerWorker({
  service,
  matching,
  actor,
  signal,
  pollMs = 250,
  onError = () => {},
  onDiagnostic = () => {},
}) {
  if (
    !service ||
    !signal ||
    !/^system:[a-z][a-z0-9_-]{0,60}$/.test(actor) ||
    !Number.isInteger(pollMs) ||
    pollMs < 25
  )
    throw new TypeError('Invalid opt-in market scheduler configuration.')
  let failures = 0,
    attempts = 0
  while (!signal.aborted) {
    try {
      const work = await service.discover(actor)
      // Create due rounds before advancing the lifecycle of existing markets.
      for (const templateId of work.templates) {
        if (signal.aborted) break
        attempts++
        try {
          await service.createNext(actor, templateId)
          await service.recovered(actor, templateId)
        } catch (error) {
          const code = /^[A-Z0-9]{5}$/.test(error.code || '')
            ? error.code
            : 'SCHEDULE_CREATION_FAILED'
          // A separate transaction records a sanitized failure after rollback.
          try {
            await service.failure(actor, templateId, code)
          } catch {
            /* PostgreSQL downtime remains recoverable from its cursor. */
          }
          onError({ code, templateId })
          failures = Math.min(failures + 1, 5)
        }
      }
      for (const marketId of work.markets) {
        if (signal.aborted) break
        attempts++
        const result = await service.step(actor, marketId)
        // Let the authoritative matching queue process commands after closure.
        if (result.state === 'CLOSED' && matching) await matching.step(actor, marketId)
      }
      onDiagnostic({
        templateBacklog: work.templates.length,
        marketBacklog: work.markets.length,
        recoveryAttempts: attempts,
      })
      if (!work.templates.length && !work.markets.length) failures = 0
    } catch (error) {
      failures = Math.min(failures + 1, 5)
      onError({
        code: /^[A-Z0-9]{5}$/.test(error.code || '') ? error.code : 'SCHEDULE_DISCOVERY_FAILED',
      })
    }
    // Capped backoff avoids rapid retries during outages and remains abortable.
    try {
      await delay(Math.min(pollMs * 2 ** failures, 5000), undefined, { signal })
    } catch (error) {
      if (error.name !== 'AbortError') throw error
    }
  }
}
