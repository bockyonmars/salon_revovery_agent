import type { TenantContext, WorkflowJob } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { MessageService } from './message-service.js'
import { EventService } from './event-service.js'
import { PermanentWorkflowError, type WorkflowActionHandler } from './workflow-engine.js'
import { WaitlistService } from './waitlist-service.js'
import { RecoveryService } from './recovery-service.js'
import { RecoveryCampaignService } from './recovery-campaign-service.js'
import { WeeklyReportWorkflowService } from './weekly-report-workflow-service.js'
import { ConversationRoutingError, ConversationService } from './conversation-service.js'
import { AbandonedEnquiryService } from './abandoned-enquiry-service.js'
import { MissedCallRecoveryService } from './missed-call-recovery-service.js'
import { ReviewRequestService } from './review-request-service.js'

export class CoreWorkflowHandler implements WorkflowActionHandler {
  constructor(private readonly messages:MessageService,private readonly events:EventService,private readonly waitlist?:WaitlistService,private readonly recovery?:RecoveryService,private readonly campaigns?:RecoveryCampaignService,private readonly store?:Store,private readonly weeklyReports?:WeeklyReportWorkflowService,private readonly conversations?:ConversationService,private readonly abandonedEnquiries?:AbandonedEnquiryService,private readonly missedCalls?:MissedCallRecoveryService,private readonly reviews?:ReviewRequestService){}
  async execute(job:WorkflowJob){
    const context:TenantContext={tenantId:job.tenantId,locationId:job.locationId,userId:`workflow:${job.workflowType}`,role:'service'}
    if(job.workflowType==='conversation_turn'){const conversationId=string(job.payload.conversationId);const messageId=string(job.payload.messageId);if(!conversationId||!messageId)throw new PermanentWorkflowError('Conversation workflow payload is incomplete');if(!this.conversations)throw new PermanentWorkflowError('Conversation workflow is not configured');try{await this.conversations.run(context,conversationId,messageId)}catch(error){if(error instanceof ConversationRoutingError&&!error.retryable)throw new PermanentWorkflowError(error.message);throw error}return}
    if(job.workflowType==='abandoned_enquiry'){if(!this.abandonedEnquiries)throw new PermanentWorkflowError('Abandoned enquiry workflow is not configured');await this.abandonedEnquiries.execute(job);return}
    if(job.workflowType==='missed_call_recovery'){if(!this.missedCalls)throw new PermanentWorkflowError('Missed-call recovery workflow is not configured');await this.missedCalls.execute(job);return}
    if(job.workflowType==='review_request'){if(!this.reviews)throw new PermanentWorkflowError('Review request workflow is not configured');await this.reviews.execute(job);return}
    if(job.workflowType==='waitlist_match'){if(!this.waitlist)throw new PermanentWorkflowError('Waitlist workflow is not configured');await this.waitlist.process(job);return}
    if(job.workflowType==='weekly_roi_report'){if(!this.weeklyReports)throw new PermanentWorkflowError('Weekly report workflow is not configured');await this.weeklyReports.execute(job);return}
    if(job.workflowType==='appointment_confirmation'||job.workflowType==='appointment_reminder'){
      const clientId=string(job.payload.clientId);const startsAt=string(job.payload.startsAt);const channel=appointmentChannel(job.payload.channel);if(!clientId||!startsAt)throw new PermanentWorkflowError('Workflow payload is missing client or appointment data')
      if(job.payload.channel!==undefined){if(!this.store)throw new PermanentWorkflowError('Appointment notification route validation is not configured');const route=await this.store.getChannelRoute(context,'twilio');const routeChannel=route?.address.startsWith('whatsapp:')?'whatsapp':'sms';if(route?.status!=='active'||routeChannel!==channel)throw new PermanentWorkflowError(`Appointment ${channel} channel does not match the active location route`)}
      const [profile,settings]=this.store?await Promise.all([this.store.getClientProfile(context,clientId),this.store.getLocationSettings(context)]):[undefined,undefined]
      const to=profile?.contactTo??string(job.payload.contactTo);if(!to)throw new PermanentWorkflowError('Authoritative client contact profile is missing')
      const reference=string(job.payload.bookingReference)??'your booking';const sender=settings?.senderName;const prefix=sender?`${sender}: `:'';const body=job.workflowType==='appointment_confirmation'?`${prefix}Your appointment is confirmed for ${startsAt}. Reference: ${reference}.`:`${prefix}Reminder: your appointment is scheduled for ${startsAt}. Reference: ${reference}.`
      await this.messages.send(context,{clientId,channel,purpose:'transactional',to,body,correlationId:job.correlationId,idempotencyKey:`workflow:${job.id}`});return
    }
    if(!this.campaigns)throw new PermanentWorkflowError('Recovery campaign workflow is not configured');await this.campaigns.execute(job)
  }
}
const string=(value:unknown)=>typeof value==='string'&&value.length?value:undefined
function appointmentChannel(value:unknown){if(value===undefined)return'sms' as const;if(value==='sms'||value==='whatsapp')return value;throw new PermanentWorkflowError('Appointment channel must be SMS or WhatsApp')}
