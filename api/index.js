import { createApp } from '../server/src/app.js'
import {
  connectToDatabase,
  initializeDatabase,
} from '../server/src/config/database.js'

// Vercel serves the built frontend (client/dist) from its CDN, so the Express
// app only handles API traffic here. A rewrite sends every /api/* request to
// this single function and Vercel preserves the original request path.
const app = createApp({ serveFrontend: false })

let readyPromise = null

function ensureDatabase() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await connectToDatabase(process.env.DATABASE_URL, { max: 5 })
      await initializeDatabase()
    })().catch((error) => {
      readyPromise = null
      throw error
    })
  }

  return readyPromise
}

export default async function handler(request, response) {
  try {
    await ensureDatabase()
  } catch {
    response.status(503).json({
      message: 'The service is temporarily unavailable.',
    })
    return
  }

  return app(request, response)
}
