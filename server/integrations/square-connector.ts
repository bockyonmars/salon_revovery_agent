import { createHash } from 'node:crypto'
import { CatalogItemProductType, SquareClient, SquareEnvironment, type Availability, type Booking, type CatalogObject, type TeamMemberBookingProfile } from 'square'
import { z } from 'zod'

export const SquareAvailabilityInputSchema = z.object({
  locationId: z.string().min(1),
  serviceVariationId: z.string().min(1),
  from: z.string().datetime(),
  to: z.string().datetime(),
  teamMemberIds: z.array(z.string().min(1)).max(20).optional(),
})

export const SquareBookingInputSchema = z.object({
  idempotencyKey: z.string().min(16).max(255),
  customerId: z.string().min(1),
  locationId: z.string().min(1),
  startAt: z.string().datetime(),
  teamMemberId: z.string().min(1),
  serviceVariationId: z.string().min(1),
  serviceVariationVersion: z.bigint(),
  durationMinutes: z.number().int().positive(),
})

export type SquareAvailabilityInput = z.infer<typeof SquareAvailabilityInputSchema>
export type SquareBookingInput = z.infer<typeof SquareBookingInputSchema>
export type SquareBookingLookupInput={customerId:string;teamMemberId:string;locationId:string;startAtMin:string;startAtMax:string;limit:number}
export function squareBookingExternalReference(idempotencyKey:string){return`sra-recovery:${createHash('sha256').update(idempotencyKey).digest('hex')}`}

export interface BookingConnector {
  searchAvailability(input: SquareAvailabilityInput): Promise<Availability[]>
  createBooking(input: SquareBookingInput): Promise<Booking>
  listBookings?(input:SquareBookingLookupInput):Promise<Booking[]>
  retrieveBooking(bookingId: string): Promise<Booking>
  cancelBooking(bookingId: string, bookingVersion: number, idempotencyKey: string): Promise<Booking>
  updateBooking(bookingId: string, bookingVersion: number, input: Omit<SquareBookingInput,'customerId'>): Promise<Booking>
}

export interface SquareCatalogConnector {
  listBookableStaff(locationId: string): Promise<TeamMemberBookingProfile[]>
  listAppointmentServices(locationId: string): Promise<CatalogObject[]>
}

export class SquareBookingConnector implements BookingConnector, SquareCatalogConnector {
  private readonly client: SquareClient

  constructor(options: { accessToken: string; environment: 'sandbox' | 'production'; timeoutSeconds?: number }) {
    this.client = new SquareClient({
      token: options.accessToken,
      environment: options.environment === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
      version: '2026-07-15',
      timeoutInSeconds: options.timeoutSeconds ?? 8,
      maxRetries: 0,
    })
  }

  async searchAvailability(raw: SquareAvailabilityInput) {
    const input = SquareAvailabilityInputSchema.parse(raw)
    const response = await this.client.bookings.searchAvailability({ query: { filter: {
      startAtRange: { startAt: input.from, endAt: input.to },
      locationId: input.locationId,
      segmentFilters: [{ serviceVariationId: input.serviceVariationId, ...(input.teamMemberIds?.length ? { teamMemberIdFilter: { any: input.teamMemberIds } } : {}) }],
    } } })
    return response.availabilities ?? []
  }

  async createBooking(raw: SquareBookingInput) {
    const input = SquareBookingInputSchema.parse(raw)
    const response = await this.client.bookings.create({ idempotencyKey: input.idempotencyKey, booking: {
      customerId: input.customerId,
      locationId: input.locationId,
      startAt: input.startAt,
      sellerNote:squareBookingExternalReference(input.idempotencyKey),
      appointmentSegments: [{ teamMemberId: input.teamMemberId, serviceVariationId: input.serviceVariationId, serviceVariationVersion: input.serviceVariationVersion, durationMinutes: input.durationMinutes }],
    } })
    if (!response.booking) throw new Error('Square did not return the created booking')
    return response.booking
  }

  async listBookings(input:SquareBookingLookupInput){const page=await this.client.bookings.list({limit:Math.min(Math.max(input.limit,1),20),customerId:input.customerId,teamMemberId:input.teamMemberId,locationId:input.locationId,startAtMin:input.startAtMin,startAtMax:input.startAtMax});const bookings:Booking[]=[];for await(const booking of page){bookings.push(booking);if(bookings.length>=input.limit)break}return bookings}

  async retrieveBooking(bookingId: string) {
    const response = await this.client.bookings.get({ bookingId })
    if (!response.booking) throw new Error('Square booking not found')
    return response.booking
  }

  async cancelBooking(bookingId: string, bookingVersion: number, idempotencyKey: string) {
    const response = await this.client.bookings.cancel({ bookingId, bookingVersion, idempotencyKey })
    if (!response.booking) throw new Error('Square did not return the cancelled booking')
    return response.booking
  }

  async updateBooking(bookingId: string, bookingVersion: number, raw: Omit<SquareBookingInput,'customerId'>) {
    const input=SquareBookingInputSchema.omit({customerId:true}).parse(raw)
    const response=await this.client.bookings.update({bookingId,idempotencyKey:input.idempotencyKey,booking:{version:bookingVersion,startAt:input.startAt,locationId:input.locationId,appointmentSegments:[{teamMemberId:input.teamMemberId,serviceVariationId:input.serviceVariationId,serviceVariationVersion:input.serviceVariationVersion,durationMinutes:input.durationMinutes}]}})
    if(!response.booking) throw new Error('Square did not return the updated booking')
    return response.booking
  }

  async listBookableStaff(locationId: string) {
    const page = await this.client.bookings.teamMemberProfiles.list({ bookableOnly: true, locationId })
    const profiles: TeamMemberBookingProfile[] = []
    for await (const profile of page) profiles.push(profile)
    return profiles
  }

  async listAppointmentServices(locationId: string) {
    const items: CatalogObject[] = []
    let cursor: string | undefined
    do {
      const response = await this.client.catalog.searchItems({ enabledLocationIds: [locationId], productTypes: [CatalogItemProductType.AppointmentsService], limit: 100, cursor })
      items.push(...(response.items ?? []))
      cursor = response.cursor
    } while (cursor)
    return items
  }
}
