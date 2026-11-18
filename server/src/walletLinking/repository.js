// save wallet links and consume challenges in one database transaction.
import { getDatabasePool } from '../config/database.js'
import { WalletLinkError, fail } from './service.js'

const publicColumns =
  'id::text, chain_id::text, wallet_address, wallet_type, custody_model, wallet_provider, ownership_verification_status, ownership_verified_at, is_primary, wallet_status'

// no schema creation here; deployment requires a separately reviewed migration.
export function createWalletLinkRepository(poolFactory = getDatabasePool) {
  return {
    async transaction(work) {
      const client = await poolFactory().connect()
      try {
        // use one connection so locks, challenge consumption and writes stay atomic.
        await client.query('BEGIN')
        await client.query("SET LOCAL statement_timeout = '5s'")
        await client.query("SET LOCAL lock_timeout = '3s'")
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'")
        const ready = await client.query(
          "SELECT to_regclass('public.wallet_link_challenges') AS challenges, to_regclass('public.user_wallets') AS wallets",
        )
        if (!ready.rows[0]?.challenges || !ready.rows[0]?.wallets) {
          fail('Wallet linking database rollout is not approved or installed.', 503)
        }
        const tx = {
          async session(actor) {
            const result = await client.query(
              `SELECT user_id::text, step_up_at FROM public.sessions
              WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL
              AND idle_expires_at > clock_timestamp() AND expires_at > clock_timestamp() FOR UPDATE`,
              [actor.sessionHash, actor.userId],
            )
            return result.rows[0]
          },
          async lock(userId, chainId, wallet) {
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
              `wallet-link-user:${userId}`,
            ])
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
              `wallet-link:${chainId}:${wallet}`,
            ])
          },
          async recentCount(userId) {
            const result = await client.query(
              "SELECT count(*)::int AS count FROM public.wallet_link_challenges WHERE user_id = $1 AND created_at > clock_timestamp() - interval '1 minute'",
              [userId],
            )
            return result.rows[0].count
          },
          async assertChain(chainId) {
            const result = await client.query(
              "SELECT chain_id FROM public.chains WHERE chain_id = $1 AND enabled = true AND environment = 'testnet'",
              [chainId],
            )
            if (!result.rowCount) {
              fail('Wallet-link test network has not been enabled by an administrator.', 503)
            }
          },
          async activeCount(userId, chainId) {
            const result = await client.query(
              "SELECT count(*)::int AS count FROM public.user_wallets WHERE user_id = $1 AND chain_id = $2 AND wallet_status <> 'REVOKED'",
              [userId, chainId],
            )
            return result.rows[0].count
          },
          async wallet(chainId, wallet) {
            const result = await client.query(
              'SELECT * FROM public.user_wallets WHERE chain_id = $1 AND wallet_address = $2 FOR UPDATE',
              [chainId, wallet],
            )
            return result.rows[0]
          },
          async list(userId) {
            const result = await client.query(
              `SELECT ${publicColumns} FROM public.user_wallets WHERE user_id = $1 ORDER BY created_at, id`,
              [userId],
            )
            return result.rows
          },
          async insertChallenge(c) {
            await client.query(
              `INSERT INTO public.wallet_link_challenges
              (id, user_id, session_hash, chain_id, wallet_address, action, app_origin, nonce, typed_data, payload_hash, expires_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
              [
                c.challengeId,
                c.userId,
                c.sessionHash,
                c.chainId,
                c.wallet,
                c.action,
                c.origin,
                c.nonce,
                JSON.stringify(c.typedData),
                c.payloadHash,
                c.expiresAt,
              ],
            )
          },
          async challenge(challengeId) {
            const result = await client.query(
              'SELECT * FROM public.wallet_link_challenges WHERE id = $1 FOR UPDATE',
              [challengeId],
            )
            return result.rows[0]
          },
          // only an unexpired, unused challenge may be consumed.
          async consume(challengeId) {
            const result = await client.query(
              `UPDATE public.wallet_link_challenges SET consumed_at = clock_timestamp()
              WHERE id = $1 AND consumed_at IS NULL AND expires_at > clock_timestamp() RETURNING id`,
              [challengeId],
            )
            if (!result.rowCount) {
              fail('Challenge expired or was already used.', 409)
            }
          },
          async save(actor, challenge, existing) {
            const params = [actor.userId, actor.sessionHash, challenge.id]
            const stepUp =
              challenge.action === 'LINK'
                ? ''
                : "AND step_up_at > clock_timestamp() - interval '5 minutes' AND step_up_at <= clock_timestamp()"
            // both guards are checked again in the statement that changes ownership state.
            const guards = `EXISTS (SELECT 1 FROM public.sessions WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL
              AND idle_expires_at > clock_timestamp() AND expires_at > clock_timestamp() ${stepUp})
              AND EXISTS (SELECT 1 FROM public.wallet_link_challenges WHERE id = $3 AND expires_at > clock_timestamp() AND consumed_at IS NOT NULL)`
            let result
            if (challenge.action === 'LINK') {
              result = await client.query(
                `INSERT INTO public.user_wallets
                (user_id, chain_id, wallet_address, wallet_type, custody_model, wallet_provider, provider_external_reference,
                 ownership_verification_status, ownership_verified_at, is_primary, wallet_status)
                SELECT $1,$4,$5,'SMART_ACCOUNT','USER_CONTROLLED','BASE_ACCOUNT_SDK',$6,'VERIFIED',clock_timestamp(),false,'ACTIVE'
                WHERE ${guards} RETURNING ${publicColumns}`,
                [
                  ...params,
                  challenge.chain_id,
                  challenge.wallet_address,
                  `${challenge.chain_id}:${challenge.wallet_address}`,
                ],
              )
            } else {
              const unlink = challenge.action === 'UNLINK'
              result = await client.query(
                `UPDATE public.user_wallets SET wallet_status = $5, is_primary = false, ownership_verification_status = 'VERIFIED',
                ownership_verified_at = clock_timestamp(), updated_at = clock_timestamp()
                WHERE id = $4 AND user_id = $1 AND ${guards} RETURNING ${publicColumns}`,
                [...params, existing.id, unlink ? 'REVOKED' : 'ACTIVE'],
              )
            }
            if (!result.rowCount) {
              fail('Session or challenge expired before linking could complete.', 401)
            }
            return result.rows[0]
          },
          async audit(userId, event, details) {
            await client.query(
              'INSERT INTO public.auth_audit_logs (user_id,event_type,details) VALUES ($1,$2,$3::jsonb)',
              [userId, event, JSON.stringify(details)],
            )
          },
        }
        const result = await work(tx)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        if (error instanceof WalletLinkError) {
          throw error
        }
        if (error.code === '23505') {
          fail('Wallet link conflicts with an existing identity.', 409)
        }
        fail('Wallet linking storage unavailable; no link was confirmed.', 503)
      } finally {
        client.release()
      }
    },
  }
}
