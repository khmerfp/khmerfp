export const STATUS_RATE_LIMIT = 30
export const STATUS_RATE_WINDOW_MS = 60_000

// create one fixed window limiter
export function createFixedWindowRateLimiter({
  limit,
  windowMs,
  message,
  now = Date.now,
}) {
  const clients = new Map()

  // limit requests by client address
  return function limitRequests(request, response, next) {
    const currentTime = now()
    const key = request.ip ?? 'unknown'
    const existing = clients.get(key)
    const entry = !existing || currentTime >= existing.resetAt
      ? { count: 0, resetAt: currentTime + windowMs }
      : existing

    entry.count += 1
    clients.set(key, entry)

    if (clients.size > 1_000) {
      for (const [clientKey, value] of clients) {
        if (currentTime >= value.resetAt) clients.delete(clientKey)
      }
    }

    if (entry.count > limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((entry.resetAt - currentTime) / 1_000),
      )
      response.set('Cache-Control', 'no-store')
      response.set('Retry-After', String(retryAfterSeconds))
      response.status(429).json({ message })
      return
    }

    next()
  }
}

// create one status lookup limiter
export function createStatusRateLimiter(options = {}) {
  return createFixedWindowRateLimiter({
    limit: options.limit ?? STATUS_RATE_LIMIT,
    windowMs: options.windowMs ?? STATUS_RATE_WINDOW_MS,
    message: 'Too many status requests.',
    now: options.now ?? Date.now,
  })
}

// prevent status responses from being cached
export function preventStatusCaching(_request, response, next) {
  response.set('Cache-Control', 'no-store')
  next()
}
