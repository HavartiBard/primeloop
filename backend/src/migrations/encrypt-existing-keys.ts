import { createPool, runMigrations } from '../db.js'
import { encrypt, isEncrypted } from '../crypto.js'

const url = process.env.DATABASE_URL

if (!url) throw new Error('DATABASE_URL required')

const pool = createPool(url)
await runMigrations(pool)

const { rows } = await pool.query(
  'SELECT id, name, api_key FROM providers WHERE api_key IS NOT NULL'
)

let count = 0

for (const row of rows) {
  if (!isEncrypted(row.api_key)) {
    await pool.query('UPDATE providers SET api_key = $1 WHERE id = $2', [
      encrypt(row.api_key),
      row.id,
    ])
    console.log(`  Encrypted key for provider: ${row.name}`)
    count += 1
  } else {
    console.log(`  Already encrypted: ${row.name}`)
  }
}

await pool.end()
console.log(`Done. ${count} key(s) encrypted.`)
