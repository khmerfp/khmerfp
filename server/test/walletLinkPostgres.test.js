// test wallet-link persistence and replay protection in disposable postgres.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import express from 'express'
import { Wallet, TypedDataEncoder } from 'ethers'
import { createWalletLinkRouter } from '../src/routes/walletLinkRoutes.js'
import { createRequireAuth } from '../src/middleware/requireAuth.js'
import { hashSessionToken, readSessionToken } from '../src/services/authSessionService.js'
import { createWalletLinkRepository } from '../src/walletLinking/repository.js'
import { createWalletLinkService, WalletLinkError, verifyEmbeddedWalletControl } from '../src/walletLinking/service.js'
import {
  assertWalletLinkCatalog,
  walletLinkFingerprint,
} from '../../packages/db/scripts/walletLinkCatalog.js'

const configured = Boolean(process.env.WALLET_LINK_TEST_DATABASE_URL)
const origin = 'http://127.0.0.1:5173'
const evidence = { method: 'EIP1271', blockNumber: 10, blockHash: `0x${'cc'.repeat(32)}` }

function inspectDisposableContainer(connectionString) {
  const inspected = spawnSync('docker', ['inspect', 'khmerfp-wallet-link-pg16'], {
    encoding: 'utf8',
    timeout: 10000,
  })
  assert.equal(inspected.status, 0, 'cannot verify the disposable container')
  const metadata = JSON.parse(inspected.stdout)[0]
  const binding = metadata.NetworkSettings.Ports['5432/tcp']
  assert.equal(metadata.Config.Image, 'postgres:16')
  assert.equal(metadata.Config.Labels['khmerfp.disposable'], 'wallet-link')
  assert.ok(metadata.Config.Env.includes('POSTGRES_DB=khmerfp_wallet_link_test'))
  assert.equal(metadata.Mounts.length, 1, 'only an anonymous database volume is allowed')
  assert.equal(metadata.Mounts[0].Type, 'volume')
  assert.match(metadata.Mounts[0].Name, /^[a-f0-9]{64}$/)
  assert.equal(metadata.Mounts[0].Destination, '/var/lib/postgresql/data')
  assert.equal(binding.length, 1)
  assert.equal(binding[0].HostIp, '127.0.0.1')
  assert.equal(binding[0].HostPort, new URL(connectionString).port)
  assert.match(metadata.Id, /^[a-f0-9]{64}$/)
  return metadata.Id
}

export function assertWalletLinkTestTarget(env) {
  if (
    !['development', 'test'].includes(env.NODE_ENV) ||
    env.WALLET_LINK_TEST_DISPOSABLE !== 'true'
  ) {
    throw new Error('Explicit test environment and disposable database opt-in required.')
  }
  let url
  try {
    url = new URL(env.WALLET_LINK_TEST_DATABASE_URL)
  } catch {
    throw new Error('A dedicated wallet-link test database URL is required.')
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/khmerfp_wallet_link_test' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Only the dedicated loopback wallet-link test database is allowed.')
  }
  return url.href
}

test('wallet-link PostgreSQL target refuses hosted, application and ambiguous databases', () => {
  const env = {
    NODE_ENV: 'test',
    WALLET_LINK_TEST_DISPOSABLE: 'true',
    WALLET_LINK_TEST_DATABASE_URL: 'postgresql://test:local@127.0.0.1/khmerfp_wallet_link_test',
  }
  assert.ok(assertWalletLinkTestTarget(env))
  for (const patch of [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'staging' },
    { WALLET_LINK_TEST_DISPOSABLE: 'false' },
    {
      WALLET_LINK_TEST_DATABASE_URL: 'postgresql://test:local@example.com/khmerfp_wallet_link_test',
    },
    { WALLET_LINK_TEST_DATABASE_URL: 'postgresql://test:local@localhost/khmerfp' },
    { WALLET_LINK_TEST_DATABASE_URL: `${env.WALLET_LINK_TEST_DATABASE_URL}?options=anything` },
  ])
    assert.throws(() => assertWalletLinkTestTarget({ ...env, ...patch }))
})

// this suite never loads .env, application startup, or a default database url.
test(
  'wallet-link persistence on an empty disposable PostgreSQL 16 database',
  {
    skip: configured ? false : 'WALLET_LINK_TEST_DATABASE_URL is not configured',
    timeout: 90000,
  },
  async (t) => {
    const connectionString = assertWalletLinkTestTarget(process.env)
    // verify the labelled container before applying migration or fixture SQL.
    const restartContainer =
      process.env.WALLET_LINK_TEST_RESTART_CONTAINER === 'khmerfp-wallet-link-pg16'
        ? inspectDisposableContainer(connectionString)
        : null
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    const createPool = () =>
      new pg.Pool({
        connectionString,
        max: 6,
        connectionTimeoutMillis: 3000,
        statement_timeout: 5000,
        lock_timeout: 3000,
        options: '-c search_path=public',
      })
    let pool = createPool()
    try {
      const state = (
        await pool.query(`SELECT current_database() AS name,
      current_setting('server_version_num')::int AS version, current_schemas(false)::text[] AS schemas`)
      ).rows[0]
      assert.equal(state.name, 'khmerfp_wallet_link_test')
      assert.equal(Math.floor(state.version / 10000), 16)
      assert.deepEqual(state.schemas, ['public'])
      const objects =
        await pool.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      AND c.relkind IN ('r','p','v','m','S','f')`)
      assert.equal(objects.rowCount, 0, 'test database must be empty; never reuse the app database')
      const routines =
        await pool.query(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'`)
      assert.equal(routines.rowCount, 0, 'test database must contain no user routines')
      const validator = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('../../packages/db/scripts/validateBaseline.js', import.meta.url))],
        { encoding: 'utf8', timeout: 15000 },
      )
      assert.equal(validator.status, 0, 'immutable migration artifact validation must pass')
      const migrationsFolder = fileURLToPath(
        new URL('../../packages/db/migrations', import.meta.url),
      )
      await migrate(drizzle(pool), { migrationsFolder })
      assert.equal(
        (await pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'))
          .rows[0].count,
        19,
      )
      await assertWalletLinkCatalog(pool)
      const journal = JSON.parse(
        readFileSync(
          new URL('../../packages/db/migrations/meta/_journal.json', import.meta.url),
          'utf8',
        ),
      )
      const history = (
        await pool.query(
          'SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id',
        )
      ).rows
      const { createHash } = await import('node:crypto')
      assert.deepEqual(
        history,
        journal.entries.map((entry) => ({
          hash: createHash('sha256')
            .update(
              readFileSync(
                new URL(`../../packages/db/migrations/${entry.tag}.sql`, import.meta.url),
                'utf8',
              ),
            )
            .digest('hex'),
          created_at: String(entry.when),
        })),
      )
      const fingerprint = await walletLinkFingerprint(pool)
      await migrate(drizzle(pool), { migrationsFolder })
      assert.equal(await walletLinkFingerprint(pool), fingerprint)
      assert.deepEqual(
        (
          await pool.query(
            'SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id',
          )
        ).rows,
        history,
      )
      await pool.query(`INSERT INTO public.chains(chain_id,name,environment,native_symbol,enabled)
      VALUES (84532,'Base Sepolia wallet-link fixture','testnet','ETH',true)`)

      let counter = 0
      const address = () => `0x${(++counter).toString(16).padStart(40, '0')}`
      async function actor() {
        const tag = ++counter
        const user = (
          await pool.query(
            `INSERT INTO public.users(email,display_name)
        VALUES ($1,'wallet-link test') RETURNING id::text`,
            [`wallet-link-${tag}@example.test`],
          )
        ).rows[0]
        const sessionHash = tag.toString(16).padStart(64, '0')
        await pool.query(
          `INSERT INTO public.sessions(token_hash,user_id,idle_expires_at,expires_at)
        VALUES ($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours')`,
          [sessionHash, user.id],
        )
        return { userId: user.id, sessionHash }
      }
      function service(
        verifyControl = async () => evidence,
        now = Date.now,
        repository = createWalletLinkRepository(() => pool),
      ) {
        return createWalletLinkService({
          repository,
          config: { origin, chainId: 84532 },
          verifyControl,
          now,
        })
      }
      const issue = (svc, who, walletAddress, action = 'LINK') =>
        svc.issue(who, { walletAddress, chainId: 84532, action })
      const verify = (svc, who, challenge) =>
        svc.verify(who, { challengeId: challenge.challengeId, signature: '0x1234' })
      const rejects = (promise, status) =>
        assert.rejects(promise, (error) => error.status === status)

      await t.test(
        'success persists ownership, consumption and audit without permissions',
        async () => {
          const who = await actor(),
            wallet = address(),
            svc = service()
          const challenge = await issue(svc, who, wallet)
          const linked = await verify(svc, who, challenge)
          assert.equal(linked.wallet.wallet_address, wallet)
          assert.equal(linked.wallet.wallet_status, 'ACTIVE')
          assert.equal(linked.wallet.ownership_verification_status, 'VERIFIED')
          assert.equal(linked.grantsTradingPermission, false)
          assert.ok(
            (
              await pool.query(
                'SELECT consumed_at FROM public.wallet_link_challenges WHERE id=$1',
                [challenge.challengeId],
              )
            ).rows[0].consumed_at,
          )
          assert.equal(
            (await pool.query('SELECT count(*)::int AS count FROM public.wallet_authorizations'))
              .rows[0].count,
            0,
          )
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS count FROM public.auth_audit_logs WHERE user_id=$1 AND event_type='wallet_ownership_changed'",
                [who.userId],
              )
            ).rows[0].count,
            1,
          )
          await rejects(verify(service(), who, challenge), 409)
          await rejects(issue(svc, who, wallet), 409)
        },
      )
      await t.test(
        'expired challenge, expired session and switched account are rejected',
        async () => {
          const who = await actor(),
            other = await actor(),
            svc = service()
          const challenge = await issue(svc, who, address())
          await rejects(verify(svc, other, challenge), 401)
          await rejects(
            verify(
              service(undefined, () => Date.now() + 130000),
              who,
              challenge,
            ),
            410,
          )
          await pool.query(
            "UPDATE public.sessions SET idle_expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",
            [who.sessionHash],
          )
          await rejects(verify(svc, who, challenge), 401)
        },
      )
      await t.test(
        'concurrent verification has one winner across repository instances',
        async () => {
          const who = await actor(),
            svc = service(),
            challenge = await issue(svc, who, address())
          const results = await Promise.allSettled([
            verify(svc, who, challenge),
            verify(service(), who, challenge),
          ])
          assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
          assert.equal(results.find((result) => result.status === 'rejected').reason.status, 409)
        },
      )
      await t.test(
        'two users cannot claim the same wallet, including concurrent attempts',
        async () => {
          const first = await actor(),
            second = await actor(),
            wallet = address(),
            svc = service()
          const a = await issue(svc, first, wallet),
            b = await issue(service(), second, wallet)
          const results = await Promise.allSettled([
            verify(svc, first, a),
            verify(service(), second, b),
          ])
          assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
          assert.equal(results.find((result) => result.status === 'rejected').reason.status, 409)
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS count FROM public.user_wallets WHERE chain_id=84532 AND wallet_address=$1',
                [wallet],
              )
            ).rows[0].count,
            1,
          )
          const third = await actor()
          await assert.rejects(
            pool.query(
              `INSERT INTO public.user_wallets
        (user_id,chain_id,wallet_address,wallet_type,custody_model,ownership_verification_status,ownership_verified_at,wallet_status)
        VALUES ($1,84532,$2,'SMART_ACCOUNT','USER_CONTROLLED','VERIFIED',clock_timestamp(),'ACTIVE')`,
              [third.userId, wallet],
            ),
            (error) =>
              error.code === '23505' && error.constraint === 'user_wallets_chain_address_key',
          )
        },
      )
      await t.test('unlink and relink require fresh step-up and fresh proofs', async () => {
        const who = await actor(),
          svc = service(),
          wallet = address()
        await verify(svc, who, await issue(svc, who, wallet))
        await rejects(issue(svc, who, wallet, 'UNLINK'), 403)
        await pool.query(
          'UPDATE public.sessions SET step_up_at=clock_timestamp() WHERE token_hash=$1',
          [who.sessionHash],
        )
        const unlink = await issue(svc, who, wallet, 'UNLINK')
        assert.equal((await verify(svc, who, unlink)).wallet.wallet_status, 'REVOKED')
        await rejects(verify(svc, who, unlink), 409)
        assert.equal(
          (await verify(svc, who, await issue(svc, who, wallet, 'RELINK'))).wallet.wallet_status,
          'ACTIVE',
        )
        const other = await actor()
        await pool.query(
          'UPDATE public.sessions SET step_up_at=clock_timestamp() WHERE token_hash=$1',
          [other.sessionHash],
        )
        await rejects(issue(svc, other, wallet, 'RELINK'), 409)
      })
      await t.test(
        'invalid signature consumes its attempt, but a database failure rolls back all writes',
        async () => {
          const who = await actor(),
            svc = service(),
            wallet = address()
          const bad = await issue(svc, who, wallet)
          await rejects(
            verify(
              service(async () => {
                throw new WalletLinkError('Invalid signature', 401)
              }),
              who,
              bad,
            ),
            401,
          )
          await rejects(verify(svc, who, bad), 409)
          const challenge = await issue(svc, who, wallet)
          const repository = createWalletLinkRepository(() => pool)
          const failing = {
            transaction: (work) =>
              repository.transaction((tx) =>
                work({
                  ...tx,
                  audit: async () => {
                    throw new Error('injected audit storage failure')
                  },
                }),
              ),
          }
          await rejects(verify(service(undefined, Date.now, failing), who, challenge), 503)
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS count FROM public.user_wallets WHERE user_id=$1',
                [who.userId],
              )
            ).rows[0].count,
            0,
          )
          assert.equal(
            (
              await pool.query(
                'SELECT consumed_at FROM public.wallet_link_challenges WHERE id=$1',
                [challenge.challengeId],
              )
            ).rows[0].consumed_at,
            null,
          )
          await verify(svc, who, challenge)
        },
      )
      await t.test('session expiring during RPC cannot produce an ownership link', async () => {
        const who = await actor(),
          svc = service(),
          wallet = address()
        const challenge = await issue(svc, who, wallet)
        await pool.query(
          "UPDATE public.sessions SET idle_expires_at=clock_timestamp()+interval '1 second' WHERE token_hash=$1",
          [who.sessionHash],
        )
        const delayed = service(async () => {
          await new Promise((resolve) => setTimeout(resolve, 1200))
          return evidence
        })
        await rejects(verify(delayed, who, challenge), 401)
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM public.user_wallets WHERE user_id=$1',
              [who.userId],
            )
          ).rows[0].count,
          0,
        )
      })
      await t.test('revoked sessions cannot consume or link a pending challenge', async () => {
        const who = await actor()
        const svc = service()
        const challenge = await issue(svc, who, address())
        await pool.query(
          'UPDATE public.sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',
          [who.sessionHash],
        )
        await rejects(verify(svc, who, challenge), 401)
        assert.equal(
          (
            await pool.query('SELECT consumed_at FROM public.wallet_link_challenges WHERE id=$1', [
              challenge.challengeId,
            ])
          ).rows[0].consumed_at,
          null,
        )
      })
      await t.test(
        'database protects challenge identity, session binding and one-way consumption',
        async () => {
          const who = await actor(),
            svc = service(),
            challenge = await issue(svc, who, address())
          await assert.rejects(
            pool.query("UPDATE public.wallet_link_challenges SET action='UNLINK' WHERE id=$1", [
              challenge.challengeId,
            ]),
            (error) => error.code === '23514',
          )
          await verify(svc, who, challenge)
          await assert.rejects(
            pool.query('UPDATE public.wallet_link_challenges SET consumed_at=NULL WHERE id=$1', [
              challenge.challengeId,
            ]),
            (error) => error.code === '23514',
          )
          const other = await actor()
          await assert.rejects(
            pool.query(
              `INSERT INTO public.wallet_link_challenges
        SELECT gen_random_uuid(),$1,session_hash,chain_id,wallet_address,action,app_origin,nonce,typed_data,payload_hash,created_at,expires_at,NULL
        FROM public.wallet_link_challenges WHERE id=$2`,
              [other.userId, challenge.challengeId],
            ),
            (error) => error.code === '23514',
          )
        },
      )
      assert.equal(
        (await pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'))
          .rows[0].count,
        19,
      )
      await t.test('embedded EOA proofs persist the correct type without smart-account or trading permissions', async () => {
        const who = await actor(), stranger = await actor(), signer = Wallet.createRandom()
        const svc = createWalletLinkService({ repository: createWalletLinkRepository(() => pool),
          config: { origin, chainId: 84532, embeddedEoa: true },
          verifyControl: input => verifyEmbeddedWalletControl(input, { rpcFactory: () => ({
            getNetwork: async () => ({ chainId: 84532n }), getCode: async () => '0x',
            getBlock: async () => ({ number: 10, hash: evidence.blockHash }), destroy() {},
          }) }),
        })
        const issue = (action = 'LINK') => svc.issue(who, { walletAddress: signer.address, chainId: 84532, action })
        const proof = challenge => ({ challengeId: challenge.challengeId,
          signature: signer.signingKey.sign(hashChallenge(challenge)).serialized })
        function hashChallenge(challenge) {
          return TypedDataEncoder.hash(challenge.typedData.domain, challenge.typedData.types, challenge.typedData.message)
        }
        const first = await issue(), signed = proof(first)
        const attempts = await Promise.allSettled([svc.verify(who, signed), svc.verify(who, signed)])
        assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1)
        const result = attempts.find(x => x.status === 'fulfilled').value
        assert.equal(result.wallet.wallet_type, 'EOA')
        assert.equal(result.wallet.wallet_provider, 'EIP712_EOA')
        assert.equal(result.grantsTradingPermission, false)
        await assert.rejects(svc.issue(stranger, { walletAddress: signer.address, chainId: 84532, action: 'LINK' }), e => e.status === 409)
        const otherSigner = Wallet.createRandom()
        const otherChallenge = await svc.issue(stranger, { walletAddress: otherSigner.address, chainId: 84532, action: 'LINK' })
        const otherLink = await svc.verify(stranger, { challengeId: otherChallenge.challengeId,
          signature: otherSigner.signingKey.sign(hashChallenge(otherChallenge)).serialized })
        assert.equal(otherLink.wallet.wallet_type, 'EOA')
        assert.notEqual(otherLink.wallet.wallet_address, result.wallet.wallet_address)
        assert.notEqual(otherLink.wallet.id, result.wallet.id)
        await assert.rejects(issue('UNLINK'), e => e.status === 403)
        await pool.query('UPDATE sessions SET step_up_at=clock_timestamp() WHERE token_hash=$1', [who.sessionHash])
        assert.equal((await svc.verify(who, proof(await issue('UNLINK')))).wallet.wallet_status, 'REVOKED')
        assert.equal((await svc.verify(who, proof(await issue('RELINK')))).wallet.wallet_status, 'ACTIVE')
      })
      await t.test('HTTP routes and PostgreSQL preserve session-bound ownership across actions', async () => {
        const who = await actor(), other = await actor(), wallet = address()
        const token = 'isolated-http-wallet-link-session'
        const otherToken = 'isolated-http-other-session'
        for (const [principal, cookie] of [[who, token], [other, otherToken]]) {
          await pool.query('UPDATE public.sessions SET token_hash=$1 WHERE token_hash=$2',
            [hashSessionToken(cookie), principal.sessionHash])
          principal.sessionHash = hashSessionToken(cookie)
        }
        let timeOffset = 0
        // test-only evidence injection; the real router, service and repository are unchanged.
        const svc = service(async ({ signature }) => {
          if (signature !== '0x1234') throw new WalletLinkError('Test wallet signature rejected.', 401)
          return evidence
        }, () => Date.now() + timeOffset)
        const previousOrigin = process.env.WALLET_LINK_APP_ORIGIN
        process.env.WALLET_LINK_APP_ORIGIN = origin
        const app = express()
        app.use(express.json())
        app.use('/api/wallet-links', createWalletLinkRouter({
          enabled: () => true,
          service: svc,
          authGuard: createRequireAuth(async req => {
            const cookie = readSessionToken(req)
            if (!cookie) return null
            return (await pool.query(`SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id
              WHERE s.token_hash=$1 AND s.revoked_at IS NULL
              AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()`,
              [hashSessionToken(cookie)])).rows[0] || null
          }),
        }))
        const http = app.listen(0, '127.0.0.1')
        await new Promise(resolve => http.once('listening', resolve))
        const base = `http://127.0.0.1:${http.address().port}/api/wallet-links`
        const request = async (path, body, cookie = token) => {
          const res = await fetch(base + path, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { Origin: origin, 'Content-Type': 'application/json',
              ...(cookie ? { Cookie: `angkor_session=${cookie}` } : {}) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(10000),
          })
          return { status: res.status, data: await res.json() }
        }
        const challenge = async (action = 'LINK', target = wallet) => {
          const res = await request('/challenges', { walletAddress: target, chainId: 84532, action })
          assert.equal(res.status, 201)
          return { challengeId: res.data.challengeId, signature: '0x1234' }
        }
        try {
          assert.equal((await request('', undefined, null)).status, 401)
          assert.equal((await request('/challenges', { walletAddress: wallet, chainId: 8453, action: 'LINK' })).status, 400)
          const first = await challenge()
          const attempts = await Promise.all([request('/verify', first), request('/verify', first)])
          assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409])
          assert.equal(attempts.find(r => r.status === 200).data.grantsTradingPermission, false)
          const listed = await request('')
          assert.equal(listed.data.userId, String(who.userId))
          assert.equal(listed.data.wallets.find(w => w.wallet_address === wallet).wallet_status, 'ACTIVE')
          assert.equal((await request('/verify', first, otherToken)).status, 401)
          assert.equal((await request('/challenges', { walletAddress: wallet, chainId: 84532, action: 'UNLINK' })).status, 403)
          await pool.query('UPDATE sessions SET step_up_at=clock_timestamp() WHERE token_hash=$1', [who.sessionHash])
          assert.equal((await request('/verify', await challenge('UNLINK'))).data.wallet.wallet_status, 'REVOKED')
          assert.equal((await request('/verify', await challenge('RELINK'))).data.wallet.wallet_status, 'ACTIVE')
          const invalid = await challenge('LINK', address())
          assert.equal((await request('/verify', { ...invalid, signature: '0xdead' })).status, 401)
          assert.equal((await request('/verify', invalid)).status, 409)
          const expired = await challenge('LINK', address())
          timeOffset = 121000
          assert.equal((await request('/verify', expired)).status, 410)
          timeOffset = 0
          assert.equal((await request('/challenges', { walletAddress: address(), chainId: 84532, action: 'LINK' })).status, 429)
          const pending = await request('/challenges', { walletAddress: address(), chainId: 84532, action: 'LINK' }, otherToken)
          assert.equal(pending.status, 201)
          await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1', [other.sessionHash])
          assert.equal((await request('/verify', { challengeId: pending.data.challengeId, signature: '0x1234' }, otherToken)).status, 401)
          assert.equal((await pool.query('SELECT count(*)::int AS count FROM wallet_authorizations')).rows[0].count, 0)
        } finally {
          await new Promise(resolve => http.close(resolve))
          if (previousOrigin === undefined) delete process.env.WALLET_LINK_APP_ORIGIN
          else process.env.WALLET_LINK_APP_ORIGIN = previousOrigin
        }
      })
      await t.test(
        'database restart preserves consumed and pending challenges',
        {
          skip:
            process.env.WALLET_LINK_TEST_RESTART_CONTAINER === 'khmerfp-wallet-link-pg16'
              ? false
              : 'explicit disposable container restart opt-in not configured',
        },
        async () => {
          assert.equal(inspectDisposableContainer(connectionString), restartContainer)
          const who = await actor()
          const used = await issue(service(), who, address())
          await verify(service(), who, used)
          const pending = await issue(service(), who, address())
          const before = (
            await pool.query(
              'SELECT id,consumed_at FROM public.wallet_link_challenges WHERE user_id=$1 ORDER BY id',
              [who.userId],
            )
          ).rows
          await pool.end()
          const restarted = spawnSync('docker', ['restart', restartContainer], {
            encoding: 'utf8',
            timeout: 20000,
          })
          pool = createPool()
          assert.equal(restarted.status, 0, 'disposable container restart failed')
          const deadline = Date.now() + 20000
          while (true) {
            try {
              await pool.query('SELECT 1')
              break
            } catch {
              if (Date.now() >= deadline)
                throw new Error('Disposable PostgreSQL did not recover in time.')
              await new Promise((resolve) => setTimeout(resolve, 500))
            }
          }
          const after = (
            await pool.query(
              'SELECT id,consumed_at FROM public.wallet_link_challenges WHERE user_id=$1 ORDER BY id',
              [who.userId],
            )
          ).rows
          assert.deepEqual(after, before)
          await rejects(verify(service(), who, used), 409)
          await verify(service(), who, pending)
        },
      )
    } finally {
      await pool.end()
    }
  },
)
