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

const baselineTables = [
  'auth_audit_logs',
  'auth_rate_limits',
  'phone_otps',
  'sessions',
  'transactions',
  'user_factors',
  'users',
  'wallets',
]
const finalTables = [
  'auth_audit_logs',
  'auth_rate_limits',
  'bakong_payments',
  'chain_assets',
  'chains',
  'contract_deployments',
  'ctf_conditions',
  'ctf_position_tokens',
  'market_categories',
  'market_outcomes',
  'market_questions',
  'markets',
  'phone_otps',
  'sessions',
  'transactions',
  'user_factors',
  'user_wallets',
  'users',
  'wallet_authorizations',
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
    canonicalLineEndings: true,
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
    canonicalLineEndings: true,
  },
  {
    idx: 2,
    tag: '0002_bouncy_glorian',
    when: 1794267362901,
    version: '7',
    sqlHash: '9d4c289b1e7f6d903fe33e7517e39385d677c1f3fc50846a8dc26b5791d2b737',
    snapshotFile: '0002_snapshot.json',
    snapshotHash: '844924280d55221720b78d5f66d5df0da0f9adb880182dc3c4bc0d4b6d202afd',
    snapshotId: '8de01e47-f8b1-4262-9ede-eeaea3714a75',
    previousSnapshotId: 'ae24c1af-b6e0-47a1-bb18-f95004cd028d',
    canonicalLineEndings: true,
  },
  {
    idx: 3,
    tag: '0003_tidy_ricochet',
    when: 1794389778533,
    version: '7',
    sqlHash: '41bdfba251af0d2847864ad6c542ab12b59efde8108655359d66497ae5ddf6b7',
    snapshotFile: '0003_snapshot.json',
    snapshotHash: '9257863f8136f61267dbba3a6d86f7895fd670e42f645fc942408a0d6d8068be',
    snapshotId: 'a8165d52-ed3d-482f-b156-792e2f9ff93d',
    previousSnapshotId: '8de01e47-f8b1-4262-9ede-eeaea3714a75',
    canonicalLineEndings: true,
  },
  {
    idx: 4,
    tag: '0004_giant_trish_tilby',
    when: 1794394744286,
    version: '7',
    sqlHash: '0b029f727318e27c7a37278d5d9849fd62d14a7e379657f756c8106ec52b25c4',
    snapshotFile: '0004_snapshot.json',
    snapshotHash: '941b3e70c5604c54ea4dc931e3d02d08e7bcb0fd245049f47ecc80ed77926623',
    snapshotId: 'e1ca5fd6-0094-4c1c-8613-83010d20b36c',
    previousSnapshotId: 'a8165d52-ed3d-482f-b156-792e2f9ff93d',
    canonicalLineEndings: true,
  },
  {
    idx: 5,
    tag: '0005_mysterious_mojo',
    when: 1794471149113,
    version: '7',
    sqlHash: '636a46a9e6b86d00413829b7b70798f780d74e01b062af0808c7c2c1818e561b',
    snapshotFile: '0005_snapshot.json',
    snapshotHash: '176207aa426e1138532e45f3003bec7b7f156041a07e99704d748352dcb5de2b',
    snapshotId: '611245d2-5efc-4155-8645-6ac6e857e575',
    previousSnapshotId: 'e1ca5fd6-0094-4c1c-8613-83010d20b36c',
    canonicalLineEndings: true,
  },
  {
    idx: 6,
    tag: '0006_dapper_nova',
    when: 1794473334712,
    version: '7',
    sqlHash: 'b6bb7af0989f5149532370001022f6ec491820d1242044fa6ed11aa24bcaf2b2',
    snapshotFile: '0006_snapshot.json',
    snapshotHash: '7fd6e4a05b6e9d8515c90c7d89ec8ad0f259b0147e9785c27ac445acd0db7a1a',
    snapshotId: '7f752026-ea0f-464d-97c9-e1208563a987',
    previousSnapshotId: '611245d2-5efc-4155-8645-6ac6e857e575',
    canonicalLineEndings: true,
  },
  {
    idx: 7,
    tag: '0007_protect_ctf_reference_identity',
    when: 1794475409667,
    version: '7',
    sqlHash: '7b75f3339aefd8f58eab178885bf28492720049a21c4be0ac05e699e394bb810',
    snapshotFile: '0007_snapshot.json',
    snapshotHash: 'c5dd2e757df9748e67499307a960fa72120705e56bbab01a9650bfbdc84ab99a',
    snapshotId: '2173e6db-a9bf-4f2b-b83e-44bfd5fb8a5c',
    previousSnapshotId: '7f752026-ea0f-464d-97c9-e1208563a987',
    canonicalLineEndings: true,
  },
]
const expectedForwardStatements = [
  'ALTER TABLE "wallets" ADD COLUMN "usd_balance_minor" bigint DEFAULT 0 NOT NULL;',
  'ALTER TABLE "wallets" ADD CONSTRAINT "wallets_usd_balance_minor_nonnegative" CHECK ("wallets"."usd_balance_minor" >= 0);',
]
const expectedBakongFunction = `CREATE OR REPLACE FUNCTION bakong_payments_fill_amount_minor()
RETURNS TRIGGER AS $$
BEGIN
\tIF NEW.amount_minor IS NULL THEN
\t\tNEW.amount_minor := CASE
\t\t\tWHEN NEW.currency = 'KHR' THEN ROUND(NEW.amount)::BIGINT
\t\t\tELSE ROUND(NEW.amount * 100)::BIGINT
\t\tEND;
\tEND IF;

\tRETURN NEW;
END;
$$ LANGUAGE plpgsql;`
const expectedBakongTrigger = `CREATE TRIGGER bakong_payments_fill_amount_minor
\tBEFORE INSERT ON bakong_payments
\tFOR EACH ROW
\tEXECUTE FUNCTION bakong_payments_fill_amount_minor();`
const expectedBakongTrailingStatements = [
  'ALTER TABLE "bakong_payments" ADD CONSTRAINT "bakong_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;',
  'CREATE INDEX "idx_bakong_payments_status_expires" ON "bakong_payments" USING btree ("status","expires_at");',
  'CREATE UNIQUE INDEX "idx_bakong_payments_user_idempotency" ON "bakong_payments" USING btree ("user_id","idempotency_key") WHERE "bakong_payments"."idempotency_key" IS NOT NULL;',
  'CREATE INDEX "idx_bakong_payments_user_status" ON "bakong_payments" USING btree ("user_id","status");',
]
const expectedReferenceTrailingStatements = [
  'ALTER TABLE "chain_assets" ADD CONSTRAINT "chain_assets_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE restrict ON UPDATE no action;',
  'ALTER TABLE "contract_deployments" ADD CONSTRAINT "contract_deployments_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE restrict ON UPDATE no action;',
  'CREATE INDEX "idx_chain_assets_chain_enabled" ON "chain_assets" USING btree ("chain_id","enabled");',
  'CREATE UNIQUE INDEX "idx_contract_deployments_chain_address_unique" ON "contract_deployments" USING btree ("chain_id","contract_address") WHERE "contract_deployments"."contract_address" IS NOT NULL;',
  'CREATE UNIQUE INDEX "idx_contract_deployments_active_role_unique" ON "contract_deployments" USING btree ("chain_id","contract_role") WHERE "contract_deployments"."deployment_status" = \'CONFIRMED\';',
  'CREATE UNIQUE INDEX "idx_contract_deployments_chain_tx_hash_unique" ON "contract_deployments" USING btree ("chain_id","deployment_tx_hash") WHERE "contract_deployments"."deployment_tx_hash" IS NOT NULL;',
  'CREATE INDEX "idx_contract_deployments_status" ON "contract_deployments" USING btree ("deployment_status","chain_id");',
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

function sha256(value, canonicalLineEndings = false) {
  const content = canonicalLineEndings
    ? value.replace(/\r\n/g, '\n')
    : value

  return createHash('sha256').update(content).digest('hex')
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

function validateBakongSnapshotDelta(previous, forward, errors) {
  if (!previous || !forward) return

  const previousTableKeys = Object.keys(previous.tables ?? {}).sort()
  const forwardTableKeys = Object.keys(forward.tables ?? {}).sort()
  const addedTableKeys = forwardTableKeys.filter(
    (key) => !previousTableKeys.includes(key),
  )

  if (JSON.stringify(addedTableKeys) !== JSON.stringify(['public.bakong_payments'])) {
    errors.push('0002 snapshot must add only public.bakong_payments')
  }

  for (const tableKey of previousTableKeys) {
    if (
      JSON.stringify(canonical(forward.tables?.[tableKey]))
      !== JSON.stringify(canonical(previous.tables[tableKey]))
    ) {
      errors.push(`0002 snapshot changed existing table ${tableKey}`)
    }
  }

  const expectedTopLevel = structuredClone(previous)
  expectedTopLevel.id = migrations[2].snapshotId
  expectedTopLevel.prevId = migrations[2].previousSnapshotId
  expectedTopLevel.tables['public.bakong_payments'] =
    forward.tables?.['public.bakong_payments']

  if (
    JSON.stringify(canonical(forward))
    !== JSON.stringify(canonical(expectedTopLevel))
  ) {
    errors.push('0002 snapshot contains an unexpected non-table schema change')
  }
}

function validateBakongStatements(sql, errors) {
  if (sql === null) return

  const statements = sql
    .replace(/\r\n/g, '\n')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)

  if (statements.length !== 7) {
    errors.push(`0002 sql must contain exactly 7 statements, received ${statements.length}`)
    return
  }

  if (!statements[0].startsWith('CREATE TABLE "bakong_payments" (')) {
    errors.push('0002 first statement must create bakong_payments')
  }
  if (statements[1] !== expectedBakongFunction) {
    errors.push('0002 compatibility function does not match the approved definition')
  }
  if (statements[2] !== expectedBakongTrigger) {
    errors.push('0002 compatibility trigger does not match the approved definition')
  }

  const trailingStatements = statements.slice(3)
  if (
    JSON.stringify(trailingStatements)
    !== JSON.stringify(expectedBakongTrailingStatements)
  ) {
    errors.push('0002 foreign key or index statements do not match the approved definitions')
  }
}

function validateReferenceSnapshotDelta(previous, forward, errors) {
  if (!previous || !forward) return

  const addedTables = [
    'public.chain_assets',
    'public.chains',
    'public.contract_deployments',
  ]
  const previousTableKeys = Object.keys(previous.tables ?? {}).sort()
  const forwardTableKeys = Object.keys(forward.tables ?? {}).sort()
  const addedTableKeys = forwardTableKeys.filter(
    (key) => !previousTableKeys.includes(key),
  )

  if (JSON.stringify(addedTableKeys) !== JSON.stringify(addedTables)) {
    errors.push('0003 snapshot must add only the three reference tables')
  }

  for (const tableKey of previousTableKeys) {
    if (
      JSON.stringify(canonical(forward.tables?.[tableKey]))
      !== JSON.stringify(canonical(previous.tables[tableKey]))
    ) {
      errors.push(`0003 snapshot changed existing table ${tableKey}`)
    }
  }

  const expected = structuredClone(previous)
  expected.id = migrations[3].snapshotId
  expected.prevId = migrations[3].previousSnapshotId
  for (const tableKey of addedTables) {
    expected.tables[tableKey] = forward.tables?.[tableKey]
  }

  if (JSON.stringify(canonical(forward)) !== JSON.stringify(canonical(expected))) {
    errors.push('0003 snapshot contains an unexpected non-table schema change')
  }
}

function validateReferenceStatements(sql, errors) {
  if (sql === null) return

  const statements = sql
    .replace(/\r\n/g, '\n')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)

  if (statements.length !== 10) {
    errors.push(`0003 sql must contain exactly 10 statements, received ${statements.length}`)
    return
  }

  const expectedCreates = [
    'CREATE TABLE "chain_assets" (',
    'CREATE TABLE "chains" (',
    'CREATE TABLE "contract_deployments" (',
  ]
  expectedCreates.forEach((prefix, index) => {
    if (!statements[index].startsWith(prefix)) {
      errors.push(`0003 statement ${index + 1} must start with ${prefix}`)
    }
  })

  if (
    JSON.stringify(statements.slice(3))
    !== JSON.stringify(expectedReferenceTrailingStatements)
  ) {
    errors.push('0003 foreign key or index statements are not approved')
  }
}

function validateMarketSnapshotDelta(previous, forward, errors) {
  if (!previous || !forward) return

  const addedTables = [
    'public.market_categories',
    'public.market_outcomes',
    'public.market_questions',
    'public.markets',
  ]
  const previousTableKeys = Object.keys(previous.tables ?? {}).sort()
  const forwardTableKeys = Object.keys(forward.tables ?? {}).sort()
  const addedTableKeys = forwardTableKeys.filter(
    (key) => !previousTableKeys.includes(key),
  )

  if (JSON.stringify(addedTableKeys) !== JSON.stringify(addedTables)) {
    errors.push('0004 snapshot must add only the four binary market tables')
  }

  for (const tableKey of previousTableKeys) {
    if (
      JSON.stringify(canonical(forward.tables?.[tableKey]))
      !== JSON.stringify(canonical(previous.tables[tableKey]))
    ) {
      errors.push(`0004 snapshot changed existing table ${tableKey}`)
    }
  }

  const expected = structuredClone(previous)
  expected.id = migrations[4].snapshotId
  expected.prevId = migrations[4].previousSnapshotId
  for (const tableKey of addedTables) {
    expected.tables[tableKey] = forward.tables?.[tableKey]
  }

  if (JSON.stringify(canonical(forward)) !== JSON.stringify(canonical(expected))) {
    errors.push('0004 snapshot contains an unexpected non-table schema change')
  }
}

function validateMarketStatements(sql, errors) {
  if (sql === null) return

  const statements = sql
    .replace(/\r\n/g, '\n')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)

  if (statements.length !== 18) {
    errors.push(`0004 sql must contain exactly 18 statements, received ${statements.length}`)
    return
  }

  const expectedCreates = [
    'CREATE TABLE "market_categories" (',
    'CREATE TABLE "market_outcomes" (',
    'CREATE TABLE "market_questions" (',
    'CREATE TABLE "markets" (',
  ]
  expectedCreates.forEach((prefix, index) => {
    if (!statements[index].startsWith(prefix)) {
      errors.push(`0004 statement ${index + 1} must start with ${prefix}`)
    }
  })

  const expectedAlterPrefixes = [
    'ALTER TABLE "market_categories" ADD CONSTRAINT "market_categories_parent_id_fkey"',
    'ALTER TABLE "market_outcomes" ADD CONSTRAINT "market_outcomes_market_question_fkey"',
    'ALTER TABLE "market_questions" ADD CONSTRAINT "market_questions_market_id_fkey"',
    'ALTER TABLE "market_questions" ADD CONSTRAINT "market_questions_oracle_contract_deployment_id_fkey"',
    'ALTER TABLE "markets" ADD CONSTRAINT "markets_category_id_fkey"',
    'ALTER TABLE "markets" ADD CONSTRAINT "markets_created_by_user_id_fkey"',
  ]
  expectedAlterPrefixes.forEach((prefix, index) => {
    if (!statements[index + 4].startsWith(prefix)) {
      errors.push(`0004 statement ${index + 5} must start with ${prefix}`)
    }
  })

  const expectedIndexPrefixes = [
    'CREATE INDEX "idx_market_categories_parent_active"',
    'CREATE INDEX "idx_markets_category_lifecycle"',
    'CREATE INDEX "idx_markets_trading_end"',
    'CREATE INDEX "idx_markets_resolution_deadline"',
  ]
  expectedIndexPrefixes.forEach((prefix, index) => {
    if (!statements[index + 10].startsWith(prefix)) {
      errors.push(`0004 statement ${index + 11} must start with ${prefix}`)
    }
  })

  const marketFunction = statements[14]
  for (const requiredText of [
    'CREATE FUNCTION protect_frozen_market_terms()',
    "IF TG_TABLE_NAME = 'markets' THEN",
    "RAISE EXCEPTION 'market must be created in an unfrozen draft state'",
    "RAISE EXCEPTION 'invalid market lifecycle transition'",
    "RAISE EXCEPTION 'invalid market trading transition'",
    "RAISE EXCEPTION 'invalid market resolution transition'",
    'IF OLD.terms_frozen_at IS NOT NULL THEN',
    'IF binary_outcome_count <> 2 THEN',
    "RAISE EXCEPTION 'binary market requires exactly two outcomes before terms are frozen'",
    "RAISE EXCEPTION 'frozen market terms cannot be changed'",
    "RAISE EXCEPTION 'frozen market questions and outcomes cannot be changed'",
  ]) {
    if (!marketFunction.includes(requiredText)) {
      errors.push(`0004 frozen-terms function is missing: ${requiredText}`)
    }
  }

  const expectedTriggers = [
    'CREATE TRIGGER markets_protect_frozen_terms',
    'CREATE TRIGGER market_questions_protect_frozen_terms',
    'CREATE TRIGGER market_outcomes_protect_frozen_terms',
  ]
  expectedTriggers.forEach((prefix, index) => {
    if (!statements[index + 15].startsWith(prefix)) {
      errors.push(`0004 statement ${index + 16} must start with ${prefix}`)
    }
  })
}

function validateWalletIdentitySnapshotDelta(previous, forward, errors) {
  if (!previous || !forward) return

  const addedTables = [
    'public.user_wallets',
    'public.wallet_authorizations',
  ]
  const previousTableKeys = Object.keys(previous.tables ?? {}).sort()
  const forwardTableKeys = Object.keys(forward.tables ?? {}).sort()
  const addedTableKeys = forwardTableKeys.filter(
    (key) => !previousTableKeys.includes(key),
  )

  if (JSON.stringify(addedTableKeys) !== JSON.stringify(addedTables)) {
    errors.push('0005 snapshot must add only the two wallet identity tables')
  }

  for (const tableKey of previousTableKeys) {
    if (
      JSON.stringify(canonical(forward.tables?.[tableKey]))
      !== JSON.stringify(canonical(previous.tables[tableKey]))
    ) {
      errors.push(`0005 snapshot changed existing table ${tableKey}`)
    }
  }

  const expected = structuredClone(previous)
  expected.id = migrations[5].snapshotId
  expected.prevId = migrations[5].previousSnapshotId
  for (const tableKey of addedTables) {
    expected.tables[tableKey] = forward.tables?.[tableKey]
  }

  if (JSON.stringify(canonical(forward)) !== JSON.stringify(canonical(expected))) {
    errors.push('0005 snapshot contains an unexpected non-table schema change')
  }
}

function validateWalletIdentityStatements(sql, errors) {
  if (sql === null) return

  const statements = sql
    .replace(/\r\n/g, '\n')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)

  const expectedPrefixes = [
    'CREATE TABLE "user_wallets" (',
    'CREATE TABLE "wallet_authorizations" (',
    'ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_user_id_fkey"',
    'ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_chain_id_fkey"',
    'ALTER TABLE "wallet_authorizations" ADD CONSTRAINT "wallet_authorizations_wallet_id_fkey"',
    'ALTER TABLE "wallet_authorizations" ADD CONSTRAINT "wallet_authorizations_contract_deployment_id_fkey"',
    'CREATE UNIQUE INDEX "idx_user_wallets_active_primary_unique"',
    'CREATE INDEX "idx_user_wallets_user_chain_status"',
    'CREATE INDEX "idx_user_wallets_verification_status"',
    'CREATE UNIQUE INDEX "idx_wallet_authorizations_verified_contract_unique"',
    'CREATE UNIQUE INDEX "idx_wallet_authorizations_verified_operator_unique"',
    'CREATE INDEX "idx_wallet_authorizations_wallet_status"',
    'CREATE INDEX "idx_wallet_authorizations_expiry"',
    'CREATE FUNCTION protect_user_wallet_identity()',
    'CREATE TRIGGER user_wallets_protect_identity',
    'CREATE FUNCTION protect_wallet_authorization_state()',
    'CREATE TRIGGER wallet_authorizations_protect_state',
  ]

  if (statements.length !== expectedPrefixes.length) {
    errors.push(`0005 sql must contain exactly ${expectedPrefixes.length} statements, received ${statements.length}`)
    return
  }

  expectedPrefixes.forEach((prefix, index) => {
    if (!statements[index].startsWith(prefix)) {
      errors.push(`0005 statement ${index + 1} must start with ${prefix}`)
    }
  })

  for (const requiredText of [
    'CONSTRAINT "user_wallets_chain_address_key" UNIQUE',
    'CONSTRAINT "user_wallets_address_check" CHECK',
    'CONSTRAINT "user_wallets_active_verification_check" CHECK',
    'CONSTRAINT "wallet_authorizations_operator_check" CHECK',
    'CONSTRAINT "wallet_authorizations_validity_check" CHECK',
    'CONSTRAINT "wallet_authorizations_revocation_check" CHECK',
    "RAISE EXCEPTION 'blockchain wallet ownership identity cannot be reassigned'",
    "RAISE EXCEPTION 'wallet authorization scope and evidence are immutable'",
    "RAISE EXCEPTION 'invalid wallet authorization transition'",
    "RAISE EXCEPTION 'wallet authorization target must use the wallet chain'",
  ]) {
    if (!sql.includes(requiredText)) {
      errors.push(`0005 wallet identity sql is missing: ${requiredText}`)
    }
  }
}

function validateCtfSnapshotDelta(previous, forward, errors) {
  if (!previous || !forward) return

  const addedTables = [
    'public.ctf_conditions',
    'public.ctf_position_tokens',
  ]
  const previousTableKeys = Object.keys(previous.tables ?? {}).sort()
  const forwardTableKeys = Object.keys(forward.tables ?? {}).sort()
  const addedTableKeys = forwardTableKeys.filter(
    (key) => !previousTableKeys.includes(key),
  )

  if (JSON.stringify(addedTableKeys) !== JSON.stringify(addedTables)) {
    errors.push('0006 snapshot must add only the two CTF registry tables')
  }

  for (const tableKey of previousTableKeys) {
    if (
      JSON.stringify(canonical(forward.tables?.[tableKey]))
      !== JSON.stringify(canonical(previous.tables[tableKey]))
    ) {
      errors.push(`0006 snapshot changed existing table ${tableKey}`)
    }
  }

  const expected = structuredClone(previous)
  expected.id = migrations[6].snapshotId
  expected.prevId = migrations[6].previousSnapshotId
  for (const tableKey of addedTables) {
    expected.tables[tableKey] = forward.tables?.[tableKey]
  }

  if (JSON.stringify(canonical(forward)) !== JSON.stringify(canonical(expected))) {
    errors.push('0006 snapshot contains an unexpected non-table schema change')
  }
}

function validateCtfStatements(sql, errors) {
  if (sql === null) return

  const statements = sql
    .replace(/\r\n/g, '\n')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)
  const expectedPrefixes = [
    'CREATE TABLE "ctf_conditions" (',
    'CREATE TABLE "ctf_position_tokens" (',
    'ALTER TABLE "ctf_conditions" ADD CONSTRAINT "ctf_conditions_market_question_id_fkey"',
    'ALTER TABLE "ctf_conditions" ADD CONSTRAINT "ctf_conditions_chain_id_fkey"',
    'ALTER TABLE "ctf_conditions" ADD CONSTRAINT "ctf_conditions_ctf_contract_deployment_id_fkey"',
    'ALTER TABLE "ctf_conditions" ADD CONSTRAINT "ctf_conditions_oracle_contract_deployment_id_fkey"',
    'ALTER TABLE "ctf_conditions" ADD CONSTRAINT "ctf_conditions_collateral_asset_id_fkey"',
    'ALTER TABLE "ctf_position_tokens" ADD CONSTRAINT "ctf_position_tokens_condition_id_fkey"',
    'ALTER TABLE "ctf_position_tokens" ADD CONSTRAINT "ctf_position_tokens_market_outcome_id_fkey"',
    'ALTER TABLE "ctf_position_tokens" ADD CONSTRAINT "ctf_position_tokens_collateral_asset_id_fkey"',
    'CREATE INDEX "idx_ctf_conditions_chain_status"',
    'CREATE INDEX "idx_ctf_conditions_ctf_question"',
    'CREATE FUNCTION enforce_ctf_condition_registry()',
    'CREATE TRIGGER ctf_conditions_enforce_registry',
    'CREATE FUNCTION enforce_ctf_position_token_registry()',
    'CREATE TRIGGER ctf_position_tokens_enforce_registry',
  ]

  if (statements.length !== expectedPrefixes.length) {
    errors.push(`0006 sql must contain exactly ${expectedPrefixes.length} statements, received ${statements.length}`)
    return
  }
  expectedPrefixes.forEach((prefix, index) => {
    if (!statements[index].startsWith(prefix)) {
      errors.push(`0006 statement ${index + 1} must start with ${prefix}`)
    }
  })

  for (const requiredText of [
    "deployment.contract_role = 'GNOSIS_CTF'",
    "deployment.contract_role = 'ORACLE'",
    'deployment.chain_id = NEW.chain_id',
    "RAISE EXCEPTION 'new CTF condition must start as locally derived'",
    "RAISE EXCEPTION 'CTF condition identity is immutable'",
    "RAISE EXCEPTION 'invalid CTF condition status transition'",
    "RAISE EXCEPTION 'CTF position token outcome does not match its condition'",
    "RAISE EXCEPTION 'CTF position token identity is immutable'",
  ]) {
    if (!sql.includes(requiredText)) {
      errors.push(`0006 CTF registry sql is missing: ${requiredText}`)
    }
  }
}

function validateCtfReferenceProtectionSnapshotDelta(previous, forward, errors) {
  if (!previous || !forward) return

  const expected = structuredClone(previous)
  expected.id = migrations[7].snapshotId
  expected.prevId = migrations[7].previousSnapshotId

  if (JSON.stringify(canonical(forward)) !== JSON.stringify(canonical(expected))) {
    errors.push('0007 snapshot must preserve the 0006 schema exactly')
  }
}

function validateCtfReferenceProtectionStatements(sql, errors) {
  if (sql === null) return

  const statements = sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)
  const expectedPrefixes = [
    'CREATE FUNCTION protect_ctf_chain_asset_identity()',
    'CREATE TRIGGER chain_assets_protect_ctf_identity',
    'CREATE FUNCTION protect_ctf_contract_deployment_identity()',
    'CREATE TRIGGER contract_deployments_protect_ctf_identity',
  ]
  if (statements.length !== expectedPrefixes.length) {
    errors.push(`0007 sql must contain exactly four statements, received ${statements.length}`)
    return
  }
  expectedPrefixes.forEach((prefix, index) => {
    if (!statements[index].startsWith(prefix)) {
      errors.push(`0007 statement ${index + 1} must start with ${prefix}`)
    }
  })

  const requiredText = [
    'NEW.chain_id IS DISTINCT FROM OLD.chain_id',
    'NEW.contract_address IS DISTINCT FROM OLD.contract_address',
    'NEW.decimals IS DISTINCT FROM OLD.decimals',
    'NEW.asset_type IS DISTINCT FROM OLD.asset_type',
    'condition.ctf_contract_deployment_id = OLD.id',
    'condition.oracle_contract_deployment_id = OLD.id',
    'NEW.contract_role IS DISTINCT FROM OLD.contract_role',
    'NEW.contract_version IS DISTINCT FROM OLD.contract_version',
    'BEFORE UPDATE ON chain_assets',
    'BEFORE UPDATE ON contract_deployments',
  ]
  for (const text of requiredText) {
    if (!sql.includes(text)) errors.push(`0007 protection sql is missing: ${text}`)
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

    if (
      sql !== null
      && sha256(sql, migration.canonicalLineEndings) !== migration.sqlHash
    ) {
      errors.push(`${migration.tag} sql hash does not match the pinned hash`)
    }
    if (
      snapshotText !== null
      && sha256(snapshotText, migration.canonicalLineEndings)
        !== migration.snapshotHash
    ) {
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
    baselineTables,
    'baseline snapshot tables',
    errors,
  )
  compareList(
    snapshotTables.map(([key]) => key),
    baselineTables.map((name) => `public.${name}`),
    'baseline snapshot table keys',
    errors,
  )

  if (sqlFiles[0] !== null) {
    compareList(
      [...sqlFiles[0].matchAll(/CREATE TABLE "([^"]+)"/g)]
        .map((match) => match[1]),
      baselineTables,
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

  const finalSnapshotTables = snapshots[7]?.tables
    && typeof snapshots[7].tables === 'object'
    ? Object.entries(snapshots[7].tables)
    : []
  compareList(
    finalSnapshotTables.map(([, table]) => table?.name),
    finalTables,
    'final snapshot tables',
    errors,
  )
  compareList(
    finalSnapshotTables.map(([key]) => key),
    finalTables.map((name) => `public.${name}`),
    'final snapshot table keys',
    errors,
  )

  validateSnapshotDelta(snapshots[0], snapshots[1], errors)
  validateBakongSnapshotDelta(snapshots[1], snapshots[2], errors)
  validateBakongStatements(sqlFiles[2], errors)
  validateReferenceSnapshotDelta(snapshots[2], snapshots[3], errors)
  validateReferenceStatements(sqlFiles[3], errors)
  validateMarketSnapshotDelta(snapshots[3], snapshots[4], errors)
  validateMarketStatements(sqlFiles[4], errors)
  validateWalletIdentitySnapshotDelta(snapshots[4], snapshots[5], errors)
  validateWalletIdentityStatements(sqlFiles[5], errors)
  validateCtfSnapshotDelta(snapshots[5], snapshots[6], errors)
  validateCtfStatements(sqlFiles[6], errors)
  validateCtfReferenceProtectionSnapshotDelta(snapshots[6], snapshots[7], errors)
  validateCtfReferenceProtectionStatements(sqlFiles[7], errors)
  return errors
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function runLineEndingPortabilityTests(root) {
  for (const lineEnding of ['lf', 'crlf']) {
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

      for (const relativePath of [
        'packages/db/migrations/0002_bouncy_glorian.sql',
        'packages/db/migrations/meta/0002_snapshot.json',
        'packages/db/migrations/0003_tidy_ricochet.sql',
        'packages/db/migrations/meta/0003_snapshot.json',
        'packages/db/migrations/0004_giant_trish_tilby.sql',
        'packages/db/migrations/meta/0004_snapshot.json',
        'packages/db/migrations/0005_mysterious_mojo.sql',
        'packages/db/migrations/meta/0005_snapshot.json',
        'packages/db/migrations/0006_dapper_nova.sql',
        'packages/db/migrations/meta/0006_snapshot.json',
        'packages/db/migrations/0007_protect_ctf_reference_identity.sql',
        'packages/db/migrations/meta/0007_snapshot.json',
      ]) {
        const path = join(fixture, relativePath)
        const lfContent = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
        const content = lineEnding === 'crlf'
          ? lfContent.replace(/\n/g, '\r\n')
          : lfContent
        writeFileSync(path, content)
      }

      const errors = validateArtifacts(fixture)
      if (errors.length > 0) {
        throw new Error(
          `${lineEnding} artifact validation failed: ${errors.join('; ')}`,
        )
      }
      console.log(`line-ending validation passed: ${lineEnding}`)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  }
}

function runNegativeTests(root) {
  runLineEndingPortabilityTests(root)

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
    ['modified 0002 sql', (fixture) => {
      appendFileSync(
        join(fixture, 'packages/db/migrations/0002_bouncy_glorian.sql'),
        '\n-- changed',
      )
    }],
    ['modified 0002 snapshot', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0002_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.bakong_payments'].isRLSEnabled = true
      writeJson(path, snapshot)
    }],
    ['modified 0003 sql', (fixture) => {
      appendFileSync(
        join(fixture, 'packages/db/migrations/0003_tidy_ricochet.sql'),
        '\n-- changed',
      )
    }],
    ['modified 0003 snapshot', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0003_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.chains'].isRLSEnabled = true
      writeJson(path, snapshot)
    }],
    ['modified 0004 sql', (fixture) => {
      appendFileSync(
        join(fixture, 'packages/db/migrations/0004_giant_trish_tilby.sql'),
        '\n-- changed',
      )
    }],
    ['modified 0004 snapshot', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0004_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.markets'].isRLSEnabled = true
      writeJson(path, snapshot)
    }],
    ['modified 0005 sql', (fixture) => {
      appendFileSync(
        join(fixture, 'packages/db/migrations/0005_mysterious_mojo.sql'),
        '\n-- changed',
      )
    }],
    ['modified 0005 snapshot', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0005_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.user_wallets'].isRLSEnabled = true
      writeJson(path, snapshot)
    }],
    ['modified 0006 sql', (fixture) => {
      appendFileSync(
        join(fixture, 'packages/db/migrations/0006_dapper_nova.sql'),
        '\n-- changed',
      )
    }],
    ['modified 0006 snapshot', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0006_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.ctf_conditions'].isRLSEnabled = true
      writeJson(path, snapshot)
    }],
    ['modified 0007 sql', (fixture) => {
      appendFileSync(
        join(fixture, 'packages/db/migrations/0007_protect_ctf_reference_identity.sql'),
        '\n-- changed',
      )
    }],
    ['modified 0007 snapshot', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0007_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.ctf_conditions'].isRLSEnabled = true
      writeJson(path, snapshot)
    }],
    ['missing migration', (fixture) => {
      rmSync(join(fixture, 'packages/db/migrations/0001_powerful_katie_power.sql'))
    }],
    ['missing 0002 migration', (fixture) => {
      rmSync(join(fixture, 'packages/db/migrations/0002_bouncy_glorian.sql'))
    }],
    ['missing 0003 migration', (fixture) => {
      rmSync(join(fixture, 'packages/db/migrations/0003_tidy_ricochet.sql'))
    }],
    ['missing 0004 migration', (fixture) => {
      rmSync(join(fixture, 'packages/db/migrations/0004_giant_trish_tilby.sql'))
    }],
    ['missing 0005 migration', (fixture) => {
      rmSync(join(fixture, 'packages/db/migrations/0005_mysterious_mojo.sql'))
    }],
    ['missing 0006 migration', (fixture) => {
      rmSync(join(fixture, 'packages/db/migrations/0006_dapper_nova.sql'))
    }],
    ['missing 0007 migration', (fixture) => {
      rmSync(join(fixture, 'packages/db/migrations/0007_protect_ctf_reference_identity.sql'))
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
    ['broken 0002 snapshot lineage', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0002_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.prevId = zeroSnapshotId
      writeJson(path, snapshot)
    }],
    ['broken 0003 snapshot lineage', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0003_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.prevId = zeroSnapshotId
      writeJson(path, snapshot)
    }],
    ['broken 0004 snapshot lineage', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0004_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.prevId = zeroSnapshotId
      writeJson(path, snapshot)
    }],
    ['broken 0005 snapshot lineage', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0005_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.prevId = zeroSnapshotId
      writeJson(path, snapshot)
    }],
    ['broken 0006 snapshot lineage', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0006_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.prevId = zeroSnapshotId
      writeJson(path, snapshot)
    }],
    ['broken 0007 snapshot lineage', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0007_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.prevId = zeroSnapshotId
      writeJson(path, snapshot)
    }],
    ['invalid CTF binary mapping accepted', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0006_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.ctf_position_tokens'].checkConstraints
        .ctf_position_tokens_binary_mapping_check.value = 'true'
      writeJson(path, snapshot)
    }],
    ['invalid CTF condition slot count accepted', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0006_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      delete snapshot.tables['public.ctf_conditions'].checkConstraints
        .ctf_conditions_outcome_slot_count_check
      writeJson(path, snapshot)
    }],
    ['unsafe wallet address accepted', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0005_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.user_wallets'].checkConstraints
        .user_wallets_address_check.value = 'true'
      writeJson(path, snapshot)
    }],
    ['unscoped wallet authorization accepted', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0005_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      delete snapshot.tables['public.wallet_authorizations'].checkConstraints
        .wallet_authorizations_scope_check
      writeJson(path, snapshot)
    }],
    ['unexpected binary outcome mapping', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0004_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.market_outcomes'].checkConstraints
        .market_outcomes_binary_pair_check.value = 'true'
      writeJson(path, snapshot)
    }],
    ['missing market freeze constraint', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0004_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      delete snapshot.tables['public.markets'].checkConstraints
        .markets_frozen_lifecycle_check
      writeJson(path, snapshot)
    }],
    ['malformed asset address accepted', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0003_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.chain_assets'].checkConstraints
        .chain_assets_contract_address_check.value = 'true'
      writeJson(path, snapshot)
    }],
    ['duplicate asset identity accepted', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0003_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      delete snapshot.tables['public.chain_assets'].uniqueConstraints
        .chain_assets_chain_address_key
      writeJson(path, snapshot)
    }],
    ['invalid chain id accepted', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0003_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.chains'].checkConstraints
        .chains_chain_id_positive.value = '"chains"."chain_id" >= 0'
      writeJson(path, snapshot)
    }],
    ['invalid deployment metadata accepted', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0003_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      delete snapshot.tables['public.contract_deployments'].checkConstraints
        .contract_deployments_metadata_check
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
    ['unexpected tenth table', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0002_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.unexpected'] = {
        ...structuredClone(snapshot.tables['public.bakong_payments']),
        name: 'unexpected',
      }
      writeJson(path, snapshot)
    }],
    ['unexpected Bakong column', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0002_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.bakong_payments'].columns.unexpected = {
        name: 'unexpected',
        type: 'text',
        primaryKey: false,
        notNull: false,
      }
      writeJson(path, snapshot)
    }],
    ['unexpected Bakong constraint', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0002_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.bakong_payments'].checkConstraints.unexpected = {
        name: 'unexpected',
        value: 'amount_minor <> 1',
      }
      writeJson(path, snapshot)
    }],
    ['unexpected Bakong index', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0002_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.bakong_payments'].indexes.unexpected =
        structuredClone(
          snapshot.tables['public.bakong_payments']
            .indexes.idx_bakong_payments_user_status,
        )
      snapshot.tables['public.bakong_payments'].indexes.unexpected.name =
        'unexpected'
      writeJson(path, snapshot)
    }],
    ['missing partial idempotency predicate', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0002_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.bakong_payments']
        .indexes.idx_bakong_payments_user_idempotency.where = undefined
      writeJson(path, snapshot)
    }],
    ['modified Bakong function', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/0002_bouncy_glorian.sql')
      const sql = readFileSync(path, 'utf8').replace(
        'ROUND(NEW.amount * 100)::BIGINT',
        'ROUND(NEW.amount * 10)::BIGINT',
      )
      writeFileSync(path, sql)
    }],
    ['modified Bakong trigger', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/0002_bouncy_glorian.sql')
      const sql = readFileSync(path, 'utf8').replace(
        'BEFORE INSERT ON bakong_payments',
        'AFTER INSERT ON bakong_payments',
      )
      writeFileSync(path, sql)
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
