import { randomUUID } from 'node:crypto'
import type { ConsentInput, TenantContext } from '../domain/schemas.js'
import { DomainError } from '../domain/errors.js'
import type { Store } from '../repositories/store.js'
import { AuditService } from './audit-service.js'

export class ConsentService {
  constructor(private readonly store: Store, audit: AuditService) { void audit }

  async record(context: TenantContext, input: ConsentInput) {
    const capturedAt = new Date().toISOString()
    return this.store.saveConsentWithEvidence(context, { id: randomUUID(), tenantId: context.tenantId, locationId: context.locationId, ...input, capturedAt, ...(input.status === 'opted_out' ? { revokedAt: capturedAt } : {}) }, { auditId: randomUUID(), eventId: randomUUID(), userId: context.userId, occurredAt: capturedAt })
  }

  async permission(context: TenantContext, clientId: string, channel: ConsentInput['channel'], purpose: ConsentInput['purpose']) {
    const records = await this.store.getClientConsents(context, clientId)
    const channelOptOut = records.some((item) => item.channel === channel && item.status === 'opted_out')
    if (channelOptOut) return { allowed: false, reason: 'channel_opted_out' as const }
    const exact = await this.store.getConsent(context, clientId, channel, purpose)
    return exact?.status === 'opted_in' ? { allowed: true, reason: 'recorded_opt_in' as const } : { allowed: false, reason: 'missing_purpose_consent' as const }
  }

  async requirePermission(context: TenantContext, clientId: string, channel: ConsentInput['channel'], purpose: ConsentInput['purpose']) {
    const permission = await this.permission(context, clientId, channel, purpose)
    if (!permission.allowed) throw new DomainError(`Message blocked: ${permission.reason}`, 'CONSENT_REQUIRED', 403)
    return permission
  }
}
