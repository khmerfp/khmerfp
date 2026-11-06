import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const expectedTables = [
  'auth_audit_logs',
  'auth_rate_limits',
  'phone_otps',
  'sessions',
  'transactions',
  'user_factors',
  'users',
  'wallets',
]

const baselineTag = '0000_fat_shen'
const zeroSnapshotId = '00000000-0000-0000-0000-000000000000'

function readProjectRoot() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    const scriptDir = dirname(fileURLToPath(import.meta.url))
    return resolve(scriptDir, '../../..')
  }

  if (args.length === 2 && args[0] === '--root') {
    return resolve(args[1])
  }

  throw new Error('usage: node scripts/validateBaseline.js [--root <path>]')
}

function readText(path, label, errors) {
  if (!existsSync(path)) {
    errors.push(`${label} is missing: ${path}`)
    return null
  }

  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    errors.push(`${label} could not be read: ${error.message}`)
    return null
  }
}

function readJson(path, label, errors) {
  const text = readText(path, label, errors)
  if (text === null) return null

  try {
    return JSON.parse(text)
  } catch (error) {
    errors.push(`${label} is not valid json: ${error.message}`)
    return null
  }
}

function listFiles(path, label, errors) {
  if (!existsSync(path)) {
    errors.push(`${label} directory is missing: ${path}`)
    return []
  }

  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    errors.push(`${label} directory could not be read: ${error.message}`)
    return []
  }
}

function compareList(actual, expected, label, errors) {
  const actualValue = JSON.stringify([...actual].sort())
  const expectedValue = JSON.stringify([...expected].sort())

  if (actualValue !== expectedValue) {
    errors.push(
      `${label} mismatch: expected ${expectedValue}, received ${actualValue}`,
    )
  }
}

function readDocumentValue(document, pattern, label, errors) {
  const match = document?.match(pattern)

  if (!match) {
    errors.push(`${label} is missing from the adoption document`)
    return null
  }

  return match[1]
}

function validateArtifacts(root) {
  const errors = []
  const migrationsDir = join(root, 'packages/db/migrations')
  const metaDir = join(migrationsDir, 'meta')
  const sqlPath = join(migrationsDir, `${baselineTag}.sql`)
  const snapshotPath = join(metaDir, '0000_snapshot.json')
  const journalPath = join(metaDir, '_journal.json')
  const documentPath = join(root, 'docs/database/baseline-adoption.md')

  compareList(
    listFiles(migrationsDir, 'migration', errors),
    [`${baselineTag}.sql`],
    'migration files',
    errors,
  )
  compareList(
    listFiles(metaDir, 'migration metadata', errors),
    ['0000_snapshot.json', '_journal.json'],
    'migration metadata files',
    errors,
  )

  const document = readText(documentPath, 'adoption document', errors)
  const sql = readText(sqlPath, 'baseline sql', errors)
  const journal = readJson(journalPath, 'migration journal', errors)
  const snapshot = readJson(snapshotPath, 'migration snapshot', errors)

  const expectedHash = readDocumentValue(
    document,
    /SQL SHA-256: `([a-f0-9]{64})`/,
    'expected sql hash',
    errors,
  )
  const documentedTimestamp = readDocumentValue(
    document,
    /Journal timestamp: `([0-9]+)`/,
    'documented journal timestamp',
    errors,
  )

  if (sql !== null && expectedHash !== null) {
    const actualHash = createHash('sha256').update(sql).digest('hex')
    if (actualHash !== expectedHash) {
      errors.push(
        `baseline sql hash mismatch: expected ${expectedHash}, received ${actualHash}`,
      )
    }
  }

  const entries = journal?.entries
  if (!Array.isArray(entries) || entries.length !== 1) {
    errors.push('migration journal must contain exactly one entry')
  }

  const entry = Array.isArray(entries) && entries.length === 1
    ? entries[0]
    : null

  if (entry?.idx !== 0) errors.push('baseline journal index must be 0')
  if (entry?.tag !== baselineTag) {
    errors.push(`baseline journal tag must be ${baselineTag}`)
  }
  if (!Number.isSafeInteger(entry?.when) || entry.when <= 0) {
    errors.push('baseline journal timestamp must be a positive safe integer')
  } else if (Number.isNaN(new Date(entry.when).getTime())) {
    errors.push('baseline journal timestamp is not a valid date')
  }
  if (
    documentedTimestamp !== null
    && String(entry?.when) !== documentedTimestamp
  ) {
    errors.push('journal timestamp does not match the adoption document')
  }
  if (entry?.breakpoints !== true) {
    errors.push('baseline journal entry must enable statement breakpoints')
  }

  if (journal?.dialect !== 'postgresql') {
    errors.push('migration journal dialect must be postgresql')
  }
  if (snapshot?.dialect !== 'postgresql') {
    errors.push('migration snapshot dialect must be postgresql')
  }
  if (journal?.version !== snapshot?.version) {
    errors.push('snapshot and journal versions do not match')
  }
  if (snapshot?.prevId !== zeroSnapshotId) {
    errors.push('baseline snapshot must not have a previous snapshot')
  }
  if (typeof snapshot?.id !== 'string' || snapshot.id === zeroSnapshotId) {
    errors.push('baseline snapshot id is missing or invalid')
  }

  const snapshotTables = snapshot?.tables && typeof snapshot.tables === 'object'
    ? Object.entries(snapshot.tables)
    : []
  const tableNames = snapshotTables.map(([, table]) => table?.name)
  compareList(tableNames, expectedTables, 'snapshot tables', errors)

  const expectedTableKeys = expectedTables.map((name) => `public.${name}`)
  compareList(
    snapshotTables.map(([key]) => key),
    expectedTableKeys,
    'snapshot table keys',
    errors,
  )

  if (sql !== null) {
    const sqlTables = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)]
      .map((match) => match[1])
    compareList(sqlTables, expectedTables, 'baseline sql tables', errors)
  }

  return errors
}

let root

try {
  root = readProjectRoot()
} catch (error) {
  console.error(`baseline validation failed\n- ${error.message}`)
  process.exitCode = 1
}

if (root) {
  const errors = validateArtifacts(root)

  if (errors.length > 0) {
    console.error(
      `baseline validation failed\n${errors.map((error) => `- ${error}`).join('\n')}`,
    )
    process.exitCode = 1
  } else {
    console.log('baseline artifacts are valid')
  }
}
