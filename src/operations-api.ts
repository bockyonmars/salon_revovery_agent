import { getOperationsAccessToken, hasOperationsSession, invalidateOperationsSession } from './operations-auth'
import type { VoiceReleaseEvidenceInput } from './voice-release-evidence'

export { hasOperationsSession }

export type ApiApprovalRequest = {
  id: string
  requestType: 'workflow_failure' | 'integration_reconnect' | 'provider_reconciliation' | 'report_delivery' | 'security_incident' | 'service_recovery' | 'message_delivery_failure'
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  entityType: string
  entityId: string
  payload: Record<string, unknown>
  createdAt: string
  decidedAt?: string
  decidedBy?: string
  decisionNote?: string
}

export type ApiHealthCheck = {
  key: string
  status: 'ready' | 'warning' | 'blocked'
  label: string
  detail: string
  action?: string
}

export type ApiTenantHealth = {
  status: 'ready' | 'degraded' | 'setup_required'
  automationReady: boolean
  checkedAt: string
  summary: { ready: number; warning: number; blocked: number; pendingWorkflows: number; failedWorkflows: number; pausedWorkflows: number; pendingApprovals: number }
  checks: ApiHealthCheck[]
}

export type ApiOnboardingCheck = {
  key: 'location_settings' | 'communication_policy' | 'square_connection' | 'catalog_sync' | 'client_profiles' | 'messaging' | 'weekly_reporting' | 'billing' | 'conversation_simulation' | 'test_booking' | 'webhook_verification'
  label: string
  status: 'passed' | 'failed'
  detail: string
}

export type ApiOnboardingRun = {
  id: string
  status: 'passed' | 'failed'
  configurationFingerprint: string
  checks: ApiOnboardingCheck[]
  createdBy: string
  createdAt: string
}

export type ApiOnboardingStatus = {
  activation: { status: 'draft' | 'active'; onboardingRunId?: string; activatedAt?: string; activatedBy?: string; updatedAt: string }
  latestRun?: ApiOnboardingRun
  canActivate: boolean
  stale: boolean
  health: ApiTenantHealth
}

export type ApiVoiceReadinessDeclaration = {
  id: string
  policyVersion: 'voice-readiness-v1'
  status: 'attested'
  jurisdictionCode: string
  aiDisclosureVersion: string
  retentionPolicyVersion: string
  recordingMode: 'disabled'
  transferMode: 'human'
  transferToMasked: string
  createdAt: string
  expiresAt: string
}

export type VoiceReadinessAttestationInput = {
  jurisdictionCode: string
  aiDisclosureVersion: string
  retentionPolicyVersion: string
  recordingMode: 'disabled'
  transferMode: 'human'
  transferTo: string
  controls: {
    aiParticipationDisclosureReviewed: true
    recordingStorageDisabled: true
    immediateTransferTested: true
    jurisdictionRetentionReviewed: true
  }
}

export type ApiMessagingReliabilityEvaluation = {
  id: string
  policyVersion: 'voice-prerequisite-v1'
  status: 'passed' | 'failed'
  voiceBuildAllowed: boolean
  expiresAt: string
  createdAt: string
  metrics: { terminalMessages: number; deliveryRate: number; uncertainSends: number; staleNonTerminal: number; pendingDeliveryIncidents: number; twilioCircuitState: 'closed' | 'open' | 'half_open' | 'untracked'; twilioReconciliationState: 'clean' | 'stale' | 'missing' | 'unclean' }
  checks: Array<{ key: string; status: 'passed' | 'failed'; detail: string }>
}

export type ApiVoiceReadinessStatus = {
  evaluation?: ApiMessagingReliabilityEvaluation
  declaration?: ApiVoiceReadinessDeclaration
  reliabilityCurrent: boolean
  declarationCurrent: boolean
  voiceRuntimeAllowed: boolean
  runtimeConfigured: boolean
  permissions: { evaluateReliability: boolean; attest: boolean }
  voiceEnabled: boolean
}

export type ApiVoiceReleaseEvidence = VoiceReleaseEvidenceInput & {
  id: string
  status: 'attested'
  createdAt: string
  expiresAt: string
}

export type ApiRealtimeVoiceActivation = {
  id: string
  policyVersion: 'voice-runtime-activation-v1'
  status: 'active'
  voiceReleaseEvidenceId: string
  voiceReadinessDeclarationId: string
  messagingReliabilityEvaluationId: string
  model: string
  activatedAt: string
}

export type ApiVoiceReleaseStatus = {
  model: string
  readiness: { allowed: boolean; declaration?: ApiVoiceReadinessDeclaration }
  evidence?: ApiVoiceReleaseEvidence
  activation?: ApiRealtimeVoiceActivation
  evidenceCurrent: boolean
  activationCurrent: boolean
  realtimeRuntimeAllowed: boolean
  runtimeConfigured: boolean
  permissions: { attestEvidence: boolean; activate: boolean }
  realtimeVoiceEnabled: boolean
}

export type ApiAgencyAccount = {
  id: string
  tenantId: string
  displayName: string
  supportEmail?: string
  status: 'active'
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

export type ApiAgencyGrant = {
  id: string
  agencyTenantId: string
  clientTenantId: string
  scopes: Array<'portfolio_read'>
  status: 'active' | 'revoked'
  invitationId: string
  acceptedBy: string
  createdAt: string
  revokedBy?: string
  revokedAt?: string
  revokeReason?: string
}

export type ApiAgencyInvitation = {
  id: string
  agencyTenantId: string
  clientTenantId: string
  scopes: Array<'portfolio_read'>
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  createdBy: string
  createdAt: string
  expiresAt: string
  acceptedBy?: string
  acceptedAt?: string
  grantId?: string
}

export type ApiAgencyInvitationPreview = {
  agency: { displayName: string; supportEmail?: string }
  scopes: Array<'portfolio_read'>
  expiresAt: string
}

export type ApiTenantPortfolioLocation = {
  locationId: string
  locationName: string
  settingsConfigured: boolean
  activationStatus: 'active' | 'draft' | 'unconfigured'
  billingStatus: 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'unpaid' | 'unconfigured'
  providerCircuits: { open: number; halfOpen: number }
  verifiedRecoveredRevenueMinorByCurrency: Record<string, number>
  recoveredBookings: number
  recoveryCases: { opened: number; resolved: number; closed: number; open: number }
  messaging: { attempted: number; delivered: number; failed: number; deliveryRate: number; currentMarketingConsentRecords: number; currentMarketingOptOuts: number; currentMarketingOptOutRate: number }
  operations: { pendingWorkflows: number; runningWorkflows: number; failedWorkflows: number; pausedWorkflows: number; pendingApprovals: number }
  experiments: { active: number; draft: number; paused: number }
}

export type ApiTenantPortfolioReport = {
  tenantId: string
  period: { from: string; to: string }
  portfolio: { locationCount: number; locations: ApiTenantPortfolioLocation[] }
  totals: Omit<ApiTenantPortfolioLocation, 'locationId' | 'locationName' | 'settingsConfigured' | 'activationStatus' | 'billingStatus' | 'providerCircuits'> & { providerCircuits: { open: number; halfOpen: number } }
  dataQuality: { revenueEvidence: 'verified_booking_single_touch'; estimatedRevenueIncluded: false; unattributedBookingsIncluded: false; multipleCurrencies: boolean; consentMetric: 'current_record_snapshot_not_period_flow'; containsClientIdentities: false }
  generatedAt: string
}

export type ApiConversation = { id:string;clientId:string;participantAddress:string;channel:'sms'|'whatsapp'|'email';status:'active'|'escalated'|'closed';intent:string;requiresHuman:boolean;unreadCount:number;lastMessageAt:string;createdAt:string;updatedAt:string }
export type ApiConversationMessage = { id:string;conversationId:string;direction:'inbound'|'outbound';author:'client'|'agent'|'operator'|'system';body:string;providerMessageId?:string;deliveryStatus:'received'|'draft'|'queued'|'sent'|'delivered'|'failed';createdAt:string }
export type ApiClientProfile = { clientId:string;displayName?:string;contactTo:string;timezone:string;providerCustomerId?:string;lastVisitAt?:string;recommendedRebookDays?:number;updatedAt:string }
export type ApiConsent = { channel:'sms'|'whatsapp'|'email'|'voice';purpose:'transactional'|'marketing';status:'unknown'|'opted_in'|'opted_out';capturedAt:string }
export type ApiConversationSummary = { conversation:ApiConversation;lastMessage?:ApiConversationMessage;client?:ApiClientProfile }
export type ApiConversationDetail = { conversation:ApiConversation;messages:ApiConversationMessage[];client?:ApiClientProfile;consents:ApiConsent[];runs:Array<{id:string;status:'completed'|'skipped'|'failed';model:string;createdAt:string;route?:{intent:string;confidence:number;requiresHuman:boolean;shortReason:string}}>;toolCalls:Array<{id:string;toolName:string;status:'completed'|'failed';errorCode?:string;createdAt:string}>;actions:Array<{id:string;actionType:'book_appointment'|'cancel_appointment'|'reschedule_appointment';status:'prepared'|'awaiting_confirmation'|'completed'|'cancelled'|'expired';holdId?:string;draftMessageId?:string;confirmationRequestedAt?:string;bookingId?:string;targetStartsAt?:string;targetStaffId?:string;reason?:string;expiresAt?:string;createdAt:string;updatedAt:string}> }

export type ApiRevenueAttribution = {
  id: string
  bookingId: string
  sourceId: string
  workflowJobId: string
  recoveryCorrelationId?: string
  amountMinor: number
  currency: string
  attributionType: 'waitlist_fill' | 'no_show_recovery' | 'post_visit_rebook' | 'lapsed_reactivation' | 'abandoned_enquiry' | 'missed_call_recovery'
  evidence: 'accepted_waitlist_offer' | 'sent_recovery_before_booking'
  touchAt: string
  verifiedAt: string
}

export type ApiRecoveryCase = {
  id: string
  recoveryType: 'waitlist_fill' | 'no_show' | 'post_visit_rebook' | 'lapsed_reactivation'
  correlationId: string
  workflowJobId: string
  status: 'open' | 'resolved' | 'closed'
  potentialRevenueMinor?: number
  currency?: string
  openedAt: string
  resolvedAt?: string
  resultBookingId?: string
  closeReason?: string
}

export type ApiControlledExperiment = {
  id: string
  tenantId?: string
  locationId?: string
  name: string
  workflowType: 'no_show_recovery' | 'post_visit_rebook' | 'lapsed_reactivation'
  status: 'draft' | 'active' | 'paused' | 'completed'
  variants: Array<{ key: string; allocation: number; messageTemplate: string }>
  startsAt?: string
  endsAt?: string
  version?: 1
  createdBy?: string
  createdAt: string
  updatedBy?: string
  updatedAt: string
  activatedAt?: string
  completedAt?: string
}

export type ApiControlledExperimentInput = Pick<ApiControlledExperiment, 'name' | 'workflowType' | 'variants' | 'startsAt' | 'endsAt'>

export type ApiControlledExperimentResult = {
  experimentId: string
  status: ApiControlledExperiment['status']
  evidence: 'verified_booking_attribution_only'
  minimumSampleReached: boolean
  minimumSamplePerVariant: number
  winnerSuggested: false
  variants: Array<{
    variantKey: string
    allocation: number
    exposures: number
    recoveredBookings: number
    conversionRate: number
    verifiedRecoveredRevenueMinorByCurrency: Record<string, number>
  }>
  generatedAt: string
}

export type ApiMonthlyOwnerReviewReport = {
  tenantId: string
  period: { from: string; to: string }
  reviewStatus: 'ready' | 'attention_required'
  revenue: {
    verifiedRecoveredRevenueMinorByCurrency: Record<string, number>
    recoveredBookings: number
    evidence: 'verified_booking_single_touch'
    churn: {
      status: 'available'
      snapshotId: string
      policyVersion: 'active-client-180d-v1'
      activityWindowDays: number
      startActiveClients: number
      endActiveClients: number
      retainedClients: number
      churnedClients: number
      newlyActiveClients: number
      churnRate: number
      evidence: 'square_completed_bookings'
    } | { status: 'unavailable'; reason: string; requiredEvidence: string }
  }
  approvalBacklog: { pending: number; olderThanSevenDays: number; oldestPendingAt?: string; byType: Record<string, number | undefined> }
  complaints: { complaintConversations: number; medicalSafetyConversations: number; negativeReviewFeedback: number; serviceRecoveryApprovals: number; evidence: 'bounded_operational_signals' }
  messagingOptOuts: { currentMarketingConsentRecords: number; currentMarketingOptOuts: number; currentMarketingOptOutRate: number; evidence: 'current_record_snapshot_not_period_flow' }
  modelCost: {
    status: 'available' | 'partial' | 'unavailable'
    usageRecords: number
    reportedUsageRecords: number
    missingUsageRecords: number
    pricedUsageRecords: number
    unpricedUsageRecords: number
    tokens: { input: number; cachedInput: number; output: number; reasoning: number; total: number }
    costMicroMinorByCurrency: Record<string, number>
    evidence: 'provider_reported_usage_with_owner_attested_price_versions'
    reason?: string
    requiredEvidence?: string
  }
  integrationHealth: { status: 'healthy' | 'attention_required'; providerCircuits: { open: number; halfOpen: number }; reconciliation: { clean: number; missing: number; stale: number; unclean: number } }
  securityAlerts: { status: 'clear' | 'attention_required'; auditIntegrity: { verified: number; empty: number; legacyOnly: number; broken: number }; rateLimitBreaches: number; incidents: { open: number; contained: number; sev1Active: number } }
  proposedExperiments: { drafts: Array<{ id: string; locationId: string; name: string; workflowType: ApiControlledExperiment['workflowType']; createdAt: string }>; active: number; paused: number; autoActivation: false }
  actionItems: Array<{ key: string; severity: 'critical' | 'warning' | 'information'; detail: string }>
  dataQuality: { containsClientIdentities: false; estimatedRevenueIncluded: false; unavailableMetrics: Array<'client_churn' | 'model_cost'>; snapshotDigestAlgorithm: 'sha256' }
  generatedAt: string
}

export type ApiMonthlyOwnerReviewSnapshot = {
  id: string
  tenantId: string
  periodFrom: string
  periodTo: string
  report: ApiMonthlyOwnerReviewReport
  reportDigest: string
  createdBy: string
  createdAt: string
}

export type ApiWeeklyRevenueReport = {
  period: { from: string; to: string }
  observed: {
    verifiedRecoveredRevenueMinorByCurrency: Record<string, number>
    verifiedRecoveredRevenueMinorBySource: Record<string, Record<string, number>>
    recoveredBookings: number
    recoveredBookingsBySource: Record<string, number>
    recoveryCasesOpened: number
    recoveryCasesResolved: number
    recoveryCasesClosed: number
    recoveryCasesStillOpen: number
    reviewRequestsConsidered: number
    reviewRequestsSent: number
    reviewRequestsClosed: number
    negativeReviewFeedback: number
  }
  attribution: {
    method: 'verified_booking_single_touch'
    records: ApiRevenueAttribution[]
  }
  dataQuality: {
    multipleCurrencies: boolean
    estimatedRevenueIncluded: false
    unattributedBookingsIncluded: false
  }
}

export type ApiWeeklyReportSnapshot = {
  id: string
  tenantId: string
  locationId: string
  periodFrom: string
  periodTo: string
  report: ApiWeeklyRevenueReport
  status: 'generated' | 'delivered' | 'delivery_failed'
  recipientEmail?: string
  createdAt: string
  deliveredAt?: string
}

export type ApiProviderCircuit = {
  provider: 'square' | 'twilio' | 'openai' | 'postmark'
  state: 'closed' | 'open' | 'half_open'
  consecutiveFailures: number
  openedAt?: string
  nextProbeAt?: string
  lastFailureAt?: string
  lastSuccessAt?: string
  lastErrorCode?: string
  updatedAt: string
}

export type ApiLocationSettings = {
  salonName: string
  senderName: string
  timezone: string
  brandVoice?: string
  reportRecipientEmail?: string
  publicReviewUrl?: string
  communicationPolicy?: {
    policyVersion: string
    transactionalDisclosureVersion: string
    marketingDisclosureVersion: string
    escalationContactName: string
    escalationContactEmail: string
    contactWindowStartHour: number
    contactWindowEndHour: number
    defaultRebookDays: number
  }
  updatedAt: string
}

const baseUrl = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export async function loadOperations() {
  const [approvalResponse, health, onboarding, recoveryResponse, attributionResponse, settingsResponse] = await Promise.all([
    request<{ requests: ApiApprovalRequest[] }>('/v1/approval-requests'),
    request<ApiTenantHealth>('/v1/operations/health'),
    request<ApiOnboardingStatus>('/v1/onboarding'),
    request<{ cases: ApiRecoveryCase[] }>('/v1/recovery-cases'),
    request<{ records: ApiRevenueAttribution[] }>('/v1/revenue-attribution'),
    request<{ settings: ApiLocationSettings | null }>('/v1/location-settings'),
  ])
  return { approvals: approvalResponse.requests, health, onboarding, recoveryCases: recoveryResponse.cases, attribution: attributionResponse.records, settings: settingsResponse.settings }
}

export function loadOnboarding() { return request<ApiOnboardingStatus>('/v1/onboarding') }

export function runOnboardingChecks() {
  return request<ApiOnboardingRun>('/v1/onboarding/simulations', { method: 'POST', body: '{}' })
}

export function activateOnboarding() {
  return request<{ activation: ApiOnboardingStatus['activation']; resumedWorkflows: number }>('/v1/onboarding/activate', { method: 'POST', body: '{}' })
}

export function loadVoiceReleaseStatus() { return request<ApiVoiceReleaseStatus>('/v1/operations/voice-release') }

export function attestVoiceReleaseEvidence(input: VoiceReleaseEvidenceInput) {
  return request<ApiVoiceReleaseEvidence>('/v1/operations/voice-release/evidence', { method: 'POST', body: JSON.stringify(input) })
}

export function activateVoiceRelease() {
  return request<ApiRealtimeVoiceActivation>('/v1/operations/voice-release/activate', { method: 'POST', body: '{}' })
}

export function loadVoiceReadinessStatus() { return request<ApiVoiceReadinessStatus>('/v1/operations/voice-readiness') }

export function evaluateMessagingReliability() {
  return request<ApiMessagingReliabilityEvaluation>('/v1/operations/messaging-reliability/evaluate', { method: 'POST', body: '{}' })
}

export function attestVoiceReadiness(input: VoiceReadinessAttestationInput) {
  return request<ApiVoiceReadinessDeclaration>('/v1/operations/voice-readiness/attest', { method: 'POST', body: JSON.stringify(input) })
}

export function loadTenantPortfolio(from: string, to: string) {
  const query = new URLSearchParams({ from, to })
  return request<ApiTenantPortfolioReport>(`/v1/reports/portfolio?${query.toString()}`)
}

export async function loadAgencyAccess() {
  const [accountResponse, clientGrantResponse] = await Promise.all([
    request<{ account: ApiAgencyAccount | null }>('/v1/agency/account'),
    request<{ grants: ApiAgencyGrant[] }>('/v1/agency/client-grants'),
  ])
  const agencyGrantResponse = accountResponse.account
    ? await request<{ grants: ApiAgencyGrant[] }>('/v1/agency/grants')
    : { grants: [] }
  return { account: accountResponse.account, agencyGrants: agencyGrantResponse.grants, clientGrants: clientGrantResponse.grants }
}

export function saveAgencyAccount(input: { displayName: string; supportEmail?: string }) {
  return request<ApiAgencyAccount>('/v1/agency/account', { method: 'PUT', body: JSON.stringify(input) })
}

export function createAgencyInvitation(input: { clientTenantId: string; expiresInDays: number }) {
  return request<{ invitation: ApiAgencyInvitation; acceptanceToken: string }>('/v1/agency/invitations', { method: 'POST', body: JSON.stringify(input) })
}

export function previewAgencyInvitation(token: string) {
  return request<ApiAgencyInvitationPreview>('/v1/agency/invitations/preview', { method: 'POST', body: JSON.stringify({ token }) })
}

export function acceptAgencyInvitation(token: string) {
  return request<{ invitation: ApiAgencyInvitation; grant: ApiAgencyGrant; duplicate: boolean }>('/v1/agency/invitations/accept', { method: 'POST', body: JSON.stringify({ token }) })
}

export function revokeAgencyGrant(grantId: string, reason: string) {
  return request<ApiAgencyGrant>(`/v1/agency/grants/${encodeURIComponent(grantId)}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) })
}

export function loadAgencyClientPortfolio(clientTenantId: string, from: string, to: string) {
  const query = new URLSearchParams({ from, to })
  return request<{ grant: { id: string; scope: 'portfolio_read' }; report: ApiTenantPortfolioReport }>(`/v1/agency/clients/${encodeURIComponent(clientTenantId)}/portfolio?${query.toString()}`)
}

export async function loadConversations(){return request<{conversations:ApiConversationSummary[]}>('/v1/conversations')}
export function loadConversation(conversationId:string){return request<ApiConversationDetail>(`/v1/conversations/${encodeURIComponent(conversationId)}`)}
export function routeConversation(conversationId:string){return request<{conversation:ApiConversation;draft?:ApiConversationMessage;route:{intent:string;confidence:number;requiresHuman:boolean;shortReason:string}}>(`/v1/conversations/${encodeURIComponent(conversationId)}/route`,{method:'POST',body:'{}'})}
export function replyToConversation(conversationId:string,body:string,draftMessageId?:string){return request<{message:ApiConversationMessage;duplicate:boolean;action?:ApiConversationDetail['actions'][number]}>(`/v1/conversations/${encodeURIComponent(conversationId)}/replies`,{method:'POST',body:JSON.stringify({body,purpose:'transactional',...(draftMessageId?{draftMessageId}:{})})})}
export function prepareConversationBookingAction(conversationId:string,input:{actionType:'cancel_appointment';bookingId:string;reason:string}|{actionType:'reschedule_appointment';bookingId:string;startsAt:string;staffId:string}){return request<{action:ApiConversationDetail['actions'][number];draft:ApiConversationMessage}>(`/v1/conversations/${encodeURIComponent(conversationId)}/booking-actions`,{method:'POST',body:JSON.stringify(input)})}

export function loadClients() { return request<{ clients: ApiClientProfile[] }>('/v1/clients') }
export function loadRevenueAttribution() { return request<{ records: ApiRevenueAttribution[] }>('/v1/revenue-attribution') }
export function loadExperiments() { return request<{ experiments: ApiControlledExperiment[] }>('/v1/experiments') }
export function createExperiment(input: ApiControlledExperimentInput) { return request<ApiControlledExperiment>('/v1/experiments', { method: 'POST', body: JSON.stringify(input) }) }
export function activateExperiment(id: string) { return request<ApiControlledExperiment>(`/v1/experiments/${encodeURIComponent(id)}/activate`, { method: 'POST', body: '{}' }) }
export function pauseExperiment(id: string) { return request<ApiControlledExperiment>(`/v1/experiments/${encodeURIComponent(id)}/pause`, { method: 'POST', body: '{}' }) }
export function completeExperiment(id: string) { return request<ApiControlledExperiment>(`/v1/experiments/${encodeURIComponent(id)}/complete`, { method: 'POST', body: '{}' }) }
export function loadExperimentResults(id: string) { return request<ApiControlledExperimentResult>(`/v1/experiments/${encodeURIComponent(id)}/results`) }
export function loadMonthlyOwnerReviews(limit = 12) { return request<{ snapshots: ApiMonthlyOwnerReviewSnapshot[] }>(`/v1/reports/monthly-owner-review/snapshots?${new URLSearchParams({ limit: String(limit) })}`) }
export function generateMonthlyOwnerReview(from: string, to: string) { return request<ApiMonthlyOwnerReviewSnapshot>('/v1/reports/monthly-owner-review', { method: 'POST', body: JSON.stringify({ from, to }) }) }
export function loadWeeklyReports() { return request<{ reports: ApiWeeklyReportSnapshot[] }>('/v1/reports/weekly/snapshots') }
export function scheduleWeeklyReports(firstRunAt: string, recipientEmail: string) { return request<{ jobId: string; runAt: string; recipientEmail: string }>('/v1/reports/weekly/schedule', { method: 'POST', body: JSON.stringify({ firstRunAt, recipientEmail }) }) }
export function loadProviderCircuits() { return request<{ circuits: ApiProviderCircuit[] }>('/v1/operations/provider-circuits') }
export function loadTenantHealth() { return request<ApiTenantHealth>('/v1/operations/health') }
export function loadLocationSettings() { return request<{ settings: ApiLocationSettings | null }>('/v1/location-settings') }
export function saveLocationSettings(settings: Omit<ApiLocationSettings, 'updatedAt'>) {
  return request<ApiLocationSettings>('/v1/location-settings', { method: 'PUT', body: JSON.stringify(settings) })
}

export async function decideApproval(id: string, decision: 'approved' | 'rejected') {
  return request<ApiApprovalRequest & { replayed: boolean }>(`/v1/approval-requests/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, note: `${decision === 'approved' ? 'Approved' : 'Rejected'} from the operations dashboard.` }),
  })
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const accessToken = await getOperationsAccessToken()
  if (!accessToken) throw new Error('Your dashboard session has expired. Sign in again to continue.')
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...init.headers },
    })
    const payload = await response.json().catch(() => ({})) as { message?: string }
    if (response.status === 401) await invalidateOperationsSession()
    if (!response.ok) throw new Error(payload.message ?? `Operations API returned ${response.status}`)
    return payload as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('The operations API did not respond within eight seconds.')
    throw error
  } finally { window.clearTimeout(timeout) }
}
