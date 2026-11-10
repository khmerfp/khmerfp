import { AuthenticationError } from './authSessionService.js'

const MAX_DISPLAY_NAME_LENGTH = 255
const LINKABLE_PROVIDER_COLUMNS = new Set([
  'google_sub',
  'facebook_sub',
])

// Columns that identify a sign-in provider. Each provider row maps to one
// users column whose value is unique when present.
export function normalizeLanguage(language) {
  return language === 'km' ? 'km' : 'en'
}

export function loginContext(request) {
  return [
    request.ip || null,
    (request.get('user-agent') || '').slice(0, 1000) || null,
  ]
}

function displayNameFor(email, fallback) {
  const candidate =
    (typeof fallback === 'string' && fallback.trim()) ||
    (typeof email === 'string' && email.split('@')[0]) ||
    ''

  return candidate.trim().slice(0, MAX_DISPLAY_NAME_LENGTH) || 'User'
}

// Resolve an existing account for one provider identity, or create a new one.
//
// Linking policy is intentionally strict: an existing account is only reused
// when it already holds the same provider identity. A matching email without
// that identity is never silently linked, because linking another sign-in
// method must be an explicit, re-authenticated action. Callers own the
// transaction; this helper only issues statements through the given client.
export async function resolveProviderUser(
  client,
  {
    column,
    identifier,
    email,
    displayName,
    avatarUrl = null,
    language,
    request,
    signInEventType,
  },
) {
  const preferredLanguage = normalizeLanguage(language)
  const context = loginContext(request)
  const name = displayNameFor(email, displayName)

  // Resolve the provider identity and the email owner in one round trip. The
  // email address is unique across accounts, so an address that already
  // belongs to a different account can never be taken over.
  const lookupResult = await client.query(
    `SELECT id, email, ${column} AS provider_identifier
     FROM users
     WHERE ${column} = $1 OR email = $2`,
    [identifier, email],
  )

  const existingRow = lookupResult.rows.find(
    (row) =>
      row.provider_identifier !== null
      && String(row.provider_identifier) === String(identifier),
  )
  const emailOwnerRow = lookupResult.rows.find((row) => row.email === email)

  const existingUserId = existingRow?.id ?? null
  const emailOwnerId = emailOwnerRow?.id ?? null

  if (
    emailOwnerId !== null
    && String(emailOwnerId) !== String(existingUserId)
  ) {
    throw new AuthenticationError(
      'An account with this email already exists and is not linked to this sign-in method. Sign in with the original method first, then link this provider from your account.',
      'ACCOUNT_LINK_REQUIRED',
    )
  }

  // Upsert the account and ensure its wallet in one round trip. The wallet CTE
  // is data-modifying, so PostgreSQL runs it even though the final SELECT only
  // reads the user row.
  const values = [
    identifier,
    email,
    name,
    avatarUrl,
    preferredLanguage,
    ...context,
  ]

  let userResult

  if (existingUserId !== null) {
    userResult = await client.query(
      `WITH updated AS (
         UPDATE users
         SET email = $2,
             display_name = $3,
             avatar_url = COALESCE($4, avatar_url),
             language = $5,
             last_login_at = NOW(),
             last_login_ip = $6,
             last_login_user_agent = $7,
             updated_at = NOW()
         WHERE ${column} = $1
         RETURNING id, email, display_name, avatar_url, language
       ), wallet AS (
         INSERT INTO wallets (user_id, balance_minor, currency)
         SELECT id, 0, 'KHR' FROM updated
         ON CONFLICT (user_id) DO NOTHING
       )
       SELECT * FROM updated`,
      values,
    )
  } else {
    userResult = await client.query(
      `WITH inserted AS (
         INSERT INTO users (
           ${column}, email, display_name, avatar_url, language,
           last_login_at, last_login_ip, last_login_user_agent
         )
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
         RETURNING id, email, display_name, avatar_url, language
       ), wallet AS (
         INSERT INTO wallets (user_id, balance_minor, currency)
         SELECT id, 0, 'KHR' FROM inserted
         ON CONFLICT (user_id) DO NOTHING
       )
       SELECT * FROM inserted`,
      values,
    )
  }

  const user = userResult.rows[0]

  return { user, signInEventType }
}

// Attach a freshly verified provider identity to the currently authenticated
// user. A provider identity can belong to only one user, and callers own the
// surrounding transaction.
export async function linkProviderIdentity(
  client,
  { userId, column, identifier, eventType, request },
) {
  if (!LINKABLE_PROVIDER_COLUMNS.has(column)) {
    throw new TypeError('Unsupported provider identity column.')
  }

  let result

  try {
    result = await client.query(
    `WITH linked AS (
       UPDATE users
       SET ${column} = $2,
           updated_at = NOW()
       WHERE id = $1
         AND (${column} IS NULL OR ${column} = $2)
         AND NOT EXISTS (
           SELECT 1 FROM users
           WHERE ${column} = $2 AND id <> $1
         )
       RETURNING id, email, display_name, avatar_url, language
     ), audited AS (
       INSERT INTO auth_audit_logs (
         user_id, event_type, ip_address, user_agent
       )
       SELECT id, $3, $4, $5 FROM linked
     )
     SELECT * FROM linked`,
    [
      userId,
      identifier,
      eventType,
      request.ip || null,
      (request.get('user-agent') || '').slice(0, 1000) || null,
    ],
    )
  } catch (error) {
    // A concurrent transaction may claim the provider identity after the
    // NOT EXISTS check but before this update reaches the unique index.
    if (error?.code === '23505') {
      throw new AuthenticationError(
        'This sign-in account is already linked to another user.',
      )
    }
    throw error
  }

  if (result.rowCount === 0) {
    throw new AuthenticationError(
      'This sign-in account is already linked to another user.',
    )
  }

  return result.rows[0]
}
