import { createHash, randomUUID } from 'node:crypto'
import formbody from '@fastify/formbody'
import Fastify from 'fastify'
import rawBody from 'fastify-raw-body'
import { DomainError } from './domain/errors.js'
import type { TenantContext } from './domain/schemas.js'
import { resolveSquareWebhookTenant, verifySquareWebhook } from './integrations/square-webhook.js'
import { validateTwilioWebhook } from './integrations/twilio-messaging.js'
import { AuditService } from './services/audit-service.js'
import { ConsentService } from './services/consent-service.js'
import { EventService } from './services/event-service.js'
import type { Store } from './repositories/store.js'
import { StripeBillingWebhookService } from './services/stripe-billing-webhook-service.js'
import { ConversationService } from './services/conversation-service.js'
import { MessageDeliveryStatusService } from './services/message-delivery-status-service.js'
import { OperationalTelemetry, operationalRequestId, registerRequestTelemetry, type OperationalLogSink } from './operational-telemetry.js'
import { VoiceReadinessService } from './services/voice-readiness-service.js'
import { OpenAIRealtimeGateway, OpenAIRealtimeSipService, OpenAISignedWebhookVerifier, type RealtimeSandboxBootstrap, type RealtimeSipWebhookHandler } from './services/openai-realtime-sip-service.js'

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export function createWebhookApp(store: Store,options:{telemetrySink?:OperationalLogSink;realtimeSipHandler?:RealtimeSipWebhookHandler}={}) {
  const app = Fastify({ logger: false, genReqId: request => operationalRequestId(request.headers['x-request-id']) })
  registerRequestTelemetry(app,new OperationalTelemetry('salon-recovery-webhook-ingester',options.telemetrySink,Boolean(options.telemetrySink)||undefined))
  const events = new EventService(store)
  const audit = new AuditService(store)
  const consent = new ConsentService(store, audit)
  const conversations = new ConversationService(store,events,audit,consent)
  const deliveryStatuses=new MessageDeliveryStatusService(store,events)
  const voiceReadiness=new VoiceReadinessService(store,()=>new Date(),true)
  const realtimeSip=options.realtimeSipHandler??configuredRealtimeSip(store,events)
  app.setErrorHandler((error, _request, reply) => error instanceof DomainError ? reply.code(error.statusCode).send({ error: error.code, message: error.message }) : reply.code(500).send({ error: 'INTERNAL_ERROR' }))
  app.get('/health', async () => ({ status: 'ok', service: 'salon-recovery-webhook-ingester' }))
  app.get('/livez', async () => ({ status: 'alive', service: 'salon-recovery-webhook-ingester' }))
  app.get('/readyz', async (_request,reply) => {try{await store.healthCheck();return{status:'ready',service:'salon-recovery-webhook-ingester'}}catch{return reply.code(503).send({status:'not_ready',service:'salon-recovery-webhook-ingester'})}})

  app.register(async (square) => {
    await square.register(rawBody, { field: 'rawBody', global: false, encoding: 'utf8', runFirst: true })
    square.post('/square', { config: { rawBody: true } }, async (request, reply) => {
      const signature = request.headers['x-square-hmacsha256-signature']; const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY; const url = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL
      if (typeof signature !== 'string' || !key || !url || typeof request.rawBody !== 'string') throw new DomainError('Square webhook verification is not configured', 'WEBHOOK_CONFIGURATION_ERROR', 503)
      if (!await verifySquareWebhook({ rawBody: request.rawBody, signature, signatureKey: key, notificationUrl: url })) throw new DomainError('Square webhook signature is invalid', 'INVALID_WEBHOOK_SIGNATURE', 403)
      const body = request.body as { event_id?: string; type?: string; created_at?: string; merchant_id?: string; data?: { object?: { booking?: { id?:string;status?:string;start_at?:string;customer_id?:string;location_id?:string;appointment_segments?:Array<{service_variation_id?:string;team_member_id?:string;duration_minutes?:number}> } } } }
      const context = await resolveSquareWebhookTenant(store, body.merchant_id);const occurredAt=body.created_at&&!Number.isNaN(Date.parse(body.created_at))?new Date(body.created_at).toISOString():new Date().toISOString()
      const result = await events.ingest(context, { eventId: body.event_id && uuid(body.event_id) ? body.event_id : randomUUID(), eventType: 'provider.webhook_received', occurredAt, correlationId: body.merchant_id ?? body.event_id ?? 'square', schemaVersion: 1, payload: { provider: 'square', providerEventType: body.type ?? 'unknown', original: body } })
      if(!result.duplicate){const normalized=normalizeSquareBooking(body);if(normalized){const decision=await store.acceptSquareBookingWebhook({tenantId:context.tenantId,locationId:context.locationId,providerBookingId:normalized.correlationId,providerEventId:result.event.eventId,providerOccurredAt:occurredAt,providerStatus:normalized.providerStatus,normalizedEventType:normalized.eventType,updatedAt:new Date().toISOString()});if(decision.accepted)await events.ingest(context,{eventId:randomUUID(),eventType:normalized.eventType,occurredAt,correlationId:normalized.correlationId,causationId:result.event.eventId,schemaVersion:1,payload:normalized.payload})}}
      return reply.code(result.duplicate ? 200 : 202).send({ accepted: true, duplicate: result.duplicate })
    })
  }, { prefix: '/webhooks' })

  app.register(async (twilioRoutes) => {
    await twilioRoutes.register(formbody)
    twilioRoutes.post('/inbound', async (request, reply) => {
      const params = request.body as Record<string, string>; const signature = request.headers['x-twilio-signature']; const token = process.env.TWILIO_AUTH_TOKEN; const url = process.env.TWILIO_INBOUND_WEBHOOK_URL
      if (typeof signature !== 'string' || !token || !url) throw new DomainError('Twilio webhook verification is not configured', 'WEBHOOK_CONFIGURATION_ERROR', 503)
      if (!validateTwilioWebhook({ authToken: token, signature, url, params })) throw new DomainError('Twilio signature is invalid', 'INVALID_WEBHOOK_SIGNATURE', 403)
      const context = await twilioTenant(store, params.To); const participant=twilioParticipant(params.From); const body = params.Body ?? ''; const messageId = params.MessageSid ?? randomUUID();const profile=await store.findClientProfileByContact(context,participant.contactTo)
      await conversations.intake(context,{...(profile?{clientId:profile.clientId}:{}),participantAddress:participant.address,channel:participant.channel,body,providerMessageId:messageId,source:'provider'})
      return reply.type('text/xml').send('<Response></Response>')
    })
    twilioRoutes.post('/voice/status',async(request,reply)=>{
      const params=request.body as Record<string,string>;const signature=request.headers['x-twilio-signature'];const token=process.env.TWILIO_AUTH_TOKEN;const url=process.env.TWILIO_VOICE_STATUS_WEBHOOK_URL
      if(typeof signature!=='string'||!token||!url)throw new DomainError('Twilio voice webhook verification is not configured','WEBHOOK_CONFIGURATION_ERROR',503)
      if(!validateTwilioWebhook({authToken:token,signature,url,params}))throw new DomainError('Twilio signature is invalid','INVALID_WEBHOOK_SIGNATURE',403)
      const callSid=params.CallSid?.trim();const status=params.CallStatus?.trim().toLowerCase();const direction=params.Direction?.trim().toLowerCase();const from=params.From?.trim();const to=params.To?.trim()
      if(!callSid||!status||!to)throw new DomainError('Twilio voice status payload is incomplete','INVALID_WEBHOOK_PAYLOAD',400)
      const context=await twilioTenant(store,to);const occurredAt=new Date().toISOString();const eventId=stableUuid(`twilio:voice:${callSid}:${status}`)
      const received=await events.ingest(context,{eventId,eventType:'provider.webhook_received',occurredAt,correlationId:callSid,schemaVersion:1,payload:{provider:'twilio',providerEventType:'voice.status',callSid,status,direction:direction??'unknown',original:params}})
      const missed=direction==='inbound'&&['busy','failed','no-answer','canceled'].includes(status)&&typeof from==='string'
      if(!received.duplicate&&missed)await events.ingest(context,{eventId:randomUUID(),eventType:'call.missed',occurredAt,correlationId:callSid,causationId:eventId,schemaVersion:1,payload:{providerCallSid:callSid,callerAddress:from,status,missedAt:occurredAt}})
      return reply.code(received.duplicate?200:202).send({accepted:true,duplicate:received.duplicate,recoveryQueued:missed&&!received.duplicate})
    })
    twilioRoutes.post('/voice/inbound',async(request,reply)=>{
      const params=request.body as Record<string,string>;const signature=request.headers['x-twilio-signature'];const token=process.env.TWILIO_AUTH_TOKEN;const url=process.env.TWILIO_VOICE_INBOUND_WEBHOOK_URL
      if(typeof signature!=='string'||!token||!url)throw new DomainError('Twilio inbound voice verification is not configured','WEBHOOK_CONFIGURATION_ERROR',503)
      if(!validateTwilioWebhook({authToken:token,signature,url,params}))throw new DomainError('Twilio signature is invalid','INVALID_WEBHOOK_SIGNATURE',403)
      const callSid=params.CallSid?.trim();const from=params.From?.trim();const to=params.To?.trim();if(!callSid||!from||!to)throw new DomainError('Twilio inbound voice payload is incomplete','INVALID_WEBHOOK_PAYLOAD',400)
      const context=await twilioTenant(store,to);const access=await voiceReadiness.runtimeAccess(context);const receivedAt=new Date().toISOString();await events.ingest(context,{eventId:stableUuid(`twilio:voice:inbound:${callSid}`),eventType:'provider.webhook_received',occurredAt:receivedAt,correlationId:callSid,schemaVersion:1,payload:{provider:'twilio',providerEventType:'voice.inbound',callSid,readiness:access.allowed?'accepted':'blocked'}})
      if(!access.allowed||!access.declaration)return reply.type('text/xml').send(voiceUnavailableTwiml())
      const settings=await store.getLocationSettings(context);return reply.type('text/xml').send(voiceTransferTwiml(settings?.salonName??'the salon',access.declaration.transferTo))
    })
    twilioRoutes.post('/status',async(request,reply)=>{
      const params=request.body as Record<string,string>;const signature=request.headers['x-twilio-signature'];const token=process.env.TWILIO_AUTH_TOKEN;const url=process.env.TWILIO_STATUS_CALLBACK_URL
      if(typeof signature!=='string'||!token||!url)throw new DomainError('Twilio delivery webhook verification is not configured','WEBHOOK_CONFIGURATION_ERROR',503)
      if(!validateTwilioWebhook({authToken:token,signature,url,params}))throw new DomainError('Twilio signature is invalid','INVALID_WEBHOOK_SIGNATURE',403)
      const messageSid=params.MessageSid?.trim();const status=params.MessageStatus?.trim().toLowerCase();const from=params.From?.trim();if(!messageSid||!status||!from)throw new DomainError('Twilio delivery status payload is incomplete','INVALID_WEBHOOK_PAYLOAD',400)
      const context=await twilioTenant(store,from);const occurredAt=new Date().toISOString();const eventId=stableWebhookUuid('twilio:message',params);const received=await events.ingest(context,{eventId,eventType:'provider.webhook_received',occurredAt,correlationId:messageSid,schemaVersion:1,payload:{provider:'twilio',providerEventType:'message.status',messageSid,status,original:params}})
      const result=received.duplicate?undefined:await deliveryStatuses.record(context,{providerMessageId:messageSid,providerStatus:status,...(params.ErrorCode?{errorCode:params.ErrorCode}:{}),causationEventId:eventId})
      return reply.code(received.duplicate?200:202).send({accepted:true,duplicate:received.duplicate,matched:result?.matched??false,ignored:result?.ignored??false})
    })
  }, { prefix: '/webhooks/twilio' })
  app.register(async(openAIRoutes)=>{
    await openAIRoutes.register(rawBody,{field:'rawBody',global:false,encoding:'utf8',runFirst:true})
    openAIRoutes.post('/realtime',{config:{rawBody:true}},async(request,reply)=>{
      if(!realtimeSip||typeof request.rawBody!=='string')throw new DomainError('OpenAI realtime webhook is not configured','WEBHOOK_CONFIGURATION_ERROR',503)
      const result=await realtimeSip.handle(request.rawBody,request.headers)
      return reply.code(result.duplicate?200:202).send(result)
    })
  },{prefix:'/webhooks/openai'})
  app.register(async(stripeRoutes)=>{
    await stripeRoutes.register(rawBody,{field:'rawBody',global:false,encoding:'utf8',runFirst:true})
    stripeRoutes.post('/stripe',{config:{rawBody:true}},async(request,reply)=>{const signature=request.headers['stripe-signature'];const secretKey=process.env.STRIPE_SECRET_KEY;const webhookSecret=process.env.STRIPE_WEBHOOK_SECRET;if(typeof signature!=='string'||!secretKey||!webhookSecret||typeof request.rawBody!=='string')throw new DomainError('Stripe webhook verification is not configured','WEBHOOK_CONFIGURATION_ERROR',503);const result=await new StripeBillingWebhookService(store,events,secretKey,webhookSecret).handle(request.rawBody,signature);return reply.code(result.duplicate?200:202).send(result)})
  },{prefix:'/webhooks'})
  return app
}

function configuredRealtimeSip(store:Store,events:EventService){
  const apiKey=process.env.OPENAI_API_KEY?.trim();const secret=process.env.OPENAI_WEBHOOK_SECRET?.trim();if(process.env.OPENAI_REALTIME_SIP_ENABLED!=='true'||!apiKey||!secret)return undefined
  const model=process.env.OPENAI_REALTIME_MODEL?.trim()||'gpt-realtime-2.1';const destinationHeader=process.env.OPENAI_SIP_DESTINATION_HEADER?.trim()||'to'
  return new OpenAIRealtimeSipService(store,events,new OpenAISignedWebhookVerifier(apiKey,secret),new OpenAIRealtimeGateway(apiKey),model,destinationHeader,()=>new Date(),configuredRealtimeSandboxBootstrap())
}

function configuredRealtimeSandboxBootstrap():RealtimeSandboxBootstrap|undefined{
  const destination=process.env.VOICE_SANDBOX_DESTINATION?.trim();const tenantId=process.env.VOICE_SANDBOX_TENANT_ID?.trim();const locationId=process.env.VOICE_SANDBOX_LOCATION_ID?.trim()
  if(process.env.NODE_ENV==='production'||process.env.VOICE_SANDBOX_ALLOW_CONTROLLED_CALL!=='true'||!tenantId||!locationId||!destination||!/^\+[1-9]\d{7,14}$/.test(destination))return undefined
  return{environment:process.env.NODE_ENV??'development',authorized:true,tenantId,locationId,destination}
}

function stableUuid(value:string){const digest=createHash('sha256').update(value).digest('hex');return`${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`}
function stableWebhookUuid(namespace:string,params:Record<string,string>){const canonical=Object.entries(params).sort(([left],[right])=>left.localeCompare(right)).map(([key,value])=>`${key.length}:${key}:${value.length}:${value}`).join('|');return stableUuid(`${namespace}:${canonical}`)}
function voiceUnavailableTwiml(){return'<Response><Say>The automated voice service is currently unavailable. Please call again later.</Say><Hangup/></Response>'}
function voiceTransferTwiml(salonName:string,transferTo:string){return`<Response><Say>You have reached ${xmlEscape(salonName)}. This is an automated assistant. This call is not recorded. I will connect you with a person now.</Say><Dial answerOnBridge="true" timeout="20">${xmlEscape(transferTo)}</Dial><Say>The salon team is unavailable. Please call again later.</Say><Hangup/></Response>`}
function xmlEscape(value:string){return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;')}

function twilioParticipant(value?:string){const address=value?.trim();if(!address)throw new DomainError('Twilio inbound payload is missing its sender','INVALID_WEBHOOK_PAYLOAD',400);const whatsapp=/^whatsapp:/i.test(address);const contactTo=whatsapp?address.slice(address.indexOf(':')+1):address;if(!/^\+[1-9]\d{7,14}$/.test(contactTo))throw new DomainError('Twilio inbound sender is not a valid SMS or WhatsApp address','INVALID_WEBHOOK_PAYLOAD',400);return{address:whatsapp?`whatsapp:${contactTo}`:contactTo,contactTo,channel:whatsapp?'whatsapp' as const:'sms' as const}}

function normalizeSquareBooking(body:{type?:string;data?:{object?:{booking?:{id?:string;status?:string;start_at?:string;customer_id?:string;location_id?:string;appointment_segments?:Array<{service_variation_id?:string;team_member_id?:string;duration_minutes?:number}>}}}}){const booking=body.data?.object?.booking;if(!booking?.id)return undefined;let eventType:'appointment.booked'|'appointment.cancelled'|'appointment.no_show'|undefined;if(body.type==='booking.created')eventType='appointment.booked';else if(body.type==='booking.updated'&&booking.status==='NO_SHOW')eventType='appointment.no_show';else if(body.type==='booking.updated'&&booking.status?.startsWith('CANCELLED'))eventType='appointment.cancelled';if(!eventType)return undefined;const providerStatus=booking.status??(eventType==='appointment.booked'?'ACCEPTED':'UNKNOWN');const segment=booking.appointment_segments?.[0];return{eventType,providerStatus,correlationId:booking.id,payload:{provider:'square',providerBookingId:booking.id,bookingId:booking.id,clientId:booking.customer_id,startsAt:booking.start_at,locationId:booking.location_id,serviceId:segment?.service_variation_id,staffId:segment?.team_member_id,durationMinutes:segment?.duration_minutes,status:providerStatus}}}

async function twilioTenant(store: Store, address?: string): Promise<TenantContext> {
  if (address) {
    const route = await store.findChannelRoute('twilio', address.trim())
    if (route?.status === 'active') return { tenantId: route.tenantId, locationId: route.locationId, userId: 'twilio-webhook', role: 'service' }
  }

  if (process.env.NODE_ENV !== 'production' && process.env.TWILIO_WEBHOOK_TENANT_ID && process.env.TWILIO_WEBHOOK_LOCATION_ID) {
    return { tenantId: process.env.TWILIO_WEBHOOK_TENANT_ID, locationId: process.env.TWILIO_WEBHOOK_LOCATION_ID, userId: 'twilio-webhook', role: 'service' }
  }

  throw new DomainError('Twilio webhook tenant could not be resolved from its destination address', 'WEBHOOK_TENANT_UNRESOLVED', 503)
}
