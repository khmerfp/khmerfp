import { createHash } from 'node:crypto'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
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
const zeroSnapshotId = '00000000-0000-0000-0000-000000000000'
const migrations = [
  {
    idx: 0,
    tag: '0000_fat_shen',
    when: 1793950642587,
    version: '7',
    sqlHash: '7a22414a2cf43ed3755b0ca8545f8b929c0a740ebb8a23fe8016955b8e4b925d',
    snapshotFile: '0000_snapshot.json',
    snapshotHash: '645738388bcd6c87c761b1f6300df9178cd6d0581585b9436a4e76fe197e8104',
    snapshotId: '916dc4d4-e1be-4b61-82c4-2e440a5d20de',
    previousSnapshotId: zeroSnapshotId,
  },
  {
    idx: 1,
    tag: '0001_powerful_katie_power',
    when: 1793965848946,
    version: '7',
    sqlHash: 'bd0e3bac41d48f696fecaa1793c807182f163977859265e7ea0886b973ced5ab',
    snapshotFile: '0001_snapshot.json',
    snapshotHash: '981f647b0331e67bafc1d7e23f5b6f57aaa1dfd737b4fe2c5b93d03295d3d3ee',
    snapshotId: 'ae24c1af-b6e0-47a1-bb18-f95004cd028d',
    previousSnapshotId: '916dc4d4-e1be-4b61-82c4-2e440a5d20de',
  },
]
const expectedForwardStatements = [
  'ALTER TABLE "wallets" ADD COLUMN "usd_balance_minor" bigint DEFAULT 0 NOT NULL;',
  'ALTER TABLE "wallets" ADD CONSTRAINT "wallets_usd_balance_minor_nonnegative" CHECK ("wallets"."usd_balance_minor" >= 0);',
]

function readOptions() {
  const args = process.argv.slice(2)
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const defaultRoot = resolve(scriptDir, '../../..')

  if (args.length === 0) return { root: defaultRoot, selfTest: false }
  if (args.length === 1 && args[0] === '--self-test') {
    return { root: defaultRoot, selfTest: true }
  }
  if (args.length === 2 && args[0] === '--root') {
    return { root: resolve(args[1]), selfTest: false }
  }

  throw new Error(
    'usage: node scripts/validateBaseline.js [--root <path> | --self-test]',
  )
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  )
}

function validateSnapshotDelta(baseline, forward, errors) {
  if (!baseline || !forward) return

  const expected = structuredClone(baseline)
  expected.id = migrations[1].snapshotId
  expected.prevId = migrations[1].previousSnapshotId
  expected.tables['public.wallets'].columns.usd_balance_minor = {
    name: 'usd_balance_minor',
    type: 'bigint',
    primaryKey: false,
    notNull: true,
    default: '0',
  }
  expected.tables['public.wallets'].checkConstraints
    .wallets_usd_balance_minor_nonnegative = {
      name: 'wallets_usd_balance_minor_nonnegative',
      value: '"wallets"."usd_balance_minor" >= 0',
    }

  if (JSON.stringify(canonical(forward)) !== JSON.stringify(canonical(expected))) {
    errors.push('0001 snapshot contains an unexpected schema change')
  }
}

function validateArtifacts(root) {
  const errors = []
  const migrationsDir = join(root, 'packages/db/migrations')
  const metaDir = join(migrationsDir, 'meta')
  const journalPath = join(metaDir, '_journal.json')
  const documentPath = join(root, 'docs/database/baseline-adoption.md')

  compareList(
    listFiles(migrationsDir, 'migration', errors),
    migrations.map(({ tag }) => `${tag}.sql`),
    'migration files',
    errors,
  )
  compareList(
    listFiles(metaDir, 'migration metadata', errors),
    [...migrations.map(({ snapshotFile }) => snapshotFile), '_journal.json'],
    'migration metadata files',
    errors,
  )

  const document = readText(documentPath, 'adoption document', errors)
  const journal = readJson(journalPath, 'migration journal', errors)
  const sqlFiles = migrations.map((migration) => readText(
    join(migrationsDir, `${migration.tag}.sql`),
    `${migration.tag} sql`,
    errors,
  ))
  const snapshotTexts = migrations.map((migration) => readText(
    join(metaDir, migration.snapshotFile),
    migration.snapshotFile,
    errors,
  ))
  const snapshots = snapshotTexts.map((text, index) => {
    if (text === null) return null
    try {
      return JSON.parse(text)
    } catch (error) {
      errors.push(`${migrations[index].snapshotFile} is not valid json: ${error.message}`)
      return null
    }
  })

  const documentedHash = readDocumentValue(
    document,
    /SQL SHA-256: `([a-f0-9]{64})`/,
    'documented baseline sql hash',
    errors,
  )
  const documentedTimestamp = readDocumentValue(
    document,
    /Journal timestamp: `([0-9]+)`/,
    'documented baseline journal timestamp',
    errors,
  )

  if (documentedHash !== null && documentedHash !== migrations[0].sqlHash) {
    errors.push('documented baseline sql hash does not match the pinned hash')
  }
  if (
    documentedTimestamp !== null
    && documentedTimestamp !== String(migrations[0].when)
  ) {
    errors.push('documented baseline timestamp does not match the pinned value')
  }

  migrations.forEach((migration, index) => {
    const sql = sqlFiles[index]
    const snapshotText = snapshotTexts[index]
    const snapshot = snapshots[index]

    if (sql !== null && sha256(sql) !== migration.sqlHash) {
      errors.push(`${migration.tag} sql hash does not match the pinned hash`)
    }
    if (snapshotText !== null && sha256(snapshotText) !== migration.snapshotHash) {
      errors.push(`${migration.snapshotFile} hash does not match the pinned hash`)
    }
    if (snapshot?.id !== migration.snapshotId) {
      errors.push(`${migration.snapshotFile} id does not match the pinned id`)
    }
    if (snapshot?.prevId !== migration.previousSnapshotId) {
      errors.push(`${migration.snapshotFile} has broken snapshot lineage`)
    }
    if (snapshot?.version !== migration.version) {
      errors.push(`${migration.snapshotFile} version must be ${migration.version}`)
    }
    if (snapshot?.dialect !== 'postgresql') {
      errors.push(`${migration.snapshotFile} dialect must be postgresql`)
    }
  })

  const entries = journal?.entries
  if (!Array.isArray(entries) || entries.length !== migrations.length) {
    errors.push(`migration journal must contain exactly ${migrations.length} entries`)
  }
  if (journal?.version !== '7') errors.push('migration journal version must be 7')
  if (journal?.dialect !== 'postgresql') {
    errors.push('migration journal dialect must be postgresql')
  }

  migrations.forEach((migration, index) => {
    const expectedEntry = {
      idx: migration.idx,
      version: migration.version,
      when: migration.when,
      tag: migration.tag,
      breakpoints: true,
    }
    if (JSON.stringify(entries?.[index]) !== JSON.stringify(expectedEntry)) {
      errors.push(`migration journal entry ${index} does not match the pinned entry`)
    }
  })

  const baselineSnapshot = snapshots[0]
  const snapshotTables = baselineSnapshot?.tables
    && typeof baselineSnapshot.tables === 'object'
    ? Object.entries(baselineSnapshot.tables)
    : []
  compareList(
    snapshotTables.map(([, table]) => table?.name),
    expectedTables,
    'baseline snapshot tables',
    errors,
  )
  compareList(
    snapshotTables.map(([key]) => key),
    expectedTables.map((name) => `public.${name}`),
    'baseline snapshot table keys',
    errors,
  )

  if (sqlFiles[0] !== null) {
    compareList(
      [...sqlFiles[0].matchAll(/CREATE TABLE "([^"]+)"/g)]
        .map((match) => match[1]),
      expectedTables,
      'baseline sql tables',
      errors,
    )
  }
  if (sqlFiles[1] !== null) {
    const statements = sqlFiles[1]
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean)
    if (JSON.stringify(statements) !== JSON.stringify(expectedForwardStatements)) {
      errors.push('0001 sql contains an unexpected statement')
    }
  }

  validateSnapshotDelta(snapshots[0], snapshots[1], errors)
  return errors
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function runNegativeTests(root) {
  const cases = [
    ['modified 0000 sql', (fixture) => {
      appendFileSync(join(fixture, 'packages/db/migrations/0000_fat_shen.sql'), '\n-- changed')
    }],
    ['modified 0001 sql', (fixture) => {
      appendFileSync(
        join(fixture, 'packages/db/migrations/0001_powerful_katie_power.sql'),
        '\n-- changed',
      )
    }],
    ['missing migration', (fixture) => {
      rmSync(join(fixture, 'packages/db/migrations/0001_powerful_katie_power.sql'))
    }],
    ['reordered journal', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/_journal.json')
      const journal = JSON.parse(readFileSync(path, 'utf8'))
      journal.entries.reverse()
      writeJson(path, journal)
    }],
    ['broken snapshot lineage', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0001_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.prevId = zeroSnapshotId
      writeJson(path, snapshot)
    }],
    ['unexpected schema change', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0001_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.wallets'].columns.unexpected = {
        name: 'unexpected',
        type: 'text',
        primaryKey: false,
        notNull: false,
      }
      writeJson(path, snapshot)
    }],
  ]

  for (const [name, mutate] of cases) {
    const fixture = mkdtempSync(join(tmpdir(), 'khmerfp-db-validator-'))
    try {
      mkdirSync(join(fixture, 'packages/db'), { recursive: true })
      mkdirSync(join(fixture, 'docs/database'), { recursive: true })
      cpSync(
        join(root, 'packages/db/migrations'),
        join(fixture, 'packages/db/migrations'),
        { recursive: true },
      )
      cpSync(
        join(root, 'docs/database/baseline-adoption.md'),
        join(fixture, 'docs/database/baseline-adoption.md'),
      )
      mutate(fixture)
      if (validateArtifacts(fixture).length === 0) {
        throw new Error(`${name} was not rejected`)
      }
      console.log(`negative validation passed: ${name}`)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  }
}

let options

try {
  options = readOptions()
} catch (error) {
  console.error(`migration validation failed\n- ${error.message}`)
  process.exitCode = 1
}

if (options) {
  const errors = validateArtifacts(options.root)

  if (errors.length > 0) {
    console.error(
      `migration validation failed\n${errors.map((error) => `- ${error}`).join('\n')}`,
    )
    process.exitCode = 1
  } else {
    console.log('ordered migration artifacts are valid')
    if (options.selfTest) runNegativeTests(options.root)
  }
}
