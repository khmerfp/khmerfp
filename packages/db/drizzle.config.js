import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.DATABASE_URL?.trim()

// drizzle-kit config for generating migrations and types
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
