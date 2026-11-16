-- review proposal only; not part of the drizzle migration chain.
CREATE TABLE public.wallet_link_challenges (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_hash CHAR(64) NOT NULL REFERENCES public.sessions(token_hash) ON DELETE CASCADE,
  chain_id NUMERIC(78,0) NOT NULL REFERENCES public.chains(chain_id) ON DELETE RESTRICT,
  wallet_address CHAR(42) NOT NULL,
  action VARCHAR(10) NOT NULL,
  app_origin TEXT NOT NULL,
  nonce CHAR(66) NOT NULL UNIQUE,
  typed_data JSONB NOT NULL,
  payload_hash CHAR(66) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CONSTRAINT wallet_link_challenges_address_check
    CHECK (wallet_address ~ '^0x[0-9a-f]{40}$' AND wallet_address <> '0x0000000000000000000000000000000000000000'),
  CONSTRAINT wallet_link_challenges_session_hash_check CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT wallet_link_challenges_action_check CHECK (action IN ('LINK','UNLINK','RELINK')),
  CONSTRAINT wallet_link_challenges_origin_check CHECK (length(app_origin) BETWEEN 1 AND 512),
  CONSTRAINT wallet_link_challenges_nonce_check CHECK (nonce ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT wallet_link_challenges_hash_check CHECK (payload_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT wallet_link_challenges_expiry_check
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '2 minutes'),
  CONSTRAINT wallet_link_challenges_consumed_check
    CHECK (consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at < expires_at)),
  CONSTRAINT wallet_link_challenges_payload_check CHECK ((
    jsonb_typeof(typed_data) = 'object'
    AND typed_data->>'primaryType' = 'WalletLink'
    AND typed_data #>> '{domain,name}' = 'KhmerFP Wallet Ownership'
    AND typed_data #>> '{domain,version}' = '1'
    AND typed_data #>> '{domain,chainId}' = chain_id::text
    AND typed_data #>> '{message,challengeId}' = id::text
    AND typed_data #>> '{message,userId}' = user_id::text
    AND typed_data #>> '{message,wallet}' = wallet_address::text
    AND typed_data #>> '{message,action}' = action
    AND typed_data #>> '{message,appOrigin}' = app_origin
    AND typed_data #>> '{message,nonce}' = nonce::text
  ) IS TRUE)
);

CREATE INDEX idx_wallet_link_challenges_user_created
  ON public.wallet_link_challenges(user_id, created_at DESC);
CREATE INDEX idx_wallet_link_challenges_session
  ON public.wallet_link_challenges(session_hash);
CREATE INDEX idx_wallet_link_challenges_expiry
  ON public.wallet_link_challenges(expires_at);

CREATE FUNCTION public.protect_wallet_link_challenge() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.consumed_at IS NOT NULL OR NEW.created_at > clock_timestamp()
       OR NEW.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'invalid initial wallet challenge state' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.sessions
      WHERE token_hash = NEW.session_hash AND user_id = NEW.user_id
        AND revoked_at IS NULL AND expires_at > clock_timestamp()
        AND idle_expires_at > clock_timestamp()
    ) THEN
      RAISE EXCEPTION 'wallet challenge session does not belong to active user' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - 'consumed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'consumed_at') THEN
      RAISE EXCEPTION 'wallet challenge terms are immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
       OR NEW.consumed_at > clock_timestamp() OR NEW.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'wallet challenge may only be consumed once before expiry' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER wallet_link_challenges_protect_state
  BEFORE INSERT OR UPDATE ON public.wallet_link_challenges
  FOR EACH ROW EXECUTE FUNCTION public.protect_wallet_link_challenge();
