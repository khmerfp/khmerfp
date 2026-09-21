import express from 'express'
import { isDatabaseReady } from './config/database.js'

export function createApp({ databaseIsReady = isDatabaseReady } = {}) {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json())

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

  return app
}
