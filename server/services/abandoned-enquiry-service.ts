import { randomUUID } from 'node:crypto'
import type { ConversationFollowupCloseReason, TenantContext, WorkflowJob } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { AuditService } from './audit-service.js'
import { EventService } from './event-service.js'
import { MessageService } from './message-service.js'
import { nextAllowedContactAt } from './communication-policy.js'
import { PermanentWorkflowError, RescheduleWorkflowError } from './workflow-engine.js'

export class AbandonedEnquiryService {
  constructor(private readonly store:Store,private readonly messages:MessageService,private readonly events:EventService,private readonly audit:AuditService,private readonly now=()=>new Date()){}

  async execute(job:WorkflowJob){
    const context:TenantContext={tenantId:job.tenantId,locationId:job.locationId,userId:'workflow:abandoned_enquiry',role:'service'}
    const conversationId=text(job.payload.conversationId);const clientId=text(job.payload.clientId);const triggerMessageId=text(job.payload.triggerMessageId);const requestedChannel=followupChannel(job.payload.channel)
    if(!conversationId||!clientId||!triggerMessageId)throw new PermanentWorkflowError('Abandoned enquiry payload is incomplete')
    const [conversation,trigger,messages]=await Promise.all([this.store.getConversation(context,conversationId),this.store.getConversationMessage(context,triggerMessageId),this.store.listConversationMessages(context,conversationId)])
    if(!conversation||conversation.clientId!==clientId||!trigger||trigger.conversationId!==conversationId||trigger.direction!=='outbound'||trigger.deliveryStatus!=='sent'){await this.close(context,job,conversationId,clientId,triggerMessageId,'conversation_unavailable',requestedChannel??'sms');return}
    if(conversation.channel==='email'){await this.close(context,job,conversationId,clientId,triggerMessageId,'conversation_unavailable',requestedChannel??'sms');return}
    if(requestedChannel&&requestedChannel!==conversation.channel)throw new PermanentWorkflowError('Abandoned enquiry channel does not match the authoritative conversation')
    const channel=conversation.channel
    const triggerTime=Date.parse(trigger.createdAt);const progressed=messages.some(value=>value.id!==trigger.id&&Date.parse(value.createdAt)>triggerTime)
    if(progressed){await this.close(context,job,conversationId,clientId,triggerMessageId,'conversation_progressed',channel);return}
    if(conversation.status!=='active'||conversation.requiresHuman){await this.close(context,job,conversationId,clientId,triggerMessageId,'conversation_unavailable',channel);return}
    if(await this.store.hasFutureBooking(context,clientId)){await this.close(context,job,conversationId,clientId,triggerMessageId,'already_booked',channel);return}
    if(await this.store.getActiveConversationAction(context,conversationId)){await this.close(context,job,conversationId,clientId,triggerMessageId,'action_pending',channel);return}
    const [profile,settings,consents]=await Promise.all([this.store.getClientProfile(context,clientId),this.store.getLocationSettings(context),this.store.getClientConsents(context,clientId)])
    if(!profile)throw new PermanentWorkflowError('Authoritative client profile is missing')
    if(!settings)throw new PermanentWorkflowError('Authoritative location settings are missing')
    const permitted=consents.some(value=>value.channel===conversation.channel&&value.purpose==='transactional'&&value.status==='opted_in')&&!consents.some(value=>value.channel===conversation.channel&&value.status==='opted_out')
    if(!permitted){await this.close(context,job,conversationId,clientId,triggerMessageId,'consent_blocked',channel);return}
    const current=this.now();const allowedAt=nextAllowedContactAt(current,profile.timezone,settings.communicationPolicy);if(allowedAt.getTime()>current.getTime()+60_000)throw new RescheduleWorkflowError('Abandoned enquiry follow-up delayed by quiet hours',allowedAt.toISOString())
    const reservation=await this.store.reserveConversationFollowup(context,job,conversationId,clientId,triggerMessageId,channel)
    if(!reservation.allowed){if(reservation.attempt.status==='sent')return;await this.audit.record(context,'conversation.followup_closed','conversation_followup',reservation.attempt.id,reservation.reason??'Follow-up closed',{conversationId,triggerMessageId},{status:'closed',reason:reservation.reason});return}
    if(reservation.attempt.status!=='reserved')return
    const body=`${settings.senderName}: Just checking whether you still want help completing your appointment request. Reply with the service or date you prefer, and we’ll check current availability.`
    const result=await this.messages.send(context,{clientId,channel:conversation.channel,purpose:'transactional',to:conversation.participantAddress,body,correlationId:conversationId,idempotencyKey:`abandoned-enquiry:${job.id}`})
    const sentAt=new Date(Math.max(Date.now(),Date.parse(conversation.lastMessageAt)+1)).toISOString();const followupMessage={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,conversationId,direction:'outbound' as const,author:'system' as const,body,providerMessageId:result.message.id,deliveryStatus:'sent' as const,createdAt:sentAt};await this.store.completeConversationFollowupWithEvidence(context,reservation.attempt.id,followupMessage,{...conversation,lastMessageAt:sentAt,updatedAt:sentAt},{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,occurredAt:sentAt,previousConversationUpdatedAt:conversation.updatedAt})
  }

  private async close(context:TenantContext,job:WorkflowJob,conversationId:string,clientId:string,triggerMessageId:string,reason:ConversationFollowupCloseReason,channel:'sms'|'whatsapp'){const attempt=await this.store.closeConversationFollowup(context,job,conversationId,clientId,triggerMessageId,reason,channel);await this.audit.record(context,'conversation.followup_closed','conversation_followup',attempt.id,reason,{conversationId,triggerMessageId,channel},{status:'closed',reason})}
}

function text(value:unknown){return typeof value==='string'&&value.trim()?value.trim():undefined}
function followupChannel(value:unknown){if(value===undefined)return undefined;if(value==='sms'||value==='whatsapp')return value;throw new PermanentWorkflowError('Abandoned enquiry channel must be SMS or WhatsApp')}
