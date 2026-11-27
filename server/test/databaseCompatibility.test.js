import assert from 'node:assert/strict'
import test from 'node:test'

import { readCanonicalMigrationManifest } from '../../packages/db/src/migrationManifest.js'
import {
  DatabaseCompatibilityError,
  verifyDatabaseCompatibility,
} from '../src/db/schemaCompatibility.js'

function fakePool({ corruptHistory = false } = {}) {
  const statements = []
  const manifest = readCanonicalMigrationManifest()
  const client = {
    async query(text) {
      const sql = typeof text === 'string' ? text : text.text
      statements.push(sql.trim())
      if (sql.includes("to_regclass('drizzle.__drizzle_migrations')")) {
        return { rows: [{ name: 'drizzle.__drizzle_migrations' }], rowCount: 1 }
      }
      if (sql.includes('FROM drizzle.__drizzle_migrations')) {
        return {
          rows: manifest.map((migration, index) => ({
            hash: corruptHistory && index === 0 ? 'corrupt' : migration.hash,
            created_at: migration.createdAt,
          })),
          rowCount: manifest.length,
        }
      }
      if (sql.includes("to_regclass('public.users')")) {
        return {
          rows: [{
            users: true,
            sessions: true,
            bakong: true,
            wallet_links: true,
            payment_lease: true,
            wallet_link_constraint: true,
          }],
          rowCount: 1,
        }
      }
      if (sql.includes('FROM pg_roles r')) {
        return {
          rows: [{
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolreplication: false,
            rolbypassrls: false,
            database_create: false,
            public_create: false,
            api_create: false,
          }],
          rowCount: 1,
        }
      }
      if (sql.includes("pg_has_role(current_user, role_name, 'MEMBER')")) {
        return { rows: [], rowCount: 0 }
      }
      if (sql.includes('has_table_privilege') || sql.includes('has_sequence_privilege')) {
        return { rows: [{ allowed: true }], rowCount: 1 }
      }
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) return { rows: [], rowCount: 0 }
      throw new Error(`Unexpected compatibility query: ${sql}`)
    },
    release() {},
  }
  return {
    statements,
    pool: { connect: async () => client },
  }
}

test('runtime compatibility verification is read-only', async () => {
  const fixture = fakePool()
  await verifyDatabaseCompatibility(fixture.pool, { mode: 'http' })

  for (const statement of fixture.statements) {
    assert.match(statement, /^(BEGIN|SELECT|COMMIT|ROLLBACK)\b/i)
  }
  assert.equal(fixture.statements[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(fixture.statements.at(-1), 'COMMIT')
})

test('runtime rejects corrupt canonical migration history', async () => {
  const fixture = fakePool({ corruptHistory: true })
  await assert.rejects(
    verifyDatabaseCompatibility(fixture.pool, { mode: 'http' }),
    DatabaseCompatibilityError,
  )
  assert.equal(fixture.statements.at(-1), 'ROLLBACK')
})
