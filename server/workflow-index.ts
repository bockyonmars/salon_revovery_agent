import { createStore } from './repositories/create-store.js'
import { TwilioMessagingProvider } from './integrations/twilio-messaging.js'
import { AuditService } from './services/audit-service.js'
import { ConsentService } from './services/consent-service.js'
import { EventService } from './services/event-service.js'
import { MessageService } from './services/message-service.js'
import { CoreWorkflowHandler } from './services/core-workflow-handler.js'
import { WorkflowEngine } from './services/workflow-engine.js'
import { WaitlistService } from './services/waitlist-service.js'
import { RecoveryService } from './services/recovery-service.js'
import { RecoveryCampaignService } from './services/recovery-campaign-service.js'
import { RevenueReportService } from './services/revenue-report-service.js'
import { WeeklyReportWorkflowService } from './services/weekly-report-workflow-service.js'
import { PostmarkEmailProvider } from './integrations/postmark-email.js'
import { BillingPolicyService, BillingPolicyWorkflowHandler } from './services/billing-policy-service.js'
import { OnboardingPolicyService, OnboardingPolicyWorkflowHandler } from './services/onboarding-service.js'
import { ConversationService } from './services/conversation-service.js'
import { OpenAIConversationAgent } from './services/openai-conversation-agent.js'
import { BookingToolService } from './services/booking-tool-service.js'
import { OpenAIBookingAgent } from './services/openai-booking-agent.js'
import { BookingService } from './services/booking-service.js'
import { SquareBookingGateway } from './services/square-booking-gateway.js'
import { SquareTokenService } from './services/square-token-service.js'
import { CredentialCipher } from './security/credential-cipher.js'
import { ConversationConfirmationService } from './services/conversation-confirmation-service.js'
import { AbandonedEnquiryService } from './services/abandoned-enquiry-service.js'
import { MissedCallRecoveryService } from './services/missed-call-recovery-service.js'
import { ReviewRequestService } from './services/review-request-service.js'
import { ProviderCircuitBreakerService } from './services/provider-circuit-breaker-service.js'
import { ControlledExperimentService } from './services/controlled-experiment-service.js'
import { ModelUsageService } from './services/model-usage-service.js'
import { createWorkerHealthServer, type WorkerHealthState } from './worker-health.js'
import { OperationalTelemetry } from './operational-telemetry.js'

const store=createStore();const audit=new AuditService(store);const events=new EventService(store);const consent=new ConsentService(store,audit);const providerCircuits=new ProviderCircuitBreakerService(store);const modelUsage=new ModelUsageService(store,audit)
const telemetry=new OperationalTelemetry('salon-recovery-workflow-worker')
const twilioCredentialsConfigured=Boolean(process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN);const smsFrom=process.env.TWILIO_FROM_NUMBER;const whatsappFrom=process.env.TWILIO_WHATSAPP_FROM_NUMBER
const provider=twilioCredentialsConfigured&&(smsFrom||whatsappFrom)?new TwilioMessagingProvider({accountSid:process.env.TWILIO_ACCOUNT_SID!,authToken:process.env.TWILIO_AUTH_TOKEN!,...(smsFrom?{smsFrom}:{}),...(whatsappFrom?{whatsappFrom}:{})}):undefined
const messages=new MessageService(provider,consent,events,audit,store,providerCircuits);const waitlist=new WaitlistService(store,consent,messages,events)
const recovery=new RecoveryService(store,events);const experiments=new ControlledExperimentService(store);const campaigns=new RecoveryCampaignService(store,messages,events,recovery,undefined,experiments)
const email=process.env.POSTMARK_SERVER_TOKEN&&process.env.POSTMARK_FROM_EMAIL?new PostmarkEmailProvider(process.env.POSTMARK_SERVER_TOKEN,process.env.POSTMARK_FROM_EMAIL):undefined
const weeklyReports=new WeeklyReportWorkflowService(store,new RevenueReportService(store),email,providerCircuits)
const billingPolicy=new BillingPolicyService(store,process.env.BILLING_ENFORCEMENT_ENABLED==='true'||process.env.NODE_ENV==='production')
const onboardingPolicy=new OnboardingPolicyService(store,process.env.ONBOARDING_ENFORCEMENT_ENABLED==='true'||process.env.NODE_ENV==='production')
const squareEnvironment=process.env.SQUARE_ENVIRONMENT==='production'?'production':'sandbox';const credentialCipher=new CredentialCipher();const tokenConfig=process.env.SQUARE_APPLICATION_ID&&process.env.SQUARE_APPLICATION_SECRET?{applicationId:process.env.SQUARE_APPLICATION_ID,applicationSecret:process.env.SQUARE_APPLICATION_SECRET,environment:squareEnvironment as 'production'|'sandbox'}:undefined
const squareTokens=new SquareTokenService(store,credentialCipher,tokenConfig,undefined,providerCircuits);const squareBooking=new SquareBookingGateway(store,credentialCipher,squareEnvironment,undefined,squareTokens,providerCircuits);const bookings=new BookingService(store,events,audit,squareBooking)
const conversationAgent=process.env.OPENAI_API_KEY?new OpenAIConversationAgent(process.env.OPENAI_API_KEY,process.env.MODEL_CONCIERGE??'gpt-5.6-terra',providerCircuits,modelUsage):undefined
const requireAutomation=async(context:import('./domain/schemas.js').TenantContext)=>{await onboardingPolicy.requireAutomation(context);await billingPolicy.requireAutomation(context)}
const bookingTools=new BookingToolService(store,bookings,squareBooking,audit,requireAutomation);const bookingSpecialist=process.env.OPENAI_API_KEY?new OpenAIBookingAgent(process.env.OPENAI_API_KEY,bookingTools,process.env.MODEL_CONCIERGE??'gpt-5.6-terra',undefined,providerCircuits,modelUsage):undefined
const confirmations=new ConversationConfirmationService(store,bookings,events,audit,requireAutomation);const conversations=new ConversationService(store,events,audit,consent,messages,conversationAgent,bookingSpecialist,confirmations)
const abandonedEnquiries=new AbandonedEnquiryService(store,messages,events,audit)
const missedCalls=new MissedCallRecoveryService(store,messages,events,audit)
const reviews=new ReviewRequestService(store,consent,messages,events,audit)
const coreHandler=new CoreWorkflowHandler(messages,events,waitlist,recovery,campaigns,store,weeklyReports,conversations,abandonedEnquiries,missedCalls,reviews)
const engine=new WorkflowEngine(store,new OnboardingPolicyWorkflowHandler(onboardingPolicy,new BillingPolicyWorkflowHandler(billingPolicy,coreHandler)),process.env.WORKER_ID)
const healthState:WorkerHealthState={shuttingDown:false};const stallAfterMs=boundedNumber(process.env.WORKER_STALL_MS,120_000,10_000,900_000);const healthPort=boundedNumber(process.env.WORKER_HEALTH_PORT,4300,1,65535);const healthServer=createWorkerHealthServer(store,healthState,stallAfterMs);healthServer.on('error',(error)=>{telemetry.error('health_listener.failed',error);process.exitCode=1});healthServer.listen(healthPort,process.env.WORKER_HEALTH_HOST??'127.0.0.1',()=>telemetry.emit('service.started','info',{port:healthPort}))
let running=false;let tickIdleResolve:(()=>void)|undefined;const tick=async()=>{if(running||healthState.shuttingDown)return;running=true;healthState.tickStartedAt=Date.now();try{await engine.tick(Number(process.env.WORKER_BATCH_SIZE??20))}catch(error){telemetry.error('workflow.tick_failed',error)}finally{healthState.tickCompletedAt=Date.now();running=false;tickIdleResolve?.();tickIdleResolve=undefined}}
const timer=setInterval(tick,Number(process.env.WORKER_POLL_MS??1000));void tick()
let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;telemetry.emit('service.stopping');healthState.shuttingDown=true;clearInterval(timer);await new Promise<void>(resolve=>healthServer.close(()=>resolve()));await waitForTick(boundedNumber(process.env.WORKER_SHUTDOWN_GRACE_MS,25_000,1_000,120_000));await store.close?.();telemetry.emit('service.stopped');process.exit(0)};process.once('SIGINT',stop);process.once('SIGTERM',stop)

function boundedNumber(value:string|undefined,fallback:number,minimum:number,maximum:number){const parsed=value===undefined?fallback:Number(value);return Number.isInteger(parsed)&&parsed>=minimum&&parsed<=maximum?parsed:fallback}
async function waitForTick(timeoutMs:number){if(!running)return;await new Promise<void>(resolve=>{const timeout=setTimeout(resolve,timeoutMs);tickIdleResolve=()=>{clearTimeout(timeout);resolve()}})}
