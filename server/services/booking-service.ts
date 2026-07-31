import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { BookAppointmentInput, BookingMutationClaim, BookingRecord, CancelBookingInput, HoldInput, RecoveryAttributionTouch, RevenueAttribution, RescheduleBookingInput, TenantContext } from '../domain/schemas.js'
import { DomainError } from '../domain/errors.js'
import type { Store } from '../repositories/store.js'
import { AuditService } from './audit-service.js'
import { EventService } from './event-service.js'
import type { BookingGateway } from './square-booking-gateway.js'

export class BookingService {
  constructor(private readonly store: Store, private readonly events: EventService, private readonly audit: AuditService, private readonly gateway?: BookingGateway) {}

  async createHold(context: TenantContext, input: HoldInput) {
    if (input.provider === 'local' && process.env.NODE_ENV === 'production') throw new DomainError('Local booking is disabled in production', 'LOCAL_BOOKING_DISABLED', 409)
    const providerDetails = input.provider === 'square' ? await this.requireGateway().validateHold(context, input) : undefined
    const occurredAt=new Date().toISOString()
    return this.store.saveHoldWithEvidence(context,{ id: randomUUID(), ...input, tenantId: context.tenantId, locationId: context.locationId, confirmationToken: randomBytes(24).toString('hex'), expiresAt: new Date(Date.parse(occurredAt) + 10 * 60_000).toISOString(), status: 'active', ...(providerDetails ? { providerDetails } : {}) },{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,occurredAt})
  }

  async requireMutableSquareBooking(context:TenantContext,bookingId:string){const booking=await this.requireBooking(context,bookingId);if(booking.provider!=='square')throw new DomainError('Only Square bookings can be changed through customer confirmation','BOOKING_PROVIDER_UNSUPPORTED',409);this.ensureMutable(booking);return booking}

  async book(context: TenantContext, input: BookAppointmentInput): Promise<{ booking: BookingRecord; duplicate: boolean }> {
    const previous = await this.store.getBookingByIdempotency(context, input.idempotencyKey)
    if (previous) {await this.requireBookingRetry(context,input,previous);await this.attributeAfterBooking(context,input,previous);return { booking: previous, duplicate: true }}
    const hold = await this.store.getHold(context, input.holdId)
    if (!hold) throw new DomainError('Hold not found for this tenant', 'HOLD_NOT_FOUND', 404)
    if (hold.locationId !== context.locationId || hold.clientId !== input.clientId) throw new DomainError('Hold scope does not match the request', 'HOLD_SCOPE_MISMATCH', 403)
    const retryingClaim = hold.status === 'booking' && hold.bookingAttemptKey === input.idempotencyKey
    if ((!retryingClaim && hold.status !== 'active') || (Date.parse(hold.expiresAt) <= Date.now()&&!hold.providerOutcomeUncertainAt)) throw new DomainError('Hold is no longer active', 'HOLD_EXPIRED', 409)
    if (hold.confirmationToken !== input.confirmationToken) throw new DomainError('Confirmation token is invalid', 'INVALID_CONFIRMATION', 403)
    if (hold.expectedPriceMinor !== input.expectedPriceMinor || hold.currency !== input.currency) throw new DomainError('Price does not match the authoritative hold', 'PRICE_MISMATCH', 409)
    if(input.waitlistOfferId){const offer=await this.store.getWaitlistOffer(context,input.waitlistOfferId);const entry=offer?await this.store.getWaitlistEntry(context,offer.entryId):undefined;const retryingOffer=offer?.status==='booking'&&offer.bookingAttemptKey===input.idempotencyKey&&offer.bookingHoldId===hold.id;if(!offer||!entry||(!retryingOffer&&(offer.status!=='accepted'||Date.parse(offer.expiresAt)<=Date.now()))||entry.clientId!==hold.clientId||offer.serviceId!==hold.serviceId||offer.staffId!==hold.staffId||offer.startsAt!==hold.startsAt||offer.channel!==(hold.channel??'sms'))throw new DomainError('Accepted waitlist offer does not match this hold','WAITLIST_OFFER_MISMATCH',409)}
    const claimed = await this.store.claimHold(context, hold.id, input.idempotencyKey,input.waitlistOfferId)
    if (!claimed) throw new DomainError('Another booking attempt already claimed this hold', 'HOLD_ALREADY_CLAIMED', 409)
    let providerBooking
    try { providerBooking = claimed.provider === 'square' ? await this.requireGateway().createBooking(context, claimed, input.idempotencyKey) : undefined }
    catch (error) {if(isUnknownBookingOutcome(error))await this.store.markHoldBookingOutcomeUncertain(context,claimed.id,input.idempotencyKey,new Date().toISOString());else await this.store.releaseHold(context, claimed.id, input.idempotencyKey,input.waitlistOfferId); throw error }
    const booking: BookingRecord = { id: randomUUID(), tenantId: context.tenantId, locationId: context.locationId, holdId: hold.id, clientId: hold.clientId, bookingReference: providerBooking?.id ?? `SRA-${randomBytes(4).toString('hex').toUpperCase()}`, priceMinor: hold.expectedPriceMinor, currency: hold.currency, createdAt: new Date().toISOString(), provider: providerBooking?.provider ?? 'local', serviceId:hold.serviceId,staffId:hold.staffId,startsAt:hold.startsAt,...(hold.channel?{notificationChannel:hold.channel}:{}),...(input.waitlistOfferId?{waitlistOfferId:input.waitlistOfferId}:{}), ...(providerBooking ? { providerBookingId: providerBooking.id, ...(providerBooking.version !== undefined ? { providerBookingVersion: providerBooking.version } : {}), ...(providerBooking.status ? { providerStatus: providerBooking.status } : {}) } : {}) }
    const [clientProfile,locationSettings]=await Promise.all([this.store.getClientProfile(context,booking.clientId),this.store.getLocationSettings(context)])
    const completionEvidence={auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,occurredAt:booking.createdAt,...(input.waitlistOfferId?{waitlistOfferId:input.waitlistOfferId}:{}),...(clientProfile?{customerContact:{contactTo:clientProfile.contactTo,timezone:clientProfile.timezone}}:{}),...(locationSettings?{senderName:locationSettings.senderName}:{})}
    try { await this.store.completeBookingWithEvidence(context, input.idempotencyKey, claimed, booking, completionEvidence) }
    catch (error) { const recovered = await this.store.getBookingByIdempotency(context, input.idempotencyKey); if (recovered){await this.attributeAfterBooking(context,input,recovered);return { booking: recovered, duplicate: true }}; throw error }
    await this.attributeAfterBooking(context,input,booking)
    return { booking, duplicate: false }
  }

  private async attributeAfterBooking(context:TenantContext,input:BookAppointmentInput,booking:BookingRecord){const existing=await this.store.getRevenueAttributionForBooking(context,booking.id);if(existing){await this.resolveAttributedRecovery(context,existing);return}if(input.waitlistOfferId){await this.attributeWaitlist(context,input.waitlistOfferId,booking);return}await this.attributeRecovery(context,booking)}

  private async attributeWaitlist(context:TenantContext,offerId:string,booking:BookingRecord){const offer=await this.store.getWaitlistOffer(context,offerId);if(!offer)throw new DomainError('Waitlist offer not found','WAITLIST_OFFER_MISMATCH',409);const attribution:RevenueAttribution={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,bookingId:booking.id,waitlistOfferId:offer.id,sourceId:offer.id,workflowJobId:offer.workflowJobId,recoveryCorrelationId:offer.correlationId,amountMinor:booking.priceMinor,currency:booking.currency,attributionType:'waitlist_fill',evidence:'accepted_waitlist_offer',touchAt:offer.respondedAt??offer.createdAt,verifiedAt:new Date().toISOString()};const saved=await this.store.saveRevenueAttributionWithEvidence(context,attribution,{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,occurredAt:attribution.verifiedAt});await this.resolveAttributedRecovery(context,saved.attribution)}

  private async attributeRecovery(context:TenantContext,booking:BookingRecord){const touches=await this.store.listRecoveryAttributionTouches(context,booking.clientId,booking.createdAt);const touch=touches.find(value=>eligibleTouch(value,booking.createdAt));if(!touch)return;const attribution:RevenueAttribution={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,bookingId:booking.id,sourceId:touch.sourceId,workflowJobId:touch.workflowJobId,...(touch.recoveryCorrelationId?{recoveryCorrelationId:touch.recoveryCorrelationId}:{}),amountMinor:booking.priceMinor,currency:booking.currency,attributionType:touch.sourceType,evidence:'sent_recovery_before_booking',touchAt:touch.occurredAt,verifiedAt:new Date().toISOString()};const saved=await this.store.saveRevenueAttributionWithEvidence(context,attribution,{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,occurredAt:attribution.verifiedAt});await this.resolveAttributedRecovery(context,saved.attribution)}

  private async resolveAttributedRecovery(context:TenantContext,attribution:RevenueAttribution){if(!attribution.recoveryCorrelationId)return;await this.store.resolveRecoveryCaseWithEvidence(context,attribution.recoveryCorrelationId,attribution.bookingId,{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,causationId:attribution.workflowJobId,occurredAt:attribution.verifiedAt,attributionType:attribution.attributionType,sourceId:attribution.sourceId})}

  async cancel(context: TenantContext, input: CancelBookingInput) {
    const duplicate=await this.store.getBookingByIdempotency(context,input.idempotencyKey); if(duplicate){if(duplicate.id!==input.bookingId)throw idempotencyScopeMismatch();return {booking:duplicate,duplicate:true}}
    const booking=await this.requireMutableSquareBooking(context,input.bookingId)
    const claim=bookingMutationClaim('cancelled',input.bookingId,input.idempotencyKey);const claimed=await this.store.claimBookingMutation(context,booking.id,claim);if(!claimed)throw bookingMutationConflict()
    let result;try{result=await this.requireGateway().cancelBooking(context,claimed,input.idempotencyKey)}catch(error){if(!isUnknownMutationOutcome(error))await this.store.releaseBookingMutationClaim(context,booking.id,claim.requestDigest);throw error}
    const updated:BookingRecord={...claimed,providerBookingVersion:result.version??claimed.providerBookingVersion,providerStatus:result.status??'CANCELLED_BY_CUSTOMER'};delete updated.providerMutationClaim
    await this.store.saveBookingMutationWithEvidence(context,input.idempotencyKey,updated,{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,occurredAt:new Date().toISOString(),mutation:'cancelled',requestDigest:claim.requestDigest})
    return {booking:updated,duplicate:false}
  }

  async reschedule(context: TenantContext, input: RescheduleBookingInput) {
    const duplicate=await this.store.getBookingByIdempotency(context,input.idempotencyKey); if(duplicate){if(duplicate.id!==input.bookingId||duplicate.startsAt!==input.startsAt||duplicate.staffId!==input.staffId)throw idempotencyScopeMismatch();return {booking:duplicate,duplicate:true}}
    const booking=await this.requireMutableSquareBooking(context,input.bookingId);const hold=await this.store.getHold(context,booking.holdId);if(!hold)throw new DomainError('Original booking hold is unavailable','BOOKING_HOLD_NOT_FOUND',409)
    const claim=bookingMutationClaim('rescheduled',input.bookingId,input.idempotencyKey,input.startsAt,input.staffId);const claimed=await this.store.claimBookingMutation(context,booking.id,claim);if(!claimed)throw bookingMutationConflict()
    let result;try{result=await this.requireGateway().rescheduleBooking(context,claimed,hold,input.startsAt,input.staffId,input.idempotencyKey)}catch(error){if(!isUnknownMutationOutcome(error))await this.store.releaseBookingMutationClaim(context,booking.id,claim.requestDigest);throw error}
    const updated:BookingRecord={...claimed,startsAt:input.startsAt,staffId:input.staffId,providerBookingVersion:result.version??claimed.providerBookingVersion,providerStatus:result.status??claimed.providerStatus};delete updated.providerMutationClaim
    await this.store.saveBookingMutationWithEvidence(context,input.idempotencyKey,updated,{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,occurredAt:new Date().toISOString(),mutation:'rescheduled',requestDigest:claim.requestDigest})
    return {booking:updated,duplicate:false}
  }

  private async requireBooking(context:TenantContext,id:string){const booking=await this.store.getBooking(context,id);if(!booking)throw new DomainError('Booking not found for this tenant','BOOKING_NOT_FOUND',404);return booking}
  private async requireBookingRetry(context:TenantContext,input:BookAppointmentInput,booking:BookingRecord){if(booking.holdId!==input.holdId||booking.clientId!==input.clientId||booking.priceMinor!==input.expectedPriceMinor||booking.currency!==input.currency||booking.waitlistOfferId!==input.waitlistOfferId)throw idempotencyScopeMismatch();const hold=await this.store.getHold(context,input.holdId);if(!hold||hold.confirmationToken!==input.confirmationToken)throw idempotencyScopeMismatch()}
  private ensureMutable(booking:BookingRecord){if(booking.providerStatus&&['CANCELLED_BY_CUSTOMER','CANCELLED_BY_SELLER','DECLINED','NO_SHOW','COMPLETED'].includes(booking.providerStatus))throw new DomainError('Booking is no longer mutable','BOOKING_NOT_MUTABLE',409)}

  private requireGateway() {
    if (!this.gateway) throw new DomainError('Provider booking is not configured', 'BOOKING_PROVIDER_NOT_CONFIGURED', 503)
    return this.gateway
  }
}

function idempotencyScopeMismatch(){return new DomainError('Idempotency key was already used for different booking inputs','IDEMPOTENCY_SCOPE_MISMATCH',409)}
function isUnknownBookingOutcome(error:unknown){return error instanceof DomainError&&error.code==='SQUARE_BOOKING_OUTCOME_UNKNOWN'}
function isUnknownMutationOutcome(error:unknown){return error instanceof DomainError&&(error.code==='SQUARE_CANCEL_OUTCOME_UNKNOWN'||error.code==='SQUARE_RESCHEDULE_OUTCOME_UNKNOWN')}
function bookingMutationConflict(){return new DomainError('A different booking mutation is already awaiting provider reconciliation','BOOKING_MUTATION_IN_PROGRESS',409)}
function bookingMutationClaim(mutation:BookingMutationClaim['mutation'],bookingId:string,idempotencyKey:string,startsAt?:string,staffId?:string):BookingMutationClaim{const requestDigest=createHash('sha256').update(JSON.stringify({mutation,bookingId,idempotencyKey,...(startsAt?{startsAt}:{}),...(staffId?{staffId}:{})})).digest('hex');return{mutation,requestDigest,startedAt:new Date().toISOString(),...(startsAt?{startsAt}:{}),...(staffId?{staffId}:{})}}

const attributionWindows:Record<RecoveryAttributionTouch['sourceType'],number>={abandoned_enquiry:24*60*60_000,missed_call_recovery:24*60*60_000,no_show_recovery:7*86_400_000,post_visit_rebook:14*86_400_000,lapsed_reactivation:14*86_400_000}
function eligibleTouch(touch:RecoveryAttributionTouch,bookedAt:string){const elapsed=Date.parse(bookedAt)-Date.parse(touch.occurredAt);return elapsed>=0&&elapsed<=attributionWindows[touch.sourceType]}
