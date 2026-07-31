import { randomUUID } from 'node:crypto'
import type { ConversationMessage, OutboundDeliveryStatus, TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { EventService } from './event-service.js'

export class MessageDeliveryStatusService{
  constructor(private readonly store:Store,private readonly events:EventService){}

  async record(context:TenantContext,input:{providerMessageId:string;providerStatus:string;errorCode?:string;causationEventId:string}){
    const normalized=normalizeDeliveryStatus(input.providerStatus);if(!normalized)return{matched:false,ignored:true}
    const delivery=await this.store.getOutboundMessageDeliveryByProvider(context,input.providerMessageId);const now=new Date().toISOString();let changed=false
    if(delivery){const next=advance(delivery.status,normalized);if(next===delivery.status&&normalized!==delivery.status)return{matched:true,ignored:true,status:delivery.status,changed:false};const stateChanged=next!==delivery.status;const failureTransition=stateChanged&&['failed','undelivered'].includes(next);changed=stateChanged||(next===normalized&&(delivery.providerStatus!==input.providerStatus||delivery.errorCode!==input.errorCode));if(changed)await this.store.saveOutboundMessageDeliveryStatusWithAudit(context,{...delivery,status:next,providerStatus:input.providerStatus,...(input.errorCode?{errorCode:input.errorCode}:{}),updatedAt:now},stateChanged?conversationStatus(next):undefined,{auditId:randomUUID(),userId:context.userId,occurredAt:now,providerMessageId:input.providerMessageId,providerStatus:input.providerStatus,previousStatus:delivery.status,previousUpdatedAt:delivery.updatedAt,...(input.errorCode?{errorCode:input.errorCode}:{})});if(failureTransition&&delivery.purpose==='transactional')await this.openFailureApproval(context,delivery.id,input.providerMessageId,input.providerStatus,input.errorCode);if(!stateChanged)return{matched:true,ignored:true,status:delivery.status,changed}}
    const eventType=normalized==='delivered'?'message.delivered':['failed','undelivered'].includes(normalized)?'message.failed':normalized==='sent'?'message.sent':'message.queued'
    await this.events.ingest(context,{eventId:randomUUID(),eventType,occurredAt:now,correlationId:delivery?.correlationId??input.providerMessageId,causationId:input.causationEventId,schemaVersion:1,payload:{provider:'twilio',providerMessageId:input.providerMessageId,providerStatus:input.providerStatus,matched:Boolean(delivery),...(delivery?{deliveryId:delivery.id,clientId:delivery.clientId,channel:delivery.channel,purpose:delivery.purpose}:{}),...(input.errorCode?{errorCode:input.errorCode}:{})}})
    return{matched:Boolean(delivery),ignored:false,status:delivery?advance(delivery.status,normalized):normalized,changed}
  }

  private async openFailureApproval(context:TenantContext,deliveryId:string,providerMessageId:string,providerStatus:string,errorCode?:string){await this.store.createApprovalRequestWithEvent({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,requestType:'message_delivery_failure',reason:`Transactional message ${providerStatus}${errorCode?` (${errorCode})`:''}`,status:'pending',entityType:'outbound_message_delivery',entityId:deliveryId,payload:{providerMessageId,providerStatus,...(errorCode?{errorCode}:{})},createdAt:new Date().toISOString()},{eventId:randomUUID(),correlationId:providerMessageId,causationId:deliveryId})}
}

export function normalizeDeliveryStatus(value:string):OutboundDeliveryStatus|undefined{const status=value.trim().toLowerCase();if(status==='read')return'delivered';if(status==='scheduled')return'queued';if(status==='canceled')return'failed';return['accepted','queued','sending','sent','delivered','failed','undelivered'].includes(status)?status as OutboundDeliveryStatus:undefined}
function conversationStatus(value:OutboundDeliveryStatus):ConversationMessage['deliveryStatus']|undefined{if(value==='delivered')return'delivered';if(value==='failed'||value==='undelivered')return'failed';if(value==='sent')return'sent';if(value==='queued'||value==='accepted'||value==='sending')return'queued';return undefined}
function advance(current:OutboundDeliveryStatus,next:OutboundDeliveryStatus){if(current==='delivered'||current==='failed'||current==='undelivered')return current;if(next==='failed'||next==='undelivered'||next==='delivered')return next;const order:OutboundDeliveryStatus[]=['reserved','accepted','queued','sending','sent','delivered'];return order.indexOf(next)>=order.indexOf(current)?next:current}
