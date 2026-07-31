import { WebhooksHelper } from 'square'
import type { TenantContext } from '../domain/schemas.js'
import { DomainError } from '../domain/errors.js'
import type { Store } from '../repositories/store.js'

export async function verifySquareWebhook(input: { rawBody: string; signature: string; signatureKey: string; notificationUrl: string }) {
  return WebhooksHelper.verifySignature({ requestBody: input.rawBody, signatureHeader: input.signature, signatureKey: input.signatureKey, notificationUrl: input.notificationUrl })
}

export async function resolveSquareWebhookTenant(store: Store, merchantId?: string): Promise<TenantContext> {
  if (merchantId) {
    const account = await store.findIntegrationAccount('square', merchantId)
    if (account) return { tenantId: account.tenantId, locationId: account.locationId, userId: 'square-webhook', role: 'service' }
  }

  if (process.env.NODE_ENV !== 'production') {
    const tenantId = process.env.SQUARE_WEBHOOK_TENANT_ID
    const locationId = process.env.SQUARE_WEBHOOK_LOCATION_ID
    if (tenantId && locationId) return { tenantId, locationId, userId: 'square-webhook', role: 'service' }
  }

  throw new DomainError('Square webhook tenant could not be resolved from its merchant account', 'WEBHOOK_TENANT_UNRESOLVED', 503)
}
