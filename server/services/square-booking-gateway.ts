import type { Booking } from 'square'
import { DomainError } from '../domain/errors.js'
import type { AppointmentHold, AvailabilitySearchInput, AvailabilitySlot, BookingRecord, HoldInput, TenantContext } from '../domain/schemas.js'
import { SquareBookingConnector, squareBookingExternalReference, type BookingConnector } from '../integrations/square-connector.js'
import type { Store } from '../repositories/store.js'
import { CredentialCipher } from '../security/credential-cipher.js'
import { SquareTokenService } from './square-token-service.js'
import { isTransientProviderFailure, type ProviderCircuitBreakerService } from './provider-circuit-breaker-service.js'

type ConnectorFactory = (accessToken: string) => BookingConnector

export interface ProviderBookingResult {
  provider: 'square'
  id: string
  version?: number
  status?: string
}

export type SquareBookingInspection={found:boolean;id:string;version?:number;status?:string;startsAt?:string;staffId?:string}

export interface BookingGateway {
  searchAvailability(context: TenantContext, input: AvailabilitySearchInput): Promise<AvailabilitySlot[]>
  validateHold(context: TenantContext, input: HoldInput): Promise<NonNullable<AppointmentHold['providerDetails']>>
  createBooking(context: TenantContext, hold: AppointmentHold, idempotencyKey: string): Promise<ProviderBookingResult>
  cancelBooking(context: TenantContext, booking: BookingRecord, idempotencyKey: string): Promise<ProviderBookingResult>
  rescheduleBooking(context: TenantContext, booking: BookingRecord, hold: AppointmentHold, startsAt: string, staffId: string, idempotencyKey: string): Promise<ProviderBookingResult>
}

export class SquareBookingGateway implements BookingGateway {
  private readonly connectorFactory: ConnectorFactory

  constructor(
    private readonly store: Store,
    private readonly cipher: CredentialCipher,
    environment: 'sandbox' | 'production',
    connectorFactory?: ConnectorFactory,
    private readonly tokens = new SquareTokenService(store, cipher),
    private readonly providerCircuits?:ProviderCircuitBreakerService,
  ) {
    this.connectorFactory = connectorFactory ?? ((accessToken) => new SquareBookingConnector({ accessToken, environment }))
  }

  async searchAvailability(context: TenantContext, input: AvailabilitySearchInput) {
    const service = await this.requireService(context, input.serviceId)
    const staffIds = input.staffIds ?? service.teamMemberIds
    if (!staffIds.length) throw new DomainError('No bookable staff are assigned to this service', 'SERVICE_HAS_NO_STAFF', 409)
    for (const staffId of staffIds) {
      if (service.teamMemberIds.length && !service.teamMemberIds.includes(staffId)) throw new DomainError('Staff member is not assigned to this service', 'STAFF_SERVICE_MISMATCH', 409)
      const staff = await this.store.getStaff(context, staffId)
      if (!staff?.bookable) throw new DomainError('Staff member is not bookable', 'STAFF_NOT_BOOKABLE', 409)
    }
    const connector = await this.connector(context)
    try {
      const request=()=>connector.searchAvailability({ locationId: context.locationId, serviceVariationId: service.id, from: input.from, to: input.to, teamMemberIds: staffIds });const availabilities=this.providerCircuits?await this.providerCircuits.execute(context,'square','availability.search',request):await request()
      return availabilities.flatMap((availability): AvailabilitySlot[] => {
        if (!availability.startAt || availability.locationId !== context.locationId) return []
        const segment = availability.appointmentSegments?.find((candidate) => candidate.serviceVariationId === service.id)
        if (!segment?.teamMemberId || !segment.durationMinutes || segment.serviceVariationVersion === undefined || segment.serviceVariationVersion === null) return []
        return [{ startsAt: availability.startAt, locationId: context.locationId, serviceId: service.id, staffId: segment.teamMemberId, durationMinutes: segment.durationMinutes, serviceVariationVersion: String(segment.serviceVariationVersion) }]
      })
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError('Square availability could not be retrieved', 'SQUARE_AVAILABILITY_FAILED', 502)
    }
  }

  async validateHold(context: TenantContext, input: HoldInput) {
    const service = await this.requireService(context, input.serviceId)
    if (service.priceMinor === undefined || !service.currency) throw new DomainError('The selected service has no authoritative price', 'SERVICE_PRICE_UNAVAILABLE', 409)
    if (service.priceMinor !== input.expectedPriceMinor || service.currency !== input.currency) throw new DomainError('Price does not match the synchronized provider service', 'PRICE_MISMATCH', 409)
    const slots = await this.searchAvailability(context, { serviceId: input.serviceId, staffIds: [input.staffId], from: input.startsAt, to: new Date(Date.parse(input.startsAt) + 60_000).toISOString() })
    const slot = slots.find((candidate) => candidate.startsAt === input.startsAt && candidate.staffId === input.staffId)
    if (!slot) throw new DomainError('The selected Square slot is no longer available', 'SLOT_UNAVAILABLE', 409)
    return { provider: 'square' as const, customerId: input.providerCustomerId!, serviceVariationVersion: slot.serviceVariationVersion, durationMinutes: slot.durationMinutes }
  }

  async createBooking(context: TenantContext, hold: AppointmentHold, idempotencyKey: string) {
    const details = hold.providerDetails
    if (!details || details.provider !== 'square') throw new DomainError('Square hold details are missing', 'PROVIDER_HOLD_INVALID', 409)
    const connector = await this.connector(context)
    if(hold.providerOutcomeUncertainAt){const reconciled=await this.reconcileUncertainBooking(context,connector,hold,idempotencyKey);if(reconciled)return reconciled}
    let booking: Booking
    try {
      const request=()=>connector.createBooking({ idempotencyKey, customerId: details.customerId, locationId: context.locationId, startAt: hold.startsAt, teamMemberId: hold.staffId, serviceVariationId: hold.serviceId, serviceVariationVersion: BigInt(details.serviceVariationVersion), durationMinutes: details.durationMinutes });booking=this.providerCircuits?await this.providerCircuits.execute(context,'square','booking.create',request):await request()
    } catch (error) {
      if(error instanceof DomainError&&error.code==='PROVIDER_CIRCUIT_OPEN'){if(hold.providerOutcomeUncertainAt)throw unknownBookingOutcome();throw error}
      if(isTransientProviderFailure(error))throw unknownBookingOutcome()
      if(error instanceof DomainError)throw error
      throw new DomainError('Square could not create the booking', 'SQUARE_BOOKING_FAILED', 502)
    }
    if (!booking.id) throw new DomainError('Square did not return a booking ID', 'SQUARE_BOOKING_INVALID_RESPONSE', 502)
    return { provider: 'square' as const, id: booking.id, ...(booking.version !== undefined ? { version: booking.version } : {}), ...(booking.status ? { status: booking.status } : {}) }
  }

  async cancelBooking(context:TenantContext,booking:BookingRecord,idempotencyKey:string){
    if(!booking.providerBookingId||booking.providerBookingVersion===undefined) throw new DomainError('Provider booking version is unavailable','BOOKING_VERSION_REQUIRED',409)
    const connector=await this.connector(context);const reconciled=await this.reconcileCancellation(context,connector,booking);if(reconciled)return reconciled
    try{const request=()=>connector.cancelBooking(booking.providerBookingId!,booking.providerBookingVersion!,idempotencyKey);const result=this.providerCircuits?await this.providerCircuits.execute(context,'square','booking.cancel',request):await request();return this.providerResult(result)}catch(error){if(error instanceof DomainError&&error.code==='PROVIDER_CIRCUIT_OPEN')throw unknownCancellationOutcome();if(isTransientProviderFailure(error))throw unknownCancellationOutcome();if(error instanceof DomainError)throw error;throw new DomainError('Square could not cancel the booking','SQUARE_CANCEL_FAILED',502)}
  }

  async rescheduleBooking(context:TenantContext,booking:BookingRecord,hold:AppointmentHold,startsAt:string,staffId:string,idempotencyKey:string){
    if(!booking.providerBookingId||booking.providerBookingVersion===undefined||!hold.providerDetails) throw new DomainError('Provider booking details are incomplete','BOOKING_VERSION_REQUIRED',409)
    const connector=await this.connector(context);const reconciled=await this.reconcileReschedule(context,connector,booking,startsAt,staffId);if(reconciled)return reconciled
    const slots=await this.searchAvailability(context,{serviceId:booking.serviceId,staffIds:[staffId],from:startsAt,to:new Date(Date.parse(startsAt)+60_000).toISOString()});const slot=slots.find(value=>value.startsAt===startsAt&&value.staffId===staffId);if(!slot)throw new DomainError('The replacement slot is no longer available','SLOT_UNAVAILABLE',409)
    try{const request=()=>connector.updateBooking(booking.providerBookingId!,booking.providerBookingVersion!,{idempotencyKey,locationId:context.locationId,startAt:startsAt,teamMemberId:staffId,serviceVariationId:booking.serviceId,serviceVariationVersion:BigInt(slot.serviceVariationVersion),durationMinutes:slot.durationMinutes});const result=this.providerCircuits?await this.providerCircuits.execute(context,'square','booking.reschedule',request):await request();return this.providerResult(result)}catch(error){if(error instanceof DomainError&&error.code==='PROVIDER_CIRCUIT_OPEN')throw unknownRescheduleOutcome();if(isTransientProviderFailure(error))throw unknownRescheduleOutcome();if(error instanceof DomainError)throw error;throw new DomainError('Square could not reschedule the booking','SQUARE_RESCHEDULE_FAILED',502)}
  }

  async inspectBooking(context:TenantContext,providerBookingId:string):Promise<SquareBookingInspection>{const connector=await this.connector(context);const request=async()=>{try{const booking=await connector.retrieveBooking(providerBookingId);const segment=booking.appointmentSegments?.[0];return{found:true,id:booking.id??providerBookingId,...(booking.version!==undefined?{version:booking.version}:{}),...(booking.status?{status:String(booking.status)}:{}),...(booking.startAt?{startsAt:booking.startAt}:{}),...(segment?.teamMemberId?{staffId:segment.teamMemberId}:{})}}catch(error){if(providerStatus(error)===404)return{found:false,id:providerBookingId};throw error}};try{return this.providerCircuits?await this.providerCircuits.execute(context,'square','booking.reconcile',request):await request()}catch(error){if(error instanceof DomainError)throw error;throw new DomainError('Square booking reconciliation could not be completed','SQUARE_RECONCILIATION_FAILED',502)}}

  private providerResult(booking:Booking){if(!booking.id)throw new DomainError('Square did not return a booking ID','SQUARE_BOOKING_INVALID_RESPONSE',502);return{provider:'square' as const,id:booking.id,...(booking.version!==undefined?{version:booking.version}:{}),...(booking.status?{status:booking.status}:{})}}

  private async reconcileCancellation(context:TenantContext,connector:BookingConnector,booking:BookingRecord){const remote=await this.retrieveMutationBooking(context,connector,booking,unknownCancellationOutcome);if(remote.version===undefined)throw unknownCancellationOutcome();const status=String(remote.status??'').toUpperCase();if(status.startsWith('CANCELLED'))return this.providerResult(remote);if(!['ACCEPTED','PENDING'].includes(status))throw new DomainError('Square reports that the booking is no longer mutable','BOOKING_NOT_MUTABLE',409);if(remote.version!==booking.providerBookingVersion)throw unknownCancellationOutcome();return undefined}

  private async reconcileReschedule(context:TenantContext,connector:BookingConnector,booking:BookingRecord,startsAt:string,staffId:string){const remote=await this.retrieveMutationBooking(context,connector,booking,unknownRescheduleOutcome);if(remote.version===undefined)throw unknownRescheduleOutcome();const status=String(remote.status??'').toUpperCase();if(!['ACCEPTED','PENDING'].includes(status))throw new DomainError('Square reports that the booking is no longer mutable','BOOKING_NOT_MUTABLE',409);const segment=remote.appointmentSegments?.find(value=>value.serviceVariationId===booking.serviceId);if(!remote.startAt||!segment?.teamMemberId)throw unknownRescheduleOutcome();if(Date.parse(remote.startAt)===Date.parse(startsAt)&&segment.teamMemberId===staffId)return this.providerResult(remote);if(Date.parse(remote.startAt)!==Date.parse(booking.startsAt)||segment.teamMemberId!==booking.staffId||remote.version!==booking.providerBookingVersion)throw unknownRescheduleOutcome();return undefined}

  private async retrieveMutationBooking(context:TenantContext,connector:BookingConnector,booking:BookingRecord,unknown:()=>DomainError){try{const request=()=>connector.retrieveBooking(booking.providerBookingId!);const remote=this.providerCircuits?await this.providerCircuits.execute(context,'square','booking.reconcile_mutation',request):await request();if(!remote.id||remote.id!==booking.providerBookingId||(remote.locationId&&remote.locationId!==context.locationId))throw unknown();return remote}catch(error){if(error instanceof DomainError&&error.code==='BOOKING_NOT_MUTABLE')throw error;throw unknown()}}

  private async reconcileUncertainBooking(context:TenantContext,connector:BookingConnector,hold:AppointmentHold,idempotencyKey:string){if(!connector.listBookings)throw unknownBookingOutcome();const details=hold.providerDetails!;let candidates:Booking[];try{const request=()=>connector.listBookings!({customerId:details.customerId,teamMemberId:hold.staffId,locationId:context.locationId,startAtMin:new Date(Date.parse(hold.startsAt)-60_000).toISOString(),startAtMax:new Date(Date.parse(hold.startsAt)+60_000).toISOString(),limit:20});candidates=this.providerCircuits?await this.providerCircuits.execute(context,'square','booking.reconcile_uncertain',request):await request()}catch{throw unknownBookingOutcome()}const reference=squareBookingExternalReference(idempotencyKey);const matches=candidates.filter(booking=>booking.sellerNote===reference&&booking.locationId===context.locationId&&booking.customerId===details.customerId&&booking.startAt&&Date.parse(booking.startAt)===Date.parse(hold.startsAt)&&booking.appointmentSegments?.some(segment=>segment.teamMemberId===hold.staffId&&segment.serviceVariationId===hold.serviceId));if(matches.length>1)throw unknownBookingOutcome();const match=matches[0];if(!match)return undefined;if(!match.status||!['ACCEPTED','PENDING'].includes(String(match.status)))throw unknownBookingOutcome();return this.providerResult(match)}

  private async requireService(context: TenantContext, serviceId: string) {
    const service = await this.store.getService(context, serviceId)
    if (!service?.active || service.provider !== 'square') throw new DomainError('Square service is not available for this location', 'SERVICE_NOT_FOUND', 404)
    return service
  }

  private async connector(context: TenantContext) {
    return this.connectorFactory(await this.tokens.getAccessToken(context))
  }
}

function unknownBookingOutcome(){return new DomainError('Square booking outcome is unknown; retain the claim and reconcile before retrying','SQUARE_BOOKING_OUTCOME_UNKNOWN',503)}
function unknownCancellationOutcome(){return new DomainError('Square cancellation outcome is unknown; retain the mutation claim and reconcile before retrying','SQUARE_CANCEL_OUTCOME_UNKNOWN',503)}
function unknownRescheduleOutcome(){return new DomainError('Square reschedule outcome is unknown; retain the mutation claim and reconcile before retrying','SQUARE_RESCHEDULE_OUTCOME_UNKNOWN',503)}

function providerStatus(error:unknown){if(typeof error!=='object'||error===null)return undefined;for(const key of['status','statusCode']){const value=(error as Record<string,unknown>)[key];if(typeof value==='number')return value}return undefined}
