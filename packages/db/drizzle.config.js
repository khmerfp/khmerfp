import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.DATABASE_URL?.trim()

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.js',
  out: './migrations',
  strict: true,
  verbose: true,
  ...(databaseUrl
    ? { dbCredentials: { url: databaseUrl } }
    : {}),
})
