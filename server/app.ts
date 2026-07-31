import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { resolveSession, type SessionResolver } from './auth/session.js'
import { DomainError } from './domain/errors.js'
import { AgencyGrantRevokeSchema, ApprovalDecisionSchema, AvailabilitySearchInputSchema, BillingCheckoutInputSchema, BookAppointmentInputSchema, ClientCohortHistoryQuerySchema, ClientDataExportInputSchema, ClientProfileInputSchema, ConsentInputSchema, ControlledExperimentInputSchema, ConversationBookingActionInputSchema, ConversationIntakeSchema, ConversationReplySchema, EventInputSchema, HoldInputSchema, LocationSettingsInputSchema, MessagePermissionInputSchema, MonthlyOwnerReviewHistoryQuerySchema, PrivacyErasureExecuteSchema, PrivacyErasureRequestInputSchema, PrivacyLegalHoldInputSchema, PrivacyLegalHoldReleaseSchema, PrivacyRetentionPolicyInputSchema, ProviderCircuitResetSchema, ProviderNameSchema, ProviderReconciliationHistoryQuerySchema, ProviderReconciliationInputSchema, PublicRecoveryReviewInputSchema, SecurityIncidentHistoryQuerySchema, SecurityIncidentIdSchema, SendMessageInputSchema, SupportKnowledgeArticleInputSchema, SupportKnowledgeSearchSchema, TenantPortfolioQuerySchema, TwilioChannelRouteInputSchema, VoiceReadinessAttestationSchema, VoiceReleaseEvidenceInputSchema, WaitlistEntryInputSchema, WaitlistOfferResponseSchema, WeeklyReportQuerySchema, WeeklyReportScheduleSchema, type TenantContext, type WorkflowJob } from './domain/schemas.js'
import { MemoryStore } from './repositories/memory-store.js'
import type { Store } from './repositories/store.js'
import { AuditService } from './services/audit-service.js'
import { BookingService } from './services/booking-service.js'
import { ConsentService } from './services/consent-service.js'
import { EventService } from './services/event-service.js'
import { TwilioMessagingProvider } from './integrations/twilio-messaging.js'
import { MessageService } from './services/message-service.js'
import { CredentialCipher } from './security/credential-cipher.js'
import { SquareOAuthService } from './services/square-oauth-service.js'
import { SquareSyncService } from './services/square-sync-service.js'
import { SquareBookingGateway } from './services/square-booking-gateway.js'
import { SquareTokenService } from './services/square-token-service.js'
import { WaitlistService } from './services/waitlist-service.js'
import { RevenueReportService } from './services/revenue-report-service.js'
import { TenantHealthService } from './services/tenant-health-service.js'
import { BillingService } from './services/billing-service.js'
import { BillingPolicyService } from './services/billing-policy-service.js'
import { OnboardingPolicyService, OnboardingService } from './services/onboarding-service.js'
import { ConversationService } from './services/conversation-service.js'
import { OpenAIConversationAgent } from './services/openai-conversation-agent.js'
import { BookingToolService } from './services/booking-tool-service.js'
import { OpenAIBookingAgent } from './services/openai-booking-agent.js'
import { ConversationConfirmationService } from './services/conversation-confirmation-service.js'
import { ConversationBookingActionService } from './services/conversation-booking-action-service.js'
import { TenantRateLimitService, tenantRateLimitPolicy, type TenantRateLimitPolicy } from './services/tenant-rate-limit-service.js'
import { PrivacyDataExportService } from './services/privacy-data-export-service.js'
import { canonicalJson } from './security/canonical-json.js'
import { PrivacyRetentionService } from './services/privacy-retention-service.js'
import { ProviderCircuitBreakerService } from './services/provider-circuit-breaker-service.js'
import { ProviderReconciliationService, type ProviderReconciliationInspectors } from './services/provider-reconciliation-service.js'
import { SupportKnowledgeService } from './services/support-knowledge-service.js'
import { RecoveryReviewService } from './services/recovery-review-service.js'
import { ControlledExperimentService } from './services/controlled-experiment-service.js'
import { TenantPortfolioService } from './services/tenant-portfolio-service.js'
import { AgencyAccessService } from './services/agency-access-service.js'
import { MessagingReliabilityService } from './services/messaging-reliability-service.js'
import { VoiceReadinessService } from './services/voice-readiness-service.js'
import { VoiceReleaseService } from './services/voice-release-service.js'
import { MonthlyOwnerReviewService } from './services/monthly-owner-review-service.js'
import { ModelUsageService } from './services/model-usage-service.js'
import { ClientCohortService } from './services/client-cohort-service.js'
import { SecurityIncidentService } from './services/security-incident-service.js'
import { PublicBotProtectionService, type PublicBotVerifier } from './services/public-bot-protection-service.js'
import { PublicRateLimitService } from './services/public-rate-limit-service.js'
import { OperationalTelemetry, operationalRequestId, registerRequestTelemetry, type OperationalLogSink } from './operational-telemetry.js'

export function createApp(store: Store = new MemoryStore(), options: { sessionResolver?: SessionResolver;rateLimit?:Partial<TenantRateLimitPolicy>;reconciliationInspectors?:ProviderReconciliationInspectors;publicBotVerifier?:PublicBotVerifier;telemetrySink?:OperationalLogSink;trustedProxyHops?:number } = {}) {
  const app = Fastify({ logger: false, trustProxy:trustedProxyPolicy(options.trustedProxyHops),genReqId: request => operationalRequestId(request.headers['x-request-id']) })
  registerRequestTelemetry(app,new OperationalTelemetry('salon-recovery-api',options.telemetrySink,Boolean(options.telemetrySink)||undefined))
  const audit = new AuditService(store)
  const privacyExports = new PrivacyDataExportService(store,audit)
  const privacyRetention = new PrivacyRetentionService(store,audit)
  const events = new EventService(store)
  const consent = new ConsentService(store, audit)
  const providerCircuits=new ProviderCircuitBreakerService(store)
  const modelUsage=new ModelUsageService(store,audit)
  const squareEnvironment: 'production' | 'sandbox' = process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox'
  const credentialCipher = new CredentialCipher()
  const tokenConfig = process.env.SQUARE_APPLICATION_ID && process.env.SQUARE_APPLICATION_SECRET ? { applicationId: process.env.SQUARE_APPLICATION_ID, applicationSecret: process.env.SQUARE_APPLICATION_SECRET, environment: squareEnvironment } : undefined
  const squareTokens = new SquareTokenService(store, credentialCipher, tokenConfig,undefined,providerCircuits)
  const squareBooking = new SquareBookingGateway(store, credentialCipher, squareEnvironment, undefined, squareTokens,providerCircuits)
  const bookings = new BookingService(store, events, audit, squareBooking)
  const twilioCredentialsConfigured=Boolean(process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN)
  const smsMessagingConfigured=Boolean(twilioCredentialsConfigured&&process.env.TWILIO_FROM_NUMBER)
  const whatsappMessagingConfigured=Boolean(twilioCredentialsConfigured&&process.env.TWILIO_WHATSAPP_FROM_NUMBER)
  const provider = twilioCredentialsConfigured&&(smsMessagingConfigured||whatsappMessagingConfigured) ? new TwilioMessagingProvider({ accountSid: process.env.TWILIO_ACCOUNT_SID!, authToken: process.env.TWILIO_AUTH_TOKEN!, ...(process.env.TWILIO_FROM_NUMBER?{smsFrom:process.env.TWILIO_FROM_NUMBER}:{}), ...(process.env.TWILIO_WHATSAPP_FROM_NUMBER?{whatsappFrom:process.env.TWILIO_WHATSAPP_FROM_NUMBER}:{}) }) : undefined
  const reconciliationInspectors:ProviderReconciliationInspectors={square:options.reconciliationInspectors?.square??squareBooking,...((options.reconciliationInspectors?.twilio??provider)?{twilio:(options.reconciliationInspectors?.twilio??provider)!}:{})};const providerReconciliation=new ProviderReconciliationService(store,audit,events,reconciliationInspectors,providerCircuits)
  const messages = new MessageService(provider, consent, events, audit,store,providerCircuits)
  const conversationAgent=process.env.OPENAI_API_KEY?new OpenAIConversationAgent(process.env.OPENAI_API_KEY,process.env.MODEL_CONCIERGE??'gpt-5.6-terra',providerCircuits,modelUsage):undefined
  const waitlist = new WaitlistService(store,consent,messages,events)
  const reports = new RevenueReportService(store)
  const portfolioReports=new TenantPortfolioService(store,audit)
  const agencyAccess=new AgencyAccessService(store,audit)
  const messagingReliability=new MessagingReliabilityService(store,audit)
  const directVoiceConfigured=Boolean(process.env.TWILIO_AUTH_TOKEN&&process.env.TWILIO_VOICE_INBOUND_WEBHOOK_URL)
  const realtimeVoiceConfigured=Boolean(process.env.OPENAI_REALTIME_SIP_ENABLED==='true'&&process.env.OPENAI_API_KEY&&process.env.OPENAI_WEBHOOK_SECRET)
  const voiceReadiness=new VoiceReadinessService(store,()=>new Date(),directVoiceConfigured)
  const voiceRelease=new VoiceReleaseService(store,process.env.OPENAI_REALTIME_MODEL?.trim()||'gpt-realtime-2.1',realtimeVoiceConfigured)
  const monthlyOwnerReviews=new MonthlyOwnerReviewService(store,audit)
  const clientCohorts=new ClientCohortService(store,audit)
  const securityIncidents=new SecurityIncidentService(store,audit,events)
  const rateLimitPolicy=tenantRateLimitPolicy(options.rateLimit);const rateLimits=new TenantRateLimitService(store,rateLimitPolicy)
  const tenantHealth = new TenantHealthService(store,{messagingConfigured:smsMessagingConfigured||whatsappMessagingConfigured,smsMessagingConfigured,whatsappMessagingConfigured,reportEmailConfigured:Boolean(process.env.POSTMARK_SERVER_TOKEN&&process.env.POSTMARK_FROM_EMAIL),billingConfigured:Boolean(process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_PRICE_ID),rateLimitingConfigured:rateLimitPolicy.enabled,outboxLagLimitMs:boundedEnvironmentNumber(process.env.OPERATIONS_OUTBOX_LAG_MS,300_000,30_000,3_600_000),outboxBacklogLimit:boundedEnvironmentNumber(process.env.OPERATIONS_OUTBOX_BACKLOG_LIMIT,100,10,100_000),workflowLagLimitMs:boundedEnvironmentNumber(process.env.OPERATIONS_WORKFLOW_LAG_MS,300_000,30_000,3_600_000),workflowDueLimit:boundedEnvironmentNumber(process.env.OPERATIONS_WORKFLOW_DUE_LIMIT,500,10,100_000),workflowLeaseMs:boundedEnvironmentNumber(process.env.OPERATIONS_WORKFLOW_LEASE_MS,300_000,60_000,3_600_000),bookingMutationClaimStaleMs:boundedEnvironmentNumber(process.env.OPERATIONS_BOOKING_MUTATION_CLAIM_STALE_MS,600_000,60_000,3_600_000)})
  const billingConfig=process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_PRICE_ID&&process.env.BILLING_SUCCESS_URL&&process.env.BILLING_CANCEL_URL?{priceId:process.env.STRIPE_PRICE_ID,successUrl:process.env.BILLING_SUCCESS_URL,cancelUrl:process.env.BILLING_CANCEL_URL,trialDays:trialDays(process.env.BILLING_TRIAL_DAYS)}:undefined
  const billing=billingConfig?new BillingService(store,process.env.STRIPE_SECRET_KEY!,billingConfig,undefined,providerCircuits):undefined
  const billingPolicy=new BillingPolicyService(store,process.env.BILLING_ENFORCEMENT_ENABLED==='true'||process.env.NODE_ENV==='production')
  const onboarding=new OnboardingService(store,tenantHealth)
  const supportKnowledge=new SupportKnowledgeService(store,audit)
  const recoveryReviews=new RecoveryReviewService(store)
  const publicBotVerifier=options.publicBotVerifier??new PublicBotProtectionService()
  const experiments=new ControlledExperimentService(store,audit)
  const publicRateLimits=new PublicRateLimitService(store)
  const onboardingPolicy=new OnboardingPolicyService(store,process.env.ONBOARDING_ENFORCEMENT_ENABLED==='true'||process.env.NODE_ENV==='production')
  const requireAutomation=async(context:TenantContext)=>{await onboardingPolicy.requireAutomation(context);await billingPolicy.requireAutomation(context)}
  const bookingTools=new BookingToolService(store,bookings,squareBooking,audit,requireAutomation,supportKnowledge)
  const bookingSpecialist=process.env.OPENAI_API_KEY?new OpenAIBookingAgent(process.env.OPENAI_API_KEY,bookingTools,process.env.MODEL_CONCIERGE??'gpt-5.6-terra',undefined,providerCircuits,modelUsage):undefined
  const confirmations=new ConversationConfirmationService(store,bookings,events,audit,requireAutomation)
  const conversations=new ConversationService(store,events,audit,consent,messages,conversationAgent,bookingSpecialist,confirmations)
  const conversationBookingActions=new ConversationBookingActionService(store,bookings,audit)
  const squareOAuth = process.env.SQUARE_APPLICATION_ID && process.env.SQUARE_APPLICATION_SECRET && process.env.SQUARE_OAUTH_REDIRECT_URI ? new SquareOAuthService(store,credentialCipher,{applicationId:process.env.SQUARE_APPLICATION_ID,applicationSecret:process.env.SQUARE_APPLICATION_SECRET,redirectUri:process.env.SQUARE_OAUTH_REDIRECT_URI,environment:squareEnvironment},providerCircuits) : undefined
  const squareSync = new SquareSyncService(store, credentialCipher, audit, squareEnvironment, undefined, squareTokens,providerCircuits)

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) return reply.code(error.statusCode).send({ error: error.code, message: error.message })
    if (error instanceof ZodError) return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: error.issues })
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'The request could not be completed.' })
  })

  app.get('/health', async () => ({ status: 'ok', service: 'salon-recovery-api', time: new Date().toISOString() }))
  app.get('/livez', async () => ({ status: 'alive', service: 'salon-recovery-api' }))
  app.get('/readyz', async (_request,reply) => {try{await store.healthCheck();return{status:'ready',service:'salon-recovery-api'}}catch{return reply.code(503).send({status:'not_ready',service:'salon-recovery-api'})}})
  app.get('/oauth/square/callback', async (request, reply) => { if(!squareOAuth) throw new DomainError('Square OAuth is not configured','SQUARE_OAUTH_NOT_CONFIGURED',503); const query=request.query as {code?:string;state?:string;error?:string}; if(query.error) throw new DomainError(`Square authorization failed: ${query.error}`,'SQUARE_OAUTH_DENIED',400); if(!query.code||!query.state) throw new DomainError('OAuth code and state are required','INVALID_OAUTH_CALLBACK',400); const account=await squareOAuth.complete(query.code,query.state); return reply.send({connected:true,provider:'square',merchantId:account.externalId}) })
  app.post('/public/recovery-reviews',async(request,reply)=>{const limit=await publicRateLimits.consume('recovery_review',request.ip);const retryAfterSeconds=Math.max(1,Math.ceil((Date.parse(limit.windowEnd)-Date.now())/1000));if(!limit.allowed)return reply.header('cache-control','no-store').header('retry-after',String(retryAfterSeconds)).code(429).send({error:'RATE_LIMIT_EXCEEDED',message:'Too many recovery review requests; please try again later.'});const input=PublicRecoveryReviewInputSchema.parse(request.body);if(input.website)return reply.header('cache-control','no-store').code(202).send({accepted:true,referenceId:'received',duplicate:false});await publicBotVerifier.verify(input.botToken,request.ip);const result=await recoveryReviews.submit(input);return reply.header('cache-control','no-store').code(result.duplicate?200:201).send({accepted:true,referenceId:result.review.id,duplicate:result.duplicate,estimatedRecoveryMinor:result.review.estimatedRecoveryMinor,currency:result.review.currency})})

  app.register(async (api) => {
    api.addHook('preHandler', async (request,reply) => {request.tenantContext=await(options.sessionResolver??resolveSession)(request);if(!rateLimitPolicy.enabled||rateLimitExempt(request.url))return;const kind=['GET','HEAD','OPTIONS'].includes(request.method)?'read':'write';const result=await rateLimits.consume(request.tenantContext,kind);const resetSeconds=Math.max(1,Math.ceil((Date.parse(result.windowEnd)-Date.now())/1000));reply.headers({'ratelimit-limit':String(result.maxRequests),'ratelimit-remaining':String(result.remaining),'ratelimit-reset':String(resetSeconds),'x-ratelimit-limit':String(result.maxRequests),'x-ratelimit-remaining':String(result.remaining),'x-ratelimit-reset':String(Math.ceil(Date.parse(result.windowEnd)/1000))});if(!result.allowed)return reply.code(429).header('retry-after',String(resetSeconds)).send({error:'RATE_LIMIT_EXCEEDED',message:`Tenant ${kind} request limit exceeded; retry after the current window.`})})

    api.post('/events', async (request, reply) => {
      const result = await events.ingest(request.tenantContext, EventInputSchema.parse(request.body))
      return reply.code(result.duplicate ? 200 : 202).send(result)
    })
    api.get('/outbox', async (request) => ({ events: await store.getOutbox(request.tenantContext) }))
    api.post('/consents', async (request, reply) => reply.code(201).send(await consent.record(request.tenantContext, ConsentInputSchema.parse(request.body))))
    api.post('/messages/permission', async (request) => {
      const input = MessagePermissionInputSchema.parse(request.body)
      return await consent.permission(request.tenantContext, input.clientId, input.channel, input.purpose)
    })
    api.post('/messages', async (request, reply) => {await requireAutomation(request.tenantContext);return reply.code(202).send(await messages.send(request.tenantContext, SendMessageInputSchema.parse(request.body)))})
    api.get('/integrations/square/oauth/start', async (request) => { if(!squareOAuth) throw new DomainError('Square OAuth is not configured','SQUARE_OAUTH_NOT_CONFIGURED',503); return squareOAuth.begin(request.tenantContext) })
    api.post('/integrations/square/sync', async (request) => squareSync.sync(request.tenantContext))
    api.get('/services', async (request) => ({ services: await store.listServices(request.tenantContext) }))
    api.get('/staff', async (request) => ({ staff: await store.listStaff(request.tenantContext) }))
    api.post('/waitlist',async(request,reply)=>{await requireAutomation(request.tenantContext);return reply.code(201).send(await waitlist.join(request.tenantContext,WaitlistEntryInputSchema.parse(request.body)))})
    api.get('/waitlist',async(request)=>({entries:await store.listWaitlistEntries(request.tenantContext)}))
    api.post('/waitlist/offers/:offerId/respond',async(request)=>{const params=request.params as {offerId:string};const input=WaitlistOfferResponseSchema.parse(request.body);return waitlist.respond(request.tenantContext,params.offerId,input.accepted)})
    api.get('/revenue-attribution',async(request)=>({records:await store.listRevenueAttribution(request.tenantContext)}))
    api.get('/recovery-cases',async(request)=>({cases:await store.listRecoveryCases(request.tenantContext)}))
    api.get('/experiments',async(request,reply)=>{requireManagement(request.tenantContext);return reply.header('cache-control','no-store').send({experiments:await experiments.list(request.tenantContext)})})
    api.post('/experiments',async(request,reply)=>{requireManagement(request.tenantContext);return reply.header('cache-control','no-store').code(201).send(await experiments.create(request.tenantContext,ControlledExperimentInputSchema.parse(request.body)))})
    api.post('/experiments/:experimentId/activate',async(request,reply)=>{requireManagement(request.tenantContext);await requireAutomation(request.tenantContext);const{experimentId}=request.params as{experimentId:string};return reply.header('cache-control','no-store').send(await experiments.activate(request.tenantContext,experimentId))})
    api.post('/experiments/:experimentId/pause',async(request,reply)=>{requireManagement(request.tenantContext);const{experimentId}=request.params as{experimentId:string};return reply.header('cache-control','no-store').send(await experiments.pause(request.tenantContext,experimentId))})
    api.post('/experiments/:experimentId/complete',async(request,reply)=>{requireManagement(request.tenantContext);const{experimentId}=request.params as{experimentId:string};return reply.header('cache-control','no-store').send(await experiments.complete(request.tenantContext,experimentId))})
    api.get('/experiments/:experimentId/results',async(request,reply)=>{requireManagement(request.tenantContext);const{experimentId}=request.params as{experimentId:string};return reply.header('cache-control','no-store').send(await experiments.results(request.tenantContext,experimentId))})
    api.get('/missed-call-recoveries',async(request)=>{requireManagement(request.tenantContext);return{recoveries:await store.listMissedCallRecoveries(request.tenantContext)}})
    api.get('/review-requests',async(request)=>{requireManagement(request.tenantContext);return{requests:await store.listReviewRequests(request.tenantContext)}})
    api.get('/message-deliveries',async(request)=>{requireManagement(request.tenantContext);return{deliveries:await store.listOutboundMessageDeliveries(request.tenantContext)}})
    api.get('/reports/weekly',async(request)=>{const query=WeeklyReportQuerySchema.parse(request.query);return reports.weekly(request.tenantContext,query.from,query.to)})
    api.get('/reports/portfolio',async(request,reply)=>{requireOwner(request.tenantContext);const query=TenantPortfolioQuerySchema.parse(request.query);return reply.header('cache-control','no-store').send(await portfolioReports.report(request.tenantContext,query))})
    api.post('/reports/monthly-owner-review',async(request,reply)=>{requireOwner(request.tenantContext);const period=TenantPortfolioQuerySchema.parse(request.body);return reply.header('cache-control','no-store').code(201).send(await monthlyOwnerReviews.generate(request.tenantContext,period))})
    api.get('/reports/monthly-owner-review/snapshots',async(request,reply)=>{requireOwner(request.tenantContext);const query=MonthlyOwnerReviewHistoryQuerySchema.parse(request.query);return reply.header('cache-control','no-store').send({snapshots:await monthlyOwnerReviews.history(request.tenantContext,query.limit)})})
    api.post('/reports/client-cohorts',async(request,reply)=>{requireOwner(request.tenantContext);const period=TenantPortfolioQuerySchema.parse(request.body);return reply.header('cache-control','no-store').code(201).send(await clientCohorts.generate(request.tenantContext,period))})
    api.get('/reports/client-cohorts/snapshots',async(request,reply)=>{requireOwner(request.tenantContext);const query=ClientCohortHistoryQuerySchema.parse(request.query);return reply.header('cache-control','no-store').send({snapshots:await clientCohorts.history(request.tenantContext,query.limit)})})
    api.get('/operations/model-prices',async(request,reply)=>{requireOwner(request.tenantContext);return reply.header('cache-control','no-store').send({prices:await modelUsage.listPrices(request.tenantContext)})})
    api.post('/operations/model-prices',async(request,reply)=>{requireOwner(request.tenantContext);return reply.header('cache-control','no-store').code(201).send(await modelUsage.createPrice(request.tenantContext,request.body))})
    api.get('/agency/account',async(request,reply)=>reply.header('cache-control','no-store').send({account:await agencyAccess.account(request.tenantContext)}))
    api.put('/agency/account',async(request,reply)=>reply.header('cache-control','no-store').send(await agencyAccess.saveAccount(request.tenantContext,request.body)))
    api.post('/agency/invitations',async(request,reply)=>reply.header('cache-control','no-store').code(201).send(await agencyAccess.invite(request.tenantContext,request.body)))
    api.post('/agency/invitations/preview',async(request,reply)=>reply.header('cache-control','no-store').send(await agencyAccess.preview(request.tenantContext,request.body)))
    api.post('/agency/invitations/accept',async(request,reply)=>reply.header('cache-control','no-store').send(await agencyAccess.accept(request.tenantContext,request.body)))
    api.get('/agency/grants',async(request,reply)=>reply.header('cache-control','no-store').send({grants:await agencyAccess.grants(request.tenantContext)}))
    api.get('/agency/client-grants',async(request,reply)=>reply.header('cache-control','no-store').send({grants:await agencyAccess.clientGrants(request.tenantContext)}))
    api.post('/agency/grants/:grantId/revoke',async(request,reply)=>{const{grantId}=request.params as{grantId:string};const input=AgencyGrantRevokeSchema.parse(request.body);return reply.header('cache-control','no-store').send(await agencyAccess.revoke(request.tenantContext,grantId,input.reason))})
    api.get('/agency/clients/:clientTenantId/portfolio',async(request,reply)=>{const{clientTenantId}=request.params as{clientTenantId:string};const query=TenantPortfolioQuerySchema.parse(request.query);return reply.header('cache-control','no-store').send(await agencyAccess.portfolio(request.tenantContext,clientTenantId,query))})
    api.get('/reports/weekly/snapshots',async(request)=>({reports:await store.listWeeklyReports(request.tenantContext)}))
    api.post('/reports/weekly/schedule',async(request,reply)=>{requireManagement(request.tenantContext);await requireAutomation(request.tenantContext);const input=WeeklyReportScheduleSchema.parse(request.body);const current=await store.getLocationSettings(request.tenantContext);if(!current)throw new DomainError('Location settings must be configured before scheduling reports','LOCATION_SETTINGS_REQUIRED',409);const scheduledAt=new Date().toISOString();const job=weeklyReportJob(request.tenantContext,input.firstRunAt,scheduledAt);try{await store.scheduleWeeklyReportWithEvidence(request.tenantContext,{...current,reportRecipientEmail:input.recipientEmail,updatedAt:scheduledAt},job,{auditId:randomUUID(),userId:request.tenantContext.userId,occurredAt:scheduledAt})}catch(error){if(error instanceof Error&&error.message==='WEEKLY_REPORT_SCHEDULE_CONFLICT')throw new DomainError('A weekly report is already scheduled for this first run time','WEEKLY_REPORT_SCHEDULE_CONFLICT',409);throw error}return reply.code(201).send({jobId:job.id,runAt:job.runAt,recipientEmail:input.recipientEmail})})
    api.get('/location-settings',async(request)=>({settings:await store.getLocationSettings(request.tenantContext)}))
    api.put('/location-settings',async(request)=>{requireManagement(request.tenantContext);const input=LocationSettingsInputSchema.parse(request.body);const updatedAt=new Date().toISOString();const result=await store.saveLocationSettingsWithAudit(request.tenantContext,{...input,tenantId:request.tenantContext.tenantId,locationId:request.tenantContext.locationId,updatedAt},{auditId:randomUUID(),userId:request.tenantContext.userId,occurredAt:updatedAt});return result.settings})
    api.get('/support/knowledge',async(request,reply)=>{requireManagement(request.tenantContext);return reply.header('cache-control','no-store').send({articles:await supportKnowledge.list(request.tenantContext,true)})})
    api.put('/support/knowledge/:slug',async(request,reply)=>{requireManagement(request.tenantContext);const{slug}=request.params as{slug:string};const article=await supportKnowledge.publish(request.tenantContext,slug,SupportKnowledgeArticleInputSchema.parse(request.body));return reply.header('cache-control','no-store').send(article)})
    api.post('/support/knowledge/search',async(request,reply)=>{requireOperator(request.tenantContext);return reply.header('cache-control','no-store').send(await supportKnowledge.search(request.tenantContext,SupportKnowledgeSearchSchema.parse(request.body)))})
    api.get('/channel-routes/twilio',async(request)=>{requireManagement(request.tenantContext);return{route:(await store.getChannelRoute(request.tenantContext,'twilio'))??null}})
    api.put('/channel-routes/twilio',async(request)=>{requireManagement(request.tenantContext);const input=TwilioChannelRouteInputSchema.parse(request.body);const existing=await store.getChannelRoute(request.tenantContext,'twilio');const now=new Date().toISOString();try{return(await store.saveChannelRouteWithAudit(request.tenantContext,{id:existing?.id??randomUUID(),tenantId:request.tenantContext.tenantId,locationId:request.tenantContext.locationId,provider:'twilio',address:input.address,status:input.status,createdAt:existing?.createdAt??now,updatedAt:now},{auditId:randomUUID(),userId:request.tenantContext.userId,occurredAt:now})).route}catch(error){if(error instanceof Error&&error.message==='CHANNEL_ADDRESS_IN_USE')throw new DomainError('This Twilio destination is already assigned to another salon location','CHANNEL_ADDRESS_IN_USE',409);throw error}})
    api.get('/clients',async(request)=>({clients:await store.listClientProfiles(request.tenantContext)}))
    api.get('/clients/:clientId',async(request)=>{const {clientId}=request.params as {clientId:string};const profile=await store.getClientProfile(request.tenantContext,clientId);if(!profile)throw new DomainError('Client profile not found','CLIENT_NOT_FOUND',404);return profile})
    api.put('/clients/:clientId',async(request)=>{requireOperator(request.tenantContext);const {clientId}=request.params as {clientId:string};const input=ClientProfileInputSchema.parse({...request.body as object,clientId});const updatedAt=new Date().toISOString();return store.saveClientProfileWithAudit(request.tenantContext,{...input,tenantId:request.tenantContext.tenantId,locationId:request.tenantContext.locationId,updatedAt},{auditId:randomUUID(),userId:request.tenantContext.userId,occurredAt:updatedAt})})
    api.post('/privacy/clients/:clientId/export',async(request,reply)=>{requireManagement(request.tenantContext);const{clientId}=request.params as{clientId:string};const input=ClientDataExportInputSchema.parse(request.body);const result=await privacyExports.generate(request.tenantContext,clientId,input.reason);const safeClientId=clientId.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80);return reply.type('application/json; charset=utf-8').header('cache-control','no-store').header('pragma','no-cache').header('x-content-sha256',result.receipt.digest).header('content-disposition',`attachment; filename="client-data-${safeClientId}-${result.receipt.generatedAt.slice(0,10)}.json"`).send(canonicalJson(result.export))})
    api.get('/privacy/data-exports',async(request,reply)=>{requireManagement(request.tenantContext);return reply.header('cache-control','no-store').send({receipts:await store.listPrivacyDataExportReceipts(request.tenantContext)})})
    api.get('/privacy/retention-policy',async(request,reply)=>{requireManagement(request.tenantContext);return reply.header('cache-control','no-store').send({policy:(await store.getPrivacyRetentionPolicy(request.tenantContext))??null})})
    api.put('/privacy/retention-policy',async(request,reply)=>{requireOwner(request.tenantContext);const policy=await privacyRetention.savePolicy(request.tenantContext,PrivacyRetentionPolicyInputSchema.parse(request.body));return reply.header('cache-control','no-store').send(policy)})
    api.get('/privacy/legal-holds',async(request,reply)=>{requireManagement(request.tenantContext);return reply.header('cache-control','no-store').send({holds:await store.listPrivacyLegalHolds(request.tenantContext)})})
    api.post('/privacy/legal-holds',async(request,reply)=>{requireOwner(request.tenantContext);const hold=await privacyRetention.createLegalHold(request.tenantContext,PrivacyLegalHoldInputSchema.parse(request.body));return reply.header('cache-control','no-store').code(201).send(hold)})
    api.post('/privacy/legal-holds/:holdId/release',async(request,reply)=>{requireOwner(request.tenantContext);const{holdId}=request.params as{holdId:string};const input=PrivacyLegalHoldReleaseSchema.parse(request.body);return reply.header('cache-control','no-store').send(await privacyRetention.releaseLegalHold(request.tenantContext,holdId,input.note))})
    api.get('/privacy/clients/:clientId/retention-preview',async(request,reply)=>{requireManagement(request.tenantContext);const{clientId}=request.params as{clientId:string};return reply.header('cache-control','no-store').send(await privacyRetention.preview(request.tenantContext,clientId))})
    api.get('/privacy/erasure-requests',async(request,reply)=>{requireManagement(request.tenantContext);return reply.header('cache-control','no-store').send({requests:await store.listPrivacyErasureRequests(request.tenantContext)})})
    api.post('/privacy/erasure-requests',async(request,reply)=>{requireManagement(request.tenantContext);const input=PrivacyErasureRequestInputSchema.parse(request.body);return reply.header('cache-control','no-store').code(201).send(await privacyRetention.requestErasure(request.tenantContext,input.clientId,input.reason))})
    api.post('/privacy/erasure-requests/:requestId/execute',async(request,reply)=>{requireOwner(request.tenantContext);const{requestId}=request.params as{requestId:string};const input=PrivacyErasureExecuteSchema.parse(request.body);return reply.header('cache-control','no-store').send(await privacyRetention.executeErasure(request.tenantContext,requestId,input.note))})
    api.get('/conversations',async(request)=>{requireOperator(request.tenantContext);return{conversations:await conversations.list(request.tenantContext)}})
    api.post('/conversations/intake',async(request,reply)=>{requireOperator(request.tenantContext);const result=await conversations.intake(request.tenantContext,ConversationIntakeSchema.parse(request.body));return reply.code(result.duplicate?200:201).send(result)})
    api.get('/conversations/:conversationId',async(request)=>{requireOperator(request.tenantContext);const{conversationId}=request.params as{conversationId:string};return conversations.detail(request.tenantContext,conversationId)})
    api.post('/conversations/:conversationId/route',async(request)=>{requireOperator(request.tenantContext);const{conversationId}=request.params as{conversationId:string};const body=request.body as{messageId?:string}|undefined;return conversations.run(request.tenantContext,conversationId,body?.messageId)})
    api.post('/conversations/:conversationId/replies',async(request,reply)=>{requireOperator(request.tenantContext);const{conversationId}=request.params as{conversationId:string};const input=ConversationReplySchema.parse(request.body);const pending=await store.getActiveConversationAction(request.tenantContext,conversationId);const existingCustomerMutation=pending?.status==='prepared'&&pending.draftMessageId===input.draftMessageId&&pending.actionType!=='book_appointment';if(!existingCustomerMutation)await requireAutomation(request.tenantContext);return reply.code(202).send(await conversations.reply(request.tenantContext,conversationId,input))})
    api.post('/conversations/:conversationId/booking-actions',async(request,reply)=>{requireOperator(request.tenantContext);const{conversationId}=request.params as{conversationId:string};return reply.code(201).send(await conversationBookingActions.prepare(request.tenantContext,conversationId,ConversationBookingActionInputSchema.parse(request.body)))})
    api.get('/approval-requests',async(request)=>{requireManagement(request.tenantContext);return{requests:await store.listApprovalRequests(request.tenantContext)}})
    api.post('/approval-requests/:requestId/decision',async(request)=>{requireManagement(request.tenantContext);const {requestId}=request.params as {requestId:string};const input=ApprovalDecisionSchema.parse(request.body);const pending=(await store.listApprovalRequests(request.tenantContext)).find(value=>value.id===requestId&&value.status==='pending');if(!pending)throw new DomainError('Pending approval request not found','APPROVAL_NOT_FOUND',404);const replayed=input.decision==='approved'&&pending.entityType==='workflow_job';const decidedAt=new Date().toISOString();const result=await store.decideApprovalRequest(request.tenantContext,requestId,input.decision,request.tenantContext.userId,input.note,{eventId:randomUUID(),decidedAt,audit:{id:randomUUID(),tenantId:request.tenantContext.tenantId,locationId:request.tenantContext.locationId,userId:request.tenantContext.userId,action:'approval.decided',entityType:'approval_request',entityId:requestId,reason:'Manager recorded an approval decision',input:{decision:input.decision,note:'[REDACTED]'},result:{status:input.decision,replayed},occurredAt:decidedAt}});if(!result)throw new DomainError('The approved action is no longer safe to replay','APPROVAL_NOT_ACTIONABLE',409);return{...result,replayed}})
    api.get('/operations/workflow-dead-letters',async(request,reply)=>{requireManagement(request.tenantContext);return reply.header('cache-control','no-store').send({deadLetters:await store.listWorkflowDeadLetters(request.tenantContext)})})
    api.get('/operations/health',async(request)=>{requireManagement(request.tenantContext);return tenantHealth.inspect(request.tenantContext)})
    api.get('/operations/booking-mutation-claims',async(request,reply)=>{requireManagement(request.tenantContext);return reply.header('cache-control','no-store').send(await tenantHealth.bookingMutationClaims(request.tenantContext))})
    api.get('/operations/messaging-reliability',async(request,reply)=>reply.header('cache-control','no-store').send(await messagingReliability.latest(request.tenantContext)))
    api.post('/operations/messaging-reliability/evaluate',async(request,reply)=>reply.header('cache-control','no-store').code(201).send(await messagingReliability.evaluate(request.tenantContext)))
    api.get('/operations/voice-readiness',async(request,reply)=>reply.header('cache-control','no-store').send(await voiceReadiness.status(request.tenantContext)))
    api.post('/operations/voice-readiness/attest',async(request,reply)=>reply.header('cache-control','no-store').code(201).send(await voiceReadiness.attest(request.tenantContext,VoiceReadinessAttestationSchema.parse(request.body))))
    api.get('/operations/voice-release',async(request,reply)=>reply.header('cache-control','no-store').send(await voiceRelease.status(request.tenantContext)))
    api.post('/operations/voice-release/evidence',async(request,reply)=>reply.header('cache-control','no-store').code(201).send(await voiceRelease.attestEvidence(request.tenantContext,VoiceReleaseEvidenceInputSchema.parse(request.body))))
    api.post('/operations/voice-release/activate',async(request,reply)=>reply.header('cache-control','no-store').code(201).send(await voiceRelease.activate(request.tenantContext)))
    api.get('/operations/provider-circuits',async(request,reply)=>{requireManagement(request.tenantContext);return reply.header('cache-control','no-store').send({circuits:await providerCircuits.list(request.tenantContext)})})
    api.post('/operations/provider-circuits/:provider/reset',async(request,reply)=>{requireOwner(request.tenantContext);const{provider}=request.params as{provider:string};const name=ProviderNameSchema.parse(provider);const input=ProviderCircuitResetSchema.parse(request.body);return reply.header('cache-control','no-store').send(await providerCircuits.reset(request.tenantContext,name,input.reason))})
    api.get('/operations/reconciliation-runs',async(request,reply)=>{requireManagement(request.tenantContext);const query=ProviderReconciliationHistoryQuerySchema.parse(request.query);return reply.header('cache-control','no-store').send({runs:await providerReconciliation.history(request.tenantContext,query.limit)})})
    api.post('/operations/reconciliation-runs',async(request,reply)=>{requireManagement(request.tenantContext);const input=ProviderReconciliationInputSchema.parse(request.body??{});return reply.header('cache-control','no-store').code(201).send(await providerReconciliation.run(request.tenantContext,input))})
    api.get('/operations/security-incidents',async(request,reply)=>{requireManagement(request.tenantContext);const query=SecurityIncidentHistoryQuerySchema.parse(request.query);return reply.header('cache-control','no-store').send({incidents:await securityIncidents.history(request.tenantContext,query)})})
    api.post('/operations/security-incidents',async(request,reply)=>{requireManagement(request.tenantContext);return reply.header('cache-control','no-store').code(201).send(await securityIncidents.declare(request.tenantContext,request.body))})
    api.post('/operations/security-incidents/:incidentId/status',async(request,reply)=>{requireManagement(request.tenantContext);const{incidentId}=request.params as{incidentId:string};return reply.header('cache-control','no-store').send(await securityIncidents.transition(request.tenantContext,SecurityIncidentIdSchema.parse(incidentId),request.body))})
    api.get('/onboarding',async(request)=>{requireManagement(request.tenantContext);return onboarding.status(request.tenantContext)})
    api.post('/onboarding/simulations',async(request,reply)=>{requireManagement(request.tenantContext);return reply.code(201).send(await onboarding.run(request.tenantContext))})
    api.post('/onboarding/activate',async(request)=>{requireManagement(request.tenantContext);return onboarding.activate(request.tenantContext)})
    api.get('/billing',async(request)=>{requireManagement(request.tenantContext);if(billing)return{...await billing.status(request.tenantContext),checkoutConfigured:true};const account=await store.getBillingAccount(request.tenantContext);return{account,automationAccess:account?.status==='active'||account?.status==='trialing',checkoutConfigured:false}})
    api.post('/billing/checkout',async(request,reply)=>{requireManagement(request.tenantContext);if(!billing)throw new DomainError('Stripe Checkout is not configured','BILLING_NOT_CONFIGURED',503);const input=BillingCheckoutInputSchema.parse(request.body);const result=await billing.createCheckout(request.tenantContext,input.idempotencyKey);await audit.record(request.tenantContext,'billing.checkout_created','billing_account',request.tenantContext.locationId,'Manager initiated hosted subscription checkout',{idempotencyKey:input.idempotencyKey},{checkoutSessionId:result.checkoutSessionId,expiresAt:result.expiresAt});return reply.code(201).send(result)})
    api.post('/availability/search', async (request) => ({ slots: await squareBooking.searchAvailability(request.tenantContext, AvailabilitySearchInputSchema.parse(request.body)) }))
    api.post('/holds', async (request, reply) => {await requireAutomation(request.tenantContext);return reply.code(201).send(await bookings.createHold(request.tenantContext, HoldInputSchema.parse(request.body)))})
    api.post('/bookings', async (request, reply) => {
      const result = await bookings.book(request.tenantContext, BookAppointmentInputSchema.parse(request.body))
      return reply.code(result.duplicate ? 200 : 201).send(result)
    })
    api.post('/bookings/:bookingId/cancel',async()=>{throw new DomainError('Prepare cancellation through a verified conversation action','CUSTOMER_CONFIRMATION_REQUIRED',409)})
    api.post('/bookings/:bookingId/reschedule',async()=>{throw new DomainError('Prepare rescheduling through a verified conversation action','CUSTOMER_CONFIRMATION_REQUIRED',409)})
    api.get('/audit-log/verify',async(request)=>{requireManagement(request.tenantContext);return audit.verify(request.tenantContext)})
    api.get('/audit-log', async (request) => ({ records: await store.getAudit(request.tenantContext) }))
  }, { prefix: '/v1' })

  return app
}

function requireManagement(context:TenantContext){if(context.role!=='owner'&&context.role!=='manager')throw new DomainError('Owner or manager access is required','ROLE_FORBIDDEN',403)}
function requireOwner(context:TenantContext){if(context.role!=='owner')throw new DomainError('Owner access is required','ROLE_FORBIDDEN',403)}
function requireOperator(context:TenantContext){if(!['owner','manager','operator'].includes(context.role))throw new DomainError('Operator access is required','ROLE_FORBIDDEN',403)}
function weeklyReportJob(context:TenantContext,runAt:string,createdAt=new Date().toISOString()):WorkflowJob{return{id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,workflowType:'weekly_roi_report',correlationId:`weekly-report:${context.locationId}`,causationEventId:`manual:${context.userId}`,dedupeKey:`${context.tenantId}:${context.locationId}:weekly_roi_report:${runAt}`,runAt,status:'pending',attempts:0,maxAttempts:5,payload:{},createdAt,updatedAt:createdAt}}
function trialDays(value:string|undefined){const parsed=Number(value??14);return Number.isInteger(parsed)&&parsed>=0&&parsed<=730?parsed:14}
function rateLimitExempt(url:string){const path=url.split('?')[0]??url;return['/v1/consents','/v1/messages/permission','/v1/approval-requests','/v1/billing','/v1/onboarding','/v1/operations/health','/v1/operations/provider-circuits'].some(value=>path===value||path.startsWith(`${value}/`))}

function boundedEnvironmentNumber(value:string|undefined,fallback:number,minimum:number,maximum:number){const parsed=value===undefined?fallback:Number(value);return Number.isInteger(parsed)&&parsed>=minimum&&parsed<=maximum?parsed:fallback}
export function trustedProxyPolicy(override?:number){const configured=override??(process.env.PUBLIC_TRUST_PROXY_HOPS===undefined?undefined:Number(process.env.PUBLIC_TRUST_PROXY_HOPS));if(configured!==undefined&&(!Number.isInteger(configured)||configured<1||configured>3))throw new Error('PUBLIC_TRUST_PROXY_HOPS must be an integer from 1 to 3');return configured??(process.env.NODE_ENV==='production'?1:false)}
