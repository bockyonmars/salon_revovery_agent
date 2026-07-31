import type { EventInput, TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'

export class EventService {
  constructor(private readonly store: Store) {}
  async ingest(context: TenantContext, input: EventInput) {
    return this.store.appendEvent({ ...input, tenantId: context.tenantId, locationId: context.locationId })
  }
}
