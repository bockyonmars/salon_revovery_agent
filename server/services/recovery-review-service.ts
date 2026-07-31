import { randomUUID } from 'node:crypto'
import type { PublicRecoveryReview, PublicRecoveryReviewInput } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'

const MISSED_ENQUIRY_RECOVERY_RATE=.65
const LATE_CANCELLATION_RECOVERY_RATE=.35

export class RecoveryReviewService {
  constructor(private readonly store:Store){}

  async submit(input:PublicRecoveryReviewInput){
    const now=new Date()
    const calculator=input.calculator
    const missed=calculator.monthlyEnquiries*(calculator.unansweredPercentage/100)*(calculator.bookingConversionPercentage/100)*calculator.averageTicketMinor*MISSED_ENQUIRY_RECOVERY_RATE
    const booked=calculator.monthlyEnquiries*(1-calculator.unansweredPercentage/100)*(calculator.bookingConversionPercentage/100)
    const cancellations=booked*(calculator.lateCancellationPercentage/100)*calculator.averageTicketMinor*LATE_CANCELLATION_RECOVERY_RATE
    const createdAt=now.toISOString()
    const review:PublicRecoveryReview={
      id:randomUUID(),submissionKey:input.submissionKey,contactName:input.contactName,businessEmail:input.businessEmail,salonName:input.salonName,
      locations:input.locations,bookingPlatform:input.bookingPlatform,monthlyAppointments:input.monthlyAppointments,averageTicketMinor:input.averageTicketMinor,
      primaryRevenueLoss:input.primaryRevenueLoss,channels:input.channels,marketingConsent:input.marketingConsent,privacyNoticeVersion:input.privacyNoticeVersion,
      calculator:input.calculator,sourcePath:input.sourcePath,...(input.locationSlug?{locationSlug:input.locationSlug}:{}),status:'new',
      estimatedRecoveryMinor:Math.round(missed+cancellations),currency:'GBP',...(input.marketingConsent?{marketingConsentCapturedAt:createdAt}:{}),createdAt,
      retentionExpiresAt:new Date(now.getTime()+365*86_400_000).toISOString(),
    }
    return this.store.createPublicRecoveryReview(review)
  }
}
