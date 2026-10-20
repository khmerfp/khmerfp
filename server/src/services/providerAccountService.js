import { AuthenticationError } from './authSessionService.js'

const MAX_DISPLAY_NAME_LENGTH = 255

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

  // Reuse the account that already owns this provider identity.
  let userResult = await client.query(
    `UPDATE users
     SET email = $2,
         display_name = $3,
         avatar_url = COALESCE($4, avatar_url),
         language = $5,
         last_login_at = NOW(),
         last_login_ip = $6,
         last_login_user_agent = $7,
         updated_at = NOW()
     WHERE ${column} = $1
     RETURNING id, email, display_name, avatar_url, language`,
    [
      identifier,
      email,
      name,
      avatarUrl,
      preferredLanguage,
      ...context,
    ],
  )

  if (userResult.rowCount === 0) {
    const emailOwner = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [email],
    )

    if (emailOwner.rowCount > 0) {
      throw new AuthenticationError(
        'An account with this email already exists and is not linked to this sign-in method. Sign in with the original method first to link it.',
      )
    }

    userResult = await client.query(
      `INSERT INTO users (
         ${column}, email, display_name, avatar_url, language,
         last_login_at, last_login_ip, last_login_user_agent
       )
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
       RETURNING id, email, display_name, avatar_url, language`,
      [
        identifier,
        email,
        name,
        avatarUrl,
        preferredLanguage,
        ...context,
      ],
    )
  }

  const user = userResult.rows[0]

  await client.query(
    `INSERT INTO wallets (user_id, balance_minor, currency)
     VALUES ($1, 0, 'KHR')
     ON CONFLICT (user_id) DO NOTHING`,
    [user.id],
  )

  return { user, signInEventType }
}
