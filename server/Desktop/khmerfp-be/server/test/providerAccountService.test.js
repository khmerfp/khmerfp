import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveProviderUser } from '../src/services/providerAccountService.js'

const request = { ip: '127.0.0.1', get: () => 'test-agent' }

// A fake PostgreSQL client that answers only the statements the resolver
// issues, so the linking rules can be checked without a database.
function createFakeClient({ existingUserId = null, emailOwnerId = null }) {
  const statements = []

  const client = {
    statements,
    async query(text, values) {
      statements.push({ text: text.replace(/\s+/g, ' ').trim(), values })

      if (text.includes('SELECT id FROM users WHERE email =')) {
        return emailOwnerId === null
          ? { rowCount: 0, rows: [] }
          : { rowCount: 1, rows: [{ id: emailOwnerId }] }
      }

      if (text.includes('SELECT id FROM users WHERE google_sub =')) {
        return existingUserId === null
          ? { rowCount: 0, rows: [] }
          : { rowCount: 1, rows: [{ id: existingUserId }] }
      }

      if (text.startsWith('UPDATE users')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: existingUserId,
              email: values[1],
              display_name: values[2],
              avatar_url: values[3],
              language: values[4],
            },
          ],
        }
      }

      if (text.startsWith('INSERT INTO users')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: '99',
              email: values[1],
              display_name: values[2],
              avatar_url: values[3],
              language: values[4],
            },
          ],
        }
      }

      return { rowCount: 0, rows: [] }
    },
  }

  return client
}

const provider = {
  column: 'google_sub',
  identifier: 'google-123',
  email: 'person@example.com',
  request,
}

test('a new provider identity creates a new account when the email is free', async () => {
  const client = createFakeClient({})
  const { user } = await resolveProviderUser(client, provider)

  assert.equal(user.email, 'person@example.com')
  assert.equal(
    client.statements.some((statement) =>
      statement.text.startsWith('INSERT INTO users'),
    ),
    true,
  )
})

test('a known provider identity reuses its own account', async () => {
  const client = createFakeClient({
    existingUserId: '7',
    emailOwnerId: '7',
  })
  const { user } = await resolveProviderUser(client, provider)

  assert.equal(user.id, '7')
  assert.equal(
    client.statements.some((statement) => statement.text.startsWith('UPDATE users')),
    true,
  )
  assert.equal(
    client.statements.some((statement) =>
      statement.text.startsWith('INSERT INTO users'),
    ),
    false,
  )
})

test('a provider identity never takes over an email owned by another account', async () => {
  const client = createFakeClient({
    existingUserId: '7',
    emailOwnerId: '9',
  })

  await assert.rejects(
    () => resolveProviderUser(client, provider),
    /already exists and is not linked/,
  )
  assert.equal(
    client.statements.some((statement) => statement.text.startsWith('UPDATE users')),
    false,
  )
})

test('a new provider identity never takes over an email owned by another account', async () => {
  const client = createFakeClient({ emailOwnerId: '9' })

  await assert.rejects(
    () => resolveProviderUser(client, provider),
    /already exists and is not linked/,
  )
  assert.equal(
    client.statements.some((statement) =>
      statement.text.startsWith('INSERT INTO users'),
    ),
    false,
  )
})
