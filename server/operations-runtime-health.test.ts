import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppointmentHold, BookingRecord, WorkflowJob } from './domain/schemas.js'
import { CredentialCipher } from './security/credential-cipher.js'
import { createConversationRouterPrompt } from './prompts/conversation-router.js'
import { MemoryStore } from './repositories/memory-store.js'
import { TenantHealthService } from './services/tenant-health-service.js'
import { createApp } from './app.js'

const context={tenantId:'tenant-one',locationId:'location-one',userId:'manager-one',role:'manager' as const}
const config={messagingConfigured:false,reportEmailConfigured:false,billingConfigured:false,rateLimitingConfigured:false}

afterEach(()=>vi.useRealTimers())

describe('operational runtime health signals',()=>{
  it('reports unpublished-event lag, due-workflow lag, and abandoned leases without exposing tenant payloads',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'))
    const store=new MemoryStore();const stale='2026-07-20T11:50:00.000Z'
    await store.appendEvent({eventId:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,eventType:'lead.received',occurredAt:stale,correlationId:'secret-client-correlation',schemaVersion:1,payload:{clientId:'secret-client',body:'private message'}})
    const job=(status:WorkflowJob['status'],id:string):WorkflowJob=>({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,workflowType:'appointment_confirmation',correlationId:id,causationEventId:randomUUID(),dedupeKey:id,runAt:stale,status,attempts:1,maxAttempts:5,payload:{clientId:'secret-client'},...(status==='running'?{lockedBy:'worker-old',lockedAt:'2026-07-20T11:53:00.000Z'}:{}),createdAt:stale,updatedAt:stale})
    await store.enqueueWorkflowJob(job('pending','due-one'));await store.enqueueWorkflowJob(job('running','running-one'))
    const result=await new TenantHealthService(store,config).inspect(context)
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({key:'event_outbox',status:'warning',detail:expect.stringContaining('10 minutes')}),expect.objectContaining({key:'workflow_queue',status:'warning',detail:expect.stringContaining('leases')})]))
    expect(JSON.stringify(result)).not.toMatch(/secret-client|private message|secret-client-correlation/)
  })

  it('reports ready only when the active prompt and fresh evaluation share the exact digest and model',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'))
    const store=new MemoryStore();const now=new Date().toISOString();const prompt=createConversationRouterPrompt('gpt-5.6-terra',{createdAt:now,approvalReference:'release-review-42'})
    await store.savePromptVersion(prompt)
    await store.saveAgentEvaluationEvidence({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,datasetVersion:'2026-07-19.1',mode:'model',model:prompt.model,promptVersion:prompt.releaseLabel,promptDigest:prompt.contentDigest,status:'passed',totalCases:150,passedCases:150,failedCases:0,metrics:{routeAccuracy:1,safetyRecall:1,confirmationAccuracy:1,groundingViolations:0},startedAt:now,completedAt:now})
    const health=new TenantHealthService(store,config)
    expect((await health.inspect(context)).checks).toEqual(expect.arrayContaining([expect.objectContaining({key:'agent_release',status:'ready',detail:expect.stringContaining(prompt.contentDigest.slice(0,12))})]))
    await store.savePromptVersion({...prompt,id:randomUUID(),version:2,instructions:`${prompt.instructions}\nUnreviewed drift.`})
    expect((await health.inspect(context)).checks).toEqual(expect.arrayContaining([expect.objectContaining({key:'agent_release',status:'warning'})]))
  })

  it('blocks Square readiness on current expiry, reconnect, and paused-workflow evidence',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));const store=new MemoryStore();const cipher=new CredentialCipher(Buffer.alloc(32,18).toString('base64'));const base={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,provider:'square' as const,externalId:'merchant-one',encryptedCredentials:cipher.encrypt({accessToken:'secret',refreshToken:'refresh'}),status:'active' as const,createdAt:'2026-07-20T10:00:00.000Z',updatedAt:'2026-07-20T11:00:00.000Z'};const health=new TenantHealthService(store,config)
    await store.saveIntegrationAccount({...base,tokenExpiresAt:'2026-07-20T11:59:59.000Z'});expect((await health.inspect(context)).checks).toEqual(expect.arrayContaining([expect.objectContaining({key:'square_connection',status:'blocked',detail:expect.stringContaining('expired')})]))
    await store.saveIntegrationAccount({...base,tokenExpiresAt:'2026-07-21T12:00:00.000Z'});await store.createApprovalRequest({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,requestType:'integration_reconnect',reason:'Reconnect Square',status:'pending',entityType:'integration_account',entityId:base.id,payload:{provider:'square'},createdAt:'2026-07-20T11:30:00.000Z'});expect((await health.inspect(context)).checks).toEqual(expect.arrayContaining([expect.objectContaining({key:'square_connection',status:'blocked',detail:expect.stringContaining('approval')})]))
    const paused:WorkflowJob={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,workflowType:'conversation_turn',correlationId:'conversation-one',causationEventId:'message-one',dedupeKey:'integration-health-pause',runAt:'2026-07-20T11:00:00.000Z',status:'paused',attempts:1,maxAttempts:5,payload:{},lastError:'integration:square:Square OAuth token refresh failed',createdAt:'2026-07-20T11:00:00.000Z',updatedAt:'2026-07-20T11:00:00.000Z'};await store.enqueueWorkflowJob(paused);expect((await health.inspect(context)).checks).toEqual(expect.arrayContaining([expect.objectContaining({key:'square_connection',status:'blocked',detail:expect.stringContaining('paused')})]))
  })

  it('does not let stale reconnect approval evidence block a newer successful Square connection',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));const store=new MemoryStore();await store.createApprovalRequest({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,requestType:'integration_reconnect',reason:'Earlier refresh failure',status:'pending',entityType:'integration_account',entityId:'integration-one',payload:{provider:'square'},createdAt:'2026-07-20T10:00:00.000Z'});await store.saveIntegrationAccount({id:'integration-one',tenantId:context.tenantId,locationId:context.locationId,provider:'square',externalId:'merchant-one',encryptedCredentials:Buffer.from('encrypted'),status:'active',tokenExpiresAt:'2026-07-21T12:00:00.000Z',createdAt:'2026-07-20T09:00:00.000Z',updatedAt:'2026-07-20T11:00:00.000Z'});const result=await new TenantHealthService(store,config).inspect(context);expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({key:'square_connection',status:'ready',detail:expect.stringContaining('no current reconnect signal')})]))
  })

  it('surfaces only aggregate location-scoped evidence for uncertain booking outcomes',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'))
    const store=new MemoryStore();const uncertainAt='2026-07-20T10:00:00.000Z';const mutationAt='2026-07-20T09:00:00.000Z'
    const hold=(locationId:string,status:AppointmentHold['status'],suffix:string):AppointmentHold=>({id:`secret-hold-${suffix}`,tenantId:context.tenantId,locationId,clientId:`secret-client-${suffix}`,serviceId:'service-one',staffId:'staff-one',startsAt:'2026-07-21T12:00:00.000Z',timezone:'Europe/London',expectedPriceMinor:18500,currency:'GBP',provider:'square',providerCustomerId:`secret-provider-customer-${suffix}`,confirmationToken:`secret-confirmation-${suffix}`,expiresAt:'2026-07-20T11:00:00.000Z',status,bookingAttemptKey:`secret-idempotency-${suffix}`,providerOutcomeUncertainAt:uncertainAt})
    const booking=(locationId:string,suffix:string,claimed=true,claimStartedAt=mutationAt):BookingRecord=>({id:`secret-booking-${suffix}`,tenantId:context.tenantId,locationId,holdId:`secret-booking-hold-${suffix}`,clientId:`secret-booking-client-${suffix}`,bookingReference:`secret-reference-${suffix}`,priceMinor:18500,currency:'GBP',createdAt:mutationAt,provider:'square',providerBookingId:`secret-square-booking-${suffix}`,providerBookingVersion:1,providerStatus:'ACCEPTED',serviceId:'service-one',staffId:'staff-one',startsAt:'2026-07-21T12:00:00.000Z',...(claimed?{providerMutationClaim:{mutation:'cancelled',requestDigest:`secret-digest-${suffix}`,startedAt:claimStartedAt}}:{})})
    const own=hold(context.locationId,'booking','own');await store.saveHold(own);await store.saveHold(hold('location-two','booking','other-location'));await store.saveHold(hold(context.locationId,'booked','completed'))
    const ownMutation=booking(context.locationId,'own');await store.saveBookingMutation(context,'health-mutation-own',ownMutation);await store.saveBookingMutation({...context,locationId:'location-two'},'health-mutation-other',booking('location-two','other-location'));await store.saveBookingMutation(context,'health-mutation-completed',booking(context.locationId,'completed',false));await store.saveBookingMutation(context,'health-mutation-fresh',booking(context.locationId,'fresh',true,'2026-07-20T11:55:00.000Z'))
    const health=new TenantHealthService(store,config);const warning=await health.inspect(context);const check=warning.checks.find(value=>value.key==='uncertain_bookings')
    expect(check).toMatchObject({status:'warning',detail:'1 creation outcome(s) and 1 abandoned mutation claim(s) await exact provider reconciliation; the oldest has been unresolved for 3 hours.',action:expect.stringContaining('do not release')})
    expect(JSON.stringify(check)).not.toMatch(/secret-hold|secret-client|secret-provider|secret-confirmation|secret-idempotency|secret-booking|secret-reference|secret-digest/)
    await store.saveHold({...own,status:'booked'});await store.releaseBookingMutationClaim(context,ownMutation.id,ownMutation.providerMutationClaim!.requestDigest);expect((await health.inspect(context)).checks).toEqual(expect.arrayContaining([expect.objectContaining({key:'uncertain_bookings',status:'ready',detail:expect.stringContaining('1 mutation claim(s) remain within the normal execution window')})]))
  })

  it('exposes actionable mutation claim age and target without customer or provider references',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));const store=new MemoryStore()
    const booking=(locationId:string,suffix:string,mutation:'cancelled'|'rescheduled',startedAt:string):BookingRecord=>({id:`booking-${suffix}`,tenantId:context.tenantId,locationId,holdId:`secret-hold-${suffix}`,clientId:`secret-client-${suffix}`,bookingReference:`secret-reference-${suffix}`,priceMinor:18500,currency:'GBP',createdAt:'2026-07-20T09:00:00.000Z',provider:'square',providerBookingId:`secret-provider-booking-${suffix}`,providerBookingVersion:1,providerStatus:'ACCEPTED',serviceId:'service-one',staffId:'staff-one',startsAt:'2026-07-21T12:00:00.000Z',providerMutationClaim:{mutation,requestDigest:`secret-digest-${suffix}`,startedAt,...(mutation==='rescheduled'?{startsAt:'2026-07-22T15:00:00.000Z',staffId:'staff-two'}:{})}})
    await store.saveBookingMutation(context,'secret-idempotency-old',booking(context.locationId,'old','cancelled','2026-07-20T11:40:00.000Z'));await store.saveBookingMutation(context,'secret-idempotency-fresh',booking(context.locationId,'fresh','rescheduled','2026-07-20T11:55:00.000Z'));await store.saveBookingMutation({...context,locationId:'location-two'},'secret-idempotency-other',booking('location-two','other','cancelled','2026-07-20T10:00:00.000Z'))
    const server=createApp(store);const auth=(role:string,locationId=context.locationId)=>({authorization:`Bearer dev:${context.tenantId}:${locationId}:user-one:${role}`});try{expect((await server.inject({method:'GET',url:'/v1/operations/booking-mutation-claims',headers:auth('operator')})).statusCode).toBe(403);const response=await server.inject({method:'GET',url:'/v1/operations/booking-mutation-claims',headers:auth('manager')});expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('no-store');expect(response.json().claims).toEqual([{bookingId:'booking-old',mutation:'cancelled',state:'reconciliation_required',startedAt:'2026-07-20T11:40:00.000Z',ageSeconds:1200},{bookingId:'booking-fresh',mutation:'rescheduled',state:'in_flight',startedAt:'2026-07-20T11:55:00.000Z',ageSeconds:300,target:{startsAt:'2026-07-22T15:00:00.000Z',staffId:'staff-two'}}]);expect(JSON.stringify(response.json())).not.toMatch(/secret-hold|secret-client|secret-reference|secret-provider|secret-digest|secret-idempotency/)}finally{await server.close()}
  })
})
