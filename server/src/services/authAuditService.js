import { getDatabasePool } from '../config/database.js'

// Write one authentication audit event; user_id stays null for anonymous
// events such as blocked origins or failed Google tokens.
export async function recordAuthEvent(
  { userId = null, eventType, request, details = {} },
  pool = getDatabasePool(),
) {
  await pool.query(
    `INSERT INTO auth_audit_logs (user_id, event_type, ip_address, user_agent, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      userId,
      eventType,
      request.ip || null,
      (request.get('user-agent') || '').slice(0, 1000) || null,
      JSON.stringify(details),
    ],
  )
}

// Best-effort audit write that never breaks the HTTP response path.
export function recordAuthEventQuietly(event) {
  return recordAuthEvent(event).catch(() => {})
}
