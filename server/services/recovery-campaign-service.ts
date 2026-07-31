import { randomUUID } from 'node:crypto'
import type { ExperimentWorkflowType, RecoveryCaseCloseReason, TenantContext, WorkflowJob } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { EventService } from './event-service.js'
import { MessageService } from './message-service.js'
import { RecoveryService } from './recovery-service.js'
import { PermanentWorkflowError, RescheduleWorkflowError } from './workflow-engine.js'
import type { ControlledExperimentService } from './controlled-experiment-service.js'
import { nextAllowedContactAt } from './communication-policy.js'

export class RecoveryCampaignService {
  constructor(private readonly store:Store,private readonly messages:MessageService,_events:EventService,private readonly recovery:RecoveryService,private readonly now=()=>new Date(),private readonly experiments?:ControlledExperimentService){}
  async execute(job:WorkflowJob){
    const context:TenantContext={tenantId:job.tenantId,locationId:job.locationId,userId:`workflow:${job.workflowType}`,role:'service'};const channel=campaignChannel(job.payload.channel);if(job.payload.channel!==undefined){const route=await this.store.getChannelRoute(context,'twilio');const routeChannel=route?.address.startsWith('whatsapp:')?'whatsapp':'sms';if(route?.status!=='active'||routeChannel!==channel)throw new PermanentWorkflowError(`Recovery ${channel} channel does not match the active location route`)}await this.recovery.open(job)
    const clientId=text(job.payload.clientId)
    if(!clientId)throw new PermanentWorkflowError('Recovery payload requires clientId')
    const [client,settings]=await Promise.all([this.store.getClientProfile(context,clientId),this.store.getLocationSettings(context)])
    if(!client)throw new PermanentWorkflowError('Authoritative client profile is missing')
    if(!settings)throw new PermanentWorkflowError('Authoritative location settings are missing')
    const to=client.contactTo;const timezone=client.timezone;const sender=settings.senderName
    const current=this.now();const allowedAt=nextAllowedContactAt(current,timezone,settings.communicationPolicy);if(allowedAt.getTime()>current.getTime()+60_000)throw new RescheduleWorkflowError('Recovery message delayed by communication policy',allowedAt.toISOString())
    if(await this.store.hasFutureBooking(context,clientId)){await this.close(context,job,'already_booked');return}
    const reservation=await this.store.reserveRecoveryContact(context,job,clientId,channel);if(!reservation.allowed||!reservation.attempt){await this.close(context,job,reservation.reason??'frequency_cap');return}if(reservation.attempt.status==='sent')return
    const selection=await this.experiments?.select(context,job.workflowType as ExperimentWorkflowType,clientId,sender)
    const result=await this.messages.send(context,{clientId,channel,purpose:'marketing',to,body:selection?.body??message(job,sender),correlationId:job.correlationId,idempotencyKey:`recovery:${job.id}`})
    const occurredAt=this.now().toISOString();const exposure=selection?await this.experiments!.prepareExposure(context,selection,{workflowJobId:job.id,recoveryContactAttemptId:reservation.attempt.id,clientId,providerMessageId:result.message.id},occurredAt):undefined;await this.store.completeRecoveryContactWithEvidence(context,reservation.attempt.id,result.message.id,exposure,{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,occurredAt})
  }
  private async close(context:TenantContext,job:WorkflowJob,reason:RecoveryCaseCloseReason){const occurredAt=this.now().toISOString();await this.store.closeRecoveryCaseWithEvidence(context,job.correlationId,reason,{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,causationId:job.id,occurredAt})}
}
function message(job:WorkflowJob,sender:string){if(job.workflowType==='no_show_recovery')return`${sender}: We missed you at your appointment. If you would like to rebook, reply or use your salon booking link. Reply STOP to unsubscribe.`;if(job.workflowType==='post_visit_rebook')return`${sender}: It may be time to schedule your next visit. Reply or use your salon booking link to view current availability. Reply STOP to unsubscribe.`;return`${sender}: We have not seen you for a while. Reply or use your salon booking link if you would like to view current availability. Reply STOP to unsubscribe.`}
function text(value:unknown){return typeof value==='string'&&value.trim()?value.trim():undefined}
function campaignChannel(value:unknown){if(value===undefined)return'sms' as const;if(value==='sms'||value==='whatsapp')return value;throw new PermanentWorkflowError('Recovery channel must be SMS or WhatsApp')}
