import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import type { MessagingReliabilityEvaluation, TenantContext, VoiceReadinessAttestation } from './domain/schemas.js'
import { MemoryStore } from './repositories/memory-store.js'
import { VoiceReadinessService } from './services/voice-readiness-service.js'

const owner:TenantContext={tenantId:'tenant-one',locationId:'location-one',userId:'owner-one',role:'owner'}
const manager:TenantContext={...owner,userId:'manager-one',role:'manager'}
const now='2026-07-21T12:00:00.000Z'
const attestation:VoiceReadinessAttestation={jurisdictionCode:'NG-LA',aiDisclosureVersion:'voice-ai-v1',retentionPolicyVersion:'voice-retention-v1',recordingMode:'disabled',transferMode:'human',transferTo:'+2348012345678',controls:{aiParticipationDisclosureReviewed:true,recordingStorageDisabled:true,immediateTransferTested:true,jurisdictionRetentionReviewed:true}}

describe('voice runtime readiness boundary',()=>{
  it('binds an owner attestation to current passing SMS evidence without enabling voice',async()=>{
    const store=new MemoryStore();await store.saveMessagingReliabilityEvaluation(passingEvaluation(now));const service=new VoiceReadinessService(store,()=>new Date(now));const declaration=await service.attest(owner,attestation)
    expect(declaration).toMatchObject({policyVersion:'voice-readiness-v1',status:'attested',jurisdictionCode:'NG-LA',recordingMode:'disabled',transferMode:'human',createdBy:owner.userId})
    expect(await service.status(manager)).toMatchObject({reliabilityCurrent:true,declarationCurrent:true,voiceRuntimeAllowed:true,runtimeConfigured:false,permissions:{evaluateReliability:true,attest:false},voiceEnabled:false,evaluation:{id:declaration.messagingReliabilityEvaluationId},declaration:{id:declaration.id,transferToMasked:'+••••5678'}})
    expect(JSON.stringify(await service.status(manager))).not.toContain(attestation.transferTo)
    expect(await service.status(owner)).toMatchObject({permissions:{evaluateReliability:true,attest:true}})
    expect(await new VoiceReadinessService(store,()=>new Date(now),true).status(manager)).toMatchObject({voiceRuntimeAllowed:true,voiceEnabled:true})
    expect(await store.getAudit(owner)).toEqual([expect.objectContaining({action:'voice_readiness.attested',entityId:declaration.id,input:expect.objectContaining({jurisdictionCode:'NG-LA'}),result:expect.objectContaining({voiceEnabled:false})})])
  })

  it('requires an owner and a current passing reliability evaluation',async()=>{
    const store=new MemoryStore();const service=new VoiceReadinessService(store,()=>new Date(now));await expect(service.attest(manager,attestation)).rejects.toMatchObject({code:'ROLE_FORBIDDEN',statusCode:403});await expect(service.attest(owner,attestation)).rejects.toMatchObject({code:'VOICE_RELIABILITY_EVIDENCE_REQUIRED',statusCode:409});await store.saveMessagingReliabilityEvaluation({...passingEvaluation(now),status:'failed',voiceBuildAllowed:false});await expect(service.attest(owner,attestation)).rejects.toMatchObject({code:'VOICE_RELIABILITY_EVIDENCE_REQUIRED'});expect(await store.getLatestVoiceReadinessDeclaration(owner)).toBeUndefined()
  })

  it('fails closed when either operational evidence or the attestation is stale',async()=>{
    const store=new MemoryStore();await store.saveMessagingReliabilityEvaluation(passingEvaluation(now));let clock=new Date(now);const service=new VoiceReadinessService(store,()=>clock);await service.attest(owner,attestation);clock=new Date(Date.parse(now)+25*60*60_000);expect(await service.status(owner)).toMatchObject({reliabilityCurrent:false,declarationCurrent:true,voiceRuntimeAllowed:false,voiceEnabled:false});const refreshedAt=clock.toISOString();await store.saveMessagingReliabilityEvaluation(passingEvaluation(refreshedAt));expect(await service.status(owner)).toMatchObject({reliabilityCurrent:true,declarationCurrent:true,voiceRuntimeAllowed:true,voiceEnabled:false});clock=new Date(Date.parse(now)+91*86_400_000);expect(await service.status(owner)).toMatchObject({declarationCurrent:false,voiceRuntimeAllowed:false,voiceEnabled:false})
  })

  it('provides owner-only, validated, no-store attestation through the API',async()=>{
    const store=new MemoryStore();const current=new Date().toISOString();await store.saveMessagingReliabilityEvaluation(passingEvaluation(current));const server=createApp(store);const headers=(role:'owner'|'manager')=>({authorization:`Bearer dev:tenant-one:location-one:${role}-one:${role}`})
    try{const forbidden=await server.inject({method:'POST',url:'/v1/operations/voice-readiness/attest',headers:headers('manager'),payload:attestation});expect(forbidden.statusCode).toBe(403);const invalid=await server.inject({method:'POST',url:'/v1/operations/voice-readiness/attest',headers:headers('owner'),payload:{...attestation,recordingMode:'enabled'}});expect(invalid.statusCode).toBe(400);const created=await server.inject({method:'POST',url:'/v1/operations/voice-readiness/attest',headers:headers('owner'),payload:attestation});expect(created.statusCode).toBe(201);expect(created.headers['cache-control']).toBe('no-store');const status=await server.inject({method:'GET',url:'/v1/operations/voice-readiness',headers:headers('manager')});expect(status.statusCode).toBe(200);expect(status.headers['cache-control']).toBe('no-store');expect(status.json()).toMatchObject({reliabilityCurrent:true,declarationCurrent:true,permissions:{evaluateReliability:true,attest:false},voiceRuntimeAllowed:true,voiceEnabled:false,declaration:{transferToMasked:'+••••5678'}});expect(status.body).not.toContain(attestation.transferTo)}finally{await server.close()}
  })
})

function passingEvaluation(createdAt:string):MessagingReliabilityEvaluation{return{id:randomUUID(),tenantId:owner.tenantId,locationId:owner.locationId,policyVersion:'voice-prerequisite-v1',channel:'sms',status:'passed',voiceBuildAllowed:true,windowFrom:new Date(Date.parse(createdAt)-30*86_400_000).toISOString(),windowTo:createdAt,expiresAt:new Date(Date.parse(createdAt)+86_400_000).toISOString(),thresholds:{minimumTerminalMessages:100,minimumDeliveryRate:.98,maximumUncertainSends:0,maximumStaleNonTerminal:0,maximumPendingDeliveryIncidents:0,reconciliationMaximumAgeHours:24},metrics:{terminalMessages:100,deliveredMessages:99,failedMessages:1,deliveryRate:.99,uncertainSends:0,staleNonTerminal:0,pendingDeliveryIncidents:0,twilioCircuitState:'closed',twilioReconciliationState:'clean'},checks:['terminal_sample','delivery_rate','uncertain_sends','stale_non_terminal','delivery_incidents','twilio_circuit','twilio_reconciliation'].map(key=>({key:key as MessagingReliabilityEvaluation['checks'][number]['key'],status:'passed' as const,detail:'Passed.'})),createdBy:owner.userId,createdAt}}
