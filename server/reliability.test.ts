import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebhookApp } from './webhook-app.js'
import { MemoryStore } from './repositories/memory-store.js'
import { signedSquareWebhook, signedTwilioWebhook } from './test-support/provider-webhook-fixtures.js'
import { WorkflowEngine } from './services/workflow-engine.js'
import { BookingService } from './services/booking-service.js'
import { EventService } from './services/event-service.js'
import { AuditService } from './services/audit-service.js'
import { DomainError } from './domain/errors.js'
import type { BookingGateway } from './services/square-booking-gateway.js'
import type { BookingRecord, WorkflowJob } from './domain/schemas.js'
import { decideSquareBookingWebhook } from './domain/square-booking-transition.js'

const apps:Array<ReturnType<typeof createWebhookApp>>=[]
afterEach(async()=>{vi.useRealTimers();await Promise.all(apps.splice(0).map(value=>value.close()))})

describe('provider webhook replay contracts',()=>{
  it('stores every signed Square notification but normalizes only forward booking transitions',async()=>{
    const store=new MemoryStore()
    const server=createWebhookApp(store)
    apps.push(server)

    const previous={
      key:process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
      url:process.env.SQUARE_WEBHOOK_NOTIFICATION_URL,
      tenant:process.env.SQUARE_WEBHOOK_TENANT_ID,
      location:process.env.SQUARE_WEBHOOK_LOCATION_ID,
    }
    const signatureKey='replay-signature-key'
    const notificationUrl='https://api.example.com/webhooks/square'
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY=signatureKey
    process.env.SQUARE_WEBHOOK_NOTIFICATION_URL=notificationUrl
    process.env.SQUARE_WEBHOOK_TENANT_ID='tenant-one'
    process.env.SQUARE_WEBHOOK_LOCATION_ID='location-one'

    const bookingId='square-replay-booking'
    const startsAt=new Date(Date.now()+48*60*60_000).toISOString()
    const body=(eventId:string,type:string,createdAt:string,status:string)=>({
      event_id:eventId,
      type,
      created_at:createdAt,
      merchant_id:'merchant-replay',
      data:{
        object:{
          booking:{
            id:bookingId,
            status,
            start_at:startsAt,
            customer_id:'client-one',
            location_id:'location-one',
            appointment_segments:[{
              service_variation_id:'service-one',
              team_member_id:'staff-one',
              duration_minutes:90,
            }],
          },
        },
      },
    })
    const created=body(randomUUID(),'booking.created','2026-07-18T10:00:00.000Z','ACCEPTED')
    const cancelled=body(randomUUID(),'booking.updated','2026-07-18T10:10:00.000Z','CANCELLED_BY_CUSTOMER')
    const staleNoShow=body(randomUUID(),'booking.updated','2026-07-18T10:05:00.000Z','NO_SHOW')
    const terminalRegression=body(randomUUID(),'booking.created','2026-07-18T10:15:00.000Z','ACCEPTED')
    const repeatedState=body(randomUUID(),'booking.updated','2026-07-18T10:20:00.000Z','CANCELLED_BY_CUSTOMER')

    try{
      const responses=[]
      for(const value of[created,cancelled,staleNoShow,terminalRegression,repeatedState,cancelled]){
        responses.push(await server.inject(signedSquareWebhook({signatureKey,notificationUrl,body:value})))
      }

      expect(responses.map(value=>value.statusCode)).toEqual([202,202,202,202,202,200])
      const context={tenantId:'tenant-one',locationId:'location-one',userId:'test',role:'service' as const}
      const events=await store.getOutbox(context)
      expect(events.filter(value=>value.eventType==='provider.webhook_received')).toHaveLength(5)
      expect(events.filter(value=>value.eventType==='appointment.booked')).toHaveLength(1)
      expect(events.filter(value=>value.eventType==='appointment.cancelled')).toHaveLength(1)
      expect(events.filter(value=>value.eventType==='appointment.no_show')).toHaveLength(0)

      const handled:WorkflowJob[]=[]
      await new WorkflowEngine(store,{execute:async job=>{handled.push(job)}},'replay-worker').tick(100)
      expect((await store.listWorkflowJobs(context)).map(value=>value.workflowType).sort()).toEqual([
        'appointment_confirmation',
        'appointment_reminder',
        'waitlist_match',
      ])
      expect(handled.map(value=>value.workflowType).sort()).toEqual([
        'appointment_confirmation',
        'waitlist_match',
      ])
    }finally{
      if(previous.key===undefined)delete process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
      else process.env.SQUARE_WEBHOOK_SIGNATURE_KEY=previous.key
      if(previous.url===undefined)delete process.env.SQUARE_WEBHOOK_NOTIFICATION_URL
      else process.env.SQUARE_WEBHOOK_NOTIFICATION_URL=previous.url
      if(previous.tenant===undefined)delete process.env.SQUARE_WEBHOOK_TENANT_ID
      else process.env.SQUARE_WEBHOOK_TENANT_ID=previous.tenant
      if(previous.location===undefined)delete process.env.SQUARE_WEBHOOK_LOCATION_ID
      else process.env.SQUARE_WEBHOOK_LOCATION_ID=previous.location
    }
  })

  it('suppresses delayed Twilio regressions after delivery and creates no false failure alert',async()=>{
    const store=new MemoryStore()
    const now=new Date().toISOString()
    await store.saveChannelRoute({
      id:randomUUID(),
      tenantId:'tenant-one',
      locationId:'location-one',
      provider:'twilio',
      address:'+447700900799',
      status:'active',
      createdAt:now,
      updatedAt:now,
    })
    await store.reserveOutboundMessageDelivery({
      id:randomUUID(),
      tenantId:'tenant-one',
      locationId:'location-one',
      clientId:'client-one',
      channel:'sms',
      purpose:'transactional',
      to:'+447700900798',
      correlationId:'twilio-replay',
      idempotencyKey:'twilio-replay-message',
      status:'sent',
      providerMessageId:'SM-replay-status',
      providerStatus:'sent',
      createdAt:now,
      updatedAt:now,
    })

    const server=createWebhookApp(store)
    apps.push(server)
    const previous={
      token:process.env.TWILIO_AUTH_TOKEN,
      url:process.env.TWILIO_STATUS_CALLBACK_URL,
    }
    const authToken='twilio-replay-token'
    const webhookUrl='https://api.example.com/webhooks/twilio/status'
    process.env.TWILIO_AUTH_TOKEN=authToken
    process.env.TWILIO_STATUS_CALLBACK_URL=webhookUrl
    const callback=(status:string)=>signedTwilioWebhook({
      authToken,
      webhookUrl,
      path:'/webhooks/twilio/status',
      params:{
        MessageSid:'SM-replay-status',
        MessageStatus:status,
        From:'+447700900799',
        To:'+447700900798',
      },
    })

    try{
      const delivered=await server.inject(callback('delivered'))
      const sent=await server.inject(callback('sent'))
      const failed=await server.inject(callback('failed'))
      const duplicate=await server.inject(callback('delivered'))

      expect(delivered.json()).toMatchObject({duplicate:false,ignored:false})
      expect(sent.json()).toMatchObject({duplicate:false,ignored:true})
      expect(failed.json()).toMatchObject({duplicate:false,ignored:true})
      expect(duplicate.json()).toMatchObject({duplicate:true})

      const context={tenantId:'tenant-one',locationId:'location-one',userId:'test',role:'service' as const}
      expect(await store.listOutboundMessageDeliveries(context)).toEqual([
        expect.objectContaining({status:'delivered',providerStatus:'delivered'}),
      ])
      const events=await store.getOutbox(context)
      expect(events.filter(value=>value.eventType==='provider.webhook_received')).toHaveLength(3)
      expect(events.filter(value=>value.eventType==='message.delivered')).toHaveLength(1)
      expect(events.some(value=>value.eventType==='message.sent'||value.eventType==='message.failed')).toBe(false)
      expect(await store.listApprovalRequests(context)).toEqual([])
    }finally{
      if(previous.token===undefined)delete process.env.TWILIO_AUTH_TOKEN
      else process.env.TWILIO_AUTH_TOKEN=previous.token
      if(previous.url===undefined)delete process.env.TWILIO_STATUS_CALLBACK_URL
      else process.env.TWILIO_STATUS_CALLBACK_URL=previous.url
    }
  })

  it('normalizes a signed WhatsApp read receipt once and preserves the channel-scoped route',async()=>{
    const store=new MemoryStore();const now=new Date().toISOString();const context={tenantId:'tenant-one',locationId:'location-one',userId:'test',role:'service' as const}
    await store.saveChannelRoute({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,provider:'twilio',address:'whatsapp:+447700900799',status:'active',createdAt:now,updatedAt:now})
    await store.reserveOutboundMessageDelivery({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,clientId:'client-one',channel:'whatsapp',purpose:'transactional',to:'whatsapp:+447700900798',correlationId:'whatsapp-read',idempotencyKey:'whatsapp-read-message',status:'sent',providerMessageId:'SM-whatsapp-read',providerStatus:'sent',createdAt:now,updatedAt:now})
    const server=createWebhookApp(store);apps.push(server);const previous={token:process.env.TWILIO_AUTH_TOKEN,url:process.env.TWILIO_STATUS_CALLBACK_URL};const authToken='twilio-whatsapp-token';const webhookUrl='https://api.example.com/webhooks/twilio/status';process.env.TWILIO_AUTH_TOKEN=authToken;process.env.TWILIO_STATUS_CALLBACK_URL=webhookUrl
    const callback=(status:string)=>signedTwilioWebhook({authToken,webhookUrl,path:'/webhooks/twilio/status',params:{MessageSid:'SM-whatsapp-read',MessageStatus:status,From:'whatsapp:+447700900799',To:'whatsapp:+447700900798'}})
    try{const read=await server.inject(callback('read'));const duplicate=await server.inject(callback('read'));const regression=await server.inject(callback('sent'));expect(read.json()).toMatchObject({duplicate:false,matched:true,ignored:false});expect(duplicate.json()).toMatchObject({duplicate:true});expect(regression.json()).toMatchObject({duplicate:false,matched:true,ignored:true});expect(await store.listOutboundMessageDeliveries(context)).toEqual([expect.objectContaining({channel:'whatsapp',status:'delivered',providerStatus:'read'})]);const events=await store.getOutbox(context);expect(events.filter(value=>value.eventType==='provider.webhook_received')).toHaveLength(2);expect(events.filter(value=>value.eventType==='message.delivered')).toHaveLength(1);expect(events.some(value=>value.eventType==='message.sent'||value.eventType==='message.failed')).toBe(false)}finally{previous.token===undefined?delete process.env.TWILIO_AUTH_TOKEN:process.env.TWILIO_AUTH_TOKEN=previous.token;previous.url===undefined?delete process.env.TWILIO_STATUS_CALLBACK_URL:process.env.TWILIO_STATUS_CALLBACK_URL=previous.url}
  })

  it('holds terminal Square states across generated timestamp and status combinations',()=>{const base={tenantId:'tenant-one',locationId:'location-one',providerBookingId:'booking-one',providerEventId:randomUUID(),providerOccurredAt:'2026-07-18T10:00:00.000Z',providerStatus:'CANCELLED_BY_CUSTOMER',normalizedEventType:'appointment.cancelled' as const,updatedAt:'2026-07-18T10:00:00.000Z'};for(const[status,eventType]of[['ACCEPTED','appointment.booked'],['NO_SHOW','appointment.no_show'],['CANCELLED_BY_SELLER','appointment.cancelled']] as const){const decision=decideSquareBookingWebhook(base,{...base,providerEventId:randomUUID(),providerOccurredAt:'2026-07-18T11:00:00.000Z',providerStatus:status,normalizedEventType:eventType});expect(decision).toMatchObject({accepted:false,reason:'invalid_transition',cursor:base})}expect(decideSquareBookingWebhook(base,{...base,providerEventId:randomUUID(),providerOccurredAt:'2026-07-18T09:59:59.000Z',providerStatus:'NO_SHOW',normalizedEventType:'appointment.no_show'})).toMatchObject({accepted:false,reason:'stale'})})
})

describe('appointment concurrency and state invariants',()=>{
  const context={tenantId:'tenant-one',locationId:'location-one',userId:'operator-one',role:'operator' as const}

  it('allows only one of two customers to acquire the same provider slot',async()=>{const store=new MemoryStore();const events=new EventService(store);const audit=new AuditService(store);let providerCalls=0;let slotBooked=false;const gateway:BookingGateway={searchAvailability:async()=>[],validateHold:async()=>({provider:'square',customerId:'customer',serviceVariationVersion:'1',durationMinutes:60}),createBooking:async()=>{providerCalls+=1;if(slotBooked)throw new DomainError('Slot was taken','SLOT_UNAVAILABLE',409);slotBooked=true;return{provider:'square',id:'square-one',version:1,status:'ACCEPTED'}},cancelBooking:async()=>({provider:'square',id:'unused'}),rescheduleBooking:async()=>({provider:'square',id:'unused'})};const service=new BookingService(store,events,audit,gateway);const input={serviceId:'service-one',staffId:'staff-one',startsAt:'2026-07-20T14:00:00.000Z',timezone:'Europe/London',expectedPriceMinor:18500,currency:'GBP',provider:'square' as const,providerCustomerId:'customer'};const first=await service.createHold(context,{...input,clientId:'client-one'});const second=await service.createHold(context,{...input,clientId:'client-two'});const results=await Promise.allSettled([service.book(context,{holdId:first.id,clientId:first.clientId,confirmationToken:first.confirmationToken,explicitConfirmation:true,expectedPriceMinor:18500,currency:'GBP',idempotencyKey:'same-slot-client-one'}),service.book(context,{holdId:second.id,clientId:second.clientId,confirmationToken:second.confirmationToken,explicitConfirmation:true,expectedPriceMinor:18500,currency:'GBP',idempotencyKey:'same-slot-client-two'})]);expect(results.filter(value=>value.status==='fulfilled')).toHaveLength(1);expect(results.filter(value=>value.status==='rejected')).toHaveLength(1);expect(providerCalls).toBe(2);expect(await store.listBookings(context)).toHaveLength(1);expect([(await store.getHold(context,first.id))?.status,(await store.getHold(context,second.id))?.status].sort()).toEqual(['active','booked'])})

  it('returns a duplicate only when every booking confirmation input matches the original request',async()=>{const store=new MemoryStore();const events=new EventService(store);const audit=new AuditService(store);const service=new BookingService(store,events,audit);const startsAt=new Date(Date.now()+86_400_000).toISOString();const base={serviceId:'service-one',staffId:'staff-one',startsAt,timezone:'Europe/London',expectedPriceMinor:18500,currency:'GBP',provider:'local' as const};const first=await service.createHold(context,{...base,clientId:'client-one'});const second=await service.createHold(context,{...base,clientId:'client-two'});const idempotencyKey='booking-request-key-0001';const firstInput={holdId:first.id,clientId:first.clientId,confirmationToken:first.confirmationToken,explicitConfirmation:true as const,expectedPriceMinor:18500,currency:'GBP',idempotencyKey};const created=await service.book(context,firstInput);await expect(service.book(context,{...firstInput,holdId:second.id,clientId:second.clientId,confirmationToken:second.confirmationToken})).rejects.toMatchObject({code:'IDEMPOTENCY_SCOPE_MISMATCH',statusCode:409});expect(await store.getHold(context,second.id)).toMatchObject({status:'active'});expect(await store.listBookings(context)).toEqual([created.booking]);expect(await service.book(context,firstInput)).toMatchObject({booking:created.booking,duplicate:true})})

  it('rejects every mutation from a generated terminal status set',async()=>{const store=new MemoryStore();const service=new BookingService(store,new EventService(store),new AuditService(store));const terminal=['CANCELLED_BY_CUSTOMER','CANCELLED_BY_SELLER','DECLINED','NO_SHOW','COMPLETED'];for(const status of terminal){const record:BookingRecord={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,holdId:randomUUID(),clientId:'client-one',bookingReference:`ref-${status}`,priceMinor:10000,currency:'GBP',createdAt:new Date().toISOString(),provider:'square',providerBookingId:`square-${status}`,providerBookingVersion:1,providerStatus:status,serviceId:'service-one',staffId:'staff-one',startsAt:'2026-07-20T14:00:00.000Z'};await store.saveBookingMutation(context,`terminal-${status}`,record);await expect(service.requireMutableSquareBooking(context,record.id)).rejects.toMatchObject({code:'BOOKING_NOT_MUTABLE'})}for(const status of['ACCEPTED','PENDING']){const record:BookingRecord={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,holdId:randomUUID(),clientId:'client-one',bookingReference:`ref-${status}`,priceMinor:10000,currency:'GBP',createdAt:new Date().toISOString(),provider:'square',providerBookingId:`square-${status}`,providerBookingVersion:1,providerStatus:status,serviceId:'service-one',staffId:'staff-one',startsAt:'2026-07-20T14:00:00.000Z'};await store.saveBookingMutation(context,`mutable-${status}`,record);await expect(service.requireMutableSquareBooking(context,record.id)).resolves.toEqual(record)}})
})

describe('workflow queue saturation and lease recovery',()=>{
  const context={tenantId:'tenant-one',locationId:'location-one',userId:'worker-test',role:'service' as const}
  const job=(index:number):WorkflowJob=>{const now=new Date().toISOString();return{id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,workflowType:'appointment_confirmation',correlationId:`booking-${index}`,causationEventId:`event-${index}`,dedupeKey:`saturation-${index}`,runAt:now,status:'pending',attempts:0,maxAttempts:5,payload:{clientId:`client-${index}`},createdAt:now,updatedAt:now}}

  it('drains a saturated queue in bounded batches without loss or duplicate execution',async()=>{const store=new MemoryStore();for(let index=0;index<75;index+=1)await store.enqueueWorkflowJob(job(index));const handled=new Set<string>();const engine=new WorkflowEngine(store,{execute:async value=>{expect(handled.has(value.id)).toBe(false);handled.add(value.id)}},'saturation-worker');expect(await engine.tick(20)).toMatchObject({processed:20});expect(await engine.tick(20)).toMatchObject({processed:20});expect(await engine.tick(20)).toMatchObject({processed:20});expect(await engine.tick(20)).toMatchObject({processed:15});expect(await engine.tick(20)).toMatchObject({processed:0});expect(handled.size).toBe(75);expect((await store.listWorkflowJobs(context)).filter(value=>value.status==='completed')).toHaveLength(75)})

  it('recovers an abandoned five-minute lease exactly once',async()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));const store=new MemoryStore();const value=job(999);await store.enqueueWorkflowJob(value);const abandoned=await store.claimDueWorkflowJobs('dead-worker',1);expect(abandoned).toEqual([expect.objectContaining({id:value.id,status:'running',attempts:1})]);vi.advanceTimersByTime(5*60_000+1);let calls=0;const engine=new WorkflowEngine(store,{execute:async()=>{calls+=1}},'recovery-worker');expect(await engine.tick(10)).toMatchObject({processed:1});expect(await engine.tick(10)).toMatchObject({processed:0});expect(calls).toBe(1);expect(await store.listWorkflowJobs(context)).toEqual([expect.objectContaining({id:value.id,status:'completed',attempts:2})])})
})
