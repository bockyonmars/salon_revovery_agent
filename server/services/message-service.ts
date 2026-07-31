import { randomUUID } from 'node:crypto'
import { DomainError } from '../domain/errors.js'
import type { SendMessageInput, TenantContext } from '../domain/schemas.js'
import type { MessagingProvider } from '../integrations/twilio-messaging.js'
import { AuditService } from './audit-service.js'
import { ConsentService } from './consent-service.js'
import { EventService } from './event-service.js'
import type { Store } from '../repositories/store.js'
import type { OutboundDeliveryStatus } from '../domain/schemas.js'
import type { ProviderCircuitBreakerService } from './provider-circuit-breaker-service.js'

export class MessageService {
  private idempotency = new Map<string, { id: string; status: string }>()
  constructor(private readonly provider: MessagingProvider | undefined, private readonly consent: ConsentService, private readonly events: EventService, private readonly audit: AuditService,private readonly store?:Store,private readonly providerCircuits?:ProviderCircuitBreakerService) {}
  async send(context: TenantContext, input: SendMessageInput) {
    const key = `${context.tenantId}:${input.idempotencyKey}`
    const prior = this.idempotency.get(key)
    if (prior) return { message: prior, duplicate: true }
    if(input.channel!=='sms'&&input.channel!=='whatsapp')throw new DomainError('Twilio delivery supports only SMS and WhatsApp channels','MESSAGING_CHANNEL_UNSUPPORTED',409)
    const channel=input.channel
    await this.consent.requirePermission(context, input.clientId, input.channel, input.purpose)
    if (!this.provider) throw new DomainError('Messaging provider is not configured', 'MESSAGING_NOT_CONFIGURED', 503)
    if(this.provider.supportsChannel&&!this.provider.supportsChannel(channel))throw new DomainError(`Messaging provider is not configured for ${channel}`,'MESSAGING_SENDER_NOT_CONFIGURED',503)
    const now=new Date().toISOString();const reservation=this.store?await this.store.reserveOutboundMessageDelivery({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,clientId:input.clientId,channel:input.channel,purpose:input.purpose,to:input.to,correlationId:input.correlationId,idempotencyKey:input.idempotencyKey,status:'reserved',createdAt:now,updatedAt:now}):undefined
    if(reservation?.duplicate){const delivery=reservation.delivery;if(delivery.clientId!==input.clientId||delivery.channel!==input.channel||delivery.purpose!==input.purpose||delivery.to!==input.to||delivery.correlationId!==input.correlationId)throw new DomainError('This idempotency key is already bound to a different message delivery scope','MESSAGE_DELIVERY_SCOPE_MISMATCH',409);if(delivery.providerMessageId)return{message:{id:delivery.providerMessageId,status:delivery.providerStatus??delivery.status},duplicate:true};throw new DomainError('This message delivery was already attempted and cannot be sent again automatically','MESSAGE_DELIVERY_ALREADY_ATTEMPTED',409)}
    let result:{id:string;status:string}
    try{const send=()=>this.provider!.send({ channel, to: input.to, body: input.body, statusCallback: process.env.TWILIO_STATUS_CALLBACK_URL });result=this.providerCircuits?await this.providerCircuits.execute(context,'twilio','message.send',send):await send()}catch(error){if(this.store&&reservation){const failedAt=new Date().toISOString();await this.store.saveOutboundMessageDelivery({...reservation.delivery,status:'failed',errorCode:providerError(error),updatedAt:failedAt})}throw error}
    this.idempotency.set(key, result)
    if(this.store&&reservation){const updatedAt=new Date().toISOString();await this.store.saveOutboundMessageDelivery({...reservation.delivery,providerMessageId:result.id,providerStatus:result.status,status:deliveryStatus(result.status),updatedAt})}
    await this.events.ingest(context, { eventId: randomUUID(), eventType: 'message.sent', occurredAt: new Date().toISOString(), correlationId: input.correlationId, schemaVersion: 1, payload: { provider: 'twilio', providerMessageId: result.id, clientId: input.clientId, channel: input.channel, purpose: input.purpose } })
    await this.audit.record(context, 'message.sent', 'message', result.id, `Consent-validated ${input.purpose} message`, { ...input, body: '[REDACTED]' }, result)
    return { message: result, duplicate: false }
  }
}

function deliveryStatus(value:string):OutboundDeliveryStatus{const status=value.toLowerCase();return['accepted','queued','sending','sent','delivered','failed','undelivered'].includes(status)?status as OutboundDeliveryStatus:'sent'}
function providerError(error:unknown){if(typeof error==='object'&&error!==null&&'code'in error)return String((error as{code:unknown}).code).slice(0,100);return error instanceof Error?error.name.slice(0,100):'PROVIDER_ERROR'}
