import { randomUUID } from 'node:crypto'
import type { CatalogObject, TeamMemberBookingProfile } from 'square'
import { DomainError } from '../domain/errors.js'
import type { ServiceRecord, StaffRecord, TenantContext } from '../domain/schemas.js'
import { SquareBookingConnector, type SquareCatalogConnector } from '../integrations/square-connector.js'
import type { Store } from '../repositories/store.js'
import { CredentialCipher } from '../security/credential-cipher.js'
import { AuditService } from './audit-service.js'
import { SquareTokenService } from './square-token-service.js'
import type { ProviderCircuitBreakerService } from './provider-circuit-breaker-service.js'

type ConnectorFactory = (accessToken: string) => SquareCatalogConnector

export class SquareSyncService {
  private readonly connectorFactory: ConnectorFactory

  constructor(
    private readonly store: Store,
    private readonly cipher: CredentialCipher,
    audit: AuditService,
    environment: 'sandbox' | 'production',
    connectorFactory?: ConnectorFactory,
    private readonly tokens = new SquareTokenService(store, cipher),
    private readonly providerCircuits?:ProviderCircuitBreakerService,
  ) {
    void audit
    this.connectorFactory = connectorFactory ?? ((accessToken) => new SquareBookingConnector({ accessToken, environment }))
  }

  async sync(context: TenantContext) {
    const account = await this.store.getIntegrationAccount(context, 'square')
    if (!account) throw new DomainError('An active Square connection is required', 'SQUARE_NOT_CONNECTED', 409)
    const accessToken = await this.tokens.getAccessToken(context)
    const connector = this.connectorFactory(accessToken)
    const retrieve=()=>Promise.all([
      connector.listAppointmentServices(context.locationId),
      connector.listBookableStaff(context.locationId),
    ])
    const [catalog,profiles]=this.providerCircuits?await this.providerCircuits.execute(context,'square','catalog.sync',retrieve):await retrieve()
    const syncedAt = new Date().toISOString()
    const services = normalizeServices(context, catalog, syncedAt)
    const staff = normalizeStaff(context, profiles, syncedAt)
    await this.store.replaceSquareCatalogWithAudit(context,services,staff,{auditId:randomUUID(),userId:context.userId,occurredAt:syncedAt,integrationAccountId:account.id})
    return { provider: 'square' as const, services: services.length, staff: staff.length, syncedAt }
  }
}

function normalizeServices(context: TenantContext, catalog: CatalogObject[], syncedAt: string): ServiceRecord[] {
  const services: ServiceRecord[] = []
  for (const object of catalog) {
    if (object.type !== 'ITEM' || !('itemData' in object) || object.itemData?.productType !== 'APPOINTMENTS_SERVICE') continue
    for (const variation of object.itemData.variations ?? []) {
      if (variation.type !== 'ITEM_VARIATION' || !('itemVariationData' in variation) || !variation.itemVariationData?.availableForBooking) continue
      const data = variation.itemVariationData
      const amount = data.priceMoney?.amount
      services.push({ id: variation.id, tenantId: context.tenantId, locationId: context.locationId, provider: 'square', externalItemId: object.id, name: object.itemData.name ?? 'Unnamed service', variationName: data.name ?? 'Standard', version: String(variation.version ?? 0), durationMinutes: Number((data.serviceDuration ?? 0n) / 60_000n), ...(amount !== undefined && amount !== null ? { priceMinor: Number(amount) } : {}), ...(data.priceMoney?.currency ? { currency: data.priceMoney.currency } : {}), teamMemberIds: data.teamMemberIds ?? [], active: !variation.isDeleted, syncedAt })
    }
  }
  return services
}

function normalizeStaff(context: TenantContext, profiles: TeamMemberBookingProfile[], syncedAt: string): StaffRecord[] {
  return profiles.filter((profile) => profile.teamMemberId && profile.isBookable).map((profile) => ({ id: profile.teamMemberId!, tenantId: context.tenantId, locationId: context.locationId, provider: 'square', name: profile.displayName ?? 'Unnamed team member', ...(profile.description ? { description: profile.description } : {}), ...(profile.profileImageUrl ? { profileImageUrl: profile.profileImageUrl } : {}), bookable: true, syncedAt }))
}
