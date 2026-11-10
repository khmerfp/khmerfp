const DEFAULT_BROWSER_ORIGIN = 'http://localhost:5173'
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

export function getBrowserOrigins(environmentVariables = process.env) {
  const configuredOrigins =
    environmentVariables.APP_ORIGINS || DEFAULT_BROWSER_ORIGIN

  return [
    ...new Set(
      configuredOrigins
        .split(',')
        .map((value) => value.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    ),
  ]
}

// Browsers treat www.example.com and example.com as different origins. The
// site is served on both hostnames, so trust the www counterpart of each
// configured origin as well.
function wwwCounterpart(origin) {
  try {
    const parsed = new URL(origin)

    if (parsed.hostname.startsWith('www.')) {
      return null
    }

    parsed.hostname = `www.${parsed.hostname}`
    return parsed.origin
  } catch {
    return null
  }
}

function isLoopbackOrigin(origin) {
  if (typeof origin !== 'string') return false

  try {
    const parsed = new URL(origin)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }

    return LOOPBACK_HOSTNAMES.has(parsed.hostname)
  } catch {
    return false
  }
}

// Strict in production: only APP_ORIGINS are trusted. Local development also
// accepts loopback origins so the app works when Vite opens on 127.0.0.1 or a
// different port. Requests without an Origin header are non-browser clients.
export function isBrowserOriginAllowed(
  origin,
  environmentVariables = process.env,
) {
  if (!origin) return true

  const allowedOrigins = getBrowserOrigins(environmentVariables)

  if (allowedOrigins.includes(origin)) {
    return true
  }

  if (allowedOrigins.some((allowed) => wwwCounterpart(allowed) === origin)) {
    return true
  }

  return (
    environmentVariables.NODE_ENV !== 'production'
    && isLoopbackOrigin(origin)
  )
}
