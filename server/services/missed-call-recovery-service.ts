import { randomUUID } from 'node:crypto'
import type { MissedCallRecoveryCloseReason, TenantContext, WorkflowJob } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { AuditService } from './audit-service.js'
import { EventService } from './event-service.js'
import { MessageService } from './message-service.js'
import { nextAllowedContactAt } from './communication-policy.js'
import { PermanentWorkflowError, RescheduleWorkflowError } from './workflow-engine.js'

export class MissedCallRecoveryService{
  constructor(private readonly store:Store,private readonly messages:MessageService,private readonly events:EventService,private readonly audit:AuditService,private readonly now=()=>new Date()){}

  async execute(job:WorkflowJob){
    const context:TenantContext={tenantId:job.tenantId,locationId:job.locationId,userId:'workflow:missed_call_recovery',role:'service'};const providerCallSid=text(job.payload.providerCallSid);const callerAddress=text(job.payload.callerAddress);const missedAt=text(job.payload.missedAt)
    if(!providerCallSid||!callerAddress||!missedAt)throw new PermanentWorkflowError('Missed-call recovery payload is incomplete')
    if(!/^\+[1-9]\d{7,14}$/.test(callerAddress)){await this.close(context,job,providerCallSid,callerAddress,'caller_invalid');return}
    const profile=await this.store.findClientProfileByContact(context,callerAddress)
    if(!profile){await this.close(context,job,providerCallSid,callerAddress,'profile_unresolved');return}
    const existingConversation=await this.store.findConversationByParticipant(context,'sms',callerAddress)
    if(existingConversation){const history=await this.store.listConversationMessages(context,existingConversation.id);if(history.some(value=>value.direction==='inbound'&&Date.parse(value.createdAt)>=Date.parse(missedAt))){await this.close(context,job,providerCallSid,callerAddress,'conversation_progressed',profile.clientId);return}}
    const [settings,consents]=await Promise.all([this.store.getLocationSettings(context),this.store.getClientConsents(context,profile.clientId)])
    if(!settings)throw new PermanentWorkflowError('Authoritative location settings are missing')
    const permitted=consents.some(value=>value.channel==='sms'&&value.purpose==='transactional'&&value.status==='opted_in')&&!consents.some(value=>value.channel==='sms'&&value.status==='opted_out')
    if(!permitted){await this.close(context,job,providerCallSid,callerAddress,'consent_blocked',profile.clientId);return}
    const current=this.now();const allowedAt=nextAllowedContactAt(current,profile.timezone,settings.communicationPolicy);if(allowedAt.getTime()>current.getTime()+60_000)throw new RescheduleWorkflowError('Missed-call recovery delayed by quiet hours',allowedAt.toISOString())
    const reservation=await this.store.reserveMissedCallRecovery(context,job,providerCallSid,callerAddress,profile.clientId)
    if(!reservation.allowed){if(reservation.attempt.status==='sent')return;await this.audit.record(context,'call.recovery_closed','missed_call_recovery',reservation.attempt.id,reservation.reason??'Recovery closed',{providerCallSid,callerAddress:'[REDACTED]'},{status:'closed',reason:reservation.reason});return}
    if(reservation.attempt.status!=='reserved')return
    const body=`${settings.senderName}: Sorry we missed your call. Reply to this message with what you need help with, and our booking concierge will assist.`
    const result=await this.messages.send(context,{clientId:profile.clientId,channel:'sms',purpose:'transactional',to:callerAddress,body,correlationId:providerCallSid,idempotencyKey:`missed-call:${job.id}`})
    const wallClock=Date.now();const sentAt=new Date(existingConversation?Math.max(wallClock,Date.parse(existingConversation.lastMessageAt)+1):wallClock).toISOString();const conversation=existingConversation?{...existingConversation,lastMessageAt:sentAt,updatedAt:sentAt}:{id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,clientId:profile.clientId,participantAddress:callerAddress,channel:'sms' as const,status:'active' as const,intent:'unknown' as const,requiresHuman:false,unreadCount:0,lastMessageAt:sentAt,createdAt:sentAt,updatedAt:sentAt};const conversationMessage={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,conversationId:conversation.id,direction:'outbound' as const,author:'system' as const,body,providerMessageId:result.message.id,deliveryStatus:'sent' as const,createdAt:sentAt};await this.store.completeMissedCallRecoveryWithEvidence(context,reservation.attempt.id,conversationMessage,conversation,{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,occurredAt:sentAt,...(existingConversation?{previousConversationUpdatedAt:existingConversation.updatedAt}:{})})
  }

  private async close(context:TenantContext,job:WorkflowJob,providerCallSid:string,callerAddress:string,reason:MissedCallRecoveryCloseReason,clientId?:string){const attempt=await this.store.closeMissedCallRecovery(context,job,providerCallSid,callerAddress,reason,clientId);await this.audit.record(context,'call.recovery_closed','missed_call_recovery',attempt.id,reason,{providerCallSid,callerAddress:'[REDACTED]'},{status:'closed',reason})}
}

function text(value:unknown){return typeof value==='string'&&value.trim()?value.trim():undefined}
