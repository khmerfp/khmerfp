// Exact observation values are independent of USD trading amounts and token quotes.
export function parseObservation(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError('Observation decimals must be an integer from 0 to 18.')
  }
  if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    throw new TypeError('Observation must be an exact decimal string.')
  }
  const negative = value.startsWith('-')
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.')
  if (fraction.length > decimals) throw new RangeError('Observation exceeds declared precision.')
  const units = BigInt(whole + fraction.padEnd(decimals, '0'))
  if (units >= 10n ** 78n) throw new RangeError('Observation exceeds NUMERIC(78,0).')
  return negative ? -units : units
}

export function claimIndexSet(outcomeCount, outcomeIndex, polarity) {
  if (!Number.isInteger(outcomeCount) || outcomeCount < 2 || outcomeCount > 256 ||
      !Number.isInteger(outcomeIndex) || outcomeIndex < 0 || outcomeIndex >= outcomeCount) {
    throw new RangeError('Invalid condition outcome count or slot.')
  }
  if (!['YES', 'NO'].includes(polarity)) throw new TypeError('Unknown claim polarity.')
  const singleton = 1n << BigInt(outcomeIndex)
  return polarity === 'YES' ? singleton : ((1n << BigInt(outcomeCount)) - 1n) ^ singleton
}

// No fallback winner: malformed or incomplete evidence must leave resolution pending.
export function selectRangeOutcome(outcomes, value) {
  if (typeof value !== 'bigint') throw new TypeError('Observation must use scaled BigInt units.')
  if (!Array.isArray(outcomes) || outcomes.some(outcome =>
    !outcome ||
    (outcome.lower !== null && typeof outcome.lower !== 'bigint') ||
    (outcome.upper !== null && typeof outcome.upper !== 'bigint') ||
    (outcome.lower !== null && outcome.upper !== null && outcome.lower >= outcome.upper))) {
    throw new TypeError('Intervals must use ordered scaled BigInt bounds or explicit null tails.')
  }
  const matches = outcomes.filter(outcome =>
    (outcome.lower === null || value >= outcome.lower) &&
    (outcome.upper === null || value < outcome.upper))
  if (matches.length !== 1) throw new Error('Observation must match exactly one frozen interval.')
  return matches[0].id
}
