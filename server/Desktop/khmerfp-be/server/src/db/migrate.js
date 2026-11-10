
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import {
  connectToDatabase,
  disconnectFromDatabase,
  getDatabasePool,
} from '../config/database.js'
import { AUTH_SCHEMA_SQL } from './authSchema.js'

dotenv.config({
  path: fileURLToPath(new URL('../../.env', import.meta.url)),
})

async function migrate() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in server/.env.')
  }

  await connectToDatabase(process.env.DATABASE_URL)

  const pool = getDatabasePool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query(AUTH_SCHEMA_SQL)
    await client.query('COMMIT')
    console.log('Authentication database schema created successfully.')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

try {
  await migrate()
} catch (error) {
  console.error('Database migration failed:', error.message)
  process.exitCode = 1
} finally {
  await disconnectFromDatabase()
}
