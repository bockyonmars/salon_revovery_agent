import { randomUUID } from 'node:crypto'
import type { ReviewRequest, ReviewRequestCloseReason, TenantContext, WorkflowJob } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { AuditService } from './audit-service.js'
import { ConsentService } from './consent-service.js'
import { EventService } from './event-service.js'
import { MessageService } from './message-service.js'
import { nextAllowedContactAt } from './communication-policy.js'
import { PermanentWorkflowError, RescheduleWorkflowError } from './workflow-engine.js'

export class ReviewRequestService{
  constructor(private readonly store:Store,private readonly consent:ConsentService,private readonly messages:MessageService,private readonly events:EventService,private readonly audit:AuditService,private readonly now=()=>new Date()){}

  async execute(job:WorkflowJob){
    const context:TenantContext={tenantId:job.tenantId,locationId:job.locationId,userId:`workflow:${job.workflowType}`,role:'service'}
    const clientId=text(job.payload.clientId);const appointmentId=text(job.payload.providerBookingId)??text(job.payload.bookingId);const channel=reviewChannel(job.payload.channel)
    if(!clientId||!appointmentId)throw new PermanentWorkflowError('Review request payload requires client and appointment identifiers')
    if(job.payload.channel!==undefined){const route=await this.store.getChannelRoute(context,'twilio');const routeChannel=route?.address.startsWith('whatsapp:')?'whatsapp':'sms';if(route?.status!=='active'||routeChannel!==channel)throw new PermanentWorkflowError(`Review ${channel} channel does not match the active location route`)}
    const [client,settings]=await Promise.all([this.store.getClientProfile(context,clientId),this.store.getLocationSettings(context)])
    const createdAt=new Date().toISOString();const proposed:ReviewRequest={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,workflowJobId:job.id,appointmentId,clientId,channel,...(settings?.publicReviewUrl?{publicReviewUrl:settings.publicReviewUrl}:{}),status:'reserved',createdAt}
    const decision=await this.store.reserveReviewRequestWithAudit(proposed,{auditId:randomUUID(),userId:context.userId,occurredAt:createdAt})
    if(!decision.allowed||decision.request.status!=='reserved')return
    if(!settings?.publicReviewUrl){await this.close(context,decision.request,'review_link_missing');return}
    if(!client){await this.close(context,decision.request,'client_profile_missing');return}
    const permission=await this.consent.permission(context,clientId,channel,'marketing')
    if(!permission.allowed){await this.close(context,decision.request,'consent_missing');return}
    const current=this.now();const allowedAt=nextAllowedContactAt(current,client.timezone,settings.communicationPolicy)
    if(allowedAt.getTime()>current.getTime()+60_000)throw new RescheduleWorkflowError('Review request delayed by communication policy',allowedAt.toISOString())
    const body=`${settings.senderName}: We would value your honest feedback about your visit. You can share it here: ${settings.publicReviewUrl} Reply STOP to unsubscribe.`
    const result=await this.messages.send(context,{clientId,channel,purpose:'marketing',to:client.contactTo,body,correlationId:job.correlationId,idempotencyKey:`review:${job.id}`})
    const sentAt=new Date().toISOString();const completed=await this.store.completeReviewRequestWithEvidence(context,decision.request.id,result.message.id,{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,occurredAt:sentAt,correlationId:job.correlationId,causationId:job.id})
    if(!completed)return
  }

  private async close(context:TenantContext,request:ReviewRequest,reason:ReviewRequestCloseReason){const occurredAt=new Date().toISOString();await this.store.closeReviewRequestWithAudit(context,request.id,reason,{auditId:randomUUID(),userId:context.userId,occurredAt})}
}

function text(value:unknown){return typeof value==='string'&&value.trim()?value.trim():undefined}
function reviewChannel(value:unknown){if(value===undefined)return'sms' as const;if(value==='sms'||value==='whatsapp')return value;throw new PermanentWorkflowError('Review channel must be SMS or WhatsApp')}
