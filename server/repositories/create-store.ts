import { MemoryStore } from './memory-store.js'
import { PostgresStore } from './postgres-store.js'
import type { Store } from './store.js'

export function createStore(): Store {
  return process.env.DATABASE_URL || process.env.PGHOST ? new PostgresStore(process.env.DATABASE_URL) : new MemoryStore()
}
