import type { AgencyAccessEvidence, AgencyAccount, AgencyGrant, AgencyInvitation, AgentEvaluationEvidence, AgentRun, AppointmentHold, ApprovalDecisionEvidence, ApprovalRequest, ApprovalRequestEventEvidence, AuditRecord, AuditRecordInput, BillingAccount, BookingCompletionEvidence, BookingMutationClaim, BookingMutationEvidence, BookingRecord, ChannelRoute, ClientCohortEvidence, ClientCohortSnapshot, ClientDataSnapshot, ClientProfile, ConsentRecord, ConsentUpdateEvidence, ControlledExperiment, Conversation, ConversationAction, ConversationActionCompletionEvidence, ConversationActionPreparationEvidence, ConversationActionTerminationEvidence, ConversationConfirmationRequestEvidence, ConversationFollowupAttempt, ConversationFollowupCloseReason, ConversationFollowupCompletionEvidence, ConversationFollowupDecision, ConversationMessage, DomainEvent, ExperimentCreationEvidence, ExperimentExposure, ExperimentTransitionEvidence, ExperimentWorkflowType, HoldCreationEvidence, IntegrationAccount, LocationActivation, LocationSettings, LockedIntegrationAccountUpdate, MessageDeliveryStatusEvidence, MessagingReliabilityEvaluation, MessagingReliabilityEvidence, MissedCallRecoveryAttempt, MissedCallRecoveryCloseReason, MissedCallRecoveryCompletionEvidence, MissedCallRecoveryDecision, ModelPriceEvidence, ModelPriceVersion, ModelUsageRecord, MonthlyOwnerReviewEvidence, MonthlyOwnerReviewSnapshot, OAuthStateRecord, OnboardingProviderVerification, OnboardingRun, OutboundMessageDelivery, PrivacyDataExportEvidence, PrivacyDataExportReceipt, PrivacyErasureExecutionEvidence, PrivacyErasureReceipt, PrivacyErasureRequest, PrivacyErasureRequestEvidence, PrivacyLegalHold, PrivacyLegalHoldEvidence, PrivacyRetentionPolicy, PrivacyRetentionPolicyEvidence, PromptVersion, ProviderCircuitPermit, ProviderCircuitResetEvidence, ProviderCircuitState, ProviderName, ProviderReconciliationEvidence, ProviderReconciliationRun, PublicRateLimitBucket, PublicRateLimitResult, PublicRecoveryReview, RecoveryAttributionTouch, RecoveryCase, RecoveryCaseCloseReason, RecoveryCaseClosureEvidence, RecoveryCaseOpeningEvidence, RecoveryCaseResolutionEvidence, RecoveryContactAttempt, RecoveryContactCompletionEvidence, RecoveryContactDecision, RevenueAttribution, RevenueAttributionEvidence, ReviewFeedbackEvidence, ReviewRequest, ReviewRequestCloseReason, ReviewRequestCompletionEvidence, ReviewRequestDecision, ReviewRequestEvidence, SecurityIncident, SecurityIncidentDeclarationEvidence, SecurityIncidentEvent, SecurityIncidentStatus, SecurityIncidentTransitionEvidence, ServiceRecord, SquareBookingWebhookCursor, SquareBookingWebhookDecision, SquareCatalogSyncEvidence, SquareOAuthCompletionEvidence, StaffRecord, SupportKnowledgeArticle, SupportKnowledgeEvidence, TenantContext, TenantOwnerReviewData, TenantPortfolioData, TenantRateLimitBucket, TenantRateLimitResult, ToolCallEvidence, ToolCallRecord, VoiceReadinessDeclaration, VoiceReadinessEvidence, WaitlistEntry, WaitlistOffer, WeeklyReportSnapshot, WorkflowDeadLetter, WorkflowJob } from '../domain/schemas.js'
import type { WaitlistOfferDeliveryEvidence, WaitlistOfferTransitionEvidence } from '../domain/schemas.js'

import type { ChannelRouteEvidence, ClientProfileEvidence, LocationSettingsEvidence, OnboardingActivationEvidence, OnboardingRunEvidence, WeeklyReportScheduleEvidence } from '../domain/schemas.js'
import type { RealtimeVoiceCall, RealtimeVoiceCallSignal, RealtimeVoiceCallStatus } from '../domain/schemas.js'
import type { RealtimeVoiceActivation, VoiceReleaseAuditEvidence, VoiceReleaseEvidence } from '../domain/schemas.js'

export interface Store {
  healthCheck(): Promise<void>
  close?(): Promise<void>
  saveConsent(record: ConsentRecord): Promise<ConsentRecord>
  saveConsentWithEvidence(context: TenantContext, record: ConsentRecord, evidence: ConsentUpdateEvidence): Promise<ConsentRecord>
  getConsent(context: TenantContext, clientId: string, channel: string, purpose: string): Promise<ConsentRecord | undefined>
  getClientConsents(context: TenantContext, clientId: string): Promise<ConsentRecord[]>
  appendEvent(event: DomainEvent): Promise<{ event: DomainEvent; duplicate: boolean }>
  getOutbox(context: TenantContext): Promise<DomainEvent[]>
  getUnpublishedEvents(limit: number): Promise<DomainEvent[]>
  appendAudit(record: AuditRecordInput): Promise<AuditRecord>
  getAudit(context: TenantContext): Promise<Array<AuditRecord|AuditRecordInput>>
  saveHold(hold: AppointmentHold): Promise<AppointmentHold>
  saveHoldWithEvidence(context: TenantContext, hold: AppointmentHold, evidence: HoldCreationEvidence): Promise<AppointmentHold>
  getHold(context: TenantContext, holdId: string): Promise<AppointmentHold | undefined>
  listUncertainBookingHolds(context:TenantContext):Promise<AppointmentHold[]>
  claimHold(context: TenantContext, holdId: string, idempotencyKey: string, waitlistOfferId?:string): Promise<AppointmentHold | undefined>
  markHoldBookingOutcomeUncertain(context:TenantContext,holdId:string,idempotencyKey:string,occurredAt:string):Promise<AppointmentHold|undefined>
  releaseHold(context: TenantContext, holdId: string, idempotencyKey: string, waitlistOfferId?:string): Promise<void>
  cancelHold(context: TenantContext, holdId: string): Promise<boolean>
  completeBooking(context: TenantContext, idempotencyKey: string, hold: AppointmentHold, booking: BookingRecord): Promise<BookingRecord>
  completeBookingWithEvidence(context: TenantContext, idempotencyKey: string, hold: AppointmentHold, booking: BookingRecord, evidence: BookingCompletionEvidence): Promise<BookingRecord>
  getBookingByIdempotency(context: TenantContext, idempotencyKey: string): Promise<BookingRecord | undefined>
  getBooking(context: TenantContext, bookingId: string): Promise<BookingRecord | undefined>
  listBookings(context:TenantContext):Promise<BookingRecord[]>
  listClaimedBookingMutations(context:TenantContext):Promise<BookingRecord[]>
  claimBookingMutation(context:TenantContext,bookingId:string,claim:BookingMutationClaim):Promise<BookingRecord|undefined>
  releaseBookingMutationClaim(context:TenantContext,bookingId:string,requestDigest:string):Promise<void>
  saveBookingMutation(context: TenantContext, idempotencyKey: string, booking: BookingRecord): Promise<BookingRecord>
  saveBookingMutationWithEvidence(context: TenantContext, idempotencyKey: string, booking: BookingRecord, evidence: BookingMutationEvidence): Promise<BookingRecord>
  saveOAuthState(state: OAuthStateRecord): Promise<void>
  consumeOAuthState(state: string): Promise<OAuthStateRecord | undefined>
  saveIntegrationAccount(account: IntegrationAccount): Promise<IntegrationAccount>
  completeSquareOAuthConnection(account:IntegrationAccount,evidence:SquareOAuthCompletionEvidence):Promise<{account:IntegrationAccount;resumedWorkflows:number}>
  getIntegrationAccount(context: TenantContext, provider: 'square'): Promise<IntegrationAccount | undefined>
  withLockedIntegrationAccount(context:TenantContext,provider:'square',update:(account:IntegrationAccount)=>Promise<LockedIntegrationAccountUpdate>):Promise<IntegrationAccount|undefined>
  findIntegrationAccount(provider: 'square', externalId: string): Promise<IntegrationAccount|undefined>
  saveChannelRoute(value: ChannelRoute): Promise<ChannelRoute>
  saveChannelRouteWithAudit(context:TenantContext,value:ChannelRoute,evidence:ChannelRouteEvidence):Promise<{route:ChannelRoute;activationInvalidated:boolean}>
  getChannelRoute(context: TenantContext, provider: 'twilio'): Promise<ChannelRoute|undefined>
  findChannelRoute(provider: 'twilio', address: string): Promise<ChannelRoute|undefined>
  saveOnboardingRun(value: OnboardingRun): Promise<OnboardingRun>
  saveOnboardingRunWithAudit(context:TenantContext,value:OnboardingRun,evidence:OnboardingRunEvidence):Promise<OnboardingRun>
  getLatestOnboardingRun(context: TenantContext): Promise<OnboardingRun|undefined>
  saveOnboardingProviderVerification(value:OnboardingProviderVerification):Promise<OnboardingProviderVerification>
  getLatestOnboardingProviderVerification(context:TenantContext):Promise<OnboardingProviderVerification|undefined>
  saveAgentEvaluationEvidence(value:AgentEvaluationEvidence):Promise<AgentEvaluationEvidence>
  getLatestAgentEvaluationEvidence(context:TenantContext):Promise<AgentEvaluationEvidence|undefined>
  saveSupportKnowledgeArticle(value:SupportKnowledgeArticle):Promise<SupportKnowledgeArticle>
  saveSupportKnowledgeArticleWithAudit(context:TenantContext,value:SupportKnowledgeArticle,evidence:SupportKnowledgeEvidence):Promise<SupportKnowledgeArticle>
  getSupportKnowledgeArticle(context:TenantContext,slug:string):Promise<SupportKnowledgeArticle|undefined>
  listSupportKnowledgeArticles(context:TenantContext,includeUnpublished:boolean):Promise<SupportKnowledgeArticle[]>
  saveLocationActivation(value: LocationActivation): Promise<LocationActivation>
  activateLocationWithEvidence(context:TenantContext,value:LocationActivation,evidence:OnboardingActivationEvidence):Promise<{activation:LocationActivation;resumedWorkflows:number}>
  getLocationActivation(context: TenantContext): Promise<LocationActivation|undefined>
  replaceSquareCatalog(context:TenantContext,services:ServiceRecord[],staff:StaffRecord[]):Promise<void>
  replaceSquareCatalogWithAudit(context:TenantContext,services:ServiceRecord[],staff:StaffRecord[],evidence:SquareCatalogSyncEvidence):Promise<void>
  replaceServices(context: TenantContext, provider: 'square', services: ServiceRecord[]): Promise<void>
  listServices(context: TenantContext): Promise<ServiceRecord[]>
  getService(context: TenantContext, serviceId: string): Promise<ServiceRecord | undefined>
  replaceStaff(context: TenantContext, provider: 'square', staff: StaffRecord[]): Promise<void>
  listStaff(context: TenantContext): Promise<StaffRecord[]>
  getStaff(context: TenantContext, staffId: string): Promise<StaffRecord | undefined>
  dispatchWorkflowJobs(event: DomainEvent, jobs: WorkflowJob[]): Promise<void>
  claimDueWorkflowJobs(workerId: string, limit: number): Promise<WorkflowJob[]>
  completeWorkflowJob(job: WorkflowJob, workerId: string): Promise<void>
  retryWorkflowJob(job: WorkflowJob, workerId: string, runAt: string, error: string): Promise<void>
  deadLetterWorkflow(job:WorkflowJob,workerId:string,error:string,approval:ApprovalRequest,eventId:string):Promise<{approval:ApprovalRequest;deadLetter:WorkflowDeadLetter}|undefined>
  listWorkflowDeadLetters(context:TenantContext):Promise<WorkflowDeadLetter[]>
  pauseWorkflowJob(job: WorkflowJob, workerId: string, reason: string): Promise<void>
  resumeBillingPausedJobs(context: TenantContext): Promise<number>
  resumeOnboardingPausedJobs(context: TenantContext): Promise<number>
  resumeIntegrationPausedJobs(context:TenantContext,provider:'square'):Promise<number>
  enqueueWorkflowJob(job: WorkflowJob): Promise<void>
  scheduleWeeklyReportWithEvidence(context:TenantContext,settings:LocationSettings,job:WorkflowJob,evidence:WeeklyReportScheduleEvidence):Promise<{settings:LocationSettings;job:WorkflowJob}>
  listWorkflowJobs(context: TenantContext): Promise<WorkflowJob[]>
  saveWaitlistEntry(entry: WaitlistEntry): Promise<WaitlistEntry>
  listWaitlistEntries(context: TenantContext): Promise<WaitlistEntry[]>
  getWaitlistEntry(context: TenantContext, entryId: string): Promise<WaitlistEntry|undefined>
  createNextWaitlistOffer(context: TenantContext, job: WorkflowJob, expiresAt: string): Promise<{entry:WaitlistEntry;offer:WaitlistOffer}|undefined>
  completeWaitlistOfferDeliveryWithEvidence(context:TenantContext,offerId:string,providerMessageId:string,expiryJob:WorkflowJob,evidence:WaitlistOfferDeliveryEvidence):Promise<{offer:WaitlistOffer;duplicate:boolean}>
  getWaitlistOffer(context: TenantContext, offerId: string): Promise<WaitlistOffer|undefined>
  respondWaitlistOfferWithEvidence(context:TenantContext,offerId:string,accepted:boolean,continuationJob:WorkflowJob|undefined,evidence:WaitlistOfferTransitionEvidence):Promise<{offer:WaitlistOffer;duplicate:boolean}|undefined>
  expireWaitlistOfferWithEvidence(context:TenantContext,offerId:string,continuationJob:WorkflowJob,evidence:WaitlistOfferTransitionEvidence):Promise<{offer:WaitlistOffer;duplicate:boolean}|undefined>
  completeWaitlistRecovery(context: TenantContext, offerId: string, booking: BookingRecord, attribution: RevenueAttribution): Promise<void>
  listRevenueAttribution(context: TenantContext): Promise<RevenueAttribution[]>
  getRevenueAttributionForBooking(context: TenantContext, bookingId: string): Promise<RevenueAttribution|undefined>
  saveRevenueAttribution(value: RevenueAttribution): Promise<{attribution:RevenueAttribution;duplicate:boolean}>
  saveRevenueAttributionWithEvidence(context:TenantContext,value:RevenueAttribution,evidence:RevenueAttributionEvidence):Promise<{attribution:RevenueAttribution;duplicate:boolean}>
  listRecoveryAttributionTouches(context: TenantContext, clientId: string, before: string): Promise<RecoveryAttributionTouch[]>
  openRecoveryCase(value: RecoveryCase): Promise<RecoveryCase>
  openRecoveryCaseWithEvidence(context:TenantContext,value:RecoveryCase,evidence:RecoveryCaseOpeningEvidence):Promise<{recoveryCase:RecoveryCase;duplicate:boolean}>
  resolveRecoveryCase(context: TenantContext, correlationId: string, bookingId: string): Promise<void>
  resolveRecoveryCaseWithEvidence(context:TenantContext,correlationId:string,bookingId:string,evidence:RecoveryCaseResolutionEvidence):Promise<{recoveryCase?:RecoveryCase;duplicate:boolean}>
  listRecoveryCases(context: TenantContext): Promise<RecoveryCase[]>
  closeRecoveryCase(context: TenantContext, correlationId: string, reason: string): Promise<void>
  closeRecoveryCaseWithEvidence(context:TenantContext,correlationId:string,reason:RecoveryCaseCloseReason,evidence:RecoveryCaseClosureEvidence):Promise<{recoveryCase?:RecoveryCase;duplicate:boolean}>
  reserveRecoveryContact(context: TenantContext, job: WorkflowJob, clientId: string, channel?: 'sms'|'whatsapp'): Promise<RecoveryContactDecision>
  completeRecoveryContact(context: TenantContext, attemptId: string, providerMessageId: string): Promise<void>
  completeRecoveryContactWithEvidence(context:TenantContext,attemptId:string,providerMessageId:string,exposure:ExperimentExposure|undefined,evidence:RecoveryContactCompletionEvidence):Promise<{attempt:RecoveryContactAttempt;duplicate:boolean}>
  saveExperiment(value:ControlledExperiment):Promise<ControlledExperiment>
  createExperiment(value:ControlledExperiment,evidence:ExperimentCreationEvidence):Promise<ControlledExperiment>
  getExperiment(context:TenantContext,id:string):Promise<ControlledExperiment|undefined>
  listExperiments(context:TenantContext):Promise<ControlledExperiment[]>
  transitionExperiment(context:TenantContext,id:string,status:'active'|'paused'|'completed',evidence:ExperimentTransitionEvidence):Promise<ControlledExperiment|undefined>
  getActiveExperiment(context:TenantContext,workflowType:ExperimentWorkflowType,at:string):Promise<ControlledExperiment|undefined>
  saveExperimentExposure(value:ExperimentExposure):Promise<{exposure:ExperimentExposure;duplicate:boolean}>
  listExperimentExposures(context:TenantContext,experimentId:string):Promise<ExperimentExposure[]>
  hasFutureBooking(context: TenantContext, clientId: string): Promise<boolean>
  saveLocationSettings(value: LocationSettings): Promise<LocationSettings>
  saveLocationSettingsWithAudit(context:TenantContext,value:LocationSettings,evidence:LocationSettingsEvidence):Promise<{settings:LocationSettings;activationInvalidated:boolean}>
  getLocationSettings(context: TenantContext): Promise<LocationSettings|undefined>
  saveClientProfile(value: ClientProfile): Promise<ClientProfile>
  saveClientProfileWithAudit(context:TenantContext,value:ClientProfile,evidence:ClientProfileEvidence):Promise<ClientProfile>
  getClientProfile(context: TenantContext, clientId: string): Promise<ClientProfile|undefined>
  findClientProfileByContact(context: TenantContext, contactTo: string): Promise<ClientProfile|undefined>
  listClientProfiles(context: TenantContext): Promise<ClientProfile[]>
  createApprovalRequest(value: ApprovalRequest): Promise<ApprovalRequest>
  createApprovalRequestWithEvent(value:ApprovalRequest,evidence:ApprovalRequestEventEvidence):Promise<{approval:ApprovalRequest;created:boolean}>
  listApprovalRequests(context: TenantContext): Promise<ApprovalRequest[]>
  decideApprovalRequest(context: TenantContext, id: string, decision: 'approved'|'rejected', userId: string, note: string, evidence:ApprovalDecisionEvidence): Promise<ApprovalRequest|undefined>
  saveWeeklyReport(value: WeeklyReportSnapshot): Promise<WeeklyReportSnapshot>
  listWeeklyReports(context: TenantContext): Promise<WeeklyReportSnapshot[]>
  getOwnerTenantPortfolioData(context:TenantContext,since:string,to:string):Promise<TenantPortfolioData>
  getOwnerClientCohortBookings(context:TenantContext,from:string,to:string):Promise<BookingRecord[]>
  saveClientCohortSnapshot(value:ClientCohortSnapshot):Promise<ClientCohortSnapshot>
  saveClientCohortSnapshotWithAudit(context:TenantContext,value:ClientCohortSnapshot,evidence:ClientCohortEvidence):Promise<ClientCohortSnapshot>
  listClientCohortSnapshots(context:TenantContext,limit:number):Promise<ClientCohortSnapshot[]>
  getOwnerReviewData(context:TenantContext,since:string,to:string):Promise<TenantOwnerReviewData>
  saveMonthlyOwnerReviewSnapshot(value:MonthlyOwnerReviewSnapshot):Promise<MonthlyOwnerReviewSnapshot>
  saveMonthlyOwnerReviewSnapshotWithAudit(context:TenantContext,value:MonthlyOwnerReviewSnapshot,evidence:MonthlyOwnerReviewEvidence):Promise<MonthlyOwnerReviewSnapshot>
  listMonthlyOwnerReviewSnapshots(context:TenantContext,limit:number):Promise<MonthlyOwnerReviewSnapshot[]>
  saveAgencyAccount(value:AgencyAccount):Promise<AgencyAccount>
  saveAgencyAccountWithAudit(context:TenantContext,value:AgencyAccount,evidence:AgencyAccessEvidence):Promise<AgencyAccount>
  getAgencyAccount(context:TenantContext):Promise<AgencyAccount|undefined>
  createAgencyInvitation(value:AgencyInvitation):Promise<AgencyInvitation>
  createAgencyInvitationWithAudit(context:TenantContext,value:AgencyInvitation,evidence:AgencyAccessEvidence):Promise<AgencyInvitation>
  getAgencyInvitationForClient(context:TenantContext,tokenHash:string,at:string):Promise<{invitation:AgencyInvitation;agency:AgencyAccount}|undefined>
  acceptAgencyInvitation(context:TenantContext,tokenHash:string,acceptedAt:string):Promise<{invitation:AgencyInvitation;grant:AgencyGrant;duplicate:boolean}|undefined>
  acceptAgencyInvitationWithAudit(context:TenantContext,tokenHash:string,acceptedAt:string,evidence:AgencyAccessEvidence):Promise<{invitation:AgencyInvitation;grant:AgencyGrant;duplicate:boolean}|undefined>
  listAgencyGrants(context:TenantContext):Promise<AgencyGrant[]>
  listClientAgencyGrants(context:TenantContext):Promise<AgencyGrant[]>
  revokeAgencyGrant(context:TenantContext,id:string,revokedAt:string,reason:string):Promise<AgencyGrant|undefined>
  revokeAgencyGrantWithAudit(context:TenantContext,id:string,revokedAt:string,reason:string,evidence:AgencyAccessEvidence):Promise<AgencyGrant|undefined>
  getAgencyGrantedTenantPortfolioData(context:TenantContext,clientTenantId:string,since:string,to:string):Promise<{grant:AgencyGrant;data:TenantPortfolioData}|undefined>
  saveBillingAccountFromEvent(value: BillingAccount): Promise<{account:BillingAccount;duplicate:boolean;stale:boolean}>
  getBillingAccount(context: TenantContext): Promise<BillingAccount|undefined>
  saveConversation(value: Conversation): Promise<Conversation>
  findConversationByParticipant(context: TenantContext, channel: Conversation['channel'], participantAddress: string): Promise<Conversation|undefined>
  getConversation(context: TenantContext, conversationId: string): Promise<Conversation|undefined>
  listConversations(context: TenantContext): Promise<Conversation[]>
  saveConversationMessage(value: ConversationMessage): Promise<{message:ConversationMessage;duplicate:boolean}>
  getConversationMessage(context: TenantContext, messageId: string): Promise<ConversationMessage|undefined>
  listConversationMessages(context: TenantContext, conversationId: string): Promise<ConversationMessage[]>
  savePromptVersion(value: PromptVersion): Promise<PromptVersion>
  getActivePromptVersion(name: PromptVersion['name']): Promise<PromptVersion|undefined>
  saveAgentRun(value: AgentRun): Promise<AgentRun>
  getAgentRunForInput(context: TenantContext, inputMessageId: string): Promise<AgentRun|undefined>
  listAgentRuns(context: TenantContext, conversationId: string): Promise<AgentRun[]>
  saveModelUsageRecord(value:ModelUsageRecord):Promise<{record:ModelUsageRecord;duplicate:boolean}>
  listModelUsageRecords(context:TenantContext,since?:string,to?:string):Promise<ModelUsageRecord[]>
  createModelPriceVersion(value:ModelPriceVersion):Promise<ModelPriceVersion>
  createModelPriceVersionWithAudit(context:TenantContext,value:ModelPriceVersion,evidence:ModelPriceEvidence):Promise<ModelPriceVersion>
  listModelPriceVersions(context:TenantContext):Promise<ModelPriceVersion[]>
  saveToolCall(value: ToolCallRecord): Promise<ToolCallRecord>
  saveToolCallWithAudit(context:TenantContext,value:ToolCallRecord,evidence:ToolCallEvidence):Promise<ToolCallRecord>
  listToolCalls(context: TenantContext, conversationId: string): Promise<ToolCallRecord[]>
  saveConversationAction(value: ConversationAction): Promise<ConversationAction>
  prepareConversationActionWithAudit(context:TenantContext,action:ConversationAction,draft:ConversationMessage,evidence:ConversationActionPreparationEvidence):Promise<{action:ConversationAction;draft:ConversationMessage}>
  requestConversationActionConfirmationWithAudit(context:TenantContext,action:ConversationAction,message:ConversationMessage,conversation:Conversation,evidence:ConversationConfirmationRequestEvidence):Promise<{action:ConversationAction;message:ConversationMessage;conversation:Conversation}>
  completeConversationActionWithAudit(context:TenantContext,action:ConversationAction,evidence:ConversationActionCompletionEvidence):Promise<ConversationAction>
  terminateConversationActionWithEvidence(context:TenantContext,action:ConversationAction,evidence:ConversationActionTerminationEvidence):Promise<{action:ConversationAction;holdReleased:boolean}>
  getActiveConversationAction(context: TenantContext, conversationId: string): Promise<ConversationAction|undefined>
  listConversationActions(context: TenantContext, conversationId: string): Promise<ConversationAction[]>
  reserveConversationFollowup(context: TenantContext, job: WorkflowJob, conversationId: string, clientId: string, triggerMessageId: string, channel?: 'sms'|'whatsapp'): Promise<ConversationFollowupDecision>
  completeConversationFollowup(context: TenantContext, attemptId: string, providerMessageId: string): Promise<void>
  completeConversationFollowupWithEvidence(context:TenantContext,attemptId:string,message:ConversationMessage,conversation:Conversation,evidence:ConversationFollowupCompletionEvidence):Promise<{attempt:ConversationFollowupAttempt;duplicate:boolean}>
  closeConversationFollowup(context: TenantContext, job: WorkflowJob, conversationId: string, clientId: string, triggerMessageId: string, reason: ConversationFollowupCloseReason, channel?: 'sms'|'whatsapp'): Promise<ConversationFollowupAttempt>
  listConversationFollowups(context: TenantContext, conversationId: string): Promise<ConversationFollowupAttempt[]>
  reserveMissedCallRecovery(context: TenantContext, job: WorkflowJob, providerCallSid: string, callerAddress: string, clientId?: string): Promise<MissedCallRecoveryDecision>
  closeMissedCallRecovery(context: TenantContext, job: WorkflowJob, providerCallSid: string, callerAddress: string, reason: MissedCallRecoveryCloseReason, clientId?: string): Promise<MissedCallRecoveryAttempt>
  completeMissedCallRecovery(context: TenantContext, attemptId: string, providerMessageId: string, conversationId: string, conversationMessageId: string): Promise<void>
  completeMissedCallRecoveryWithEvidence(context:TenantContext,attemptId:string,message:ConversationMessage,conversation:Conversation,evidence:MissedCallRecoveryCompletionEvidence):Promise<{attempt:MissedCallRecoveryAttempt;duplicate:boolean}>
  listMissedCallRecoveries(context: TenantContext): Promise<MissedCallRecoveryAttempt[]>
  reserveReviewRequest(value: ReviewRequest): Promise<ReviewRequestDecision>
  reserveReviewRequestWithAudit(value:ReviewRequest,evidence:ReviewRequestEvidence):Promise<ReviewRequestDecision>
  completeReviewRequest(context: TenantContext, id: string, providerMessageId: string): Promise<ReviewRequest|undefined>
  completeReviewRequestWithEvidence(context:TenantContext,id:string,providerMessageId:string,evidence:ReviewRequestCompletionEvidence):Promise<ReviewRequest|undefined>
  closeReviewRequest(context: TenantContext, id: string, reason: ReviewRequestCloseReason): Promise<ReviewRequest|undefined>
  closeReviewRequestWithAudit(context:TenantContext,id:string,reason:ReviewRequestCloseReason,evidence:ReviewRequestEvidence):Promise<ReviewRequest|undefined>
  findRecentSentReviewRequest(context: TenantContext, clientId: string, since: string): Promise<ReviewRequest|undefined>
  recordReviewFeedback(context: TenantContext, id: string, messageId: string, recoveryApprovalId: string): Promise<ReviewRequest|undefined>
  recordReviewFeedbackWithEvidence(context:TenantContext,id:string,messageId:string,recoveryApprovalId:string,evidence:ReviewFeedbackEvidence):Promise<ReviewRequest|undefined>
  listReviewRequests(context: TenantContext): Promise<ReviewRequest[]>
  consumeTenantRateLimit(bucket: TenantRateLimitBucket): Promise<TenantRateLimitResult>
  consumePublicRateLimit(bucket: PublicRateLimitBucket): Promise<PublicRateLimitResult>
  listTenantRateLimitBuckets(context: TenantContext, since: string): Promise<TenantRateLimitBucket[]>
  reserveOutboundMessageDelivery(value: OutboundMessageDelivery): Promise<{delivery:OutboundMessageDelivery;duplicate:boolean}>
  saveOutboundMessageDelivery(value: OutboundMessageDelivery): Promise<OutboundMessageDelivery>
  saveOutboundMessageDeliveryStatusWithAudit(context:TenantContext,value:OutboundMessageDelivery,messageStatus:ConversationMessage['deliveryStatus']|undefined,evidence:MessageDeliveryStatusEvidence):Promise<OutboundMessageDelivery>
  getOutboundMessageDeliveryByProvider(context: TenantContext, providerMessageId: string): Promise<OutboundMessageDelivery|undefined>
  listOutboundMessageDeliveries(context: TenantContext): Promise<OutboundMessageDelivery[]>
  getConversationMessageByProvider(context: TenantContext, providerMessageId: string): Promise<ConversationMessage|undefined>
  updateConversationMessageDelivery(context: TenantContext, providerMessageId: string, status: ConversationMessage['deliveryStatus']): Promise<ConversationMessage|undefined>
  buildClientDataSnapshot(context: TenantContext, clientId: string): Promise<ClientDataSnapshot>
  savePrivacyDataExportReceipt(value: PrivacyDataExportReceipt): Promise<PrivacyDataExportReceipt>
  savePrivacyDataExportReceiptWithAudit(context:TenantContext,value:PrivacyDataExportReceipt,evidence:PrivacyDataExportEvidence):Promise<PrivacyDataExportReceipt>
  listPrivacyDataExportReceipts(context: TenantContext): Promise<PrivacyDataExportReceipt[]>
  savePrivacyRetentionPolicy(value: PrivacyRetentionPolicy): Promise<PrivacyRetentionPolicy>
  savePrivacyRetentionPolicyWithAudit(context:TenantContext,value:PrivacyRetentionPolicy,evidence:PrivacyRetentionPolicyEvidence):Promise<PrivacyRetentionPolicy>
  getPrivacyRetentionPolicy(context: TenantContext): Promise<PrivacyRetentionPolicy|undefined>
  createPrivacyLegalHold(value: PrivacyLegalHold): Promise<PrivacyLegalHold>
  createPrivacyLegalHoldWithAudit(context:TenantContext,value:PrivacyLegalHold,evidence:PrivacyLegalHoldEvidence):Promise<PrivacyLegalHold>
  listPrivacyLegalHolds(context: TenantContext, clientId?: string): Promise<PrivacyLegalHold[]>
  releasePrivacyLegalHold(context: TenantContext, id: string, releasedBy: string, releaseNote: string, releasedAt: string): Promise<PrivacyLegalHold|undefined>
  releasePrivacyLegalHoldWithAudit(context:TenantContext,id:string,releasedBy:string,releaseNote:string,releasedAt:string,evidence:PrivacyLegalHoldEvidence):Promise<PrivacyLegalHold|undefined>
  createPrivacyErasureRequest(value: PrivacyErasureRequest): Promise<PrivacyErasureRequest>
  createPrivacyErasureRequestWithAudit(value:PrivacyErasureRequest,evidence:PrivacyErasureRequestEvidence):Promise<{request:PrivacyErasureRequest;created:boolean}>
  getPrivacyErasureRequest(context: TenantContext, id: string): Promise<PrivacyErasureRequest|undefined>
  listPrivacyErasureRequests(context: TenantContext): Promise<PrivacyErasureRequest[]>
  executePrivacyErasure(context: TenantContext, request: PrivacyErasureRequest, receipt: PrivacyErasureReceipt, evidence:PrivacyErasureExecutionEvidence): Promise<{request:PrivacyErasureRequest;receipt:PrivacyErasureReceipt}>
  acquireProviderCircuitPermit(context:TenantContext,provider:ProviderName,now:string,probeLeaseMs:number):Promise<ProviderCircuitPermit>
  recordProviderCircuitSuccess(context:TenantContext,provider:ProviderName,now:string):Promise<ProviderCircuitState>
  recordProviderCircuitFailure(context:TenantContext,provider:ProviderName,now:string,threshold:number,cooldownMs:number,errorCode:string):Promise<ProviderCircuitState>
  listProviderCircuits(context:TenantContext):Promise<ProviderCircuitState[]>
  resetProviderCircuit(context:TenantContext,provider:ProviderName,evidence:ProviderCircuitResetEvidence):Promise<ProviderCircuitState>
  createSecurityIncident(value:SecurityIncident,event:SecurityIncidentEvent,approval:ApprovalRequest,evidence:SecurityIncidentDeclarationEvidence):Promise<SecurityIncident>
  listSecurityIncidents(context:TenantContext,limit:number):Promise<SecurityIncident[]>
  listSecurityIncidentEvents(context:TenantContext,incidentId:string):Promise<SecurityIncidentEvent[]>
  transitionSecurityIncident(context:TenantContext,id:string,status:Exclude<SecurityIncidentStatus,'open'>,actorId:string,at:string,actionSummary:string,evidence:SecurityIncidentTransitionEvidence):Promise<SecurityIncident|undefined>
  saveProviderReconciliationRun(value:ProviderReconciliationRun):Promise<ProviderReconciliationRun>
  completeProviderReconciliationRun(context:TenantContext,value:ProviderReconciliationRun,evidence:ProviderReconciliationEvidence):Promise<ProviderReconciliationRun>
  listProviderReconciliationRuns(context:TenantContext,limit:number):Promise<ProviderReconciliationRun[]>
  saveMessagingReliabilityEvaluation(value:MessagingReliabilityEvaluation):Promise<MessagingReliabilityEvaluation>
  saveMessagingReliabilityEvaluationWithAudit(context:TenantContext,value:MessagingReliabilityEvaluation,evidence:MessagingReliabilityEvidence):Promise<MessagingReliabilityEvaluation>
  getLatestMessagingReliabilityEvaluation(context:TenantContext):Promise<MessagingReliabilityEvaluation|undefined>
  saveVoiceReadinessDeclarationWithAudit(context:TenantContext,value:VoiceReadinessDeclaration,evidence:VoiceReadinessEvidence):Promise<VoiceReadinessDeclaration>
  getLatestVoiceReadinessDeclaration(context:TenantContext):Promise<VoiceReadinessDeclaration|undefined>
  reserveRealtimeVoiceCall(value:RealtimeVoiceCall):Promise<{call:RealtimeVoiceCall;duplicate:boolean}>
  getRealtimeVoiceCall(context:TenantContext,callId:string):Promise<RealtimeVoiceCall|undefined>
  transitionRealtimeVoiceCall(context:TenantContext,callId:string,from:RealtimeVoiceCallStatus[],to:RealtimeVoiceCallStatus,updatedAt:string,errorCode?:string):Promise<RealtimeVoiceCall|undefined>
  recordRealtimeVoiceCallSignal(context:TenantContext,callId:string,signal:RealtimeVoiceCallSignal,occurredAt:string):Promise<RealtimeVoiceCall|undefined>
  saveVoiceReleaseEvidenceWithAudit(context:TenantContext,value:VoiceReleaseEvidence,evidence:VoiceReleaseAuditEvidence):Promise<VoiceReleaseEvidence>
  getLatestVoiceReleaseEvidence(context:TenantContext):Promise<VoiceReleaseEvidence|undefined>
  activateRealtimeVoiceWithAudit(context:TenantContext,value:RealtimeVoiceActivation,evidence:VoiceReleaseAuditEvidence):Promise<RealtimeVoiceActivation>
  getLatestRealtimeVoiceActivation(context:TenantContext):Promise<RealtimeVoiceActivation|undefined>
  acceptSquareBookingWebhook(value:SquareBookingWebhookCursor):Promise<SquareBookingWebhookDecision>
  createPublicRecoveryReview(value:PublicRecoveryReview):Promise<{review:PublicRecoveryReview;duplicate:boolean}>
  getPublicRecoveryReview(id:string):Promise<PublicRecoveryReview|undefined>
}
