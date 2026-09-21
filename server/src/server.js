import dotenv from 'dotenv'
import { createApp } from './app.js'

dotenv.config({ quiet: true })

const DEFAULT_PORT = 3000
const rawPort = process.env.PORT ?? String(DEFAULT_PORT)
const port = Number(rawPort)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Server startup failed: PORT must be an integer from 1 to 65535; received "${rawPort}".`)
  process.exitCode = 1
} else {
  const app = createApp()
  const server = app.listen(port, () => {
    console.log(`API server listening on http://localhost:${port}`)
  })

  server.on('error', (error) => {
    console.error('Server startup failed:', error.message)
    process.exitCode = 1
  })
}
