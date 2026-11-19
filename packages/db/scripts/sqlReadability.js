// Compare reading copies without changing executable migration artifacts.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const canonicalSqlHash = (text) =>
  createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex')

// Ignore layout/comments and unquoted case only. Quoted text, operators and
// statement order remain significant, including inside PL/pgSQL dollar bodies.
export function sqlTokens(text) {
  const tokens = []
  let position = 0
  while (position < text.length) {
    const rest = text.slice(position)
    const whitespace = /^\s+/.exec(rest)
    if (whitespace) {
      position += whitespace[0].length
      continue
    }
    if (rest.startsWith('--')) {
      const end = text.indexOf('\n', position)
      position = end < 0 ? text.length : end + 1
      continue
    }
    if (rest.startsWith('/*')) {
      let depth = 1
      position += 2
      while (depth && position < text.length) {
        if (text.startsWith('/*', position)) {
          depth++
          position += 2
        } else if (text.startsWith('*/', position)) {
          depth--
          position += 2
        } else position++
      }
      if (depth) throw new Error('Unterminated SQL comment')
      continue
    }
    const dollar = /^(?:\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/.exec(rest)
    if (dollar) {
      const delimiter = dollar[0]
      const end = text.indexOf(delimiter, position + delimiter.length)
      if (end < 0) throw new Error('Unterminated dollar-quoted SQL body')
      const previous = tokens.at(-1)
      const isCodeBody = previous?.[0] === 'word' && ['as', 'do'].includes(previous[1])
      const doLanguageBody =
        tokens
          .slice(-3)
          .map((token) => token[1])
          .slice(0, 2)
          .join(' ') === 'do language'
      if (isCodeBody || doLanguageBody) {
        tokens.push(['body', delimiter, sqlTokens(text.slice(position + delimiter.length, end))])
      } else {
        // Dollar quotes used as data are not function code: preserve their exact contents.
        tokens.push(['quoted', text.slice(position, end + delimiter.length)])
      }
      position = end + delimiter.length
      continue
    }
    if (rest[0] === "'" || rest[0] === '"') {
      const quote = rest[0],
        start = position++
      let closed = false
      while (position < text.length) {
        if (text[position] === quote) {
          if (text[position + 1] === quote) {
            position += 2
            continue
          }
          position++
          closed = true
          break
        }
        // E-string escapes are retained exactly, never normalized.
        if (text[position] === '\\' && quote === "'" && /[eE]/.test(text[start - 1] || ''))
          position++
        position++
      }
      if (!closed) throw new Error('Unterminated SQL quote')
      tokens.push(['quoted', text.slice(start, position)])
      continue
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(rest)
    if (word) {
      tokens.push(['word', word[0].toLowerCase()])
      position += word[0].length
      continue
    }
    const parameter = /^\$[0-9]+/.exec(rest)
    if (parameter) {
      tokens.push(['parameter', parameter[0]])
      position += parameter[0].length
      continue
    }
    const number = /^(?:[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(rest)
    if (number) {
      tokens.push(['number', number[0]])
      position += number[0].length
      continue
    }
    const operator = /^(?:::|->>|->|#>>|#>|>=|<=|<>|!=|:=|\|\||<<|>>|=>|!~\*|!~|~\*)/.exec(rest)
    if (operator) {
      tokens.push(['operator', operator[0]])
      position += operator[0].length
      continue
    }
    tokens.push(['symbol', text[position++]])
  }
  return tokens
}

export function verifyReadingCopies(root) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'packages/db/sql-reference/manifest.json'), 'utf8'),
  )
  const sources = readdirSync(resolve(root, 'packages/db/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => 'packages/db/migrations/' + name)
  sources.push(
    ...readdirSync(resolve(root, 'packages/db/proposals'))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => 'packages/db/proposals/' + name),
  )
  assert.deepEqual(
    manifest.files.map((entry) => entry.source).sort(),
    sources.sort(),
    'Reading copy inventory must cover all migration and proposal SQL files',
  )
  for (const entry of manifest.files) {
    assert.match(entry.source, /^packages\/db\/(?:migrations|proposals)\/[A-Za-z0-9_]+\.sql$/)
    assert.match(entry.copy, /^packages\/db\/sql-reference\/[A-Za-z0-9_]+\.sql$/)
    const source = readFileSync(resolve(root, entry.source), 'utf8')
    const copy = readFileSync(resolve(root, entry.copy), 'utf8')
    assert.equal(canonicalSqlHash(source), entry.sourceSha256, `Source changed: ${entry.source}`)
    assert.equal(canonicalSqlHash(copy), entry.copySha256, `Reading copy changed: ${entry.copy}`)
    assert.deepEqual(sqlTokens(copy), sqlTokens(source), `SQL tokens differ: ${entry.copy}`)
    assert.equal(
      (copy.match(/--> statement-breakpoint/g) || []).length,
      (source.match(/--> statement-breakpoint/g) || []).length,
      `Statement boundaries differ: ${entry.copy}`,
    )
  }
  return manifest.files.length
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  console.log(
    `SQL reading copies verified: ${verifyReadingCopies(root)}; original SQL tokens and boundaries preserved.`,
  )
}
