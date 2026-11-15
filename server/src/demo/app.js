import express from 'express'
import { randomBytes } from 'node:crypto'
import { getAddress, hashMessage, verifyMessage } from 'ethers'
import { createRequireAuth } from '../middleware/requireAuth.js'
import { createFixedWindowRateLimiter, preventStatusCaching } from '../middleware/statusRateLimit.js'
import { createSessionCookie, readSessionToken } from '../services/authSessionService.js'
import { reject, validSignature } from './orderService.js'

export function createDemoApp(service) {
  if (process.env.NODE_ENV !== 'development' || process.env.LOCAL_DEMO_ENABLED !== 'true') reject('Local demo disabled.', 503)
  const app = express()
  app.disable('x-powered-by')
  const challenges = new Map(), sessions = new Map()
  app.use(preventStatusCaching)
  app.use((req, res, next) => {
    if (!['127.0.0.1', 'localhost'].includes(req.hostname)) return res.status(403).json({ message: 'Local host required.' })
    // browser requests must come from the local Vite UI; no wildcard CORS or proxy trust.
    const origin = req.headers.origin
    if (origin && !['http://localhost:5173', 'http://127.0.0.1:5173'].includes(origin)) return res.status(403).json({ message: 'Origin not allowed.' })
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin)
      res.set('Access-Control-Allow-Credentials', 'true')
      res.set('Access-Control-Allow-Headers', 'Content-Type')
      res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      res.vary('Origin')
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })
  app.use(createFixedWindowRateLimiter({ limit: 60, windowMs: 60000, message: 'Too many demo requests.' }))
  app.use(express.json({ limit: '24kb' }))
  const sessionToken = req => {
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('khmerfp_demo_session='))
    return readSessionToken({ headers: { cookie: cookie?.replace(/^khmerfp_demo_session=/, 'angkor_session=') || '' } })
  }
  app.post('/api/demo/auth/logout', (req, res) => {
    sessions.delete(sessionToken(req))
    res.set('Set-Cookie', 'khmerfp_demo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
    res.json({ demoOnly: true })
  })
  app.use(async (_req, _res, next) => { try { await service.verifyEnvironment(); next() } catch { next(Object.assign(new Error('Local chain verification failed.'), { status: 503 })) } })
  app.get('/api/demo/config', (_req, res) => res.json({ ...service.config, domain: service.domain }))

  app.post('/api/demo/auth/challenge', (req, res) => {
    const wallet = getAddress(req.body.wallet)
    if (challenges.size > 1000) challenges.clear()
    const nonce = randomBytes(32).toString('hex')
    const expires = Date.now() + 60000
    const message = `KhmerFP local demo login\nChain: 31337\nExchange: ${service.config.addresses.exchange}\nWallet: ${wallet}\nNonce: ${nonce}\nExpires: ${expires}`
    challenges.set(nonce, { wallet, message, expires })
    res.json({ nonce, message })
  })
  app.post('/api/demo/auth/verify', async (req, res) => {
    const challenge = challenges.get(req.body.nonce)
    challenges.delete(req.body.nonce)
    if (!challenge || challenge.expires < Date.now() || !await validSignature(service.provider, challenge.wallet, hashMessage(challenge.message), req.body.signature, () => verifyMessage(challenge.message, req.body.signature))) reject('Invalid login proof.', 401)
    if (sessions.size >= 1000) sessions.clear()
    const token = randomBytes(32).toString('base64url')
    sessions.set(token, { demoWallet: challenge.wallet, id: `local:${challenge.wallet}`, expires: Date.now() + 30 * 60000 })
    // cookies are shared across localhost ports; do not replace the normal app session.
    res.set('Set-Cookie', createSessionCookie(token).replace(/^angkor_session=/, 'khmerfp_demo_session='))
    res.json({ wallet: challenge.wallet, demoOnly: true })
  })
  app.use('/api/demo', createRequireAuth(async req => {
    const demoCookie = (req.headers.cookie || '').split(';').map(part => part.trim())
      .find(part => part.startsWith('khmerfp_demo_session='))
    const token = readSessionToken({ headers: { cookie: demoCookie?.replace(/^khmerfp_demo_session=/, 'angkor_session=') || '' } })
    const session = sessions.get(token)
    return session && session.expires > Date.now() ? session : null
  }))
  app.get('/api/demo/market', (_req, res) => res.json({ ...service.config, domain: service.domain }))
  app.post('/api/demo/orders', async (req, res) => res.status(201).json(await service.submit(req.authUser, req.body)))
  app.get('/api/demo/orders', async (req, res) => res.json(await service.list(req.authUser)))
  app.get('/api/demo/operator/orders', async (req, res) => res.json(await service.operatorOrders(req.authUser)))
  app.post('/api/demo/matches', async (req, res) => res.json(await service.match(req.authUser, req.body)))
  app.get('/api/demo/settlements', async (req, res) => res.json(await service.settlements(req.authUser)))
  app.use((error, _req, res, _next) => {
    const status = error.status || (error.type || error.code === 'INVALID_ARGUMENT' ? 400 : 503)
    res.status(status).json({ message: error.status ? error.message : 'Invalid request or local blockchain unavailable.' })
  })
  return app
}
