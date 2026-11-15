const SOURCE = 'LOCAL_FIXTURE_BTC_USD_DEMO'

// no network reads or oracle transactions; invalid evidence stays pending.
function evaluatePrices(round, opening, closing, now) {
  if (!round || ![round.startTime, round.tradingCutoff, round.resolutionTime, now].every(Number.isSafeInteger)
    || round.startTime < 0 || round.tradingCutoff !== round.startTime + 300
    || round.resolutionTime < round.tradingCutoff) {
    return { status: 'PENDING', outcome: null }
  }
  const valid = (sample, target) => sample && sample.source === SOURCE
    && typeof sample.priceUsd6 === 'string' && /^[1-9][0-9]{0,29}$/.test(sample.priceUsd6)
    && sample.sourceTimestamp === target
    && Number.isSafeInteger(sample.recordedAt)
    && sample.recordedAt >= target && sample.recordedAt <= target + 10
    && sample.recordedAt <= now
  if (!Number.isSafeInteger(now) || now < round.resolutionTime
    || !valid(opening, round.startTime) || !valid(closing, round.tradingCutoff)) {
    return { status: 'PENDING', outcome: null }
  }
  return { status: 'READY_FOR_DEMO_RESOLUTION', outcome: BigInt(closing.priceUsd6) > BigInt(opening.priceUsd6) ? 'YES' : 'NO' }
}

module.exports = { SOURCE, evaluatePrices }
