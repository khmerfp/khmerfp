const ALLOWED_FIELDS = new Set([
  'code',
  'duplicate',
  'environment',
  'httpStatus',
  'outcome',
  'transactionId',
])

// redact one transaction id
export function redactTransactionId(value) {
  return typeof value === 'string' && value.length >= 4
    ? `***${value.slice(-4)}`
    : undefined
}

// keep only safe log metadata
export function sanitizeLogFields(fields = {}) {
  const safe = {}

  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key)) continue

    const normalized = key === 'transactionId'
      ? redactTransactionId(value)
      : value
    if (['string', 'number', 'boolean'].includes(typeof normalized)) {
      safe[key] = normalized
    }
  }

  return safe
}

// create a structured redacted logger
export function createOperationalLogger(writer = console) {
  // write one safe event
  function write(level, event, fields) {
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...sanitizeLogFields(fields),
    })
    const method = typeof writer[level] === 'function' ? level : 'log'
    writer[method](record)
  }

  return Object.freeze({
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  })
}

export const operationalLogger = createOperationalLogger()
