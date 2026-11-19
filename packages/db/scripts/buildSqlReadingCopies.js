// Generates commented reading copies only; never rewrites executable source SQL.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { sqlTokens, canonicalSqlHash } from './sqlReadability.js'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const { values } = parseArgs({
  options: { formatter: { type: 'string' }, perl: { type: 'string' }, help: { type: 'boolean' } },
})
if (values.help) {
  console.log(
    'Usage: node packages/db/scripts/buildSqlReadingCopies.js --formatter /path/to/pgFormatter/pg_format [--perl /path/to/perl]',
  )
  console.log(
    'Use the pinned pgFormatter checkout recorded in sql-reference/manifest.json. Only reading copies are written.',
  )
  process.exit(0)
}
if (!values.formatter)
  throw new Error('Explicit path to the reviewed pgFormatter checkout is required')
const formatter = path.resolve(values.formatter)
const tool = path.dirname(formatter)
const expectedRevision = '3aab449352e0dc852a2385f4df8359812b98f5c3'
assert.equal(
  execFileSync('git', ['-C', tool, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  expectedRevision,
  'Use the reviewed pgFormatter revision',
)
const perl = values.perl || 'perl'
const options = [
  path.basename(formatter),
  '-X',
  '-u',
  '2',
  '-U',
  '0',
  '-f',
  '0',
  '-s',
  '4',
  '-L',
  '--no-space-function',
]
const sqlDir = path.join(root, 'packages/db/sql-reference')
const sources = fs
  .readdirSync(path.join(root, 'packages/db/migrations'))
  .filter((n) => n.endsWith('.sql'))
  .sort()
  .map((n) => 'packages/db/migrations/' + n)
sources.push('packages/db/proposals/wallet_link_challenges.sql')
const purposes = Object.fromEntries(
  [
    ...fs
      .readFileSync(path.join(root, 'docs/architecture/IMPLEMENTED_DATABASE_ERD.md'), 'utf8')
      .matchAll(/^\| `(\w+)` \| (.*?) \|$/gm),
  ].map((m) => [m[1], m[2]]),
)
const explanations = {
  protect_frozen_market_terms:
    'Requires a complete binary question/outcome set before freezing; protects frozen terms and permits only the existing lifecycle transitions.',
  protect_user_wallet_identity:
    'Prevents reassignment of the wallet owner, chain or address after identity registration.',
  protect_wallet_authorization_state:
    'Protects authorization terms, target chain, expiry and revocation state without granting on-chain transfer permissions.',
  enforce_ctf_condition_registry:
    'Checks binary condition identity, market question, collateral chain, deployment roles and allowed preparation lifecycle.',
  enforce_ctf_position_token_registry:
    'Binds each immutable YES/NO position identity to its condition, matching outcome index and collateral.',
  protect_ctf_chain_asset_identity:
    'Rejects changes to collateral identity once a registered CTF condition depends on that asset.',
  protect_ctf_contract_deployment_identity:
    'Rejects changes to deployment identity used by a CTF condition while retaining the separately managed operational fields.',
  financial_execute:
    'Executes authorized financial operations; later versions extend dispatch to positions. The caller owns the transaction and deferred commit checks.',
  financial_cash_execute:
    'Validates actor and canonical terms, handles idempotency, locks accounts, and executes the selected cash operation.',
  position_execute:
    'Validates token identity and ownership, locks cash before positions, and executes transfers, holds, rebuilds or atomic settlement.',
  financial_immutable:
    'Rejects changes to immutable accounting records; corrections use eligible compensating entries.',
  financial_guard:
    'Protects cash journals, entries, reservations, projections and completed operation results during mutation.',
  position_guard:
    'Protects position identity, journal posting, whole-share quantities and nonnegative spendable inventory.',
  position_validate:
    'Independently validates a position account, journal, reservation or linked cash/share settlement.',
  financial_audit:
    'Historical full-history commit audit. Later migrations replace its trigger use, while preserving reconciliation.',
  financial_reconcile:
    'Checks authoritative cash history against projections without repairing it or creating financial credits.',
  financial_schedule_audit:
    'Queues affected records for mandatory transaction-end checks without rescanning unrelated history.',
  financial_validate_target:
    'Validates the selected journal/account/reservation/operation/settlement and removes its completed audit context.',
  financial_capture_baseline:
    'Captures the locked account or reservation state before its first transaction mutation; rebuilds require the exclusive maintenance gate.',
  financial_accumulate_delta:
    'Derives expected changes from newly inserted immutable entries and reservation events, not supplied projection values.',
  financial_validate_delta:
    'Compares final counters and projections with protected baselines plus authoritative deltas; validates new reservation event links.',
  financial_queue_audit:
    'Binds a deduplicated target to the current transaction and protected baseline generation.',
  financial_protect_delta:
    'Rejects direct audit-state manipulation, baseline replacement and unauthorized rebuild context changes.',
  financial_protect_target:
    'Protects audit target identity, scheduling and cleanup from direct runtime manipulation.',
  financial_delta_link_check:
    'Rejects an orphan baseline at commit; forced earlier validation may already have removed a checked generation.',
  bakong_payments_fill_amount_minor:
    'Legacy BEFORE INSERT compatibility: fill missing minor units from the existing amount and currency only.',
  protect_wallet_link_challenge:
    'Protects immutable, session-bound challenge terms and atomic one-time consumption.',
}
function section(sql) {
  const first = sql.replace(/--[^\n]*(?:\n|$)/g, '').trim()
  if (/^CREATE\s+EXTENSION/i.test(first)) return 'EXTENSIONS'
  if (/^CREATE\s+TABLE/i.test(first)) return 'TABLES'
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX/i.test(first)) return 'INDEXES'
  if (/^(?:ALTER\s+TABLE|DROP\s+CONSTRAINT)/i.test(first))
    return 'CONSTRAINTS AND TABLE ALTERATIONS'
  if (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)/i.test(first))
    return 'FUNCTIONS AND STORED PROCEDURES'
  if (/^(?:CREATE\s+(?:CONSTRAINT\s+)?TRIGGER|DROP\s+TRIGGER)/i.test(first)) return 'TRIGGERS'
  if (/^(?:REVOKE|GRANT|ALTER\s+(?:FUNCTION|PROCEDURE).*OWNER)/i.test(first))
    return 'PERMISSIONS AND SECURITY'
  if (/^(?:DO\b|LOCK\s+TABLE|SELECT\s+pg_advisory)/i.test(first))
    return 'VALIDATION AND TRANSACTION SAFETY'
  return 'REQUIRED DATA AND MIGRATION OPERATIONS'
}
function describe(sql) {
  const table = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/i.exec(sql)
  if (table)
    return (
      '-- ' +
      (purposes[table[1]] || 'Defines ' + table[1] + ' and its original integrity rules.') +
      '\n'
    )
  const fn = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)/i.exec(sql)
  if (fn)
    return (
      '-- ' +
      (explanations[fn[1]] ||
        'Implements ' +
          fn[1] +
          '. Keep its validation and execution order unchanged; later migrations may replace this version.') +
      '\n'
    )
  const trigger = /CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+"?(\w+)/i.exec(sql)
  if (trigger) {
    const invoked = /EXECUTE FUNCTION\s+(?:public\.)?(\w+)/i.exec(sql)
    const reason = invoked && explanations[invoked[1]]
    return (
      '-- ' +
      (reason || 'Invokes the original database protection or bookkeeping function.') +
      '\n' +
      '-- ' +
      (/DEFERRABLE/i.test(sql)
        ? 'Mandatory deferred integrity check; validation must succeed before the transaction commits.'
        : 'Runs the original protection or bookkeeping function at its declared timing and event.') +
      '\n'
    )
  }
  return ''
}
function annotateSteps(sql) {
  return sql
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trim()
      let note
      if (/PERFORM\s+pg_advisory_xact_lock/.test(trimmed))
        note = 'Coordinate maintenance and financial operations before acquiring record locks.'
      if (/^INSERT INTO public\.financial_operations/.test(trimmed))
        note = 'Claim the actor-bound idempotency key before applying financial changes.'
      if (/^ELSIF p_action\s*=\s*'SETTLE'/.test(trimmed))
        note =
          'Atomic settlement: validate market and reservations, then move cash and shares in this same transaction.'
      if (/^INSERT INTO public\.(financial_journals|position_journals)/.test(trimmed))
        note = 'Create the journal header before its immutable accounting lines.'
      if (/^UPDATE public\.(financial_journals|position_journals)/.test(trimmed))
        note = 'Post only after all lines exist; later changes to posted history are forbidden.'
      if (/^DELETE FROM public\.financial_audit_targets/.test(trimmed))
        note = 'Remove protected transaction state only after the required validation succeeds.'
      return note ? [line.match(/^\s*/)[0] + '-- ' + note, line] : [line]
    })
    .join('\n')
}
const manifest = {
  purpose: 'Reading copies only. Never migrate or execute this directory.',
  formatter: {
    repository: 'https://github.com/darold/pgFormatter',
    commit: '3aab449352e0dc852a2385f4df8359812b98f5c3',
    options: options.slice(1),
  },
  files: [],
}
// Refuse to publish a reading copy of an edited historical migration.
const committedSources = new Set(
  execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', 'packages/db/migrations'], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split(/\r?\n/),
)
const pending = []
for (const source of sources) {
  const original = fs.readFileSync(path.join(root, source), 'utf8')
  if (committedSources.has(source)) {
    const committed = execFileSync('git', ['show', 'HEAD:' + source], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(
      canonicalSqlHash(original),
      canonicalSqlHash(committed),
      'Historical migration was edited; restore it before generating reading copies: ' + source,
    )
  }
  let last
  const chunks = original.split('--> statement-breakpoint').map((chunk) => {
    if (!chunk.trim()) return chunk
    const formatted = execFileSync(perl, options, {
      cwd: tool,
      input: chunk,
      encoding: 'utf8',
      maxBuffer: 10e6,
    })
    assert.deepEqual(
      sqlTokens(formatted),
      sqlTokens(chunk),
      'Formatter changed SQL tokens: ' + source,
    )
    const category = section(chunk)
    let heading = ''
    if (category !== last) {
      heading =
        '\n-- ============================================================================\n-- ' +
        category +
        ' (original execution order preserved)\n-- ============================================================================\n'
      last = category
    }
    return heading + describe(chunk) + annotateSteps(formatted).trim() + '\n'
  })
  const copy =
    'packages/db/sql-reference/' +
    (source.includes('/proposals/') ? 'proposal_' : '') +
    path.basename(source)
  const rawOutput =
    '-- READING COPY ONLY: do not execute or use as a migration.\n-- Executable source: ' +
    source +
    '\n-- Original statement order, object names, quoted values and Drizzle boundaries are preserved.\n-- Function versions are historical: apply the migration chain to determine the current definition.\n' +
    chunks.join('\n--> statement-breakpoint\n')
  const output = rawOutput
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
  assert.deepEqual(
    sqlTokens(output),
    sqlTokens(original),
    'Reading copy changed SQL tokens: ' + source,
  )
  pending.push([copy, output])
  manifest.files.push({
    source,
    copy,
    sourceSha256: canonicalSqlHash(original),
    copySha256: canonicalSqlHash(output),
  })
}
// A concurrent editor must not leave the reference inventory claiming stale inputs.
for (const entry of manifest.files) {
  assert.equal(
    canonicalSqlHash(fs.readFileSync(path.join(root, entry.source), 'utf8')),
    entry.sourceSha256,
    'Source changed during generation: ' + entry.source,
  )
}
fs.mkdirSync(sqlDir, { recursive: true })
for (const [file, text] of pending) fs.writeFileSync(path.join(root, file), text)
fs.writeFileSync(path.join(sqlDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(
  'Generated ' +
    pending.length +
    ' token-equivalent reading copies; no executable migration touched.',
)
