import { getDatabasePool } from '../config/database.js'
import { recordAuthEventQuietly } from '../services/authAuditService.js'

const DEFAULT_WINDOW_MINUTES = 15
const DEFAULT_MAX_REQUESTS = 10
const DEFAULT_BLOCK_MINUTES = 15

function getClientIp(request) {
  return (request.ip || 'unknown').slice(0, 64)
}

// Fixed-window counter backed by the auth_rate_limits table. The key scopes
// one bucket per client IP and auth route so one attacker cannot starve
// other users, and the failure path never blocks the response chain.
export function createAuthRateLimiter({
  pool,
  windowMinutes = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MINUTES || DEFAULT_WINDOW_MINUTES),
  maxRequests = Number(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS || DEFAULT_MAX_REQUESTS),
  blockMinutes = Number(process.env.AUTH_RATE_LIMIT_BLOCK_MINUTES || DEFAULT_BLOCK_MINUTES),
} = {}) {
  return async function authRateLimit(request, response, next) {
    let database

    try {
      database = pool || getDatabasePool()
    } catch {
      // The login path itself needs the database, so an unavailable pool
      // already prevents authentication; skip the limit instead of erroring.
      next()
      return
    }

    try {
      const key = `auth:${request.method}:${request.baseUrl}${request.path}:${getClientIp(request)}`.slice(0, 255)

      const result = await database.query(
        `INSERT INTO auth_rate_limits (rate_limit_key, window_started_at, request_count)
         VALUES ($1, NOW(), 1)
         ON CONFLICT (rate_limit_key) DO UPDATE SET
           request_count = CASE
             WHEN auth_rate_limits.window_started_at <= NOW() - ($2 * INTERVAL '1 minute')
               THEN 1
             ELSE auth_rate_limits.request_count + 1
           END,
           window_started_at = CASE
             WHEN auth_rate_limits.window_started_at <= NOW() - ($2 * INTERVAL '1 minute')
               THEN NOW()
             ELSE auth_rate_limits.window_started_at
           END,
           blocked_until = CASE
             WHEN auth_rate_limits.window_started_at <= NOW() - ($2 * INTERVAL '1 minute')
               THEN NULL
             ELSE auth_rate_limits.blocked_until
           END,
           updated_at = NOW()
         RETURNING request_count, blocked_until`,
        [key, windowMinutes],
      )

      const row = result.rows[0]

      if (row.blocked_until && new Date(row.blocked_until) > new Date()) {
        response.setHeader('Retry-After', String(blockMinutes * 60))
        response.status(429).json({
          message: 'Too many attempts. Try again later.',
        })
        return
      }

      if (row.request_count > maxRequests) {
        await database.query(
          `UPDATE auth_rate_limits
           SET blocked_until = NOW() + ($2 * INTERVAL '1 minute'),
               updated_at = NOW()
           WHERE rate_limit_key = $1`,
          [key, blockMinutes],
        )

        await recordAuthEventQuietly({
          eventType: 'auth_rate_limited',
          request,
          details: { route: `${request.baseUrl}${request.path}`, windowMinutes },
        })

        response.setHeader('Retry-After', String(blockMinutes * 60))
        response.status(429).json({
          message: 'Too many attempts. Try again later.',
        })
        return
      }

      next()
    } catch (error) {
      next(error)
    }
  }
}
