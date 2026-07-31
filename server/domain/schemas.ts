import { z } from 'zod'

export const TenantContextSchema = z.object({
  tenantId: z.string().min(3),
  locationId: z.string().min(3),
  userId: z.string().min(3),
  role: z.enum(['owner', 'manager', 'operator', 'service']),
})
export type TenantContext = z.infer<typeof TenantContextSchema>

export const ChannelSchema = z.enum(['sms', 'whatsapp', 'email', 'voice'])
export const PurposeSchema = z.enum(['transactional', 'marketing'])
export const ConsentStatusSchema = z.enum(['unknown', 'opted_in', 'opted_out'])

export const ConsentInputSchema = z.object({
  clientId: z.string().min(3),
  channel: ChannelSchema,
  purpose: PurposeSchema,
  status: ConsentStatusSchema,
  captureMethod: z.string().min(2).max(100),
  disclosureVersion: z.string().min(1).max(50),
  sourceEvidenceUrl: z.string().url().optional(),
})
export type ConsentInput = z.infer<typeof ConsentInputSchema>

export type ConsentRecord = ConsentInput & {
  id: string
  tenantId: string
  locationId: string
  capturedAt: string
  revokedAt?: string
}

export type ConsentUpdateEvidence = {
  auditId: string
  eventId: string
  userId: string
  occurredAt: string
}

export const EventTypeSchema = z.enum([
  'provider.webhook_received',
  'lead.received', 'consent.recorded', 'consent.revoked', 'appointment.hold_created', 'appointment.hold_released',
  'appointment.booked', 'appointment.confirmed', 'appointment.rescheduled',
  'appointment.cancelled', 'appointment.completed', 'appointment.no_show',
  'slot.opened', 'waitlist.match_found', 'waitlist.offer_responded', 'waitlist.offer_expired', 'message.queued', 'message.sent',
  'message.delivered', 'message.failed', 'message.replied', 'client.lapsed',
  'review.requested', 'review.feedback_received', 'recovery.opened', 'recovery.contact_sent', 'recovery.resolved', 'revenue.recovered',
  'approval.requested', 'approval.decided',
  'integration.connected',
  'billing.updated',
  'onboarding.activated',
  'conversation.followup_requested',
  'conversation.followup_sent',
  'call.missed',
  'call.recovery_sent',
  'security.incident_opened',
  'security.incident_status_changed',
])

export const EventInputSchema = z.object({
  eventId: z.string().uuid(),
  eventType: EventTypeSchema,
  occurredAt: z.string().datetime(),
  correlationId: z.string().min(3),
  causationId: z.string().min(3).optional(),
  schemaVersion: z.number().int().positive().default(1),
  payload: z.record(z.string(), z.unknown()),
})
export type EventInput = z.infer<typeof EventInputSchema>
export type DomainEvent = EventInput & { tenantId: string; locationId: string }

export type AuditRecordInput = {
  id: string
  tenantId: string
  locationId: string
  userId: string
  action: string
  entityType: string
  entityId: string
  reason: string
  input: unknown
  result: unknown
  occurredAt: string
}
export type AuditRecord = AuditRecordInput&{chainVersion:1;sequence:number;previousHash:string;recordHash:string}
export type AuditIntegrityReport={status:'empty'|'verified'|'legacy_only'|'broken';recordCount:number;legacyRecords:number;chainedRecords:number;checkedAt:string;headHash?:string;breakAtId?:string;reason?:string}

export const HoldInputSchema = z.object({
  clientId: z.string().min(3),
  serviceId: z.string().min(3),
  staffId: z.string().min(3),
  startsAt: z.string().datetime(),
  timezone: z.string().min(3),
  expectedPriceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  provider: z.enum(['local', 'square']).default('local'),
  providerCustomerId: z.string().min(1).optional(),
  contactTo: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  channel: z.enum(['sms', 'whatsapp']).optional(),
}).superRefine((value, context) => {
  if (value.provider === 'square' && !value.providerCustomerId) context.addIssue({ code: 'custom', path: ['providerCustomerId'], message: 'Square customer ID is required for a Square hold' })
})
export type HoldInput = z.infer<typeof HoldInputSchema>

export const BookAppointmentInputSchema = z.object({
  holdId: z.string().uuid(),
  clientId: z.string().min(3),
  confirmationToken: z.string().min(16),
  explicitConfirmation: z.literal(true),
  expectedPriceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  idempotencyKey: z.string().min(16),
  waitlistOfferId: z.string().uuid().optional(),
})
export type BookAppointmentInput = z.infer<typeof BookAppointmentInputSchema>

export type AppointmentHold = HoldInput & {
  id: string
  tenantId: string
  locationId: string
  confirmationToken: string
  expiresAt: string
  status: 'active' | 'booking' | 'booked' | 'expired' | 'released'
  bookingAttemptKey?: string
  providerOutcomeUncertainAt?: string
  providerDetails?: {
    provider: 'square'
    customerId: string
    serviceVariationVersion: string
    durationMinutes: number
  }
}

export type HoldCreationEvidence = {
  auditId: string
  eventId: string
  userId: string
  occurredAt: string
}

export type BookingRecord = {
  id: string
  tenantId: string
  locationId: string
  holdId: string
  clientId: string
  bookingReference: string
  priceMinor: number
  currency: string
  createdAt: string
  provider: 'local' | 'square'
  providerBookingId?: string
  providerBookingVersion?: number
  providerStatus?: string
  serviceId: string
  staffId: string
  startsAt: string
  notificationChannel?: 'sms' | 'whatsapp'
  waitlistOfferId?: string
  providerMutationClaim?: BookingMutationClaim
}

export type BookingMutationClaim={mutation:'cancelled'|'rescheduled';requestDigest:string;startedAt:string;startsAt?:string;staffId?:string}

export type BookingCompletionEvidence = {
  auditId: string
  eventId: string
  userId: string
  occurredAt: string
  waitlistOfferId?: string
  customerContact?: { contactTo: string; timezone: string }
  senderName?: string
}

export type BookingMutationEvidence = {
  auditId: string
  eventId: string
  userId: string
  occurredAt: string
  mutation: 'cancelled' | 'rescheduled'
  requestDigest?:string
}

export const CancelBookingInputSchema = z.object({ bookingId: z.string().uuid(), idempotencyKey: z.string().min(16), reason: z.string().min(3).max(500) })
export type CancelBookingInput = z.infer<typeof CancelBookingInputSchema>
export const RescheduleBookingInputSchema = z.object({ bookingId: z.string().uuid(), startsAt: z.string().datetime(), staffId: z.string().min(3), explicitConfirmation: z.literal(true), idempotencyKey: z.string().min(16) })
export type RescheduleBookingInput = z.infer<typeof RescheduleBookingInputSchema>

export const AvailabilitySearchInputSchema = z.object({
  serviceId: z.string().min(3),
  from: z.string().datetime(),
  to: z.string().datetime(),
  staffIds: z.array(z.string().min(1)).min(1).max(20).optional(),
}).superRefine((value, context) => {
  const from = Date.parse(value.from); const to = Date.parse(value.to)
  if (to <= from) context.addIssue({ code: 'custom', path: ['to'], message: 'Availability end must be after start' })
  if (to - from > 31 * 86_400_000) context.addIssue({ code: 'custom', path: ['to'], message: 'Availability range cannot exceed 31 days' })
})
export type AvailabilitySearchInput = z.infer<typeof AvailabilitySearchInputSchema>

export type AvailabilitySlot = {
  startsAt: string
  locationId: string
  serviceId: string
  staffId: string
  durationMinutes: number
  serviceVariationVersion: string
}

export type WorkflowType = 'conversation_turn'|'abandoned_enquiry'|'missed_call_recovery'|'appointment_confirmation'|'appointment_reminder'|'waitlist_match'|'no_show_recovery'|'post_visit_rebook'|'lapsed_reactivation'|'review_request'|'weekly_roi_report'
export type WorkflowJob = {
  id: string
  tenantId: string
  locationId: string
  workflowType: WorkflowType
  correlationId: string
  causationEventId: string
  dedupeKey: string
  runAt: string
  status: 'pending'|'running'|'completed'|'failed'|'paused'
  attempts: number
  maxAttempts: number
  payload: Record<string, unknown>
  lockedBy?: string
  lockedAt?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}
export type WorkflowDeadLetter={
  id:string
  tenantId:string
  locationId:string
  workflowJobId:string
  workflowType:WorkflowType
  attempts:number
  maxAttempts:number
  failureDetail:string
  approvalId:string
  failedAt:string
}

export const WaitlistEntryInputSchema=z.object({clientId:z.string().min(3),contactTo:z.string().regex(/^\+[1-9]\d{7,14}$/),channel:z.enum(['sms','whatsapp']).optional(),serviceId:z.string().min(3),staffIds:z.array(z.string().min(3)).max(20).default([]),windowStart:z.string().datetime(),windowEnd:z.string().datetime(),timezone:z.string().min(3)}).superRefine((value,context)=>{if(Date.parse(value.windowEnd)<=Date.parse(value.windowStart))context.addIssue({code:'custom',path:['windowEnd'],message:'Waitlist window must end after it starts'})})
export type WaitlistEntryInput=z.infer<typeof WaitlistEntryInputSchema>
export type WaitlistEntry=Omit<WaitlistEntryInput,'channel'>&{channel:'sms'|'whatsapp';id:string;tenantId:string;locationId:string;status:'active'|'offered'|'matched'|'booked'|'cancelled';offerCount:number;joinedAt:string;lastOfferedAt?:string}
export type WaitlistOffer={id:string;tenantId:string;locationId:string;entryId:string;correlationId:string;workflowJobId:string;channel:'sms'|'whatsapp';serviceId:string;staffId:string;startsAt:string;priceMinor:number;currency:string;expiresAt:string;status:'offered'|'accepted'|'booking'|'declined'|'expired'|'booked';createdAt:string;sentAt?:string;providerMessageId?:string;respondedAt?:string;expiredAt?:string;bookingAttemptKey?:string;bookingHoldId?:string}
export type WaitlistOfferDeliveryEvidence={auditId:string;eventId:string;userId:string;occurredAt:string}
export type WaitlistOfferTransitionEvidence={auditId:string;eventId:string;userId:string;occurredAt:string}
export const WaitlistOfferResponseSchema=z.object({accepted:z.boolean()})
export type RevenueAttributionType='waitlist_fill'|'no_show_recovery'|'post_visit_rebook'|'lapsed_reactivation'|'abandoned_enquiry'|'missed_call_recovery'
export type RevenueAttribution={id:string;tenantId:string;locationId:string;bookingId:string;waitlistOfferId?:string;sourceId:string;workflowJobId:string;recoveryCorrelationId?:string;amountMinor:number;currency:string;attributionType:RevenueAttributionType;evidence:'accepted_waitlist_offer'|'sent_recovery_before_booking';touchAt:string;verifiedAt:string}
export type RevenueAttributionEvidence={auditId:string;eventId:string;userId:string;occurredAt:string}
export type RecoveryAttributionTouch={sourceType:Exclude<RevenueAttributionType,'waitlist_fill'>;sourceId:string;workflowJobId:string;clientId:string;occurredAt:string;recoveryCorrelationId?:string}
export type RecoveryCase={id:string;tenantId:string;locationId:string;recoveryType:'waitlist_fill'|'no_show'|'post_visit_rebook'|'lapsed_reactivation';correlationId:string;workflowJobId:string;status:'open'|'resolved'|'closed';potentialRevenueMinor?:number;currency?:string;openedAt:string;resolvedAt?:string;resultBookingId?:string;closeReason?:string}
export type RecoveryCaseOpeningEvidence={auditId:string;eventId:string;userId:string;causationId:string;occurredAt:string}
export type RecoveryCaseCloseReason='already_booked'|'seven_day_interval'|'thirty_day_cap'|'frequency_cap'|'waitlist_exhausted'
export type RecoveryCaseClosureEvidence={auditId:string;eventId:string;userId:string;causationId:string;occurredAt:string}
export type RecoveryCaseResolutionEvidence={auditId:string;eventId:string;userId:string;causationId:string;occurredAt:string;attributionType:RevenueAttributionType;sourceId:string}
export type RecoveryContactAttempt={id:string;tenantId:string;locationId:string;workflowJobId:string;clientId:string;workflowType:'no_show_recovery'|'post_visit_rebook'|'lapsed_reactivation';channel:'sms'|'whatsapp';status:'reserved'|'sent';reservedAt:string;sentAt?:string;providerMessageId?:string}
export type RecoveryContactDecision={allowed:boolean;attempt?:RecoveryContactAttempt;reason?:'seven_day_interval'|'thirty_day_cap'}
export type RecoveryContactCompletionEvidence={auditId:string;eventId:string;userId:string;occurredAt:string}
export const ExperimentWorkflowTypeSchema=z.enum(['no_show_recovery','post_visit_rebook','lapsed_reactivation'])
const ExperimentVariantInputSchema=z.object({key:z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),allocation:z.number().int().min(1).max(99),messageTemplate:z.string().min(40).max(320).superRefine((value,context)=>{if(!value.startsWith('{{sender}}:'))context.addIssue({code:'custom',message:'Experiment copy must begin with {{sender}}:'});if(!value.endsWith('Reply STOP to unsubscribe.'))context.addIssue({code:'custom',message:'Experiment copy must end with the exact opt-out instruction'});const variables=value.match(/{{[^}]+}}/g)??[];if(variables.some(variable=>variable!=='{{sender}}'))context.addIssue({code:'custom',message:'Only the {{sender}} variable is allowed'});if(/\b(guaranteed|urgent|last chance|only \d+ left|discount|free|refund|% off)\b/i.test(value))context.addIssue({code:'custom',message:'Experiment copy cannot contain unverified urgency, scarcity, discount, free-service, or refund claims'})})})
export const ControlledExperimentInputSchema=z.object({name:z.string().min(3).max(120),workflowType:ExperimentWorkflowTypeSchema,startsAt:z.string().datetime().optional(),endsAt:z.string().datetime().optional(),variants:z.array(ExperimentVariantInputSchema).min(2).max(3)}).superRefine((value,context)=>{if(new Set(value.variants.map(variant=>variant.key)).size!==value.variants.length)context.addIssue({code:'custom',path:['variants'],message:'Experiment variant keys must be unique'});if(value.variants.reduce((total,variant)=>total+variant.allocation,0)!==100)context.addIssue({code:'custom',path:['variants'],message:'Experiment allocations must total 100'});if(value.startsAt&&value.endsAt&&Date.parse(value.endsAt)<=Date.parse(value.startsAt))context.addIssue({code:'custom',path:['endsAt'],message:'Experiment end must be after its start'})})
export type ControlledExperimentInput=z.infer<typeof ControlledExperimentInputSchema>
export type ExperimentWorkflowType=z.infer<typeof ExperimentWorkflowTypeSchema>
export type ExperimentVariant=z.infer<typeof ExperimentVariantInputSchema>
export type ControlledExperiment=ControlledExperimentInput&{id:string;tenantId:string;locationId:string;version:1;status:'draft'|'active'|'paused'|'completed';createdBy:string;createdAt:string;updatedBy:string;updatedAt:string;activatedAt?:string;completedAt?:string}
export type ExperimentCreationEvidence={auditId:string;userId:string;occurredAt:string}
export type ExperimentTransitionEvidence={auditId:string;userId:string;occurredAt:string}
export type ExperimentExposure={id:string;tenantId:string;locationId:string;experimentId:string;variantKey:string;workflowJobId:string;recoveryContactAttemptId:string;clientId:string;providerMessageId:string;exposedAt:string}
export type ExperimentVariantResult={variantKey:string;allocation:number;exposures:number;recoveredBookings:number;conversionRate:number;verifiedRecoveredRevenueMinorByCurrency:Record<string,number>}
export type ControlledExperimentResult={experimentId:string;status:ControlledExperiment['status'];evidence:'verified_booking_attribution_only';minimumSampleReached:boolean;minimumSamplePerVariant:number;winnerSuggested:false;variants:ExperimentVariantResult[];generatedAt:string}
export const WeeklyReportQuerySchema=z.object({from:z.string().datetime(),to:z.string().datetime()}).superRefine((value,context)=>{if(Date.parse(value.to)<=Date.parse(value.from))context.addIssue({code:'custom',path:['to'],message:'Report end must be after start'});if(Date.parse(value.to)-Date.parse(value.from)>8*86_400_000)context.addIssue({code:'custom',path:['to'],message:'Weekly report range cannot exceed eight days'})})
export const TenantPortfolioQuerySchema=z.object({from:z.string().datetime(),to:z.string().datetime()}).superRefine((value,context)=>{if(Date.parse(value.to)<=Date.parse(value.from))context.addIssue({code:'custom',path:['to'],message:'Portfolio end must be after start'});if(Date.parse(value.to)-Date.parse(value.from)>31*86_400_000)context.addIssue({code:'custom',path:['to'],message:'Portfolio range cannot exceed 31 days'})})
export const MonthlyOwnerReviewHistoryQuerySchema=z.object({limit:z.coerce.number().int().min(1).max(24).default(12)})
export const ClientCohortHistoryQuerySchema=z.object({limit:z.coerce.number().int().min(1).max(24).default(12)})
export type TenantPortfolioData={locationSettings:LocationSettings[];attribution:RevenueAttribution[];recoveryCases:RecoveryCase[];messageDeliveries:OutboundMessageDelivery[];workflowJobs:WorkflowJob[];approvals:ApprovalRequest[];experiments:ControlledExperiment[];consents:ConsentRecord[];activations:LocationActivation[];billingAccounts:BillingAccount[];providerCircuits:ProviderCircuitState[]}
export type TenantPortfolioLocation={locationId:string;locationName:string;settingsConfigured:boolean;activationStatus:'active'|'draft'|'unconfigured';billingStatus:BillingStatus|'unconfigured';providerCircuits:{open:number;halfOpen:number};verifiedRecoveredRevenueMinorByCurrency:Record<string,number>;recoveredBookings:number;recoveryCases:{opened:number;resolved:number;closed:number;open:number};messaging:{attempted:number;delivered:number;failed:number;deliveryRate:number;currentMarketingConsentRecords:number;currentMarketingOptOuts:number;currentMarketingOptOutRate:number};operations:{pendingWorkflows:number;runningWorkflows:number;failedWorkflows:number;pausedWorkflows:number;pendingApprovals:number};experiments:{active:number;draft:number;paused:number}}
export type TenantPortfolioReport={tenantId:string;period:{from:string;to:string};portfolio:{locationCount:number;locations:TenantPortfolioLocation[]};totals:Omit<TenantPortfolioLocation,'locationId'|'locationName'|'settingsConfigured'|'activationStatus'|'billingStatus'|'providerCircuits'> & {providerCircuits:{open:number;halfOpen:number}};dataQuality:{revenueEvidence:'verified_booking_single_touch';estimatedRevenueIncluded:false;unattributedBookingsIncluded:false;multipleCurrencies:boolean;consentMetric:'current_record_snapshot_not_period_flow';containsClientIdentities:false};generatedAt:string}
export type TenantOwnerReviewData={portfolio:TenantPortfolioData;conversations:Conversation[];reviewRequests:ReviewRequest[];serviceRecoveryApprovals:ApprovalRequest[];reconciliationRuns:ProviderReconciliationRun[];rateLimitBuckets:TenantRateLimitBucket[];auditRecords:Array<AuditRecord|AuditRecordInput>;modelUsageRecords:ModelUsageRecord[];modelPriceVersions:ModelPriceVersion[];clientCohortSnapshots:ClientCohortSnapshot[];securityIncidents:SecurityIncident[]}
export type MonthlyOwnerReviewModelCost={status:'available'|'partial'|'unavailable';usageRecords:number;reportedUsageRecords:number;missingUsageRecords:number;pricedUsageRecords:number;unpricedUsageRecords:number;tokens:{input:number;cachedInput:number;output:number;reasoning:number;total:number};costMicroMinorByCurrency:Record<string,number>;evidence:'provider_reported_usage_with_owner_attested_price_versions';reason?:string;requiredEvidence?:string}
export type MonthlyOwnerReviewClientChurn={status:'available';snapshotId:string;policyVersion:'active-client-180d-v1';activityWindowDays:180;startActiveClients:number;endActiveClients:number;retainedClients:number;churnedClients:number;newlyActiveClients:number;churnRate:number;evidence:'square_completed_bookings'}|{status:'unavailable';reason:string;requiredEvidence:string}
export type MonthlyOwnerReviewReport={tenantId:string;period:{from:string;to:string};reviewStatus:'ready'|'attention_required';revenue:{verifiedRecoveredRevenueMinorByCurrency:Record<string,number>;recoveredBookings:number;evidence:'verified_booking_single_touch';churn:MonthlyOwnerReviewClientChurn};approvalBacklog:{pending:number;olderThanSevenDays:number;oldestPendingAt?:string;byType:Partial<Record<ApprovalRequest['requestType'],number>>};complaints:{complaintConversations:number;medicalSafetyConversations:number;negativeReviewFeedback:number;serviceRecoveryApprovals:number;evidence:'bounded_operational_signals'};messagingOptOuts:{currentMarketingConsentRecords:number;currentMarketingOptOuts:number;currentMarketingOptOutRate:number;evidence:'current_record_snapshot_not_period_flow'};modelCost:MonthlyOwnerReviewModelCost;integrationHealth:{status:'healthy'|'attention_required';providerCircuits:{open:number;halfOpen:number};reconciliation:{clean:number;missing:number;stale:number;unclean:number}};securityAlerts:{status:'clear'|'attention_required';auditIntegrity:{verified:number;empty:number;legacyOnly:number;broken:number};rateLimitBreaches:number;incidents:{open:number;contained:number;sev1Active:number}};proposedExperiments:{drafts:Array<{id:string;locationId:string;name:string;workflowType:ExperimentWorkflowType;createdAt:string}>;active:number;paused:number;autoActivation:false};actionItems:Array<{key:string;severity:'critical'|'warning'|'information';detail:string}>;dataQuality:{containsClientIdentities:false;estimatedRevenueIncluded:false;unavailableMetrics:Array<'client_churn'|'model_cost'>;snapshotDigestAlgorithm:'sha256'};generatedAt:string}
export type MonthlyOwnerReviewSnapshot={id:string;tenantId:string;periodFrom:string;periodTo:string;report:MonthlyOwnerReviewReport;reportDigest:string;createdBy:string;createdAt:string}
export type MonthlyOwnerReviewEvidence={auditId:string;userId:string;occurredAt:string}
export type ClientCohortSnapshot={id:string;tenantId:string;policyVersion:'active-client-180d-v1';activityWindowDays:180;periodFrom:string;periodTo:string;startWindowFrom:string;endWindowFrom:string;evidenceStatus:'sufficient'|'insufficient';metrics:{completedBookingsConsidered:number;startCompletedBookings:number;endCompletedBookings:number;startActiveClients:number;endActiveClients:number;retainedClients:number;churnedClients:number;newlyActiveClients:number;churnRate:number|null};evidence:'square_completed_bookings';containsClientIdentities:false;snapshotDigest:string;createdBy:string;createdAt:string}
export type ClientCohortEvidence={auditId:string;userId:string;occurredAt:string}
export const AgencyAccountInputSchema=z.object({displayName:z.string().min(3).max(120),supportEmail:z.string().email().optional()})
export const AgencyClientTenantIdSchema=z.string().min(3).max(200)
export const AgencyInvitationInputSchema=z.object({clientTenantId:AgencyClientTenantIdSchema,expiresInDays:z.number().int().min(1).max(30).default(7)})
export const AgencyInvitationTokenSchema=z.object({token:z.string().min(43).max(200)})
export type AgencyGrantScope='portfolio_read'
export type AgencyAccount=z.infer<typeof AgencyAccountInputSchema>&{id:string;tenantId:string;status:'active';createdBy:string;createdAt:string;updatedBy:string;updatedAt:string}
export type AgencyInvitation={id:string;agencyTenantId:string;clientTenantId:string;scopes:AgencyGrantScope[];tokenHash:string;status:'pending'|'accepted'|'expired'|'revoked';createdBy:string;createdAt:string;expiresAt:string;acceptedBy?:string;acceptedAt?:string;grantId?:string}
export type AgencyGrant={id:string;agencyTenantId:string;clientTenantId:string;scopes:AgencyGrantScope[];status:'active'|'revoked';invitationId:string;acceptedBy:string;createdAt:string;revokedBy?:string;revokedAt?:string;revokeReason?:string}
export type AgencyAccessEvidence={auditId:string;userId:string;occurredAt:string}
export const AgencyGrantRevokeSchema=z.object({reason:z.string().min(3).max(500)})
export type MessagingReliabilityCheckKey='terminal_sample'|'delivery_rate'|'uncertain_sends'|'stale_non_terminal'|'delivery_incidents'|'twilio_circuit'|'twilio_reconciliation'
export type MessagingReliabilityEvaluation={id:string;tenantId:string;locationId:string;policyVersion:'voice-prerequisite-v1';channel:'sms';status:'passed'|'failed';voiceBuildAllowed:boolean;windowFrom:string;windowTo:string;expiresAt:string;thresholds:{minimumTerminalMessages:100;minimumDeliveryRate:0.98;maximumUncertainSends:0;maximumStaleNonTerminal:0;maximumPendingDeliveryIncidents:0;reconciliationMaximumAgeHours:24};metrics:{terminalMessages:number;deliveredMessages:number;failedMessages:number;deliveryRate:number;uncertainSends:number;staleNonTerminal:number;pendingDeliveryIncidents:number;twilioCircuitState:'closed'|'open'|'half_open'|'untracked';twilioReconciliationState:'clean'|'stale'|'missing'|'unclean'};checks:Array<{key:MessagingReliabilityCheckKey;status:'passed'|'failed';detail:string}>;createdBy:string;createdAt:string}
export type MessagingReliabilityEvidence={auditId:string;userId:string;occurredAt:string}
const VoicePolicyVersionSchema=z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/)
export const VoiceReadinessAttestationSchema=z.object({
  jurisdictionCode:z.string().trim().regex(/^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/),
  aiDisclosureVersion:VoicePolicyVersionSchema,
  retentionPolicyVersion:VoicePolicyVersionSchema,
  recordingMode:z.literal('disabled'),
  transferMode:z.literal('human'),
  transferTo:z.string().regex(/^\+[1-9]\d{7,14}$/),
  controls:z.object({aiParticipationDisclosureReviewed:z.literal(true),recordingStorageDisabled:z.literal(true),immediateTransferTested:z.literal(true),jurisdictionRetentionReviewed:z.literal(true)}),
})
export type VoiceReadinessAttestation=z.infer<typeof VoiceReadinessAttestationSchema>
export type VoiceReadinessDeclaration=VoiceReadinessAttestation&{id:string;tenantId:string;locationId:string;policyVersion:'voice-readiness-v1';status:'attested';messagingReliabilityEvaluationId:string;createdBy:string;createdAt:string;expiresAt:string}
export type VoiceReadinessEvidence={auditId:string;userId:string;occurredAt:string}
export type RealtimeVoiceCallStatus='received'|'processing'|'accept_failed'|'accepted'|'rejected'|'transferred'
export type RealtimeVoiceCallSignal='sideband_connected'|'disclosure_requested'|'wait_tool_observed'|'transfer_requested'|'transfer_completed'|'sideband_failed'
export type RealtimeVoiceCall={callId:string;tenantId:string;locationId:string;providerEventId:string;status:RealtimeVoiceCallStatus;readiness:'accepted'|'blocked';releaseMode?:'activated'|'sandbox_bootstrap';model?:string;errorCode?:string;signals?:Partial<Record<RealtimeVoiceCallSignal,string>>;createdAt:string;updatedAt:string}
const Sha256Schema=z.string().regex(/^[a-f0-9]{64}$/)
export const VoiceReleaseEvidenceInputSchema=z.object({policyVersion:z.literal('voice-realtime-sandbox-v1'),model:VoicePolicyVersionSchema,referenceHash:Sha256Schema,reportDigest:Sha256Schema,sandboxCompletedAt:z.string().datetime(),containsPhoneNumbers:z.literal(false),containsAudioOrTranscripts:z.literal(false),machineChecks:z.object({callRecency:z.literal(true),modelPin:z.literal(true),readinessGate:z.literal(true),recordingDisabled:z.literal(true),sidebandConnection:z.literal(true),aiDisclosure:z.literal(true),silenceHandling:z.literal(true),humanTransfer:z.literal(true),sidebandHealth:z.literal(true)}).strict(),humanObservations:z.object({aiDisclosureAudible:z.literal(true),transferCompleted:z.literal(true),silenceBehaviorAcceptable:z.literal(true),interruptionBehaviorAcceptable:z.literal(true)}).strict()}).strict()
export type VoiceReleaseEvidenceInput=z.infer<typeof VoiceReleaseEvidenceInputSchema>
export type VoiceReleaseEvidence=VoiceReleaseEvidenceInput&{id:string;tenantId:string;locationId:string;status:'attested';createdBy:string;createdAt:string;expiresAt:string}
export type VoiceReleaseAuditEvidence={auditId:string;userId:string;occurredAt:string}
export type RealtimeVoiceActivation={id:string;tenantId:string;locationId:string;policyVersion:'voice-runtime-activation-v1';status:'active';voiceReleaseEvidenceId:string;voiceReadinessDeclarationId:string;messagingReliabilityEvaluationId:string;model:string;activatedBy:string;activatedAt:string}
export const CommunicationPolicySchema=z.object({
  policyVersion:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/),
  transactionalDisclosureVersion:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/),
  marketingDisclosureVersion:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/),
  escalationContactName:z.string().trim().min(2).max(120),
  escalationContactEmail:z.string().email().max(254),
  contactWindowStartHour:z.number().int().min(0).max(23),
  contactWindowEndHour:z.number().int().min(1).max(24),
  defaultRebookDays:z.number().int().min(7).max(365),
}).superRefine((value,context)=>{if(value.contactWindowStartHour>=value.contactWindowEndHour)context.addIssue({code:'custom',path:['contactWindowEndHour'],message:'Contact window end must be later than its start'})})
export type CommunicationPolicy=z.infer<typeof CommunicationPolicySchema>
export const LocationSettingsInputSchema=z.object({salonName:z.string().min(2).max(120),senderName:z.string().min(2).max(80),timezone:z.string().min(3).max(100),brandVoice:z.string().min(2).max(1000).optional(),reportRecipientEmail:z.string().email().optional(),publicReviewUrl:z.string().url().max(500).optional(),communicationPolicy:CommunicationPolicySchema.optional()})
export type LocationSettings=z.infer<typeof LocationSettingsInputSchema>&{tenantId:string;locationId:string;updatedAt:string}
export type LocationSettingsEvidence={auditId:string;userId:string;occurredAt:string}
export const ClientProfileInputSchema=z.object({clientId:z.string().min(3),displayName:z.string().min(1).max(120).optional(),contactTo:z.string().regex(/^\+[1-9]\d{7,14}$/),timezone:z.string().min(3).max(100),providerCustomerId:z.string().min(1).optional(),lastVisitAt:z.string().datetime().optional(),recommendedRebookDays:z.number().int().min(7).max(365).optional()})
export type ClientProfile=z.infer<typeof ClientProfileInputSchema>&{tenantId:string;locationId:string;updatedAt:string}
export type ClientProfileEvidence={auditId:string;userId:string;occurredAt:string}
export type ApprovalRequest={id:string;tenantId:string;locationId:string;requestType:'workflow_failure'|'integration_reconnect'|'report_delivery'|'service_recovery'|'message_delivery_failure'|'provider_reconciliation'|'security_incident';reason:string;status:'pending'|'approved'|'rejected';entityType:string;entityId:string;payload:Record<string,unknown>;createdAt:string;decidedAt?:string;decidedBy?:string;decisionNote?:string}
export type ApprovalRequestEventEvidence={eventId:string;correlationId:string;causationId?:string}
export type ApprovalDecisionEvidence={eventId:string;decidedAt:string;audit:AuditRecordInput}
export type ReviewRequestCloseReason='review_link_missing'|'client_profile_missing'|'consent_missing'|'recent_request'
export type ReviewRequest={id:string;tenantId:string;locationId:string;workflowJobId:string;appointmentId:string;clientId:string;channel:'sms'|'whatsapp';publicReviewUrl?:string;status:'reserved'|'sent'|'closed';providerMessageId?:string;closeReason?:ReviewRequestCloseReason;feedbackStatus?:'negative';feedbackMessageId?:string;recoveryApprovalId?:string;createdAt:string;sentAt?:string;closedAt?:string}
export type ReviewRequestDecision={allowed:boolean;request:ReviewRequest;reason?:ReviewRequestCloseReason}
export type ReviewRequestEvidence={auditId:string;userId:string;occurredAt:string}
export type ReviewRequestCompletionEvidence=ReviewRequestEvidence&{eventId:string;correlationId:string;causationId:string}
export type ReviewFeedbackEvidence=ReviewRequestEvidence&{eventId:string;conversationId:string}
export const ApprovalDecisionSchema=z.object({decision:z.enum(['approved','rejected']),note:z.string().min(2).max(1000)})
export type WeeklyReportSnapshot={id:string;tenantId:string;locationId:string;periodFrom:string;periodTo:string;report:Record<string,unknown>;status:'generated'|'delivered'|'delivery_failed';recipientEmail?:string;createdAt:string;deliveredAt?:string}
export const WeeklyReportScheduleSchema=z.object({firstRunAt:z.string().datetime(),recipientEmail:z.string().email()})
export type WeeklyReportScheduleEvidence={auditId:string;userId:string;occurredAt:string}
export const ProviderNameSchema=z.enum(['square','twilio','openai','postmark','stripe'])
export const ProviderCircuitResetSchema=z.object({reason:z.string().min(3).max(500)})
export type ProviderName=z.infer<typeof ProviderNameSchema>
export type ProviderCircuitState={tenantId:string;locationId:string;provider:ProviderName;state:'closed'|'open'|'half_open';consecutiveFailures:number;openedAt?:string;nextProbeAt?:string;probeLeaseUntil?:string;lastFailureAt?:string;lastSuccessAt?:string;lastErrorCode?:string;updatedAt:string}
export type ProviderCircuitPermit={allowed:boolean;probe:boolean;circuit:ProviderCircuitState}
export type ProviderCircuitResetEvidence={auditId:string;userId:string;redactedReason:string;occurredAt:string}
export const SecurityIncidentCategorySchema=z.enum(['suspected_data_exposure','credential_compromise','audit_integrity_failure','unauthorized_access','provider_security_event','availability_attack','other'])
export const SecurityIncidentSeveritySchema=z.enum(['sev1','sev2','sev3'])
export const SecurityIncidentInputSchema=z.object({category:SecurityIncidentCategorySchema,severity:SecurityIncidentSeveritySchema,summary:z.string().trim().min(10).max(500),evidenceReferences:z.array(z.string().regex(/^(?:audit|reconciliation|approval|provider-event|external-ticket|monitor):[A-Za-z0-9][A-Za-z0-9._/-]{1,180}$/)).max(10).default([]).transform(values=>[...new Set(values)])})
export const SecurityIncidentTransitionSchema=z.object({status:z.enum(['contained','resolved','false_positive']),actionSummary:z.string().trim().min(10).max(500)})
export const SecurityIncidentHistoryQuerySchema=z.object({limit:z.coerce.number().int().min(1).max(100).default(50)})
export const SecurityIncidentIdSchema=z.string().uuid()
export type SecurityIncidentStatus='open'|'contained'|'resolved'|'false_positive'
export type SecurityIncident={id:string;tenantId:string;locationId:string;category:z.infer<typeof SecurityIncidentCategorySchema>;severity:z.infer<typeof SecurityIncidentSeveritySchema>;status:SecurityIncidentStatus;summary:string;evidenceReferences:string[];reportedBy:string;openedAt:string;updatedBy:string;updatedAt:string;containedAt?:string;resolvedAt?:string}
export type SecurityIncidentEvent={id:string;incidentId:string;tenantId:string;locationId:string;eventType:'opened'|'contained'|'resolved'|'false_positive';fromStatus?:SecurityIncidentStatus;toStatus:SecurityIncidentStatus;actionSummary:string;actorId:string;occurredAt:string}
export type SecurityIncidentDeclarationEvidence={openedEventId:string;approvalEventId:string;audit:AuditRecordInput}
export type SecurityIncidentTransitionEvidence={eventId:string;audit:AuditRecordInput}
export const ReconciliationProviderSchema=z.enum(['square','twilio'])
export type ReconciliationProvider=z.infer<typeof ReconciliationProviderSchema>
export const ProviderReconciliationInputSchema=z.object({providers:z.array(ReconciliationProviderSchema).min(1).max(2).default(['square','twilio']),maxRecords:z.number().int().min(1).max(50).default(20)}).superRefine((value,context)=>{if(new Set(value.providers).size!==value.providers.length)context.addIssue({code:'custom',path:['providers'],message:'Reconciliation providers must be unique'})})
export const ProviderReconciliationHistoryQuerySchema=z.object({limit:z.coerce.number().int().min(1).max(50).default(20)})
export type ProviderReconciliationFinding={id:string;provider:ReconciliationProvider;entityType:'booking'|'outbound_message_delivery';entityId:string;category:'provider_record_missing'|'status_mismatch'|'start_time_mismatch'|'provider_version_ahead'|'uncertain_send';severity:'warning'|'critical';localState:Record<string,string|number>;providerState?:Record<string,string|number>;detectedAt:string}
export type ProviderReconciliationRun={id:string;tenantId:string;locationId:string;requestedBy:string;providers:ReconciliationProvider[];maxRecords:number;status:'running'|'completed'|'partial';summary:{checked:number;findings:number;critical:number;warnings:number;providerErrors:number;alertsOpened:number};findings:ProviderReconciliationFinding[];errors:Array<{provider:ReconciliationProvider;code:string}>;startedAt:string;completedAt?:string}
export type ProviderReconciliationEvidence={auditId:string;userId:string;occurredAt:string}
export type SquareBookingWebhookCursor={tenantId:string;locationId:string;providerBookingId:string;providerEventId:string;providerOccurredAt:string;providerStatus:string;normalizedEventType:'appointment.booked'|'appointment.cancelled'|'appointment.no_show';updatedAt:string}
export type SquareBookingWebhookDecision={accepted:boolean;reason?:'duplicate'|'stale'|'no_change'|'invalid_transition';cursor:SquareBookingWebhookCursor}
export type TenantHealthCheck={key:'location_settings'|'communication_policy'|'agent_release'|'event_outbox'|'square_connection'|'catalog_sync'|'client_profiles'|'messaging'|'message_delivery'|'provider_circuits'|'provider_reconciliation'|'uncertain_bookings'|'rate_limiting'|'audit_integrity'|'security_incidents'|'privacy_governance'|'weekly_reporting'|'billing'|'workflow_queue'|'approval_queue';status:'ready'|'warning'|'blocked';label:string;detail:string;action?:string}
export type TenantHealth={status:'ready'|'degraded'|'setup_required';automationReady:boolean;checkedAt:string;summary:{ready:number;warning:number;blocked:number;pendingWorkflows:number;failedWorkflows:number;pausedWorkflows:number;pendingApprovals:number};checks:TenantHealthCheck[]}
export type TenantRateLimitKind='read'|'write'
export type TenantRateLimitBucket={tenantId:string;locationId:string;kind:TenantRateLimitKind;windowStart:string;windowEnd:string;requestCount:number;maxRequests:number;updatedAt:string}
export type TenantRateLimitResult=TenantRateLimitBucket&{allowed:boolean;remaining:number}
export type PublicRateLimitRoute='recovery_review'
export type PublicRateLimitBucket={route:PublicRateLimitRoute;identityHash:string;windowStart:string;windowEnd:string;requestCount:number;maxRequests:number;updatedAt:string}
export type PublicRateLimitResult=PublicRateLimitBucket&{allowed:boolean;remaining:number}
export type BillingStatus='trialing'|'active'|'past_due'|'paused'|'canceled'|'incomplete'|'incomplete_expired'|'unpaid'
export type BillingAccount={id:string;tenantId:string;locationId:string;provider:'stripe';customerId:string;subscriptionId:string;priceId?:string;status:BillingStatus;trialEndsAt?:string;currentPeriodEndsAt?:string;cancelAtPeriodEnd:boolean;providerEventCreated:number;sourceEventId:string;sourceEventType:string;createdAt:string;updatedAt:string}
export const BillingCheckoutInputSchema=z.object({idempotencyKey:z.string().min(16).max(200)})

export type OAuthStateRecord = { state: string; tenantId: string; locationId: string; userId: string; expiresAt: string }
export type IntegrationAccount = { id: string; tenantId: string; locationId: string; provider: 'square'; externalId: string; encryptedCredentials: Buffer; status: 'active' | 'expired' | 'revoked'; tokenExpiresAt?: string; createdAt: string; updatedAt: string }
export type SquareOAuthCompletionEvidence={auditId:string;eventId:string;userId:string;occurredAt:string}
export type LockedIntegrationAccountUpdate={account:IntegrationAccount;refreshEvidence?:{auditId:string;userId:string;occurredAt:string}}
export type ChannelRoute={id:string;tenantId:string;locationId:string;provider:'twilio';address:string;status:'active'|'disabled';createdAt:string;updatedAt:string}
export const TwilioChannelRouteInputSchema=z.object({address:z.string().regex(/^(?:whatsapp:)?\+[1-9]\d{7,14}$/),status:z.enum(['active','disabled']).default('active')})
export type ChannelRouteEvidence={auditId:string;userId:string;occurredAt:string}
export type OnboardingCheckKey='location_settings'|'communication_policy'|'square_connection'|'catalog_sync'|'client_profiles'|'messaging'|'weekly_reporting'|'billing'|'conversation_simulation'|'test_booking'|'webhook_verification'
export type OnboardingCheckResult={key:OnboardingCheckKey;label:string;status:'passed'|'failed';detail:string}
export type OnboardingRun={id:string;tenantId:string;locationId:string;status:'passed'|'failed';configurationFingerprint:string;checks:OnboardingCheckResult[];createdBy:string;createdAt:string}
export type OnboardingRunEvidence={auditId:string;userId:string;occurredAt:string}
export type LocationActivation={tenantId:string;locationId:string;status:'draft'|'active';onboardingRunId?:string;activatedAt?:string;activatedBy?:string;updatedAt:string}
export type OnboardingActivationEvidence={auditId:string;eventId:string;userId:string;occurredAt:string}
export type AgentEvaluationEvidence={id:string;tenantId:string;locationId:string;datasetVersion:string;mode:'deterministic'|'model';model:string;promptVersion:string;promptDigest:string;status:'passed'|'failed';totalCases:number;passedCases:number;failedCases:number;metrics:{routeAccuracy:number;safetyRecall:number;confirmationAccuracy:number;groundingViolations:number};startedAt:string;completedAt:string}
export type OnboardingProviderVerification={id:string;tenantId:string;locationId:string;status:'passed'|'failed';checks:Array<{id:string;status:'passed'|'failed';detail:string;code?:string;referenceHash?:string}>;startedAt:string;completedAt:string}

export const ConversationChannelSchema=z.enum(['sms','whatsapp','email'])
export const ConversationIntentSchema=z.enum(['booking','reschedule','cancellation','price_question','service_question','availability_question','complaint','medical_safety','opt_out','human_request','spam','unknown'])
export type ConversationIntent=z.infer<typeof ConversationIntentSchema>
export type Conversation={id:string;tenantId:string;locationId:string;clientId:string;participantAddress:string;channel:z.infer<typeof ConversationChannelSchema>;status:'active'|'escalated'|'closed';intent:ConversationIntent;requiresHuman:boolean;unreadCount:number;lastMessageAt:string;createdAt:string;updatedAt:string}
export type ConversationMessage={id:string;tenantId:string;locationId:string;conversationId:string;direction:'inbound'|'outbound';author:'client'|'agent'|'operator'|'system';body:string;providerMessageId?:string;deliveryStatus:'received'|'draft'|'queued'|'sent'|'delivered'|'failed';createdAt:string}
export const ConversationIntakeSchema=z.object({clientId:z.string().min(3).optional(),participantAddress:z.string().min(3).max(255),channel:ConversationChannelSchema,body:z.string().min(1).max(4000),providerMessageId:z.string().min(3).max(255).optional(),source:z.enum(['provider','sandbox']).default('sandbox')})
export type ConversationIntake=z.input<typeof ConversationIntakeSchema>
export const ConversationReplySchema=z.object({body:z.string().min(1).max(1600),purpose:PurposeSchema.default('transactional'),draftMessageId:z.string().uuid().optional()})
export type ConversationReply=z.infer<typeof ConversationReplySchema>
export const ConversationBookingActionInputSchema=z.discriminatedUnion('actionType',[
  z.object({actionType:z.literal('cancel_appointment'),bookingId:z.string().uuid(),reason:z.string().min(3).max(500)}),
  z.object({actionType:z.literal('reschedule_appointment'),bookingId:z.string().uuid(),startsAt:z.string().datetime(),staffId:z.string().min(3)}),
])
export type ConversationBookingActionInput=z.infer<typeof ConversationBookingActionInputSchema>
export const ConversationRouteSchema=z.object({intent:ConversationIntentSchema,confidence:z.number().min(0).max(1),urgency:z.enum(['normal','urgent','safety']),requiresHuman:z.boolean(),shortReason:z.string().min(1).max(200),draftReply:z.string().max(1600).optional()})
export type ConversationRoute=z.infer<typeof ConversationRouteSchema>
export type PromptVersion={id:string;name:'conversation_router';version:number;releaseLabel:string;model:string;instructions:string;contentDigest:string;active:boolean;approvalReference?:string;createdAt:string}
export type AgentRun={id:string;tenantId:string;locationId:string;conversationId:string;inputMessageId:string;responseMessageId?:string;promptVersionId:string;model:string;status:'completed'|'skipped'|'failed';route?:ConversationRoute;errorCode?:string;createdAt:string;completedAt:string}
export type ModelUsageOperation='conversation_route'|'booking_specialist'
export type ModelUsageRecord={id:string;tenantId:string;locationId:string;provider:'openai';providerResponseId:string;agentRunId:string;operation:ModelUsageOperation;model:string;usageStatus:'reported'|'missing';inputTokens?:number;cachedInputTokens?:number;outputTokens?:number;reasoningTokens?:number;totalTokens?:number;occurredAt:string}
export const ModelPriceVersionInputSchema=z.object({provider:z.literal('openai').default('openai'),model:z.string().trim().min(1).max(120),currency:z.string().length(3).transform(value=>value.toUpperCase()),inputPerMillionMinor:z.number().int().nonnegative().max(1_000_000_000),cachedInputPerMillionMinor:z.number().int().nonnegative().max(1_000_000_000),outputPerMillionMinor:z.number().int().nonnegative().max(1_000_000_000),effectiveFrom:z.string().datetime(),sourceLabel:z.string().trim().min(3).max(200),sourceUrl:z.string().url().max(500).optional()})
export type ModelPriceVersionInput=z.infer<typeof ModelPriceVersionInputSchema>
export type ModelPriceVersion=ModelPriceVersionInput&{id:string;tenantId:string;version:number;evidence:'owner_attested';createdBy:string;createdAt:string}
export type ModelPriceEvidence={auditId:string;userId:string;occurredAt:string}
export type BookingToolName='get_salon_information'|'list_services'|'get_service_details'|'list_staff'|'search_support_knowledge'|'search_availability'|'create_temporary_hold'
export type ToolCallRecord={id:string;tenantId:string;locationId:string;conversationId:string;inputMessageId:string;agentRunId:string;providerCallId:string;toolName:BookingToolName;status:'completed'|'failed';input:unknown;result?:unknown;errorCode?:string;createdAt:string;completedAt:string}
export type ToolCallEvidence={auditId:string;userId:string;occurredAt:string}

export const SupportKnowledgeArticleInputSchema=z.object({title:z.string().trim().min(3).max(160),summary:z.string().trim().min(10).max(500),content:z.string().trim().min(20).max(8000),topics:z.array(z.string().trim().min(2).max(60)).min(1).max(20).transform(values=>[...new Set(values.map(value=>value.toLowerCase()))]),status:z.enum(['draft','published','archived'])})
export const SupportKnowledgeSearchSchema=z.object({query:z.string().trim().min(2).max(300),limit:z.number().int().min(1).max(5).default(3)})
export type SupportKnowledgeArticleInput=z.infer<typeof SupportKnowledgeArticleInputSchema>
export type SupportKnowledgeArticle=SupportKnowledgeArticleInput&{id:string;tenantId:string;locationId:string;slug:string;version:number;contentHash:string;updatedBy:string;createdAt:string;updatedAt:string;publishedAt?:string}
export type SupportKnowledgeEvidence={auditId:string;userId:string;occurredAt:string}
export type SupportKnowledgeMatch={articleId:string;slug:string;version:number;title:string;summary:string;content:string;topics:string[];score:number;contentHash:string}
export const PublicRecoveryReviewInputSchema=z.object({
  submissionKey:z.string().uuid(),
  contactName:z.string().trim().min(2).max(100),
  businessEmail:z.string().trim().email().max(254).transform(value=>value.toLowerCase()),
  salonName:z.string().trim().min(2).max(140),
  locations:z.enum(['one','two_to_five','six_plus']),
  bookingPlatform:z.enum(['square','fresha','phorest','other']),
  monthlyAppointments:z.number().int().min(1).max(100_000),
  averageTicketMinor:z.number().int().min(100).max(10_000_000),
  primaryRevenueLoss:z.enum(['unanswered_enquiries','cancellations','lapsed_clients','rebooking']),
  channels:z.array(z.enum(['whatsapp','sms','email','voice'])).min(1).max(4).transform(values=>[...new Set(values)]),
  marketingConsent:z.boolean(),
  privacyNoticeVersion:z.literal('recovery-review-v1'),
  calculator:z.object({monthlyEnquiries:z.number().int().min(0).max(100_000),unansweredPercentage:z.number().min(0).max(100),bookingConversionPercentage:z.number().min(0).max(100),averageTicketMinor:z.number().int().min(0).max(10_000_000),lateCancellationPercentage:z.number().min(0).max(100)}).strict(),
  sourcePath:z.string().trim().min(1).max(200).refine(value=>value.startsWith('/'),{message:'Source path must be relative'}),
  locationSlug:z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80).optional(),
  website:z.string().max(200).default(''),
  botToken:z.string().max(2048).default(''),
}).strict()
export type PublicRecoveryReviewInput=z.infer<typeof PublicRecoveryReviewInputSchema>
export type PublicRecoveryReview=Omit<PublicRecoveryReviewInput,'website'|'botToken'>&{id:string;status:'new'|'contacted'|'qualified'|'closed';estimatedRecoveryMinor:number;currency:'GBP';marketingConsentCapturedAt?:string;createdAt:string;retentionExpiresAt:string}
export type ConversationAction={id:string;tenantId:string;locationId:string;conversationId:string;clientId:string;actionType:'book_appointment'|'cancel_appointment'|'reschedule_appointment';holdId?:string;agentRunId:string;status:'prepared'|'awaiting_confirmation'|'completed'|'cancelled'|'expired';draftMessageId?:string;confirmationRequestMessageId?:string;confirmationRequestedAt?:string;confirmationMessageId?:string;bookingId?:string;targetStartsAt?:string;targetStaffId?:string;reason?:string;expiresAt?:string;createdAt:string;updatedAt:string}
export type ConversationActionPreparationEvidence={auditId:string;userId:string;occurredAt:string}
export type ConversationConfirmationRequestEvidence={auditId:string;userId:string;occurredAt:string;previousUpdatedAt:string}
export type ConversationActionCompletionEvidence={auditId:string;userId:string;occurredAt:string;previousUpdatedAt:string;bookingReference:string;duplicate:boolean}
export type ConversationActionTerminationEvidence={auditId:string;eventId:string;userId:string;occurredAt:string;previousUpdatedAt:string;reason:'customer_declined'|'action_expired'}
export type ConversationFollowupCloseReason='recent_followup'|'conversation_progressed'|'already_booked'|'action_pending'|'conversation_unavailable'|'consent_blocked'
export type ConversationFollowupAttempt={id:string;tenantId:string;locationId:string;workflowJobId:string;conversationId:string;clientId:string;triggerMessageId:string;channel:'sms'|'whatsapp';status:'reserved'|'sent'|'closed';reservedAt:string;sentAt?:string;closedAt?:string;closeReason?:ConversationFollowupCloseReason;providerMessageId?:string}
export type ConversationFollowupDecision={allowed:boolean;attempt:ConversationFollowupAttempt;reason?:ConversationFollowupCloseReason}
export type ConversationFollowupCompletionEvidence={auditId:string;eventId:string;userId:string;occurredAt:string;previousConversationUpdatedAt:string}
export type MissedCallRecoveryCloseReason='recent_recovery'|'profile_unresolved'|'consent_blocked'|'caller_invalid'|'conversation_progressed'
export type MissedCallRecoveryAttempt={id:string;tenantId:string;locationId:string;workflowJobId:string;providerCallSid:string;callerAddress:string;clientId?:string;status:'reserved'|'sent'|'closed';reservedAt:string;sentAt?:string;closedAt?:string;closeReason?:MissedCallRecoveryCloseReason;providerMessageId?:string;conversationId?:string;conversationMessageId?:string}
export type MissedCallRecoveryDecision={allowed:boolean;attempt:MissedCallRecoveryAttempt;reason?:MissedCallRecoveryCloseReason}
export type MissedCallRecoveryCompletionEvidence={auditId:string;eventId:string;userId:string;occurredAt:string;previousConversationUpdatedAt?:string}
export type OutboundDeliveryStatus='reserved'|'accepted'|'queued'|'sending'|'sent'|'delivered'|'failed'|'undelivered'
export type OutboundMessageDelivery={id:string;tenantId:string;locationId:string;clientId:string;channel:'sms'|'whatsapp';purpose:'transactional'|'marketing';to:string;correlationId:string;idempotencyKey:string;status:OutboundDeliveryStatus;providerMessageId?:string;providerStatus?:string;errorCode?:string;createdAt:string;updatedAt:string}
export type MessageDeliveryStatusEvidence={auditId:string;userId:string;occurredAt:string;providerMessageId:string;providerStatus:string;previousStatus:OutboundDeliveryStatus;previousUpdatedAt:string;errorCode?:string}

export const ClientDataExportInputSchema=z.object({reason:z.string().trim().min(10).max(1000)})
export type ClientDataExportInput=z.infer<typeof ClientDataExportInputSchema>
export type ClientDataExportRecordCounts={profile:number;consents:number;holds:number;bookings:number;waitlistEntries:number;conversations:number;messages:number;reviewRequests:number;recoveryContacts:number;conversationFollowups:number;missedCallRecoveries:number;messageDeliveries:number;events:number;auditRecords:number}
export type ClientDataSnapshot={profile:ClientProfile|null;consents:ConsentRecord[];holds:AppointmentHold[];bookings:BookingRecord[];waitlistEntries:WaitlistEntry[];conversations:Conversation[];messages:ConversationMessage[];reviewRequests:ReviewRequest[];recoveryContacts:RecoveryContactAttempt[];conversationFollowups:ConversationFollowupAttempt[];missedCallRecoveries:MissedCallRecoveryAttempt[];messageDeliveries:OutboundMessageDelivery[];events:DomainEvent[];auditRecords:Array<AuditRecord|AuditRecordInput>}
export type ClientDataExportPackage={schemaVersion:1;exportId:string;generatedAt:string;scope:{tenantId:string;locationId:string};subject:{clientId:string};data:Omit<ClientDataSnapshot,'conversations'|'messages'>&{conversations:Array<{conversation:Conversation;messages:ConversationMessage[]}>}}
export type PrivacyDataExportReceipt={id:string;tenantId:string;locationId:string;clientId:string;requestedBy:string;reason:string;digest:string;recordCounts:ClientDataExportRecordCounts;generatedAt:string}
export type PrivacyDataExportEvidence={auditId:string;userId:string;occurredAt:string}
export const PrivacyRetentionPolicyInputSchema=z.object({jurisdiction:z.string().trim().min(2).max(100),policyVersion:z.string().trim().min(1).max(50),clientProfileDays:z.number().int().min(30).max(3650),conversationDays:z.number().int().min(30).max(3650),bookingDays:z.number().int().min(365).max(3650),outreachDays:z.number().int().min(30).max(3650),eventDays:z.number().int().min(30).max(3650),exportReceiptDays:z.number().int().min(30).max(3650),deletionEnabled:z.boolean(),legalBasis:z.string().trim().min(20).max(1000),counselApproved:z.literal(true),effectiveAt:z.string().datetime()})
export type PrivacyRetentionPolicyInput=z.infer<typeof PrivacyRetentionPolicyInputSchema>
export type PrivacyRetentionPolicy=PrivacyRetentionPolicyInput&{tenantId:string;locationId:string;updatedBy:string;updatedAt:string}
export type PrivacyRetentionPolicyEvidence={auditId:string;userId:string;occurredAt:string}
export const PrivacyLegalHoldInputSchema=z.object({clientId:z.string().min(3).max(255),reason:z.string().trim().min(10).max(1000),expiresAt:z.string().datetime().optional()}).superRefine((value,context)=>{if(value.expiresAt&&Date.parse(value.expiresAt)<=Date.now())context.addIssue({code:'custom',path:['expiresAt'],message:'Legal hold expiry must be in the future'})})
export type PrivacyLegalHoldInput=z.infer<typeof PrivacyLegalHoldInputSchema>
export const PrivacyLegalHoldReleaseSchema=z.object({note:z.string().trim().min(10).max(1000)})
export type PrivacyLegalHold={id:string;tenantId:string;locationId:string;clientId:string;reason:string;status:'active'|'released';createdBy:string;createdAt:string;expiresAt?:string;releasedBy?:string;releasedAt?:string;releaseNote?:string}
export type PrivacyLegalHoldEvidence={auditId:string;userId:string;occurredAt:string}
export type PrivacyRetentionPreview={clientId:string;generatedAt:string;policy:PrivacyRetentionPolicy|null;lastActivityAt?:string;activeLegalHolds:PrivacyLegalHold[];cleanupAllowed:boolean;blockingReasons:Array<'retention_policy_missing'|'policy_not_effective'|'deletion_disabled'|'legal_hold_active'>;eligible:{profile:number;conversations:number;messages:number;holds:number;bookings:number;waitlistEntries:number;reviewRequests:number;recoveryContacts:number;conversationFollowups:number;missedCallRecoveries:number;messageDeliveries:number;events:number;exportReceipts:number};alwaysRetained:{consents:number;auditRecords:number}}
export const PrivacyErasureRequestInputSchema=z.object({clientId:z.string().min(3).max(255),reason:z.string().trim().min(10).max(1000)})
export const PrivacyErasureExecuteSchema=z.object({confirmation:z.literal('DELETE ELIGIBLE CLIENT DATA'),note:z.string().trim().min(10).max(1000)})
export type PrivacyErasureCounts=PrivacyRetentionPreview['eligible']
export type PrivacyErasurePlan={profile:boolean;conversationIds:string[];holdIds:string[];bookingIds:string[];waitlistEntryIds:string[];reviewRequestIds:string[];recoveryContactIds:string[];conversationFollowupIds:string[];missedCallRecoveryIds:string[];messageDeliveryIds:string[];eventIds:string[];exportReceiptIds:string[];counts:PrivacyErasureCounts}
export type PrivacyErasureRequest={id:string;tenantId:string;locationId:string;clientId:string;reason:string;status:'pending'|'completed'|'superseded';policyVersion:string;policyUpdatedAt:string;planDigest:string;plan:PrivacyErasurePlan;requestedBy:string;requestedAt:string;expiresAt:string;completedBy?:string;completedAt?:string;completionReceiptId?:string}
export type PrivacyErasureRequestEvidence={auditId:string;userId:string;occurredAt:string}
export type PrivacyErasureReceipt={id:string;tenantId:string;locationId:string;clientId:string;requestId:string;planDigest:string;deleted:PrivacyErasureCounts;skipped:PrivacyErasureCounts;policyVersion:string;completedBy:string;completedAt:string}
export type PrivacyErasureExecutionEvidence={approvalAuditId:string;completionAuditId:string;userId:string;occurredAt:string;alwaysRetained:PrivacyRetentionPreview['alwaysRetained']}

export type ServiceRecord = {
  id: string
  tenantId: string
  locationId: string
  provider: 'square'
  externalItemId: string
  name: string
  variationName: string
  version: string
  durationMinutes: number
  priceMinor?: number
  currency?: string
  teamMemberIds: string[]
  active: boolean
  syncedAt: string
}

export type StaffRecord = {
  id: string
  tenantId: string
  locationId: string
  provider: 'square'
  name: string
  description?: string
  profileImageUrl?: string
  bookable: boolean
  syncedAt: string
}

export type SquareCatalogSyncEvidence = {
  auditId: string
  userId: string
  occurredAt: string
  integrationAccountId: string
}

export const MessagePermissionInputSchema = z.object({
  clientId: z.string().min(3),
  channel: ChannelSchema,
  purpose: PurposeSchema,
})

export const SendMessageInputSchema = MessagePermissionInputSchema.extend({
  to: z.string().min(7).max(30),
  body: z.string().min(1).max(1600),
  correlationId: z.string().min(3),
  idempotencyKey: z.string().min(16),
})
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>
