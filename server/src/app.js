import express from 'express'
import { isDatabaseReady } from './config/database.js'
import { paymentRouter } from './routes/paymentRoutes.js'

export function createApp({ databaseIsReady = isDatabaseReady } = {}) {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '10kb' }))

  app.get('/api/health', (_request, response) => {
    response.status(200).json({ status: 'ok' })
  })

  app.get('/api/ready', (_request, response) => {
    if (databaseIsReady()) {
      response.status(200).json({ status: 'ready' })
      return
    }

    response.status(503).json({ status: 'unavailable' })
  })

  app.use('/api/payments', paymentRouter)

  app.use((error, _request, response, _next) => {
    if (error.type === 'entity.parse.failed') {
      response.status(400).json({ message: 'Malformed JSON request body.' })
      return
    }

    if (error.type === 'entity.too.large') {
      response.status(413).json({ message: 'JSON request body is too large.' })
      return
    }

    console.error('Unexpected request failure; request details have been redacted.')
    response.status(500).json({ message: 'An unexpected server error occurred.' })
  })

  return app
}
