import { randomUUID } from 'node:crypto'
import type { TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { verifyAuditChain } from '../security/audit-chain.js'
import { redactSensitive, redactText } from '../security/pii-redaction.js'

export class AuditService {
  constructor(private readonly store: Store) {}
  async record(context: TenantContext, action: string, entityType: string, entityId: string, reason: string, input: unknown, result: unknown) {
    return this.store.appendAudit({ id: randomUUID(), ...context, action, entityType, entityId, reason: redactText(reason), input:redactSensitive(input), result:redactSensitive(result), occurredAt: new Date().toISOString() })
  }
  async verify(context:TenantContext){return verifyAuditChain(await this.store.getAudit(context))}
}
