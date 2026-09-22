export const STATUS_RATE_LIMIT = 30
export const STATUS_RATE_WINDOW_MS = 60_000

// create one in-memory status lookup limiter
export function createStatusRateLimiter({
  limit = STATUS_RATE_LIMIT,
  windowMs = STATUS_RATE_WINDOW_MS,
  now = Date.now,
} = {}) {
  const clients = new Map()

  // limit status reads by client address
  return function limitStatusRequests(request, response, next) {
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
      response.status(429).json({ message: 'Too many status requests.' })
      return
    }

    next()
  }
}

// prevent status responses from being cached
export function preventStatusCaching(_request, response, next) {
  response.set('Cache-Control', 'no-store')
  next()
}
