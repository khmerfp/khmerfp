import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const migrationsFolder = fileURLToPath(
  new URL('../migrations/', import.meta.url),
)

export function readCanonicalMigrationManifest() {
  const journal = JSON.parse(
    readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8'),
  )

  return journal.entries.map((entry) => {
    const sql = readFileSync(
      new URL(`../migrations/${entry.tag}.sql`, import.meta.url),
      'utf8',
    )

    return Object.freeze({
      index: entry.idx,
      tag: entry.tag,
      createdAt: String(entry.when),
      hash: createHash('sha256').update(sql).digest('hex'),
    })
  })
}
