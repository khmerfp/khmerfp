const SENSITIVE_KEY_PATTERN =
  /(?:secret|password|passwd|pwd|token|api[_-]?key|private[_-]?key|credential|database[_-]?url)/i

const MAX_CAUSE_DEPTH = 4

// Collect configured values that must never appear in a diagnostic message.
function getSensitiveEnvironmentValues(environmentVariables) {
  return Object.entries(environmentVariables)
    .filter(
      ([key, value]) =>
        SENSITIVE_KEY_PATTERN.test(key) &&
        typeof value === 'string' &&
        value.length > 0,
    )
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length)
}

// Remove configured secrets and common credential shapes from free-form text.
export function redactSensitiveText(value, environmentVariables = process.env) {
  if (typeof value !== 'string' || value.length === 0) {
    return value
  }

  let redacted = value

  for (const sensitiveValue of getSensitiveEnvironmentValues(environmentVariables)) {
    redacted = redacted.split(sensitiveValue).join('[REDACTED]')
  }

  return redacted
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi,
      '$1[REDACTED]@',
    )
    .replace(
      /((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[REDACTED]',
    )
}

function appendErrorDiagnostics(
  lines,
  error,
  label,
  environmentVariables,
  depth,
) {
  if (depth > MAX_CAUSE_DEPTH) {
    lines.push(`${label}: [cause chain truncated]`)
    return
  }

  if (error === null || typeof error !== 'object') {
    lines.push(
      `${label}: ${redactSensitiveText(String(error), environmentVariables)}`,
    )
    return
  }

  const name = redactSensitiveText(
    String(error.name ?? 'Error'),
    environmentVariables,
  )
  const message = redactSensitiveText(
    String(error.message ?? ''),
    environmentVariables,
  )
  const stack = redactSensitiveText(
    String(error.stack ?? ''),
    environmentVariables,
  )

  lines.push(`${label} name: ${name}`)
  lines.push(`${label} message: ${message}`)

  if (error.code !== undefined) {
    lines.push(
      `${label} code: ${redactSensitiveText(String(error.code), environmentVariables)}`,
    )
  }

  lines.push(`${label} stack:`)
  lines.push(stack)

  if (error.cause !== undefined) {
    appendErrorDiagnostics(
      lines,
      error.cause,
      `${label} cause`,
      environmentVariables,
      depth + 1,
    )
  }
}

// Build a safe, detailed diagnostic report for an unexpected startup failure.
export function formatStartupDiagnostics(
  error,
  environmentVariables = process.env,
) {
  const lines = ['Startup diagnostics (local development only):']

  appendErrorDiagnostics(lines, error, 'error', environmentVariables, 0)

  return lines.join('\n')
}

// Write startup diagnostics without exposing configured credentials.
export function logStartupDiagnostics(
  error,
  { environmentVariables = process.env, writer = console } = {},
) {
  writer.error(formatStartupDiagnostics(error, environmentVariables))
}
