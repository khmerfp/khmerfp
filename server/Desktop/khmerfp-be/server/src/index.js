import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'

// Local development may use server/.env; Vercel supplies env vars directly.
dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
  quiet: true,
})

const app = createApp()

export default app
