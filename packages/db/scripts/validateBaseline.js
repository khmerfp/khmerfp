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
  'wallet_link_challenges',
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
const walletLinkMigration = {
  idx: 8,
  tag: '0008_wallet_link_challenges',
  when: 1794817806169,
  version: '7',
  sqlHash: '03b61fc027ef3037230b744f6b8d2bac980ee2165e2a55eccdec53630a2be826',
  snapshotFile: '0008_snapshot.json',
  snapshotHash: '46fed37892e138fc546cc1d2285746f320b589ca9ec61bfaa79c87f9c100bf2a',
  snapshotId: '36258582-0a46-4061-bd52-982b420cf773',
  previousSnapshotId: '2173e6db-a9bf-4f2b-b83e-44bfd5fb8a5c',
  canonicalLineEndings: true,
}
migrations.push(walletLinkMigration)
const ledgerMigration = {
  "idx": 9,
  "version": "7",
  "when": 1795013701663,
  "tag": "0009_financial_ledger",
  "sqlHash": "f6a2d50a3f24fa9d20ec836390741435a53855e6f80540474e556ce9aebdbed1",
  "snapshotFile": "0009_snapshot.json",
  "snapshotHash": "79373d93cdd2be56e63f5e2037dfba2ff1b346adfc4ab130b154fddf3ec9da48",
  "snapshotId": "167e9cc6-841a-4ed8-b9f9-dc5531d7819a",
  "previousSnapshotId": "36258582-0a46-4061-bd52-982b420cf773",
  "canonicalLineEndings": true
}
migrations.push(ledgerMigration)
const targetedAuditMigration = {
  "idx": 10,
  "version": "7",
  "when": 1795020222614,
  "tag": "0010_targeted_financial_audits",
  "sqlHash": "825cd7ff1ebe8e31c26d4845c9222f788a88c6e7b6beeb60dd6fe8860214b08f",
  "snapshotFile": "0010_snapshot.json",
  "snapshotHash": "cf6dfe938e01ee299fb44702309a4b170025386e44beb8dbc4ad79194fd7b6d8",
  "snapshotId": "03410853-4f91-427b-8fad-75caf3cb8411",
  "previousSnapshotId": "167e9cc6-841a-4ed8-b9f9-dc5531d7819a",
  "canonicalLineEndings": true
}
migrations.push(targetedAuditMigration)
const positionMigration = {
  "idx": 11,
  "tag": "0011_position_accounting",
  "when": 1795051524320,
  "version": "7",
  "sqlHash": "0ae7e1651cd3b7d88bdf881fc89e31b2700bea59a5696e5567827c5c21634b86",
  "snapshotFile": "0011_snapshot.json",
  "snapshotHash": "5145919660be188b694fe8010a6b54ed2073aaed5fe54fbbbd9532ffdeeb10c0",
  "snapshotId": "2b3c589f-4c64-4c72-b9d6-01ede2237dd0",
  "previousSnapshotId": "03410853-4f91-427b-8fad-75caf3cb8411",
  "canonicalLineEndings": true
}
migrations.push(positionMigration)
const incrementalMigration = {
  "idx": 12,
  "tag": "0012_incremental_financial_validation",
  "when": 1795057209047,
  "version": "7",
  "sqlHash": "a5da23ac17c64c4f65519396329a65a0e7e896c2478d7b71d498a367752312f4",
  "snapshotFile": "0012_snapshot.json",
  "snapshotHash": "7d79fab5076edd1f79524b57ba815944d5c2f520390b378b3c685343eb466698",
  "snapshotId": "85dbe4e9-a292-42a2-9ed9-8e48171e34f1",
  "previousSnapshotId": "2b3c589f-4c64-4c72-b9d6-01ede2237dd0",
  "canonicalLineEndings": true
}
migrations.push(incrementalMigration)
const registryMigration = {
  "idx": 13,
  "version": "7",
  "when": 1795084251073,
  "tag": "0013_generalized_market_registry",
  "breakpoints": true,
  "sqlHash": "0641c7aa0032cb9182aa2424d7d77c543f8c4f587c8d02b5598f61b02e979f94",
  "snapshotFile": "0013_snapshot.json",
  "snapshotHash": "904ce657540622d69e696552416923c860d2ae645dba549affee36aec33e7908",
  "snapshotId": "3531ea5e-ad69-4c5e-8538-f6c5a964c14e",
  "previousSnapshotId": "85dbe4e9-a292-42a2-9ed9-8e48171e34f1",
  "canonicalLineEndings": true
}
migrations.push(registryMigration)
const eligibilityMigration = {
  "idx": 14,
  "version": "7",
  "when": 1795086935406,
  "tag": "0014_generalized_position_eligibility",
  "breakpoints": true,
  "sqlHash": "57f398699cefe08a7a9c5feb3b774e7531937ec1704f9332850363c78d5c83c5",
  "snapshotFile": "0014_snapshot.json",
  "snapshotHash": "e8635d33394b817bc6c2d5d7fa78456b41e6c3b54d8712d5e189f86019419f2f",
  "snapshotId": "97deb2fa-14cb-4017-bfc8-eccf515671b2",
  "previousSnapshotId": "3531ea5e-ad69-4c5e-8538-f6c5a964c14e",
  "canonicalLineEndings": true
}
migrations.push(eligibilityMigration)
const tradingMigration = {
  "idx": 15,
  "version": "7",
  "when": 1795089273713,
  "tag": "0015_persistent_trading_foundation",
  "breakpoints": true,
  "sqlHash": "14dcebbbb46bfeb375274f9887a23fdd2e5853aeca4d8fa7e85f6d71cb1c5884",
  "snapshotFile": "0015_snapshot.json",
  "snapshotHash": "38763cc8125bcb86623a3f8c2195467e8415e7a578f64ad16e1c3a59551abd7f",
  "snapshotId": "2e42ce7d-f31c-4abb-8592-3d700832ba49",
  "previousSnapshotId": "97deb2fa-14cb-4017-bfc8-eccf515671b2",
  "canonicalLineEndings": true
}
migrations.push(tradingMigration)
const matchingMigration = {
  "idx": 16,
  "version": "7",
  "when": 1795105796278,
  "tag": "0016_automatic_matching",
  "breakpoints": true,
  "sqlHash": "50e26640429bdcd34765688800cd07dd42754984858b35762df779ef54834599",
  "snapshotFile": "0016_snapshot.json",
  "snapshotHash": "09c7f143f931ec4916c4a04232fee78ee34fa0f9905d063d3ee60b9338862e8a",
  "snapshotId": "ece618c5-111f-48da-b0e2-aa2612023db2",
  "previousSnapshotId": "2e42ce7d-f31c-4abb-8592-3d700832ba49",
  "canonicalLineEndings": true
}
migrations.push(matchingMigration)
const marketOrderMigration = {
  "idx": 17,
  "version": "7",
  "when": 1795163308836,
  "tag": "0017_protected_market_orders",
  "breakpoints": true,
  "sqlHash": "9e5bef8be30fc49db0cdadcf304fc492bf6e76480a75d6773c82940bbcb10516",
  "snapshotFile": "0017_snapshot.json",
  "snapshotHash": "4edf872a2e6fb7d33b9d213dc56cede5819c929110c64571fd9f5fc8d1706eb4",
  "snapshotId": "5b386e29-6d70-4c92-97cd-e86e0daafa8f",
  "previousSnapshotId": "ece618c5-111f-48da-b0e2-aa2612023db2",
  "canonicalLineEndings": true
}
migrations.push(marketOrderMigration)
const lifecycleMigration = {
  "idx": 18,
  "version": "7",
  "when": 1795166161348,
  "tag": "0018_trading_lifecycle_recovery",
  "breakpoints": true,
  "sqlHash": "0e9c9d86bc6df9878daee81bac702cba4e8db83df9391ab2e38b09cb6ac8e07e",
  "snapshotFile": "0018_snapshot.json",
  "snapshotHash": "612efe28416ad36246733d4c090e66713e953d2627859ee648b1c92813f91d7e",
  "snapshotId": "43fbb559-2e62-4753-88e0-55bced3d851b",
  "previousSnapshotId": "5b386e29-6d70-4c92-97cd-e86e0daafa8f",
  "canonicalLineEndings": true
}
migrations.push(lifecycleMigration)
const schedulingMigration = {
  "idx": 19,
  "version": "7",
  "when": 1795168972918,
  "tag": "0019_recurring_market_lifecycle",
  "breakpoints": true,
  "sqlHash": "e55307755977793ca12a235c5fb9578e84c4e11aefd7bee268b51415495ac845",
  "snapshotFile": "0019_snapshot.json",
  "snapshotHash": "850cb10f7c8043fe9f2b49bc5de1d8c4d31fa538081cd9a85a23e4cbb7b0b640",
  "snapshotId": "cfde3967-7ecd-4a79-904d-eab3fe008f74",
  "previousSnapshotId": "43fbb559-2e62-4753-88e0-55bced3d851b",
  "canonicalLineEndings": true
}
migrations.push(schedulingMigration)
const capabilityMigration = {
  "idx": 20,
  "version": "7",
  "when": 1795460000000,
  "tag": "0020_custodial_capability_boundaries",
  "sqlHash": "b112da87d45865c909c2febaf862f3f0020480939f973f1e2242f2406d6c2173",
  "snapshotFile": "0020_snapshot.json",
  "snapshotHash": "627ba8882937903d8a06615940d72a54907edf04a5794c960ee9880926112bb5",
  "snapshotId": "1b097ab5-99d4-49fd-9233-b3e8da2334db",
  "previousSnapshotId": "cfde3967-7ecd-4a79-904d-eab3fe008f74",
  "canonicalLineEndings": true
}
migrations.push(capabilityMigration)

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

function validateWalletLinkArtifacts(previous, forward, sql, errors) {
  if (!previous || !forward || sql === null) return
  const expected = structuredClone(previous)
  expected.id = walletLinkMigration.snapshotId
  expected.prevId = walletLinkMigration.previousSnapshotId
  expected.tables['public.wallet_link_challenges'] = forward.tables?.['public.wallet_link_challenges']
  if (JSON.stringify(canonical(expected)) !== JSON.stringify(canonical(forward))) {
    errors.push('0008 may only add public.wallet_link_challenges to the previous snapshot')
  }
  const table = forward.tables?.['public.wallet_link_challenges']
  compareList(Object.keys(table?.columns || {}), [
    'id', 'user_id', 'session_hash', 'chain_id', 'wallet_address', 'action',
    'app_origin', 'nonce', 'typed_data', 'payload_hash', 'created_at', 'expires_at', 'consumed_at',
  ], '0008 challenge columns', errors)
  const statements = sql.split('--> statement-breakpoint').map((value) => value.trim()).filter(Boolean)
  const prefixes = [
    'CREATE TABLE "wallet_link_challenges"',
    'ALTER TABLE "wallet_link_challenges" ADD CONSTRAINT "wallet_link_challenges_user_id_fkey"',
    'ALTER TABLE "wallet_link_challenges" ADD CONSTRAINT "wallet_link_challenges_session_hash_fkey"',
    'ALTER TABLE "wallet_link_challenges" ADD CONSTRAINT "wallet_link_challenges_chain_id_fkey"',
    'CREATE INDEX "idx_wallet_link_challenges_user_created"',
    'CREATE INDEX "idx_wallet_link_challenges_session"',
    'CREATE INDEX "idx_wallet_link_challenges_expiry"',
    'CREATE FUNCTION public.protect_wallet_link_challenge()',
    'CREATE TRIGGER wallet_link_challenges_protect_state',
  ]
  if (statements.length !== prefixes.length || prefixes.some((prefix, index) => !statements[index]?.startsWith(prefix))) {
    errors.push('0008 must contain only the nine approved wallet-link statements')
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

  const finalSnapshotTables = snapshots[8]?.tables
    && typeof snapshots[8].tables === 'object'
    ? Object.entries(snapshots[8].tables)
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
  validateWalletLinkArtifacts(snapshots[7], snapshots[8], sqlFiles[8], errors)
  const ledgerTables = ['financial_assets','financial_accounts','financial_operations','financial_journals','financial_journal_entries','financial_balance_projections','cash_reservations','cash_reservation_events']
  compareList(Object.keys(snapshots[9]?.tables || {}), [...finalTables,...ledgerTables].map(name => `public.${name}`), 'ledger final snapshot tables', errors)
  for (const [key, table] of Object.entries(snapshots[8]?.tables || {})) {
    if (JSON.stringify(table) !== JSON.stringify(snapshots[9]?.tables?.[key])) errors.push(`0009 changed existing table ${key}`)
  }
  const ledgerSql = sqlFiles[9] || ''
  compareList([...ledgerSql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(match => match[1]), ledgerTables, '0009 created tables', errors)
  if (!ledgerSql.includes('DEFERRABLE INITIALLY DEFERRED') || !ledgerSql.includes('REVOKE ALL ON FUNCTION public.financial_execute')) errors.push('0009 missing deferred integrity or privilege protection')
  compareList(Object.keys(snapshots[10]?.tables || {}), [...finalTables,...ledgerTables,'financial_audit_targets'].map(name => `public.${name}`), '0010 final snapshot tables', errors)
  for (const [key, table] of Object.entries(snapshots[9]?.tables || {})) {
    if (JSON.stringify(table) !== JSON.stringify(snapshots[10]?.tables?.[key])) errors.push(`0010 changed existing table ${key}`)
  }
  const targetedSql = sqlFiles[10] || ''
  compareList([...targetedSql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(match => match[1]), ['financial_audit_targets'], '0010 internal audit table', errors)
  for (const required of ['DEFERRABLE INITIALLY DEFERRED','pg_current_xact_id()','ON CONFLICT DO NOTHING','REVOKE ALL ON TABLE public.financial_audit_targets','CREATE FUNCTION public.financial_reconcile']) {
    if (!targetedSql.includes(required)) errors.push(`0010 missing mandatory protection ${required}`)
  }
  const positionTables = ['position_accounts','position_journals','position_journal_entries','position_balance_projections','position_reservations','position_reservation_events','cash_position_settlements']
  compareList(Object.keys(snapshots[11]?.tables || {}), [...finalTables,...ledgerTables,'financial_audit_targets',...positionTables].map(name => `public.${name}`), '0011 final snapshot tables', errors)
  for (const [key, table] of Object.entries(snapshots[10]?.tables || {})) {
    const expected = structuredClone(table)
    if (key === 'public.financial_audit_targets') expected.checkConstraints.financial_audit_targets_kind_check.value = expected.checkConstraints.financial_audit_targets_kind_check.value.replace("'RESERVATION')", "'RESERVATION','POSITION_ACCOUNT','POSITION_JOURNAL','POSITION_RESERVATION','SETTLEMENT')")
    if (JSON.stringify(expected) !== JSON.stringify(snapshots[11]?.tables?.[key])) errors.push(`0011 changed unapproved existing table metadata ${key}`)
  }
  const positionSql = sqlFiles[11] || ''
  compareList([...positionSql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(match => match[1]), positionTables, '0011 created tables', errors)
  for (const required of ['CREATE FUNCTION public.position_validate','CREATE FUNCTION public.position_execute','CREATE FUNCTION public.position_guard','REVOKE ALL ON FUNCTION public.financial_cash_execute','REVOKE ALL ON TABLE public.position_accounts','position journal must be posted and balanced per token','incomplete settlement operation']) {
    if (!positionSql.includes(required)) errors.push(`0011 missing mandatory protection ${required}`)
  }
  const incrementalTables = [...finalTables,...ledgerTables,'financial_audit_targets',...positionTables,'financial_audit_deltas']
  compareList(Object.keys(snapshots[12]?.tables || {}),incrementalTables.map(name=>`public.${name}`),'0012 final snapshot tables',errors)
  for(const [key,table] of Object.entries(snapshots[11]?.tables || {})){
    const actual=structuredClone(snapshots[12]?.tables?.[key] || {})
    if(key==='public.financial_audit_targets'){
      delete actual.columns?.context_generation
      delete actual.foreignKeys?.financial_targets_delta_generation_fk
    }
    if(JSON.stringify(table)!==JSON.stringify(actual))errors.push(`0012 changed existing table ${key}`)
  }
  const incrementalSql=sqlFiles[12] || ''
  compareList([...incrementalSql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(m=>m[1]),['financial_audit_deltas'],'0012 private table',errors)
  for(const required of ["public.financial_reconcile('system:migration')",'CREATE FUNCTION public.financial_capture_baseline','CREATE FUNCTION public.financial_validate_delta','protected audit state cannot be manipulated directly','REVOKE ALL ON TABLE public.financial_audit_deltas']){
    if(!incrementalSql.includes(required))errors.push(`0012 missing protection ${required}`)
  }
  const registryTables = ['market_observation_specs','market_outcome_tokens']
  compareList(Object.keys(snapshots[13]?.tables || {}), [...incrementalTables,...registryTables].map(name=>`public.${name}`), '0013 final snapshot tables', errors)
  const changed = new Set(['public.markets','public.market_outcomes','public.ctf_conditions','public.ctf_position_tokens'])
  for(const [key,table] of Object.entries(snapshots[12]?.tables || {})) {
    if(!changed.has(key) && JSON.stringify(table)!==JSON.stringify(snapshots[13]?.tables?.[key])) errors.push(`0013 changed unrelated table ${key}`)
  }
  const registrySql=sqlFiles[13] || ''
  compareList([...registrySql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(m=>m[1]),registryTables,'0013 added registry tables',errors)
  for(const required of ['public.validate_market_definition','overlapping outcome ranges','range gap or inconsistent slot ordering','public.protect_market_outcome_token','claim does not match canonical token','ctf_conditions_market_count_check','composite token cannot masquerade as an atomic outcome','JOIN public.ctf_conditions c ON c.id=t.condition_id JOIN public.market_questions o ON o.id=c.market_question_id']) {
    if(!registrySql.includes(required)) errors.push(`0013 missing registry protection ${required}`)
  }
  compareList(Object.keys(snapshots[14]?.tables || {}), [...incrementalTables,...registryTables,'position_token_verifications'].map(name=>`public.${name}`), '0014 final snapshot tables', errors)
  for(const [key,table] of Object.entries(snapshots[13]?.tables || {})) {
    if(JSON.stringify(table)!==JSON.stringify(snapshots[14]?.tables?.[key]))errors.push(`0014 changed existing table ${key}`)
  }
  const eligibilitySql=sqlFiles[14] || ''
  compareList([...eligibilitySql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(m=>m[1]),['position_token_verifications'],'0014 eligibility table',errors)
  for(const required of ["public.financial_reconcile('system:migration')", "v.scope='MOCK_ONLY'", 'verification evidence is immutable', 'REVOKE ALL ON TABLE public.position_token_verifications', 'c.outcome_slot_count=m.outcome_count']) {
    if(!eligibilitySql.includes(required))errors.push(`0014 missing eligibility protection ${required}`)
  }
  const tradingTables=['trading_books','trading_commands','trading_orders','trading_fills','trading_order_events','trading_outbox']
  compareList(Object.keys(snapshots[15]?.tables || {}),[...Object.keys(snapshots[14]?.tables || {}),...tradingTables.map(n=>`public.${n}`)],'0015 table inventory',errors)
  for(const [name,table] of Object.entries(snapshots[14]?.tables || {})) if(JSON.stringify(table)!==JSON.stringify(snapshots[15]?.tables?.[name]))errors.push(`0015 changed existing table ${name}`)
  for(const required of ['public.trading_execute','order cash reservation mismatch','fill accounting settlement mismatch','public.trading_audit','DEFERRABLE INITIALLY DEFERRED','pg_advisory_xact_lock_shared(727190001)']) if(!(sqlFiles[15]||'').includes(required))errors.push(`0015 missing trading protection ${required}`)
  compareList(Object.keys(snapshots[16]?.tables || {}),[...Object.keys(snapshots[15]?.tables || {}),'public.matching_markets','public.matching_requests'],'0016 table inventory',errors)
  for(const [name,table] of Object.entries(snapshots[15]?.tables || {})) if(JSON.stringify(table)!==JSON.stringify(snapshots[16]?.tables?.[name]))errors.push(`0016 changed existing table ${name}`)
  for(const required of ['direct fill disabled','public.matching_step','mr.sequence<r.sequence','maker.limit_price_cents','SELF_TRADE_PREVENTION','missing or fabricated matching progress','DEFERRABLE INITIALLY DEFERRED']) if(!(sqlFiles[16]||'').includes(required))errors.push(`0016 missing matching protection ${required}`)
  compareList(Object.keys(snapshots[17]?.tables || {}),[...Object.keys(snapshots[16]?.tables || {}),'public.trading_order_policies'],'0017 table inventory',errors)
  for(const [name,table] of Object.entries(snapshots[16]?.tables || {})) if(JSON.stringify(table)!==JSON.stringify(snapshots[17]?.tables?.[name]))errors.push(`0017 changed existing table ${name}`)
  for(const required of ['public.trading_accept_market','IOC orders cannot become resting makers','market BUY requires an exact spending cap','IOC_SPENDING_CAP','public.matching_quote','STABLE SECURITY DEFINER','max_spend_cents','order execution policy is immutable']) if(!(sqlFiles[17]||'').includes(required))errors.push(`0017 missing market order protection ${required}`)


  compareList(Object.keys(snapshots[18]?.tables || {}),[...Object.keys(snapshots[17]?.tables || {}),'public.trading_event_stream','public.trading_event_cursors'],'0018 table inventory',errors)
  for(const [name,table] of Object.entries(snapshots[17]?.tables || {})) {
    const expected=structuredClone(table)
    if(name==='public.trading_orders')expected.indexes.trading_orders_lifecycle_idx={...snapshots[18].tables[name].indexes.trading_orders_lifecycle_idx}
    if(JSON.stringify(expected)!==JSON.stringify(snapshots[18]?.tables?.[name]))errors.push(`0018 changed unexpected table metadata ${name}`)
  }
  for(const required of ['public.matching_expire','public.trading_event_ack','acknowledgement must identify the exact next event prefix','DEFERRABLE INITIALLY DEFERRED','public.matching_diagnostics','event stream is immutable','LIMIT p_limit','REVOKE ALL','public.financial_reconcile']) if(!(sqlFiles[18]||'').includes(required))errors.push(`0018 missing lifecycle protection ${required}`)

  compareList(Object.keys(snapshots[19]?.tables || {}),[...Object.keys(snapshots[18]?.tables || {}),'public.market_templates','public.market_template_controls','public.market_rounds','public.market_round_requirements','public.market_round_observations','public.market_lifecycle_events','public.market_lifecycle_cursors'],'0019 table inventory',errors)
  for(const [name,table] of Object.entries(snapshots[18]?.tables || {})) if(JSON.stringify(table)!==JSON.stringify(snapshots[19]?.tables?.[name]))errors.push(`0019 changed existing table ${name}`)
  for(const required of ['public.market_schedule_create_round','ambiguous or nonexistent local schedule boundary','scope','MOCK_ONLY','public.market_schedule_step','SETUP_REQUIRED','public.matching_expire','exact next lifecycle event prefix required','REVOKE ALL']) if(!(sqlFiles[19]||'').includes(required))errors.push(`0019 missing lifecycle protection ${required}`)

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
        'packages/db/migrations/0012_incremental_financial_validation.sql',
        'packages/db/migrations/meta/0012_snapshot.json',
        'packages/db/migrations/0019_recurring_market_lifecycle.sql',
        'packages/db/migrations/meta/0019_snapshot.json',
        'packages/db/migrations/0018_trading_lifecycle_recovery.sql',
        'packages/db/migrations/meta/0018_snapshot.json',
        'packages/db/migrations/0017_protected_market_orders.sql',
        'packages/db/migrations/meta/0017_snapshot.json',
        'packages/db/migrations/0016_automatic_matching.sql',
        'packages/db/migrations/meta/0016_snapshot.json',
        'packages/db/migrations/0015_persistent_trading_foundation.sql',
        'packages/db/migrations/meta/0015_snapshot.json',
        'packages/db/migrations/0014_generalized_position_eligibility.sql',
        'packages/db/migrations/meta/0014_snapshot.json',
        'packages/db/migrations/0013_generalized_market_registry.sql',
        'packages/db/migrations/meta/0013_snapshot.json',
        'packages/db/migrations/0011_position_accounting.sql',
        'packages/db/migrations/meta/0011_snapshot.json',
        'packages/db/migrations/0010_targeted_financial_audits.sql',
        'packages/db/migrations/meta/0010_snapshot.json',
        'packages/db/migrations/0009_financial_ledger.sql',
        'packages/db/migrations/meta/0009_snapshot.json',
        'packages/db/migrations/0008_wallet_link_challenges.sql',
        'packages/db/migrations/meta/0008_snapshot.json',
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
    ['modified 0019 SQL',fixture=>appendFileSync(join(fixture,'packages/db/migrations/0019_recurring_market_lifecycle.sql'),'-- changed')],
    ['missing 0019 SQL',fixture=>rmSync(join(fixture,'packages/db/migrations/0019_recurring_market_lifecycle.sql'))],
    ['modified 0019 snapshot',fixture=>appendFileSync(join(fixture,'packages/db/migrations/meta/0019_snapshot.json'),' ')],
    ['broken 0019 lineage',fixture=>{const path=join(fixture,'packages/db/migrations/meta/0019_snapshot.json');const value=JSON.parse(readFileSync(path,'utf8'));value.prevId=zeroSnapshotId;writeJson(path,value)}],
    ['removed scheduler verification gate',fixture=>{const path=join(fixture,'packages/db/migrations/0019_recurring_market_lifecycle.sql');writeFileSync(path,readFileSync(path,'utf8').replace('SETUP_REQUIRED','removed'))}],
    ['modified 0018 SQL',fixture=>appendFileSync(join(fixture,'packages/db/migrations/0018_trading_lifecycle_recovery.sql'),'-- changed')],
    ['missing 0018 SQL',fixture=>rmSync(join(fixture,'packages/db/migrations/0018_trading_lifecycle_recovery.sql'))],
    ['modified 0018 snapshot',fixture=>appendFileSync(join(fixture,'packages/db/migrations/meta/0018_snapshot.json'),' ')],
    ['broken 0018 lineage',fixture=>{const path=join(fixture,'packages/db/migrations/meta/0018_snapshot.json');const value=JSON.parse(readFileSync(path,'utf8'));value.prevId=zeroSnapshotId;writeJson(path,value)}],
    ['removed recovery prefix guard',fixture=>{const path=join(fixture,'packages/db/migrations/0018_trading_lifecycle_recovery.sql');writeFileSync(path,readFileSync(path,'utf8').replace('acknowledgement must identify the exact next event prefix','removed'))}],
    ['modified 0017 SQL',fixture=>appendFileSync(join(fixture,'packages/db/migrations/0017_protected_market_orders.sql'),'-- changed')],
    ['missing 0017 SQL',fixture=>rmSync(join(fixture,'packages/db/migrations/0017_protected_market_orders.sql'))],
    ['modified 0017 snapshot',fixture=>appendFileSync(join(fixture,'packages/db/migrations/meta/0017_snapshot.json'),' ')],
    ['broken 0017 lineage',fixture=>{const path=join(fixture,'packages/db/migrations/meta/0017_snapshot.json');const value=JSON.parse(readFileSync(path,'utf8'));value.prevId=zeroSnapshotId;writeJson(path,value)}],
    ['removed IOC cap guard',fixture=>{const path=join(fixture,'packages/db/migrations/0017_protected_market_orders.sql');writeFileSync(path,readFileSync(path,'utf8').replace('market BUY requires an exact spending cap','removed'))}],
    ['modified 0016 SQL',fixture=>appendFileSync(join(fixture,'packages/db/migrations/0016_automatic_matching.sql'),'-- changed')],
    ['missing 0016 SQL',fixture=>rmSync(join(fixture,'packages/db/migrations/0016_automatic_matching.sql'))],
    ['modified 0016 snapshot',fixture=>appendFileSync(join(fixture,'packages/db/migrations/meta/0016_snapshot.json'),' ')],
    ['modified 0015 SQL',fixture=>appendFileSync(join(fixture,'packages/db/migrations/0015_persistent_trading_foundation.sql'),'-- changed')],
    ['missing 0015 SQL',fixture=>rmSync(join(fixture,'packages/db/migrations/0015_persistent_trading_foundation.sql'))],
    ['modified 0015 snapshot',fixture=>appendFileSync(join(fixture,'packages/db/migrations/meta/0015_snapshot.json'),' ')],
    ['broken 0015 lineage',fixture=>{const path=join(fixture,'packages/db/migrations/meta/0015_snapshot.json');const value=JSON.parse(readFileSync(path,'utf8'));value.prevId=zeroSnapshotId;writeJson(path,value)}],
    ['removed fill settlement validation',fixture=>{const path=join(fixture,'packages/db/migrations/0015_persistent_trading_foundation.sql');writeFileSync(path,readFileSync(path,'utf8').replace('fill accounting settlement mismatch','removed'))}],
    ['modified 0014 SQL',fixture=>appendFileSync(join(fixture,'packages/db/migrations/0014_generalized_position_eligibility.sql'),'-- changed')],
    ['missing 0014 SQL',fixture=>rmSync(join(fixture,'packages/db/migrations/0014_generalized_position_eligibility.sql'))],
    ['modified 0014 snapshot',fixture=>appendFileSync(join(fixture,'packages/db/migrations/meta/0014_snapshot.json'),' ')],
    ['broken 0014 lineage',fixture=>{const path=join(fixture,'packages/db/migrations/meta/0014_snapshot.json');const value=JSON.parse(readFileSync(path,'utf8'));value.prevId=zeroSnapshotId;writeJson(path,value)}],
    ['removed mock eligibility',fixture=>{const path=join(fixture,'packages/db/migrations/0014_generalized_position_eligibility.sql');writeFileSync(path,readFileSync(path,'utf8').replace("v.scope='MOCK_ONLY'",'true'))}],
    ['modified 0013 SQL',fixture=>appendFileSync(join(fixture,'packages/db/migrations/0013_generalized_market_registry.sql'),'\n-- modified')],
    ['missing 0013 SQL',fixture=>rmSync(join(fixture,'packages/db/migrations/0013_generalized_market_registry.sql'))],
    ['modified 0013 snapshot',fixture=>appendFileSync(join(fixture,'packages/db/migrations/meta/0013_snapshot.json'),' ')],
    ['broken 0013 lineage',fixture=>{const path=join(fixture,'packages/db/migrations/meta/0013_snapshot.json');const value=JSON.parse(readFileSync(path,'utf8'));value.prevId=zeroSnapshotId;writeJson(path,value)}],
    ['removed range validation',fixture=>{const path=join(fixture,'packages/db/migrations/0013_generalized_market_registry.sql');writeFileSync(path,readFileSync(path,'utf8').replace('overlapping outcome ranges','overlap removed'))}],

    ['modified 0012 SQL',fixture=>appendFileSync(join(fixture,'packages/db/migrations/0012_incremental_financial_validation.sql'),'\n-- modified')],
    ['missing 0012 SQL',fixture=>rmSync(join(fixture,'packages/db/migrations/0012_incremental_financial_validation.sql'))],
    ['modified 0012 snapshot',fixture=>appendFileSync(join(fixture,'packages/db/migrations/meta/0012_snapshot.json'),' ')],
    ['broken 0012 lineage',fixture=>{const path=join(fixture,'packages/db/migrations/meta/0012_snapshot.json');const snapshot=JSON.parse(readFileSync(path,'utf8'));snapshot.prevId=zeroSnapshotId;writeJson(path,snapshot)}],
    ['missing incremental adoption reconciliation',fixture=>{const path=join(fixture,'packages/db/migrations/0012_incremental_financial_validation.sql');writeFileSync(path,readFileSync(path,'utf8').replace("PERFORM public.financial_reconcile('system:migration');",'NULL;'))}],
    ['modified 0011 sql', fixture => appendFileSync(join(fixture,'packages/db/migrations/0011_position_accounting.sql'),'\n-- changed')],
    ['missing 0011 sql', fixture => rmSync(join(fixture,'packages/db/migrations/0011_position_accounting.sql'))],
    ['modified 0011 snapshot', fixture => appendFileSync(join(fixture,'packages/db/migrations/meta/0011_snapshot.json'),' ')],
    ['broken 0011 lineage', fixture => {
      const path=join(fixture,'packages/db/migrations/meta/0011_snapshot.json')
      const snapshot=JSON.parse(readFileSync(path,'utf8'));snapshot.prevId=zeroSnapshotId;writeJson(path,snapshot)
    }],
    ['missing position settlement integrity', fixture => {
      const path=join(fixture,'packages/db/migrations/0011_position_accounting.sql')
      writeFileSync(path,readFileSync(path,'utf8').replace("RAISE EXCEPTION 'incomplete settlement operation'",'NULL'))
    }],
    ['modified 0010 sql', fixture => appendFileSync(join(fixture, 'packages/db/migrations/0010_targeted_financial_audits.sql'), '\n-- changed')],
    ['missing 0010 sql', fixture => rmSync(join(fixture, 'packages/db/migrations/0010_targeted_financial_audits.sql'))],
    ['modified 0010 snapshot', fixture => {
      const path = join(fixture, 'packages/db/migrations/meta/0010_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8')); snapshot.tables['public.financial_audit_targets'].columns.target_id.notNull=false; writeJson(path,snapshot)
    }],
    ['broken 0010 lineage', fixture => {
      const path = join(fixture, 'packages/db/migrations/meta/0010_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path,'utf8')); snapshot.prevId=zeroSnapshotId; writeJson(path,snapshot)
    }],
    ['modified 0009 sql', fixture => appendFileSync(join(fixture, 'packages/db/migrations/0009_financial_ledger.sql'), '\n-- changed')],
    ['missing 0009 sql', fixture => rmSync(join(fixture, 'packages/db/migrations/0009_financial_ledger.sql'))],
    ['modified 0009 snapshot', fixture => {
      const path = join(fixture, 'packages/db/migrations/meta/0009_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.financial_journal_entries'].columns.amount.notNull = false
      writeJson(path, snapshot)
    }],
    ['broken 0009 lineage', fixture => {
      const path = join(fixture, 'packages/db/migrations/meta/0009_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8')); snapshot.prevId = zeroSnapshotId; writeJson(path, snapshot)
    }],
    ['modified 0008 sql', (fixture) => {
      appendFileSync(join(fixture, 'packages/db/migrations/0008_wallet_link_challenges.sql'), '\n-- changed')
    }],
    ['modified 0008 snapshot', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0008_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.tables['public.wallet_link_challenges'].columns.nonce.notNull = false
      writeJson(path, snapshot)
    }],
    ['missing 0008 migration', (fixture) => {
      rmSync(join(fixture, 'packages/db/migrations/0008_wallet_link_challenges.sql'))
    }],
    ['broken 0008 snapshot lineage', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/meta/0008_snapshot.json')
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      snapshot.prevId = zeroSnapshotId
      writeJson(path, snapshot)
    }],
    ['modified wallet challenge protection', (fixture) => {
      const path = join(fixture, 'packages/db/migrations/0008_wallet_link_challenges.sql')
      writeFileSync(path, readFileSync(path, 'utf8').replace('BEFORE INSERT OR UPDATE', 'BEFORE INSERT'))
    }],
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
