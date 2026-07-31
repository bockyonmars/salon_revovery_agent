import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl && !process.env.PGHOST) throw new Error('DATABASE_URL or PGHOST is required')

const migrationsDirectory=fileURLToPath(new URL('./migrations/',import.meta.url))
const migrations=(await readdir(migrationsDirectory)).filter(value=>/^\d{3}_[a-z0-9_]+\.sql$/.test(value)).sort()
const pool = new pg.Pool({ ...(databaseUrl ? { connectionString: databaseUrl } : {}), max: 1 })

try {
  for (const migration of migrations) { await pool.query(await readFile(`${migrationsDirectory}/${migration}`, 'utf8')); console.info(`Applied ${migration}`) }
} finally {
  await pool.end()
}
