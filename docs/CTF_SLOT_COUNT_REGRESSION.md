# CTF slot-count regression verification

Stage 4.3F, 2026-11-16, feature/matching-contract-mvp.

## Root cause

The database was correct. The invalid-slot-count fixture omitted
oracle_contract_deployment_id while its market question required a specific oracle.
PostgreSQL runs BEFORE triggers before table CHECK constraints. The existing
enforce_ctf_condition_registry trigger therefore rejected the oracle mismatch first:

```text
SQLSTATE: P0001
Message: CTF condition oracle does not match the market question
Constraint: none
Function: enforce_ctf_condition_registry
```

The slot-count CHECK exists and is correct. With the matching confirmed ORACLE
deployment supplied, outcome_slot_count=3 fails with SQLSTATE 23514 and named
constraint ctf_conditions_outcome_slot_count_check.

## Before and after 0008

The unchanged full runner first reproduced the failure on fresh disposable
PostgreSQL 16. A second empty database ran testCtfSlotCount.js. It copied only
0000–0007 and an eight-entry journal into a temporary test folder, applied them
through Drizzle, verified eight history rows and no wallet challenge table, and
ran four cases. It then applied the real migration folder through 0008, verified
nine history rows, and repeated exactly those cases:

| Case | Before 0008 | After 0008 |
| --- | --- | --- |
| Missing oracle, invalid slot count | P0001, oracle mismatch | Identical |
| Matching oracle, invalid slot count | 23514, named slot-count CHECK | Identical |
| Matching oracle, malformed condition ID | 23514, named condition-ID CHECK | Identical |
| Valid binary condition | Accepted as DERIVED | Identical |

The complete CTF trigger definition remained byte-identical. SHA-256:
`d36627abab6077a81187a54f0661ab6020f91ebd38edc7137dfaa97f244afdb6`.
This proves the fixture issue existed before 0008.

## Correction and results

The full runner's invalid-slot-count INSERT now supplies the existing
oracleDeploymentId. Its exact named CHECK assertion stays unchanged. A separate
strict negative assertion verifies the original missing-oracle trigger rejection.
No schema, migration, trigger, wallet ownership or trading permission rule changed.

On another fresh disposable PostgreSQL 16 instance:

- The complete nine-migration runner passed, including all 21 table catalogs,
  protection objects and CTF negative/lifecycle checks.
- Nine history rows matched. Repeat migration preserved history and the whole-schema fingerprint.
- All ten wallet-linking scenarios passed again (12 Node tests, zero skips/failures), including restart.
- Artifact validation and negative tests passed; pinned migration content stayed unchanged.
- Existing normalization/transaction tests passed.
- Drizzle consistency passed and generation found no schema changes.
- Backend regressions: 334 passed, 17 optional tests skipped, zero failed.
- Lint and git diff whitespace checks passed.

These are local equivalents of database CI, not a GitHub Actions result. Nothing
was committed or pushed. Remote combined CI remains pending.

## Repeat safely

Use Node.js 22 and an explicitly disposable, empty PostgreSQL 16 database named
khmerfp_ctf_regression_test on a loopback host. Set NODE_ENV=test,
CTF_REGRESSION_TEST_DISPOSABLE=true and CTF_REGRESSION_TEST_DATABASE_URL to its
dedicated test URL. Never use the application database. Run from the repository:

```powershell
node packages/db/scripts/testCtfSlotCount.js
```

The script rejects other hosts/database names, wrong versions, unexpected search
paths and existing objects. It never loads server/.env or falls back to DATABASE_URL.
All fixtures/savepoints share one client and roll back. Temporary migration copies
are removed; original SQL, snapshots and journal are never rewritten.

Real Coinbase proof, dependency review and application database adoption remain
activation gates. Linking stays disabled. No hosted database, real funds or
blockchain deployment was used. The local checks are ready for reviewed CI execution.
