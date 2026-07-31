import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import type { OutboundMessageDelivery, ProviderReconciliationRun, TenantContext } from './domain/schemas.js'
import { MemoryStore } from './repositories/memory-store.js'
import { MessagingReliabilityService } from './services/messaging-reliability-service.js'

const context:TenantContext={tenantId:'tenant-one',locationId:'location-one',userId:'manager-one',role:'manager'}
const now='2026-07-19T12:00:00.000Z'

describe('voice prerequisite messaging reliability evidence',()=>{
  it('passes only with the fixed sample, delivery, circuit, reconciliation, and incident evidence',async()=>{
    const store=new MemoryStore();await seedPassing(store);const evaluation=await new MessagingReliabilityService(store,undefined,()=>new Date(now)).evaluate(context)
    expect(evaluation).toMatchObject({policyVersion:'voice-prerequisite-v1',status:'passed',voiceBuildAllowed:true,thresholds:{minimumTerminalMessages:100,minimumDeliveryRate:.98,reconciliationMaximumAgeHours:24},metrics:{terminalMessages:100,deliveredMessages:99,failedMessages:1,deliveryRate:.99,uncertainSends:0,staleNonTerminal:0,pendingDeliveryIncidents:0,twilioCircuitState:'closed',twilioReconciliationState:'clean'}});expect(evaluation.checks.every(value=>value.status==='passed')).toBe(true);expect((await store.getAudit(context))).toEqual([expect.objectContaining({action:'messaging_reliability.evaluated',entityId:evaluation.id})]);expect((await new MessagingReliabilityService(store,undefined,()=>new Date(now)).latest(context))).toMatchObject({current:true,voiceEnabled:false})
  })

  it('fails closed when operational evidence contains unresolved risks',async()=>{
    const store=new MemoryStore();await seedPassing(store);await saveDelivery(store,'reserved','2026-07-19T11:30:00.000Z','2026-07-19T11:30:00.000Z');await saveDelivery(store,'sent','2026-07-17T10:00:00.000Z','2026-07-17T10:00:00.000Z');await store.createApprovalRequest({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,requestType:'message_delivery_failure',reason:'Delivery failed',status:'pending',entityType:'outbound_message_delivery',entityId:randomUUID(),payload:{},createdAt:now});await store.recordProviderCircuitFailure(context,'twilio',now,1,60_000,'TIMEOUT');await store.saveProviderReconciliationRun({...cleanRun(),id:randomUUID(),status:'partial',summary:{...cleanRun().summary,providerErrors:1},errors:[{provider:'twilio',code:'TIMEOUT'}],startedAt:'2026-07-19T11:30:00.000Z',completedAt:'2026-07-19T11:31:00.000Z'})
    const evaluation=await new MessagingReliabilityService(store,undefined,()=>new Date(now)).evaluate(context);expect(evaluation.status).toBe('failed');expect(evaluation.voiceBuildAllowed).toBe(false);expect(evaluation.metrics).toMatchObject({uncertainSends:1,staleNonTerminal:1,pendingDeliveryIncidents:1,twilioCircuitState:'open',twilioReconciliationState:'unclean'});for(const key of['uncertain_sends','stale_non_terminal','delivery_incidents','twilio_circuit','twilio_reconciliation'])expect(evaluation.checks.find(value=>value.key===key)?.status).toBe('failed')
  })

  it('expires passing evidence after 24 hours and never enables voice',async()=>{
    const store=new MemoryStore();await seedPassing(store);let clock=new Date(now);const service=new MessagingReliabilityService(store,undefined,()=>clock);await service.evaluate(context);clock=new Date(Date.parse(now)+25*60*60_000);expect(await service.latest(context)).toMatchObject({current:false,voiceEnabled:false,evaluation:{status:'passed',voiceBuildAllowed:true}})
  })

  it('is manager-readable, operator-forbidden, no-store, and location isolated through the API',async()=>{
    const store=new MemoryStore();await seedPassing(store);const server=createApp(store)
    try{const operator=await server.inject({method:'POST',url:'/v1/operations/messaging-reliability/evaluate',headers:{authorization:'Bearer dev:tenant-one:location-one:operator-one:operator'}});expect(operator.statusCode).toBe(403);const evaluated=await server.inject({method:'POST',url:'/v1/operations/messaging-reliability/evaluate',headers:{authorization:'Bearer dev:tenant-one:location-one:manager-one:manager'}});expect(evaluated.statusCode).toBe(201);expect(evaluated.headers['cache-control']).toBe('no-store');expect(evaluated.json()).toMatchObject({policyVersion:'voice-prerequisite-v1'});expect(evaluated.json()).not.toHaveProperty('voiceEnabled');const other=await server.inject({method:'GET',url:'/v1/operations/messaging-reliability',headers:{authorization:'Bearer dev:tenant-one:location-two:manager-two:manager'}});expect(other.json()).toEqual({current:false,voiceEnabled:false})}finally{await server.close()}
  })
})

async function seedPassing(store:MemoryStore){for(let index=0;index<100;index++)await saveDelivery(store,index===0?'failed':'delivered','2026-07-18T12:00:00.000Z','2026-07-18T12:01:00.000Z');await store.recordProviderCircuitSuccess(context,'twilio',now);await store.saveProviderReconciliationRun(cleanRun())}
async function saveDelivery(store:MemoryStore,status:OutboundMessageDelivery['status'],createdAt:string,updatedAt:string){const value:OutboundMessageDelivery={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,clientId:'client-one',channel:'sms',purpose:'transactional',to:'+447700900181',correlationId:randomUUID(),idempotencyKey:randomUUID(),status:'reserved',createdAt,updatedAt:createdAt};const reserved=await store.reserveOutboundMessageDelivery(value);await store.saveOutboundMessageDelivery({...reserved.delivery,status,providerMessageId:status==='reserved'?undefined:randomUUID(),updatedAt})}
function cleanRun():ProviderReconciliationRun{return{id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,requestedBy:context.userId,providers:['twilio'],maxRecords:50,status:'completed',summary:{checked:100,findings:0,critical:0,warnings:0,providerErrors:0,alertsOpened:0},findings:[],errors:[],startedAt:'2026-07-19T10:00:00.000Z',completedAt:'2026-07-19T10:05:00.000Z'}}
