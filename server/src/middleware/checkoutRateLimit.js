import { createFixedWindowRateLimiter } from './statusRateLimit.js'

export const CHECKOUT_RATE_LIMIT = 5
export const CHECKOUT_RATE_WINDOW_MS = 60_000

// create one checkout preparation limiter
export function createCheckoutRateLimiter(options = {}) {
  return createFixedWindowRateLimiter({
    limit: options.limit ?? CHECKOUT_RATE_LIMIT,
    windowMs: options.windowMs ?? CHECKOUT_RATE_WINDOW_MS,
    message: 'Too many checkout preparation requests.',
    now: options.now ?? Date.now,
  })
}
