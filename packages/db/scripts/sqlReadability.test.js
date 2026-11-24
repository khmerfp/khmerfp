import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalSqlHash, sqlTokens, verifyReadingCopies } from './sqlReadability.js'

const same = (before, after) => assert.deepEqual(sqlTokens(before), sqlTokens(after))
const different = (before, after) => assert.notDeepEqual(sqlTokens(before), sqlTokens(after))

test('formatting preserves token boundaries, parameter positions and quoted values', () => {
  same(
    "select id, amount from public.accounts where id=$1 and status='OPEN';",
    "-- Read the account.\nSELECT id, amount\nFROM public.accounts\nWHERE id = $1 AND status = 'OPEN';",
  )
  different('SELECT account_id FROM entries', 'SELECT accountid FROM entries')
  different('SELECT $1, $2', 'SELECT $2, $1')
})

test('quoted case, whitespace and comment-looking text stay significant', () => {
  different("SELECT 'a b'", "SELECT 'ab'")
  different('SELECT "Account"', 'SELECT "account"')
  different("SELECT '-- not a comment'", "SELECT '-- changed'")
  same("SELECT 'it''s intact'", "select 'it''s intact'")
})

test('PL/pgSQL bodies are checked recursively rather than ignored as opaque strings', () => {
  same(
    "DO $$ BEGIN IF x>0 THEN RAISE EXCEPTION 'No'; END IF; END $$;",
    "DO $$\nBEGIN\n-- enforce the original condition\nIF x > 0 THEN\nRAISE EXCEPTION 'No';\nEND IF;\nEND $$;",
  )
  different('DO $$ BEGIN x:=1; END $$;', 'DO $$ BEGIN x:=2; END $$;')
  different(
    "DO $$ BEGIN EXECUTE 'DELETE FROM x'; END $$;",
    "DO $$ BEGIN EXECUTE 'DELETE FROM y'; END $$;",
  )
})

test('operators, boolean precedence, statement order and security rules remain significant', () => {
  for (const [before, after] of [
    ['SELECT x>=1', 'SELECT x>1'],
    ['SELECT (a OR b) AND c', 'SELECT a OR (b AND c)'],
    ['BEGIN; UPDATE a SET b=1; COMMIT;', 'BEGIN; COMMIT; UPDATE a SET b=1;'],
    ['REVOKE ALL ON TABLE x FROM PUBLIC;', 'GRANT ALL ON TABLE x TO PUBLIC;'],
    [
      'CREATE FUNCTION f() RETURNS void SECURITY DEFINER',
      'CREATE FUNCTION f() RETURNS void SECURITY INVOKER',
    ],
  ])
    different(before, after)
})

test('nested comments are allowed, while malformed quotes and bodies fail closed', () => {
  same('SELECT /* outer /* nested */ still outer */ 1', 'SELECT 1')
  for (const text of ["SELECT 'unfinished", 'DO $$ BEGIN', 'SELECT /* unfinished']) {
    assert.throws(() => sqlTokens(text), /Unterminated/)
  }
})

test('hash policy ignores CRLF only and still detects other content changes', () => {
  assert.equal(canonicalSqlHash('SELECT 1;\r\n'), canonicalSqlHash('SELECT 1;\n'))
  assert.notEqual(canonicalSqlHash('SELECT 1;'), canonicalSqlHash('SELECT  1;'))
})

test('all reading copies preserve pinned source hashes, SQL tokens and migration boundaries', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  assert.equal(verifyReadingCopies(root), 22)
})

test('ordinary dollar-quoted values retain whitespace, case and comment-looking data', () => {
  different('SELECT $$a  b$$', 'SELECT $$a b$$')
  different('SELECT $tag$Hello$tag$', 'SELECT $tag$hello$tag$')
  different('SELECT $$-- data$$', 'SELECT $$-- changed$$')
  same(
    'DO LANGUAGE plpgsql $$ BEGIN NULL; END $$;',
    'DO LANGUAGE plpgsql $$ BEGIN /* note */ NULL; END $$;',
  )
})
