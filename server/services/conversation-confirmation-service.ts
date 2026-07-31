import { randomUUID } from 'node:crypto'
import type { AppointmentHold, Conversation, ConversationAction, ConversationMessage, ConversationRoute, TenantContext } from '../domain/schemas.js'
import { DomainError } from '../domain/errors.js'
import type { Store } from '../repositories/store.js'
import { AuditService } from './audit-service.js'
import { BookingService } from './booking-service.js'
import { EventService } from './event-service.js'

export type ConfirmationResolution={route:ConversationRoute;action:ConversationAction;bookingId?:string}
type ConfirmationDecision='confirmed'|'declined'|'ambiguous'|'none'

export class ConversationConfirmationService{
  constructor(private readonly store:Store,private readonly bookings:BookingService,private readonly events:EventService,private readonly audit:AuditService,private readonly requireAutomation:((context:TenantContext)=>Promise<void>)=async()=>{}){}

  async resolve(context:TenantContext,conversation:Conversation,message:ConversationMessage):Promise<ConfirmationResolution|undefined>{
    const prior=(await this.store.listConversationActions(context,conversation.id)).find(value=>value.confirmationMessageId===message.id)
    if(prior?.status==='completed'&&prior.bookingId)return this.completedResolution(context,prior)
    if(prior?.status==='cancelled')return{action:prior,route:declinedRoute(prior)}
    if(prior?.status==='expired')return{action:prior,route:expiredRoute(prior)}
    const action=await this.store.getActiveConversationAction(context,conversation.id)
    if(!action||action.status!=='awaiting_confirmation'||action.clientId!==conversation.clientId||!action.confirmationRequestedAt)return undefined
    if(Date.parse(message.createdAt)<=Date.parse(action.confirmationRequestedAt))return undefined
    const hold=action.holdId?await this.store.getHold(context,action.holdId):undefined
    const decision=confirmationDecision(message.body,action.actionType)
    const recovered=decision==='confirmed'?await this.store.getBookingByIdempotency(context,`conversation:${action.id}:confirmed`):undefined
    if(!recovered&&this.expired(action,hold,conversation.clientId))return this.expire(context,conversation,message,action,hold)
    if(decision==='none')return undefined
    if(decision==='ambiguous')return{action,route:ambiguousRoute(action)}
    if(decision==='declined')return this.decline(context,conversation,message,action,hold)
    if(action.actionType==='book_appointment')await this.requireAutomation(context)
    const result=recovered?{booking:recovered,duplicate:true}:await this.execute(context,conversation,message,action,hold)
    const completedAt=new Date().toISOString();const completed=await this.store.completeConversationActionWithAudit(context,{...action,status:'completed',confirmationMessageId:message.id,bookingId:result.booking.id,updatedAt:completedAt},{auditId:randomUUID(),userId:context.userId,occurredAt:completedAt,previousUpdatedAt:action.updatedAt,bookingReference:result.booking.bookingReference,duplicate:result.duplicate})
    await this.releaseCompletedReschedule(context,completed,hold,message.id)
    return{action:completed,bookingId:result.booking.id,route:completedRoute(completed,result.booking.bookingReference)}
  }

  private async completedResolution(context:TenantContext,action:ConversationAction){const[booking,hold]=await Promise.all([this.store.getBooking(context,action.bookingId!),action.holdId?this.store.getHold(context,action.holdId):undefined]);await this.releaseCompletedReschedule(context,action,hold,action.confirmationMessageId??action.id);return{action,bookingId:action.bookingId,route:completedRoute(action,booking?.bookingReference??action.bookingId!)}}

  private expired(action:ConversationAction,hold:AppointmentHold|undefined,clientId:string){if(action.expiresAt&&Date.parse(action.expiresAt)<=Date.now())return true;if(action.actionType==='cancel_appointment')return false;return!hold||hold.clientId!==clientId||hold.status!=='active'||Date.parse(hold.expiresAt)<=Date.now()}

  private async expire(context:TenantContext,conversation:Conversation,message:ConversationMessage,action:ConversationAction,hold?:AppointmentHold){const occurredAt=new Date().toISOString();const result=await this.store.terminateConversationActionWithEvidence(context,{...action,status:'expired',confirmationMessageId:message.id,updatedAt:occurredAt},{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,occurredAt,previousUpdatedAt:action.updatedAt,reason:'action_expired'});return{action:result.action,route:expiredRoute(result.action)}}

  private async decline(context:TenantContext,conversation:Conversation,message:ConversationMessage,action:ConversationAction,hold?:AppointmentHold){const occurredAt=new Date().toISOString();const result=await this.store.terminateConversationActionWithEvidence(context,{...action,status:'cancelled',confirmationMessageId:message.id,updatedAt:occurredAt},{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,occurredAt,previousUpdatedAt:action.updatedAt,reason:'customer_declined'});return{action:result.action,route:declinedRoute(result.action)}}

  private async execute(context:TenantContext,conversation:Conversation,message:ConversationMessage,action:ConversationAction,hold?:AppointmentHold){
    const idempotencyKey=`conversation:${action.id}:confirmed`
    if(action.actionType==='book_appointment'){
      if(!hold)throw invalidAction();return this.bookings.book(context,{holdId:hold.id,clientId:conversation.clientId,confirmationToken:hold.confirmationToken,explicitConfirmation:true,expectedPriceMinor:hold.expectedPriceMinor,currency:hold.currency,idempotencyKey})
    }
    if(!action.bookingId)throw invalidAction()
    if(action.actionType==='cancel_appointment'){
      if(!action.reason)throw invalidAction();return this.bookings.cancel(context,{bookingId:action.bookingId,idempotencyKey,reason:action.reason})
    }
    if(!hold||!action.targetStartsAt||!action.targetStaffId)throw invalidAction()
    return this.bookings.reschedule(context,{bookingId:action.bookingId,startsAt:action.targetStartsAt,staffId:action.targetStaffId,explicitConfirmation:true,idempotencyKey})
  }

  private async releaseCompletedReschedule(context:TenantContext,action:ConversationAction,hold:AppointmentHold|undefined,causationId:string){if(action.actionType!=='reschedule_appointment'||!hold)return;const released=await this.store.cancelHold(context,hold.id);if(released)await this.events.ingest(context,{eventId:randomUUID(),eventType:'appointment.hold_released',occurredAt:new Date().toISOString(),correlationId:hold.id,causationId,schemaVersion:1,payload:{holdId:hold.id,conversationId:action.conversationId,reason:'reschedule_completed',actionType:action.actionType}})}

  private async update(action:ConversationAction,status:ConversationAction['status'],changes:Partial<ConversationAction>={}){return this.store.saveConversationAction({...action,...changes,status,updatedAt:new Date().toISOString()})}
}

export function confirmationDecision(body:string,actionType:ConversationAction['actionType']='book_appointment'):ConfirmationDecision{
  const value=body.trim().toLowerCase().replace(/[.!]+$/,'').trim()
  const exact=actionType==='book_appointment'?['yes, book it','yes book it','book it','please book it']:actionType==='cancel_appointment'?['yes, cancel it','yes cancel it']:['yes, reschedule it','yes reschedule it']
  if(exact.includes(value))return'confirmed'
  if(['no','no thanks','no thank you','decline','no, keep it','no keep it','keep it','do not change it',"don't change it",'do not book it',"don't book it"].includes(value))return'declined'
  if(['yes','yes please','ok','okay','sure','sounds good','perfect','great','fine','yep','yeah','👍','👌'].includes(value))return'ambiguous'
  return'none'
}

function actionIntent(action:ConversationAction):ConversationRoute['intent']{return action.actionType==='cancel_appointment'?'cancellation':action.actionType==='reschedule_appointment'?'reschedule':'booking'}
function confirmationPhrase(action:ConversationAction){return action.actionType==='cancel_appointment'?'Yes, cancel it.':action.actionType==='reschedule_appointment'?'Yes, reschedule it.':'Yes, book it.'}
function ambiguousRoute(action:ConversationAction):ConversationRoute{return{intent:actionIntent(action),confidence:1,urgency:'normal',requiresHuman:false,shortReason:'The reply was not the exact confirmation required for this appointment action.',draftReply:`To confirm this exact change, please reply “${confirmationPhrase(action)}” If you do not want the change, reply “No, keep it.”`}}
function declinedRoute(action:ConversationAction):ConversationRoute{if(action.actionType==='book_appointment')return{intent:'booking',confidence:1,urgency:'normal',requiresHuman:false,shortReason:'Customer explicitly declined the temporary hold.',draftReply:'No problem. The temporary hold has been released. I can check another time whenever you are ready.'};return{intent:actionIntent(action),confidence:1,urgency:'normal',requiresHuman:false,shortReason:'Customer explicitly declined the proposed appointment change.',draftReply:'No changes were made. Your current appointment remains in place.'}}
function expiredRoute(action:ConversationAction):ConversationRoute{return{intent:actionIntent(action),confidence:1,urgency:'normal',requiresHuman:false,shortReason:'The verified appointment action expired before confirmation.',draftReply:action.actionType==='cancel_appointment'?'That cancellation request has expired. Please ask the salon to prepare it again if you still want to cancel.':'That temporary hold has expired. I can check the latest availability again for you.'}}
function completedRoute(action:ConversationAction,reference:string):ConversationRoute{const label=action.actionType==='cancel_appointment'?'cancellation':action.actionType==='reschedule_appointment'?'reschedule':'booking';return{intent:actionIntent(action),confidence:1,urgency:'normal',requiresHuman:false,shortReason:`Customer explicitly confirmed ${label} ${reference}.`}}
function invalidAction(){return new DomainError('The verified appointment action is incomplete','CONVERSATION_ACTION_INVALID',409)}
