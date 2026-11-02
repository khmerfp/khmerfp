// Authentication and wallet schema shared by startup and the migrate script.
export const AUTH_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    google_sub VARCHAR(255) UNIQUE,
    email VARCHAR(320) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    language VARCHAR(5) NOT NULL DEFAULT 'en'
      CHECK (language IN ('en', 'km')),
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    last_login_user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Accounts may sign in with Google (google_sub), Facebook (facebook_sub),
  -- email/password (password_hash) or a verified phone number (phone_number).
  -- Every identity column is nullable: a provider-only user has no password_hash
  -- and an email-only user has no google_sub/facebook_sub/phone_number.
  ALTER TABLE users ALTER COLUMN google_sub DROP NOT NULL;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_sub VARCHAR(255);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_sub VARCHAR(255);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(32);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
    ON users (email);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_facebook_sub_unique
    ON users (facebook_sub)
    WHERE facebook_sub IS NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_sub_unique
    ON users (telegram_sub)
    WHERE telegram_sub IS NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_number_unique
    ON users (phone_number)
    WHERE phone_number IS NOT NULL;

  CREATE TABLE IF NOT EXISTS wallets (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE
      REFERENCES users(id) ON DELETE CASCADE,
    balance_minor BIGINT NOT NULL DEFAULT 0
      CHECK (balance_minor >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'KHR'
      CHECK (currency = 'KHR'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY
      CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    user_id BIGINT NOT NULL
      REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    idle_expires_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    step_up_at TIMESTAMPTZ,
    ip_address INET,
    user_agent TEXT,
    CHECK (idle_expires_at <= expires_at)
  );

  ALTER TABLE sessions ADD COLUMN IF NOT EXISTS step_up_at TIMESTAMPTZ;

  CREATE INDEX IF NOT EXISTS idx_sessions_user_active
    ON sessions (user_id, expires_at)
    WHERE revoked_at IS NULL;

  CREATE TABLE IF NOT EXISTS user_factors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL
      REFERENCES users(id) ON DELETE CASCADE,
    factor_type VARCHAR(30) NOT NULL
      CHECK (factor_type IN ('telegram', 'sms')),
    identifier VARCHAR(255) NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, factor_type, identifier)
  );

  CREATE TABLE IF NOT EXISTS auth_rate_limits (
    rate_limit_key VARCHAR(255) PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    request_count INTEGER NOT NULL DEFAULT 0
      CHECK (request_count >= 0),
    blocked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(100) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  
  CREATE INDEX IF NOT EXISTS idx_auth_audit_user_created
    ON auth_audit_logs (user_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_auth_audit_event_created
    ON auth_audit_logs (event_type, created_at DESC);

  -- Short-lived one-time codes for phone-number sign-in. Only the SHA-256 hash
  -- of the code is stored, attempts are counted, and the row is single-use.
  CREATE TABLE IF NOT EXISTS phone_otps (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    phone_number VARCHAR(32) NOT NULL,
    code_hash CHAR(64) NOT NULL
      CHECK (code_hash ~ '^[a-f0-9]{64}$'),
    attempts INTEGER NOT NULL DEFAULT 0
      CHECK (attempts >= 0),
    consumed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_phone_otps_lookup
    ON phone_otps (phone_number, created_at DESC);
`

// Create the authentication tables when they are missing.
export async function initializeAuthDatabase(db) {
  await db.query(AUTH_SCHEMA_SQL)
}
