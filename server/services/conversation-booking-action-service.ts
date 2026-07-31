import { randomUUID } from 'node:crypto'
import { DomainError } from '../domain/errors.js'
import type { ConversationAction, ConversationBookingActionInput, ConversationMessage, TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { AuditService } from './audit-service.js'
import { BookingService } from './booking-service.js'

export class ConversationBookingActionService{
  constructor(private readonly store:Store,private readonly bookings:BookingService,private readonly audit:AuditService){}

  async prepare(context:TenantContext,conversationId:string,input:ConversationBookingActionInput){
    const conversation=await this.store.getConversation(context,conversationId)
    if(!conversation)throw new DomainError('Conversation not found','CONVERSATION_NOT_FOUND',404)
    if(conversation.status==='closed')throw new DomainError('Closed conversations cannot prepare booking changes','CONVERSATION_CLOSED',409)
    if(await this.store.getActiveConversationAction(context,conversationId))throw new DomainError('This conversation already has an action awaiting confirmation','PENDING_CONFIRMATION_EXISTS',409)
    const booking=await this.bookings.requireMutableSquareBooking(context,input.bookingId)
    if(booking.clientId!==conversation.clientId)throw new DomainError('The booking does not belong to this conversation client','BOOKING_CLIENT_MISMATCH',403)
    const[service,settings,profile]=await Promise.all([this.store.getService(context,booking.serviceId),this.store.getLocationSettings(context),this.store.getClientProfile(context,booking.clientId)])
    const timezone=profile?.timezone??settings?.timezone
    if(!timezone)throw new DomainError('A verified timezone is required before preparing a booking change','TIMEZONE_REQUIRED',409)
    let holdId:string|undefined;let expiresAt=new Date(Date.now()+10*60_000).toISOString();let body:string;let targetStaffId:string|undefined;let targetStartsAt:string|undefined
    if(input.actionType==='cancel_appointment'){
      body=`Please confirm cancellation of ${service?.name??'your appointment'} (${booking.bookingReference}) on ${appointmentTime(booking.startsAt,timezone)}. Reply “Yes, cancel it.” to cancel, or “No, keep it.” to keep the appointment.`
    }else{
      const[staff,originalHold]=await Promise.all([this.store.getStaff(context,input.staffId),this.store.getHold(context,booking.holdId)])
      const customerId=originalHold?.providerDetails?.customerId??profile?.providerCustomerId
      if(!customerId)throw new DomainError('The provider customer identity is unavailable','PROVIDER_CUSTOMER_REQUIRED',409)
      const hold=await this.bookings.createHold(context,{clientId:booking.clientId,serviceId:booking.serviceId,staffId:input.staffId,startsAt:input.startsAt,timezone,expectedPriceMinor:booking.priceMinor,currency:booking.currency,provider:'square',providerCustomerId:customerId,...(conversation.channel==='sms'||conversation.channel==='whatsapp'?{channel:conversation.channel}:{})})
      holdId=hold.id;expiresAt=hold.expiresAt;targetStaffId=input.staffId;targetStartsAt=input.startsAt
      body=`Please confirm moving ${service?.name??'your appointment'} (${booking.bookingReference}) to ${appointmentTime(input.startsAt,timezone)}${staff?.name?` with ${staff.name}`:''}. The total remains ${money(booking.priceMinor,booking.currency)}. Reply “Yes, reschedule it.” to confirm, or “No, keep it.” to retain the current appointment.`
    }
    const now=new Date().toISOString();const draft:ConversationMessage={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,conversationId,direction:'outbound',author:'agent',body,deliveryStatus:'draft',createdAt:now}
    const action:ConversationAction={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,conversationId,clientId:conversation.clientId,actionType:input.actionType,bookingId:booking.id,agentRunId:`operator:${context.userId}`,status:'prepared',draftMessageId:draft.id,expiresAt,createdAt:now,updatedAt:now,...(holdId?{holdId}:{}),...(targetStartsAt?{targetStartsAt}:{}),...(targetStaffId?{targetStaffId}:{}),...(input.actionType==='cancel_appointment'?{reason:input.reason}:{})}
    try{return await this.store.prepareConversationActionWithAudit(context,action,draft,{auditId:randomUUID(),userId:context.userId,occurredAt:now})}catch(error){if(holdId)await this.store.cancelHold(context,holdId);throw error}
  }
}

function appointmentTime(value:string,timezone:string){return`${new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:timezone}).format(new Date(value))} ${timezone}`}
function money(value:number,currency:string){return new Intl.NumberFormat('en-GB',{style:'currency',currency}).format(value/100)}
