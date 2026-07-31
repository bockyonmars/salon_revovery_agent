import { createHash, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import Stripe from 'stripe'
import { SquareBookingConnector } from '../integrations/square-connector.js'
import { TwilioMessagingProvider } from '../integrations/twilio-messaging.js'

export type SandboxSmokeStatus='passed'|'failed'
export type SandboxSmokeCheck={id:string;status:SandboxSmokeStatus;detail:string;code?:string;referenceHash?:string}
export type SandboxSmokeReport={status:SandboxSmokeStatus;startedAt:string;completedAt:string;checks:SandboxSmokeCheck[]}

export type SandboxSmokeConfig={
  databaseUrl:string
  tenantId:string
  locationId:string
  square:{accessToken:string;locationId:string;customerId:string;teamMemberId:string;serviceVariationId:string;serviceVariationVersion:bigint;durationMinutes:number;startAt:string;notificationUrl:string}
  twilio:{accountSid:string;authToken:string;channel:'sms'|'whatsapp';from:string;to:string;statusCallback:string}
  stripe:{secretKey:string;webhookSecret:string}
  webhookWaitSeconds:number
}

export class SandboxConfigurationError extends Error{
  constructor(readonly issues:string[]){super('Sandbox smoke configuration is incomplete or unsafe');this.name='SandboxConfigurationError'}
}

export function parseSandboxSmokeConfig(env:NodeJS.ProcessEnv):SandboxSmokeConfig{
  const issues:string[]=[]
  const required=(name:string)=>{const value=env[name]?.trim();if(!value)issues.push(`${name} is required`);return value??''}
  if(env.NODE_ENV==='production')issues.push('NODE_ENV must not be production for a sandbox smoke run')
  if((env.SQUARE_ENVIRONMENT??'sandbox')!=='sandbox')issues.push('SQUARE_ENVIRONMENT must be sandbox')
  if(env.SANDBOX_ALLOW_PROVIDER_MUTATIONS!=='true')issues.push('SANDBOX_ALLOW_PROVIDER_MUTATIONS must be true')

  const databaseUrl=required('DATABASE_URL')
  const tenantId=required('SANDBOX_TENANT_ID')
  const locationId=required('SANDBOX_LOCATION_ID')
  const squareAccessToken=required('SQUARE_ACCESS_TOKEN')
  const squareLocationId=required('SANDBOX_SQUARE_LOCATION_ID')
  const squareCustomerId=required('SANDBOX_SQUARE_CUSTOMER_ID')
  const squareTeamMemberId=required('SANDBOX_SQUARE_TEAM_MEMBER_ID')
  const squareServiceVariationId=required('SANDBOX_SQUARE_SERVICE_VARIATION_ID')
  const squareVersionRaw=required('SANDBOX_SQUARE_SERVICE_VARIATION_VERSION')
  const squareDurationRaw=required('SANDBOX_SQUARE_DURATION_MINUTES')
  const squareStartAt=required('SANDBOX_SQUARE_START_AT')
  const squareNotificationUrl=required('SQUARE_WEBHOOK_NOTIFICATION_URL')
  required('SQUARE_WEBHOOK_SIGNATURE_KEY')
  const twilioAccountSid=required('TWILIO_ACCOUNT_SID')
  const twilioAuthToken=required('TWILIO_AUTH_TOKEN')
  const twilioTo=required('SANDBOX_TWILIO_TO')
  const twilioChannel=twilioTo.startsWith('whatsapp:')?'whatsapp' as const:'sms' as const
  const twilioFromName=twilioChannel==='whatsapp'?'TWILIO_WHATSAPP_FROM_NUMBER':'TWILIO_FROM_NUMBER'
  const twilioFrom=required(twilioFromName)
  const twilioStatusCallback=required('TWILIO_STATUS_CALLBACK_URL')
  const stripeSecretKey=required('STRIPE_SECRET_KEY')
  const stripeWebhookSecret=required('STRIPE_WEBHOOK_SECRET')

  const serviceVariationVersion=squareVersionRaw?parseInteger(squareVersionRaw,'SANDBOX_SQUARE_SERVICE_VARIATION_VERSION',issues,0):0
  const durationMinutes=squareDurationRaw?parseInteger(squareDurationRaw,'SANDBOX_SQUARE_DURATION_MINUTES',issues,5,480):5
  const startAtMs=Date.parse(squareStartAt)
  if(squareStartAt&&!Number.isFinite(startAtMs))issues.push('SANDBOX_SQUARE_START_AT must be an RFC3339 timestamp')
  else if(startAtMs<=Date.now()+15*60_000)issues.push('SANDBOX_SQUARE_START_AT must be at least 15 minutes in the future')
  validatePublicHttps(squareNotificationUrl,'SQUARE_WEBHOOK_NOTIFICATION_URL',issues)
  validatePublicHttps(twilioStatusCallback,'TWILIO_STATUS_CALLBACK_URL',issues)
  if(twilioFrom&&!(twilioChannel==='whatsapp'?/^(?:whatsapp:)?\+[1-9]\d{7,14}$/:/^\+[1-9]\d{7,14}$/).test(twilioFrom))issues.push(`${twilioFromName} must be a valid ${twilioChannel==='whatsapp'?'WhatsApp':'SMS'} E.164 address`)
  if(twilioTo&&!/^(?:whatsapp:)?\+[1-9]\d{7,14}$/.test(twilioTo))issues.push('SANDBOX_TWILIO_TO must be an E.164 SMS or WhatsApp address')
  if(stripeSecretKey&&!stripeSecretKey.startsWith('sk_test_'))issues.push('STRIPE_SECRET_KEY must be a Stripe test-mode key')
  const webhookWaitSeconds=parseInteger(env.SANDBOX_WEBHOOK_WAIT_SECONDS??'30','SANDBOX_WEBHOOK_WAIT_SECONDS',issues,5,60)

  if(issues.length)throw new SandboxConfigurationError([...new Set(issues)])
  return{
    databaseUrl,
    tenantId,
    locationId,
    square:{accessToken:squareAccessToken,locationId:squareLocationId,customerId:squareCustomerId,teamMemberId:squareTeamMemberId,serviceVariationId:squareServiceVariationId,serviceVariationVersion:BigInt(serviceVariationVersion),durationMinutes,startAt:new Date(startAtMs).toISOString(),notificationUrl:squareNotificationUrl},
    twilio:{accountSid:twilioAccountSid,authToken:twilioAuthToken,channel:twilioChannel,from:twilioFrom,to:twilioTo,statusCallback:twilioStatusCallback},
    stripe:{secretKey:stripeSecretKey,webhookSecret:stripeWebhookSecret},
    webhookWaitSeconds,
  }
}

export async function runSandboxSmoke(config:SandboxSmokeConfig):Promise<SandboxSmokeReport>{
  const startedAt=new Date().toISOString()
  const checks:SandboxSmokeCheck[]=[]
  const square=new SquareBookingConnector({accessToken:config.square.accessToken,environment:'sandbox'})
  let squareBookingId:string|undefined
  let squareBookingVersion:number|undefined
  let squareCancelled=false
  try{
    const created=await square.createBooking({
      idempotencyKey:`sandbox-create-${randomUUID()}`,
      customerId:config.square.customerId,
      locationId:config.square.locationId,
      startAt:config.square.startAt,
      teamMemberId:config.square.teamMemberId,
      serviceVariationId:config.square.serviceVariationId,
      serviceVariationVersion:config.square.serviceVariationVersion,
      durationMinutes:config.square.durationMinutes,
    })
    if(!created.id||created.version===undefined)throw new Error('SQUARE_BOOKING_ID_OR_VERSION_MISSING')
    squareBookingId=created.id
    squareBookingVersion=created.version
    const retrieved=await square.retrieveBooking(created.id)
    if(retrieved.id!==created.id)throw new Error('SQUARE_BOOKING_RETRIEVAL_MISMATCH')
    const cancelled=await square.cancelBooking(created.id,retrieved.version??created.version,`sandbox-cancel-${randomUUID()}`)
    if(!cancelled.status?.startsWith('CANCELLED'))throw new Error('SQUARE_BOOKING_NOT_CANCELLED')
    squareCancelled=true
    checks.push({id:'square_create_retrieve_cancel',status:'passed',detail:'Sandbox booking was created, retrieved, and cancelled',referenceHash:hashReference(created.id)})
  }catch(error){
    checks.push({id:'square_create_retrieve_cancel',status:'failed',detail:'Square sandbox booking lifecycle failed',code:safeProviderCode(error)})
  }finally{
    if(squareBookingId&&squareBookingVersion!==undefined&&!squareCancelled){
      try{await square.cancelBooking(squareBookingId,squareBookingVersion,`sandbox-cleanup-${randomUUID()}`)}catch{
        checks.push({id:'square_cleanup',status:'failed',detail:'The sandbox booking could not be cancelled during cleanup',referenceHash:hashReference(squareBookingId)})
      }
    }
  }

  let twilioMessageId:string|undefined
  try{
    const channel=config.twilio.channel
    const twilio=new TwilioMessagingProvider({accountSid:config.twilio.accountSid,authToken:config.twilio.authToken,...(channel==='whatsapp'?{whatsappFrom:config.twilio.from}:{smsFrom:config.twilio.from})})
    const message=await twilio.send({channel,to:config.twilio.to,body:`Salon Recovery Agent sandbox verification ${randomUUID()}`,statusCallback:config.twilio.statusCallback})
    if(!message.id)throw new Error('TWILIO_MESSAGE_ID_MISSING')
    twilioMessageId=message.id
    checks.push({id:'twilio_send',status:'passed',detail:`Sandbox message was accepted with provider status ${boundedStatus(message.status)}`,referenceHash:hashReference(message.id)})
  }catch(error){checks.push({id:'twilio_send',status:'failed',detail:'Twilio sandbox message delivery request failed',code:safeProviderCode(error)})}

  try{
    const stripe=new Stripe(config.stripe.secretKey,{maxNetworkRetries:0,timeout:8_000})
    await stripe.balance.retrieve()
    checks.push({id:'stripe_test_mode',status:'passed',detail:'Stripe test-mode API credentials were accepted'})
  }catch(error){checks.push({id:'stripe_test_mode',status:'failed',detail:'Stripe test-mode API verification failed',code:safeProviderCode(error)})}

  if(squareBookingId&&squareCancelled&&twilioMessageId){
    checks.push(await observeProviderWebhooks(config,squareBookingId,twilioMessageId))
  }else{
    checks.push({id:'live_webhook_observation',status:'failed',detail:'Live webhooks cannot be verified until both provider mutations succeed'})
  }

  return{status:checks.every(value=>value.status==='passed')?'passed':'failed',startedAt,completedAt:new Date().toISOString(),checks}
}

async function observeProviderWebhooks(config:SandboxSmokeConfig,squareBookingId:string,twilioMessageId:string):Promise<SandboxSmokeCheck>{
  const pool=new Pool({connectionString:config.databaseUrl,connectionTimeoutMillis:8_000,statement_timeout:8_000,max:1})
  const deadline=Date.now()+config.webhookWaitSeconds*1_000
  try{
    do{
      const result=await pool.query<{square_seen:boolean;twilio_seen:boolean}>(`
        SELECT
          EXISTS(SELECT 1 FROM domain_events WHERE tenant_id=$1 AND location_id=$2 AND correlation_id=$3 AND event_type='appointment.cancelled') AS square_seen,
          EXISTS(SELECT 1 FROM domain_events WHERE tenant_id=$1 AND location_id=$2 AND correlation_id=$4 AND event_type='provider.webhook_received') AS twilio_seen
      `,[config.tenantId,config.locationId,squareBookingId,twilioMessageId])
      if(result.rows[0]?.square_seen&&result.rows[0]?.twilio_seen)return{id:'live_webhook_observation',status:'passed',detail:'Signed Square cancellation and Twilio status webhooks were observed in the tenant-scoped event ledger'}
      if(Date.now()>=deadline)break
      await new Promise(resolve=>setTimeout(resolve,1_000))
    }while(true)
    return{id:'live_webhook_observation',status:'failed',detail:'Expected provider webhooks were not observed before the bounded deadline'}
  }catch(error){return{id:'live_webhook_observation',status:'failed',detail:'Tenant-scoped webhook evidence could not be queried',code:safeProviderCode(error)}}
  finally{await pool.end()}
}

function parseInteger(raw:string,name:string,issues:string[],minimum:number,maximum=Number.MAX_SAFE_INTEGER){const value=Number(raw);if(!Number.isSafeInteger(value)||value<minimum||value>maximum){issues.push(`${name} must be an integer from ${minimum} to ${maximum}`);return minimum}return value}
function validatePublicHttps(raw:string,name:string,issues:string[]){if(!raw)return;try{const url=new URL(raw);if(url.protocol!=='https:')issues.push(`${name} must use HTTPS`);if(['localhost','127.0.0.1','::1'].includes(url.hostname))issues.push(`${name} must be publicly reachable`)}catch{issues.push(`${name} must be a valid URL`)}}
function hashReference(value:string){return createHash('sha256').update(value).digest('hex').slice(0,16)}
function boundedStatus(value:string){return /^[a-z_]{1,32}$/i.test(value)?value:'unknown'}
function safeProviderCode(error:unknown){if(typeof error==='object'&&error!==null){for(const key of['code','type','status','statusCode','name']){const value=(error as Record<string,unknown>)[key];if(typeof value==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(value))return value;if(typeof value==='number')return String(value)}}return'PROVIDER_REQUEST_FAILED'}
